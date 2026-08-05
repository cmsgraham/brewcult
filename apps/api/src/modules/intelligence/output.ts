/**
 * Output handling — AI-08, EF §3.4 ("output handling").
 *
 * Two independent jobs:
 *
 * 1. SANITIZATION. `model output is rendered as text/markdown with sanitization
 *    — never interpreted as HTML, never executed, never used to construct
 *    queries.` The model is not trusted to be well-behaved, because its input
 *    contains other people's text. Everything that could become executable or
 *    navigable in a renderer is neutralised HERE, server-side, so a client bug
 *    (a stray `dangerouslySetInnerHTML`) cannot turn a model answer into XSS.
 *
 * 2. ENTITY ALLOWLIST. `entity references in AI answers resolve through an
 *    allowlist lookup (ID must exist and be visible to the user).` Three gates,
 *    all of which must pass before an id reaches a response:
 *      a. the model must have SEEN it in a tool result this conversation
 *         (`SeenEntities`) — otherwise it is a hallucination even if it exists;
 *      b. it must EXIST in the graph;
 *      c. it must be VISIBLE to the requester, decided by the same policy layer
 *         the routes use.
 *    A reference that fails any gate is replaced with plain descriptive text and
 *    never emitted as a link. The answer degrades; it never lies.
 */

import { can, type Actor } from '../../lib/policy.js';
import {
  BREW_SESSION_RESOURCE,
  RECIPE_RESOURCE,
  findBrewSessionResource,
  findRecipeResource,
  getRecipeRow,
} from '../brewing/index.js';
import { getCoffeeBySlug, getEquipmentById } from '../catalog/index.js';
import type { EntityReference, IntelligenceDb } from './types.js';
import type { SeenEntities } from './tools/context.js';

// ---------------------------------------------------------------------------
// 1. Markdown sanitization
// ---------------------------------------------------------------------------

/** URL schemes a renderer must never be handed. */
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript|data|file|blob):/gi;

/**
 * Sanitizes model output down to inert markdown.
 *
 * The approach is ESCAPE, not strip-tags. A tag-stripping regex is a losing
 * game against `<img src=x onerror=…>` variants; escaping `<`, `>` and `&`
 * means no sequence of characters the model can emit is a tag in any renderer,
 * whether it renders markdown or (by mistake) HTML.
 *
 * What survives: markdown emphasis, lists, links written as `[text](path)` with
 * a safe scheme, code fences, tables. That is everything §7 needs.
 */
