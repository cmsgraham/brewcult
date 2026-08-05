/**
 * EVAL: dial-in golden set — AI-06, AI-07, second_draft §16.2, EF §1.4.
 *
 * `Golden-set evals for dial-in advice (does sour+weak -> "grind finer" style
 * reasoning hold?), regression-run on every prompt/model change.` This file is a
 * TEST: it lives in CI and a failure blocks the merge.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 * 1. THE CAUSAL DIRECTION. Sour/weak is under-extraction and the fix must move
 *    extraction UP (finer / hotter / longer / more). Bitter is over-extraction
 *    and the fix must move it DOWN (coarser / cooler / shorter / less). A good
 *    brew gets HOLD. Getting the sign wrong is the one failure that actively
 *    makes someone's coffee worse, so it is asserted first and hardest.
 * 2. EXACTLY ONE VARIABLE (§7.2 rule 2). The structured field carries one
 *    variable by construction, and the prose is checked too: the advice may
 *    prescribe at most one lever. The reasoning is allowed to mention others —
 *    "temperature does the same job" is teaching, not a second instruction.
 * 3. GROUNDING AND UNCERTAINTY are present and non-empty (§7.2 rules 1 and 3).
 *
 * ── Fake vs live ────────────────────────────────────────────────────────────
 * Default: the injected `FakeAiProvider`, which derives its answer by parsing
 * the taste verdict out of the ASSEMBLED PROMPT. So in CI this suite is a real
 * regression detector for prompt assembly and the response contract — drop the
 * verdict from the context and every case fails with `unclear`.
 *
 * Live: `ANTHROPIC_API_KEY=… AI_EVAL_LIVE=1 npm run test -w @brewcult/api -- test/ai-evals`
 * runs the identical assertions against the real model on `claude-sonnet-5`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DiagnoseResult } from '../../src/modules/intelligence/index.js';
import { LIVE, USER_A, createHarness, type Harness } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  // Evals are not budget tests; a shared daily cap would make later cases fail
  // for the wrong reason.
  await h.usage.reset();
});

const diagnose = async (brewSessionId: string): Promise<DiagnoseResult> => {
  const res = await h.as(USER_A, () =>
    h.app.inject({
      method: 'POST',
      url: '/v1/ai/diagnose',
      payload: { brew_session_id: brewSessionId, coffee_slug: 'chelbesa' },
    }),
  );
  expect(res.statusCode).toBe(200);
  return res.json<DiagnoseResult>();
};

/** Levers that INCREASE extraction. Any of these is a correct fix for sour/weak. */
const UP = ['finer', 'hotter', 'longer', 'more'] as const;
/** Levers that DECREASE extraction. Any of these is a correct fix for bitter. */
const DOWN = ['coarser', 'cooler', 'shorter', 'less'] as const;

/** Prescriptive lever words, for the one-variable check on the prose. */
const LEVER_WORDS = [...UP, ...DOWN] as readonly string[];

const leversMentioned = (markdown: string): string[] =>
  LEVER_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(markdown));

// ===========================================================================
describe(`dial-in golden set (${LIVE ? 'LIVE Anthropic API' : 'fake provider'})`, () => {
  it('sour -> under-extracted -> increase extraction, one variable', async () => {
    const result = await diagnose(h.ids.brewSourA);

    expect(result.diagnosis).toBe('under_extracted');
    expect(UP as readonly string[]).toContain(result.suggestion.direction);
    expect(DOWN as readonly string[]).not.toContain(result.suggestion.direction);
    expect(result.suggestion.variable).not.toBe('none');

    // Exactly one lever prescribed in the advice itself.
    expect(leversMentioned(result.advice_markdown)).toEqual([result.suggestion.direction]);
  });

  it('weak -> under-extracted -> increase extraction, one variable', async () => {
    const result = await diagnose(h.ids.brewWeakA);

    expect(result.diagnosis).toBe('under_extracted');
    expect(UP as readonly string[]).toContain(result.suggestion.direction);
    expect(leversMentioned(result.advice_markdown)).toEqual([result.suggestion.direction]);
  });

  it('bitter -> over-extracted -> decrease extraction, one variable', async () => {
    const result = await diagnose(h.ids.brewBitterA);

    expect(result.diagnosis).toBe('over_extracted');
    expect(DOWN as readonly string[]).toContain(result.suggestion.direction);
    expect(UP as readonly string[]).not.toContain(result.suggestion.direction);
    expect(leversMentioned(result.advice_markdown)).toEqual([result.suggestion.direction]);
  });

  it('good -> balanced -> HOLD, and no lever is prescribed at all', async () => {
    const result = await diagnose(h.ids.brewGoodA);

    expect(result.diagnosis).toBe('balanced');
    expect(result.suggestion.direction).toBe('hold');
    expect(result.suggestion.variable).toBe('none');
    expect(leversMentioned(result.advice_markdown)).toEqual([]);
    expect(result.advice_markdown.toLowerCase()).toMatch(/hold|repeat|again|same/);
  });

  it('agrees with the server-authoritative taste mapping in every case', async () => {
    // §6.7's mapping is duplicated in exactly two places (brewing/taste.ts and
    // the generated `brew_sessions.diagnosis` column). The AI must not become a
    // silent third opinion.
    const cases: [string, string][] = [
      [h.ids.brewSourA, 'under_extracted'],
      [h.ids.brewWeakA, 'under_extracted'],
      [h.ids.brewBitterA, 'over_extracted'],
      [h.ids.brewGoodA, 'balanced'],
    ];
    for (const [id, expected] of cases) {
      const stored = await h.pg.query<{ diagnosis: string }>(
        'SELECT diagnosis FROM brew_sessions WHERE id = $1::uuid',
        [id],
      );
      expect(stored.rows[0]?.diagnosis).toBe(expected);
      expect((await diagnose(id)).diagnosis).toBe(expected);
    }
  });

  it('always answers "why" and always names its basis (§7.1, §7.2 rules 1 and 3)', async () => {
    for (const id of [h.ids.brewSourA, h.ids.brewBitterA, h.ids.brewGoodA]) {
      const result = await diagnose(id);
      expect(result.reasoning_markdown.trim().length).toBeGreaterThan(30);
      expect(result.grounding.note.trim().length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(result.confidence);
      // Uncertainty is spoken: a general prior must not claim community backing.
      if (result.grounding.basis === 'general_priors') {
        expect(result.grounding.note.toLowerCase()).toMatch(/no community data|general/);
      }
    }
  });

  it('never emits HTML or an unresolved entity token', async () => {
    for (const id of [h.ids.brewSourA, h.ids.brewBitterA, h.ids.brewGoodA, h.ids.brewWeakA]) {
      const result = await diagnose(id);
      for (const text of [result.advice_markdown, result.reasoning_markdown]) {
        expect(text).not.toMatch(/<script|<img|<iframe|javascript:/i);
        expect(text).not.toMatch(/\[\[/);
      }
      for (const entity of result.entities) {
        expect(entity.href).toMatch(/^\/(coffee|recipes|equipment|brew)\//);
      }
    }
  });
});
