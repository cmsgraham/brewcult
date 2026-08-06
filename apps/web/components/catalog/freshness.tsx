import type { CoffeeDetail } from './catalog-api';
import styles from './catalog.module.css';
import { catalogCopy, daysSince, formatDate } from './copy';

/**
 * Roast-date context (§6.2 — "freshness is a logistics requirement, not
 * metadata").
 *
 * A roast date printed without explanation is a date. The useful content is
 * *what it means*: filter peaks roughly 4–21 days off roast, espresso usually
 * wants 7–14 days of rest, and "fresher" is not a synonym for "better" while
 * the coffee is still degassing. That sentence is the reason a beginner would
 * bookmark this page, so it is rendered whether or not we have batch data.
 *
 * The day count is computed from a `now` that the caller can inject, so tests
 * are deterministic and the server does not disagree with a stale cache.
 */

function restingAdvice(days: number, intendedUse: CoffeeDetail['intended_use']): string {
  if (days < 0) return 'Roasted in the future, apparently — that is a data problem, not a coffee one.';
  if (days <= 3) {
    return intendedUse === 'espresso'
      ? 'Very fresh and still degassing. Espresso from this will likely gush and taste sharp — give it a week.'
      : 'Very fresh and still degassing. Expect a big bloom and a slower drawdown; it often gets easier around day 5.';
  }
  if (days <= 21) {
    return intendedUse === 'espresso' && days < 7
      ? 'Approaching its window for espresso — the last few days of rest usually settle the shot down.'
      : 'In the window most people find best for filter brewing.';
  }
  if (days <= 45) {
    return 'Past its brightest, but far from bad — expect sweeter, rounder, less aromatic. Try a slightly finer grind or hotter water.';
  }
  return 'Well past its peak. Still drinkable, and honestly still better than most coffee — just do not judge the lot by this bag.';
}

export function FreshnessSection({
  coffee,
  now = new Date(),
  locale = 'en',
}: {
  coffee: CoffeeDetail;
  now?: Date;
  /** Which language the explainer is written in. */
  locale?: string;
}) {
  const copy = catalogCopy(locale);
  const batches = (coffee.roast_batches ?? [])
    .filter((batch) => typeof batch?.roast_date === 'string')
    .slice(0, 5);

  return (
    <section className={styles.section} aria-labelledby="freshness">
      <h2 id="freshness">Roast date and freshness</h2>
      <p>{copy.FRESHNESS_EXPLAINER}</p>

      {batches.length === 0 ? (
        <div className={styles.explainer}>
          <p>{copy.FRESHNESS_NO_BATCH_COPY}</p>
        </div>
      ) : (
        <>
          <p className="bc-muted">Roast batches we know about for this coffee:</p>
          <ul className={styles.pours}>
            {batches.map((batch) => {
              const days = daysSince(batch.roast_date, now);
              return (
                <li className={styles.pour} key={batch.id}>
                  <span className={styles.pourTime}>
                    {days === null ? '—' : days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`}
                  </span>
                  <span>{formatDate(batch.roast_date) ?? batch.roast_date}</span>
                  <span className="bc-muted">
                    {days === null ? '' : restingAdvice(days, coffee.intended_use)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="bc-muted">
            Day counts are from today, so they move as the page ages — that is the point.
          </p>
        </>
      )}
    </section>
  );
}