export function sanitizeMarkdown(raw: string): string {
  let text = raw
    // Unicode format chars: invisible, and a known way to smuggle payloads.
    .replace(/\p{Cf}/gu, '')
    // HTML entity-ish sequences would survive escaping and re-form later.
    .replace(/&(?=[#a-zA-Z])/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown links/images with a dangerous scheme lose the target, keep the label.
  text = text.replace(/!?\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g, (match, label: string, href: string) =>
    isSafeHref(href) ? match : label,
  );
  // Any remaining bare dangerous scheme (autolinked by a renderer) is defanged.
  text = text.replace(DANGEROUS_SCHEME, 'blocked:');

  return text.trim();
}

/** Only same-origin app paths and plain https links survive. */
export function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  if (DANGEROUS_SCHEME.test(value)) {
    DANGEROUS_SCHEME.lastIndex = 0;
    return false;
  }
  DANGEROUS_SCHEME.lastIndex = 0;
  return value.startsWith('/') || value.startsWith('https://') || value.startsWith('#');
}

// ---------------------------------------------------------------------------
// 2. Entity reference allowlist
// ---------------------------------------------------------------------------

/** `[[coffee:chelbesa]]`, `[[recipe:0189…]]`, `[[equipment:…]]`, `[[brew:…]]`. */
const REFERENCE = /\[\[(coffee|recipe|equipment|brew):([A-Za-z0-9_-]{1,128})\]\]/g;

export interface ResolvedOutput {
  /** Sanitized markdown with every surviving reference rendered as a link. */
  text: string;
  /** Only entities that passed all three gates. */
  entities: EntityReference[];
  /** References the model emitted that did not resolve. Logged, not shown. */
  rejected: { type: string; id: string; reason: 'unseen' | 'missing' | 'not_visible' }[];
}

export interface ResolveOptions {
  db: IntelligenceDb;
  actor: Actor;
  seen: SeenEntities;
}

/**
 * Sanitizes, then resolves every entity reference through the allowlist.
 *
 * Run order matters: sanitization first, so a reference smuggled inside an
 * escaped tag never becomes a link.
 */
export async function resolveOutput(raw: string, opts: ResolveOptions): Promise<ResolvedOutput> {
  const sanitized = sanitizeMarkdown(raw);

  const found: { type: string; id: string; token: string }[] = [];
  for (const match of sanitized.matchAll(REFERENCE)) {
    found.push({ type: match[1] as string, id: match[2] as string, token: match[0] });
  }

  const entities: EntityReference[] = [];
  const rejected: ResolvedOutput['rejected'] = [];
  const replacements = new Map<string, string>();

  for (const ref of found) {
    if (replacements.has(ref.token)) continue;
    const resolution = await resolveOne(ref.type, ref.id, opts);
    if (resolution.ok) {
      if (!entities.some((e) => e.type === resolution.entity.type && e.id === resolution.entity.id)) {
        entities.push(resolution.entity);
      }
      replacements.set(ref.token, `[${resolution.entity.label}](${resolution.entity.href})`);
    } else {
      rejected.push({ type: ref.type, id: ref.id, reason: resolution.reason });
      // Degrade to neutral prose rather than leaving a raw token in the answer.
      replacements.set(ref.token, 'that item');
    }
  }

  let text = sanitized;
  for (const [token, replacement] of replacements) {
    text = text.split(token).join(replacement);
  }
  // Any malformed `[[…]]` the regex did not claim is stripped rather than shown.
  text = text.replace(/\[\[[^\]]{0,200}\]\]/g, '');

  return { text: text.trim(), entities, rejected };
}

type Resolution =
  | { ok: true; entity: EntityReference }
  | { ok: false; reason: 'unseen' | 'missing' | 'not_visible' };

async function resolveOne(type: string, id: string, opts: ResolveOptions): Promise<Resolution> {
  switch (type) {
    case 'coffee': {
      // Gate (a): the model must have been given this slug by a tool.
      if (!opts.seen.has('coffee', id)) return { ok: false, reason: 'unseen' };
      const coffee = await getCoffeeBySlug(opts.db, id).catch(() => null);
      if (!coffee) return { ok: false, reason: 'missing' };
      if (!(await can(opts.actor, 'read', 'coffee_product'))) {
        return { ok: false, reason: 'not_visible' };
      }
      return {
        ok: true,
        entity: {
          type: 'coffee',
          id: coffee.slug,
          label: `${coffee.name} (${coffee.roaster.name})`,
          href: `/coffee/${coffee.slug}`,
        },
      };
    }
    case 'equipment': {
      if (!opts.seen.has('equipment', id)) return { ok: false, reason: 'unseen' };
      const model = await getEquipmentById(opts.db, id).catch(() => null);
      if (!model) return { ok: false, reason: 'missing' };
      if (!(await can(opts.actor, 'read', 'equipment_model'))) {
        return { ok: false, reason: 'not_visible' };
      }
      return {
        ok: true,
        entity: {
          type: 'equipment',
          id: model.id,
          label: `${model.brand.name} ${model.name}`,
          href: `/equipment/${model.slug}`,
        },
      };
    }
    case 'recipe': {
      if (!opts.seen.has('recipe', id)) return { ok: false, reason: 'unseen' };
      const resource = await findRecipeResource(opts.db, id).catch(() => null);
      if (!resource) return { ok: false, reason: 'missing' };
      // Gate (c): the SAME policy the routes use, on the SAME loaded row.
      if (!(await can(opts.actor, 'read', RECIPE_RESOURCE, resource))) {
        return { ok: false, reason: 'not_visible' };
      }
      const row = await getRecipeRow(opts.db, id).catch(() => null);
      return {
        ok: true,
        entity: {
          type: 'recipe',
          id,
          label: row ? sanitizeMarkdown(row.title).slice(0, 120) : 'recipe',
          href: `/recipes/${id}`,
        },
      };
    }
    case 'brew': {
      if (!opts.seen.has('brew', id)) return { ok: false, reason: 'unseen' };
      const resource = await findBrewSessionResource(opts.db, id).catch(() => null);
      if (!resource) return { ok: false, reason: 'missing' };
      if (!(await can(opts.actor, 'read', BREW_SESSION_RESOURCE, resource))) {
        return { ok: false, reason: 'not_visible' };
      }
      return {
        ok: true,
        entity: { type: 'brew', id, label: 'your brew', href: `/brew/${id}` },
      };
    }
    default:
      return { ok: false, reason: 'missing' };
  }
}
