/**
 * Per-page metadata helpers for the public SEO surface (§23.1, CAT-09, REC-06).
 *
 * `app/layout.tsx` already sets `metadataBase`, the title template
 * (`%s · BrewCult`), the default OG image and the Twitter card. This module
 * exists so every catalog page produces the *same shape* on top of that —
 * canonical, OG url/title/description, and a description that is a real
 * sentence rather than a truncated field dump.
 *
 * Canonical policy:
 *  - A detail page canonicalises to itself.
 *  - A filtered hub page canonicalises to *its filtered URL* — "washed
 *    Ethiopian coffees" is a page worth ranking, not a duplicate of /coffee.
 *  - A **cursor** page canonicalises to the unfiltered-by-cursor URL and is
 *    marked `noindex, follow`: page 4 of an opaque keyset cursor is not a
 *    landing page, and its URL is not stable enough to be one.
 */
import { type Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://brewcult.coffee').replace(
  /\/+$/,
  '',
);

/** The shared OG card that ships in `public/`. Per-entity cards are a later win. */
export const OG_IMAGE_PATH = '/og-1200x630.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Site-relative path → absolute URL. Absolute inputs pass through untouched. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Trim to a whole word within `max` characters and append an ellipsis.
 * Meta descriptions are cut around 155–160 characters in practice; cutting
 * mid-word looks like a bug to a human reader.
 */
export function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[,;:.\s]+$/, '')}…`;
}

/** Join sentence fragments, dropping blanks, with no double spaces or stray dots. */
export function sentence(...parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PageMetadataInput {
  /** Goes through the layout's `%s · BrewCult` template. */
  title: string;
  description: string;
  /** Site-relative canonical path. */
  path: string;
  /** Defaults to `title`; set when the social title should read differently. */
  ogTitle?: string;
  /** `false` for cursor/paginated URLs. */
  index?: boolean;
}

/**
 * The one place a catalog page's `Metadata` is assembled. Every page gets a
 * canonical, an absolute OG url and the shared OG image — the three things that
 * are individually easy to forget and collectively decide whether a shared link
 * looks like a product or like a 404.
 */
export function buildPageMetadata({
  title,
  description,
  path,
  ogTitle,
  index = true,
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const shortDescription = truncate(description);

  return {
    title,
    description: shortDescription,
    alternates: { canonical: path },
    ...(index ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: 'website',
      siteName: 'BrewCult',
      title: `${ogTitle ?? title} · BrewCult`,
      description: shortDescription,
      url,
      images: [
        {
          url: OG_IMAGE_PATH,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          alt: 'BrewCult',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${ogTitle ?? title} · BrewCult`,
      description: shortDescription,
      images: [OG_IMAGE_PATH],
    },
  };
}

/** Metadata for a slug/id that did not resolve. Never indexable. */
export function notFoundMetadata(what: string): Metadata {
  return {
    title: `${what} not found`,
    description: `We could not find that ${what.toLowerCase()}.`,
    robots: { index: false, follow: false },
  };
}

/* ------------------------------------------------------------------ *
 * Per-entity title/description builders
 * ------------------------------------------------------------------ */

export interface CoffeeSeoInput {
  slug: string;
  name: string;
  roasterName: string;
  originLabel?: string | null;
  processLabel?: string | null;
  roastLevelLabel?: string | null;
  tastingNotes?: string[];
}

/**
 * "Ethiopia Chelbesa, Washed by Cascara Roasting Co." — the roaster belongs in
 * the title because "[coffee] [roaster]" is how people actually search for a
 * bag they are holding.
 */
export function coffeeMetadata(coffee: CoffeeSeoInput): Metadata {
  const notes =
    coffee.tastingNotes && coffee.tastingNotes.length > 0
      ? `Tasting notes: ${coffee.tastingNotes.join(', ')}.`
      : null;
  const provenance = [coffee.originLabel, coffee.processLabel, coffee.roastLevelLabel]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return buildPageMetadata({
    title: `${coffee.name} — ${coffee.roasterName}`,
    description: sentence(
      `${coffee.name} from ${coffee.roasterName}.`,
      provenance === '' ? null : `${provenance}.`,
      notes,
      'Brewing recipes, provenance and freshness guidance.',
    ),
    path: `/coffee/${coffee.slug}`,
  });
}

export interface RoasterSeoInput {
  slug: string;
  name: string;
  location?: string | null;
  coffeeCount?: number;
}

export function roasterMetadata(roaster: RoasterSeoInput): Metadata {
  const where = roaster.location ? `Roasting in ${roaster.location}.` : null;
  const count =
    typeof roaster.coffeeCount === 'number' && roaster.coffeeCount > 0
      ? `${roaster.coffeeCount} ${roaster.coffeeCount === 1 ? 'coffee' : 'coffees'} in the BrewCult catalogue,`
      : 'Coffees in the BrewCult catalogue,';

  return buildPageMetadata({
    title: `${roaster.name} — coffees and recipes`,
    description: sentence(
      `${roaster.name}.`,
      where,
      `${count} with origins, processes, tasting notes and community brewing recipes.`,
    ),
    path: `/roaster/${roaster.slug}`,
  });
}

export interface EquipmentSeoInput {
  slug: string;
  name: string;
  brandName: string;
  categoryLabel: string;
  isGrinder?: boolean;
}

/**
 * Grinders get "grind settings" in the title on purpose: "[grinder] setting for
 * espresso" is the high-intent, weak-incumbent query §23.1 calls out, and the
 * conversion table on the page is the thing that answers it.
 */
