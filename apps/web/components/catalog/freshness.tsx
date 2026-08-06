import type { Translator } from '../../lib/i18n';
import { localeParam, translator } from '../../lib/locale-server';
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

function restingAdvice(
  days: number,
  intendedUse: CoffeeDetail['intended_use'],
  t: Translator,
): string {
  if (days < 0) return t('catalog.freshness.future');
  if (days <= 3) {
    return intendedUse === 'espresso'
      ? t('catalog.freshness.veryFreshEspresso')
      : t('catalog.freshness.veryFreshFilter');
  }
  if (days <= 21) {
    return intendedUse === 'espresso' && days < 7
      ? t('catalog.freshness.restingEspresso')
      : t('catalog.freshness.inWindow');
  }
  if (days <= 45) return t('catalog.freshness.pastPeak');
  return t('catalog.freshness.wellPast');
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
  const t = translator(localeParam(locale));
  const batches = (coffee.roast_batches ?? [])
    .filter((batch) => typeof batch?.roast_date === 'string')
    .slice(0, 5);

  return (
    <section className={styles.section} aria-labelledby="freshness">
      <h2 id="freshness">{t('catalog.freshness.heading')}</h2>
      <p>{copy.FRESHNESS_EXPLAINER}</p>

      {batches.length === 0 ? (
        <div className={styles.explainer}>
          <p>{copy.FRESHNESS_NO_BATCH_COPY}</p>
        </div>
      ) : (
        <>
          <p className="bc-muted">{t('catalog.freshness.batchesIntro')}</p>
          <ul className={styles.pours}>
            {batches.map((batch) => {
              const days = daysSince(batch.roast_date, now);
              return (
                <li className={styles.pour} key={batch.id}>
                  <span className={styles.pourTime}>
                    {days === null
                      ? '—'
                      : days === 0
                        ? t('catalog.freshness.today')
                        : days === 1
                          ? t('catalog.freshness.dayOne')
                          : t('catalog.freshness.dayOther', { count: days })}
                  </span>
                  <span>{formatDate(batch.roast_date) ?? batch.roast_date}</span>
                  <span className="bc-muted">
                    {days === null ? '' : restingAdvice(days, coffee.intended_use, t)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="bc-muted">{t('catalog.freshness.ageNote')}</p>
        </>
      )}
    </section>
  );
}
