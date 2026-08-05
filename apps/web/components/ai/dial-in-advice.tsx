'use client';

import type { TasteVerdict } from '@brewcult/shared-types';
import { useEffect, useState, type ReactNode } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  confidenceLine,
  describeBasis,
  fetchDiagnosis,
  type AiDiagnosis,
  type AiFailure,
} from '../../lib/ai-client';
import { EntityLinks } from './entity-links';
import { SafeMarkdown } from './markdown';
import styles from './ai.module.css';

export interface DialInAdviceProps {
  /** The session that was just logged. */
  brewSessionId: string;
  /** Only ever rendered for a brew the user actually tasted. */
  verdict: TasteVerdict;
  /**
   * The static payback line. Shown while we wait and kept forever if the AI has
   * nothing to add — the card must never *lose* content by asking.
   */
  fallback: ReactNode;
  fetchImpl?: FetchLike;
}

/**
 * Dial-in advice, at the only moment it is worth anything: the user has just
 * tasted the cup (brew_logger_ux §6; second_draft §7.1).
 *
 * Rules this component is built around:
 *
 *  - **Non-blocking.** The brew was persisted before this ever mounted. The
 *    request happens in an effect, off the logging path, and its result changes
 *    one paragraph. Nothing waits for it, and a slow model costs the user
 *    nothing but a slightly later paragraph.
 *  - **Silent failure.** 404 (Lane O hasn't shipped), 500, offline, or an answer
 *    we cannot parse → the existing static payback line stays exactly as it was.
 *    The user never learns that something they didn't ask for didn't happen.
 *  - **One suggestion** (§7.2.2), never two: when the AI answers, it *replaces*
 *    the static suggestion rather than stacking on top of it.
 *  - **Never shaming** (§6): the lead line is "that happens — here's the usual
 *    fix", and a bad cup is treated as ordinary, because it is.
 *  - **Honest basis** (§7.2.1/3): "based on your 3 brews of this coffee" or "no
 *    community data for this coffee yet — this is a general starting point".
 */
export function DialInAdvice({ brewSessionId, verdict, fallback, fetchImpl }: DialInAdviceProps) {
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis | null>(null);
  const [failure, setFailure] = useState<AiFailure | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    void (async () => {
      const result = await fetchDiagnosis(brewSessionId, {
        signal: controller.signal,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      if (!alive) return;
      if (result.ok) setDiagnosis(result.diagnosis);
      else setFailure(result.failure);
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [brewSessionId, fetchImpl]);

  if (!diagnosis) {
    // The allowance running out is the one failure worth mentioning, because the
    // user may be wondering where their advice went. It never replaces the
    // payback line; it sits under it, quietly, and blames nobody.
    return (
      <>
        {fallback}
        {failure?.kind === 'budget' ? (
          <p className={`bc-muted ${styles.quiet}`}>{failure.message}</p>
        ) : null}
      </>
    );
  }

  const lead =
    verdict === 'good'
      ? 'Nice one. If you want to push it further:'
      : "That happens — here's the usual fix.";
  const uncertainty = confidenceLine(diagnosis.confidence);

  return (
    <div className={styles.advice}>
      <p className={styles.adviceLead}>{lead}</p>

      {diagnosis.variable || diagnosis.direction ? (
        <p className={styles.adviceTag}>
          {[diagnosis.variable, diagnosis.direction].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <div className={styles.adviceBody}>
        <SafeMarkdown text={diagnosis.advice} />
      </div>

      <p className={`bc-muted ${styles.quiet}`}>{describeBasis(diagnosis.basis)}</p>
      {uncertainty ? <p className={`bc-muted ${styles.quiet}`}>{uncertainty}</p> : null}

      <EntityLinks entities={diagnosis.entities} />
    </div>
  );
}
