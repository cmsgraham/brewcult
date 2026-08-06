'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  describeBasis,
  fetchStartingRecipe,
  type AiFailure,
  type AiStartingRecipe,
} from '../../lib/ai-client';
import { EntityLinks } from './entity-links';
import { SafeMarkdown } from './markdown';
import styles from './ai.module.css';
import { useTranslate } from '../locale-provider';

export interface StartingRecipeCardProps {
  coffeeProductId: string;
  /** Used only for copy ("for Ethiopia Chelbesa"). */
  coffeeName?: string;
  brewerModelId?: string;
  grinderModelId?: string;
  fetchImpl?: FetchLike;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; recipe: AiStartingRecipe }
  | { status: 'failed'; failure: AiFailure };

/**
 * "Get a starting recipe for my setup" — the purchase → brew bridge (§7.1).
 *
 * Drop-in for a coffee detail page. It is **opt-in by a tap**: nothing is
 * generated, no tokens are spent and no model is consulted until someone asks,
 * which keeps a public, cacheable SEO page public and cacheable.
 *
 * The basis line is the point of the card as much as the numbers are. A recipe
 * grounded in the roaster's own is worth more than one invented from priors, and
 * the reader is told which of the two they are looking at (§7.2.1).
 */
export function StartingRecipeCard({
  coffeeProductId,
  coffeeName,
  brewerModelId,
  grinderModelId,
  fetchImpl,
}: StartingRecipeCardProps) {
  const t = useTranslate();
  const [state, setState] = useState<State>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const request = async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading' });

    const result = await fetchStartingRecipe(
      {
        coffee_product_id: coffeeProductId,
        ...(brewerModelId ? { brewer_model_id: brewerModelId } : {}),
        ...(grinderModelId ? { grinder_model_id: grinderModelId } : {}),
      },
      { signal: controller.signal, ...(fetchImpl ? { fetchImpl } : {}) },
    );
    if (controller.signal.aborted) return;

    setState(
      result.ok
        ? { status: 'ready', recipe: result.recipe }
        : { status: 'failed', failure: result.failure },
    );
  };

  const subject = coffeeName ? `for ${coffeeName}` : 'for this coffee';

  return (
    <section className={`bc-panel ${styles.recipeCard}`} aria-labelledby="ai-starting-recipe">
      <h2 id="ai-starting-recipe" className={styles.recipeHeading}>
        Not sure where to start?
      </h2>
      <p className="bc-muted">
        A starting point {subject} on your gear — the roaster&apos;s recipe if there is one,
        what the community brews if there isn&apos;t, and an honest note about which.
      </p>

      {state.status !== 'ready' ? (
        <p>
          <button
            type="button"
            className="bc-button"
            onClick={() => void request()}
            disabled={state.status === 'loading'}
          >
            {state.status === 'loading'
              ? t('ai.workingOut')
              : t('ai.getStarting')}
          </button>
        </p>
      ) : null}

      {/* Politely announced: the reader asked for this, so they are waiting. */}
      <div role="status" aria-live="polite">
        {state.status === 'loading' ? (
          <p className="bc-muted">{t('ai.lookingAt')}</p>
        ) : null}

        {state.status === 'failed' ? (
          <p className="bc-muted">
            {state.failure.kind === 'budget'
              ? state.failure.message
              : state.failure.kind === 'error'
                ? state.failure.message
                : "The recipe assistant isn't available right now — the recipes below are a good place to start instead."}
          </p>
        ) : null}

        {state.status === 'ready' ? (
          <div className={styles.recipeBody}>
            {state.recipe.summary ? <SafeMarkdown text={state.recipe.summary} /> : null}

            {state.recipe.steps.length > 0 ? (
              <dl className={styles.recipeSpec}>
                {state.recipe.steps.map((step) => (
                  <div key={step.label} className={styles.recipeRow}>
                    <dt>{step.label}</dt>
                    <dd>{step.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {state.recipe.notes ? <SafeMarkdown text={state.recipe.notes} /> : null}

            <p className={`bc-muted ${styles.quiet}`}>{describeBasis(state.recipe.basis)}</p>

            <EntityLinks entities={state.recipe.entities} />

            <p className={styles.recipeActions}>
              <Link
                className="bc-button"
                href={`/brew?coffee_product_id=${encodeURIComponent(coffeeProductId)}`}
              >
                Log a brew with this
              </Link>
              <button type="button" className="bc-button bc-button--quiet" onClick={() => void request()}>
                Try again
              </button>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