export function equipmentMetadata(equipment: EquipmentSeoInput): Metadata {
  const full = `${equipment.brandName} ${equipment.name}`;
  const title = equipment.isGrinder
    ? `${full} grind settings and recipes`
    : `${full} — specs and recipes`;

  return buildPageMetadata({
    title,
    // Kept short enough that the honesty clause survives `truncate()` — the
    // "confidence and sample size" promise is the reason to click.
    description: equipment.isGrinder
      ? sentence(
          `${full} grind settings, specs and recipes.`,
          'Community grind conversions between grinders, each with its confidence and sample size shown.',
        )
      : sentence(
          `${full} specifications and brewing recipes.`,
          `${equipment.categoryLabel} details, compatible recipes and the coffees people brew on it.`,
        ),
    path: `/equipment/${equipment.slug}`,
  });
}

export interface RecipeSeoInput {
  id: string;
  title: string;
  methodLabel: string;
  brewerName?: string | null;
  coffeeName?: string | null;
  authorName?: string | null;
}

export function recipeMetadata(recipe: RecipeSeoInput): Metadata {
  const forCoffee = recipe.coffeeName ? ` for ${recipe.coffeeName}` : '';
  const onBrewer = recipe.brewerName ? ` on the ${recipe.brewerName}` : '';
  const by = recipe.authorName ? ` by ${recipe.authorName}` : '';

  return buildPageMetadata({
    title: recipe.title,
    description: sentence(
      `${recipe.methodLabel} recipe${forCoffee}${onBrewer}${by}.`,
      'Dose, water, ratio, temperature, grind and the full pour schedule — a starting point to dial in from.',
    ),
    path: `/recipes/${recipe.id}`,
  });
}

/* ------------------------------------------------------------------ *
 * Hub pages
 * ------------------------------------------------------------------ */

export interface HubMetadataInput {
  title: string;
  description: string;
  basePath: string;
  /** Active filters, already normalised. Order-stable so canonicals are stable. */
  filters?: Record<string, string | undefined>;
  /** Present ⇒ this is a cursor page ⇒ noindex. */
  cursor?: string | undefined;
}

/** Canonical path for a hub page: filters in, cursor out. */
export function hubCanonicalPath(
  basePath: string,
  filters: Record<string, string | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

export function hubMetadata({
  title,
  description,
  basePath,
  filters = {},
  cursor,
}: HubMetadataInput): Metadata {
  return buildPageMetadata({
    title,
    description,
    path: hubCanonicalPath(basePath, filters),
    index: cursor === undefined || cursor === '',
  });
}

/* ------------------------------------------------------------------ *
 * Sitemap contributions
 * ------------------------------------------------------------------ */

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

/**
 * The static hub routes this lane adds. `app/sitemap.ts` is owned elsewhere —
 * spread these into its route list (see the lane report) rather than
 * duplicating the literals there.
 */
export const CATALOG_HUB_SITEMAP_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: 'daily' | 'weekly';
}[] = [
  { path: '/coffee', priority: 0.9, changeFrequency: 'daily' },
  { path: '/roaster', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/equipment', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/recipes', priority: 0.9, changeFrequency: 'daily' },
];

export interface SitemapSources {
  coffees?: { slug: string; updated_at?: string }[];
  roasters?: { slug: string; updated_at?: string }[];
  equipment?: { slug: string; updated_at?: string }[];
  recipes?: { id: string; updated_at?: string | null }[];
}

/**
 * Build every catalog sitemap entry — hubs plus one row per entity.
 *
 * Kept as a pure function so `app/sitemap.ts` stays a four-line file that
 * fetches and spreads, and so this is testable without a Next runtime.
 */
export function catalogSitemapEntries(
  sources: SitemapSources = {},
  now: Date = new Date(),
): SitemapEntry[] {
  const lastModified = (iso?: string | null): Date => {
    if (!iso) return now;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? now : date;
  };

  const entries: SitemapEntry[] = CATALOG_HUB_SITEMAP_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  for (const coffee of sources.coffees ?? []) {
    entries.push({
      url: absoluteUrl(`/coffee/${coffee.slug}`),
      lastModified: lastModified(coffee.updated_at),
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }
  for (const roaster of sources.roasters ?? []) {
    entries.push({
      url: absoluteUrl(`/roaster/${roaster.slug}`),
      lastModified: lastModified(roaster.updated_at),
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }
  for (const model of sources.equipment ?? []) {
    entries.push({
      url: absoluteUrl(`/equipment/${model.slug}`),
      lastModified: lastModified(model.updated_at),
      changeFrequency: 'monthly',
      priority: 0.7,
    });
  }
  for (const recipe of sources.recipes ?? []) {
    entries.push({
      url: absoluteUrl(`/recipes/${recipe.id}`),
      lastModified: lastModified(recipe.updated_at),
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }

  return entries;
}

/**
 * Official profiles for the Organization entity's `sameAs`.
 *
 * Comma-separated absolute URLs in NEXT_PUBLIC_BRAND_PROFILES. Empty by
 * default and empty is CORRECT until the accounts exist: `sameAs` is a claim
 * that these profiles are ours, and pointing it at a handle somebody else owns
 * is worse than omitting it entirely. Anything that is not an https URL is
 * dropped rather than emitted broken.
 */
export function brandSameAs(): string[] {
  return (process.env.NEXT_PUBLIC_BRAND_PROFILES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('https://'));
}
