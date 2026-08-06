import { LocaleLink as Link } from '../../components/locale-link';
import type { Translator } from '../../lib/i18n';
import { localeParam, translator } from '../../lib/locale-server';
import type { GrindConversion } from './catalog-api';
import styles from './catalog.module.css';
import { catalogCopy } from './copy';

/**
 * Grind-setting conversions for one grinder (§6.4 — "the hardest domain
 * problem").
 *
 * The rule this component exists to enforce: **a converted setting is never
 * rendered without its uncertainty.** Confidence, sample size and the API's
 * disclaimer are not optional decorations that a redesign can drop — they are
 * the reason the feature is defensible. Concretely:
 *
 *  - Every row shows the confidence band *in words* and the sample size, in the
 *    same table cell region as the number itself, so neither can be skimmed
 *    past or screenshotted away.
 *  - The number is prefixed with "≈" and labelled "approximate start".
 *  - The section renders **even with zero data**, stating a sample size of 0
 *    and the disclaimer, because "we have no data for this pair" is a true and
 *    useful answer. Silence would read as "no conversion needed".
 *
 * This is also the §23.1 shareable hook — the thing r/pourover complains about
 * weekly — so it is the last place to be coy about what we do and do not know.
 */

export interface GrindConversionSectionProps {
  /** Which language the explanatory copy is written in. */
  locale?: string;
  grinderName: string;
  grindScaleType: string | null;
  conversions: GrindConversion[];
  /** Always rendered. The API sends it; a fallback exists if it does not. */
  disclaimer: string;
  /** True when the conversions endpoint itself failed (not just empty). */
  unavailable?: boolean;
}

/**
 * Named per band rather than capitalising the band token: "Low confidence"
 * happens to be `Low` + ` confidence` in English and is "Confianza baja" — two
 * words in the other order — in Spanish.
 */
function bandLabel(band: 'low' | 'medium' | 'high', t: Translator): string {
  if (band === 'low') return t('catalog.grindConversion.bandLow');
  if (band === 'high') return t('catalog.grindConversion.bandHigh');
  return t('catalog.grindConversion.bandMedium');
}

function percent(confidence: number, t: Translator): string {
  if (!Number.isFinite(confidence)) return t('catalog.grindConversion.unknownPercent');
  const clamped = Math.max(0, Math.min(1, confidence));
  return `${Math.round(clamped * 100)}%`;
}

export function GrindConversionSection({
  grinderName,
  grindScaleType,
  conversions,
  disclaimer,
  unavailable = false,
  locale = 'en',
}: GrindConversionSectionProps) {
  const copy = catalogCopy(locale);
  const t = translator(localeParam(locale));
  const scaleCopy = grindScaleType ? copy.GRIND_SCALE_COPY[grindScaleType] : null;

  return (
    <section className={styles.section} aria-labelledby="grind-conversions">
      <h2 id="grind-conversions">{t('catalog.grindConversion.heading')}</h2>

      <p>{t('catalog.grindConversion.intro')}</p>
      {scaleCopy ? <p className="bc-muted">{scaleCopy}</p> : null}

      {conversions.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>{t('catalog.grindConversion.caption', { name: grinderName })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('catalog.grindConversion.colOn', { name: grinderName })}</th>
                <th scope="col">{t('catalog.grindConversion.colGrinder')}</th>
                <th scope="col">{t('catalog.grindConversion.colApprox')}</th>
                <th scope="col">{t('catalog.grindConversion.colTrust')}</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map((conversion) => (
                <tr key={conversion.id}>
                  <td>{conversion.from_setting}</td>
                  <td>
                    {conversion.to_model.slug ? (
                      <Link href={`/equipment/${conversion.to_model.slug}`}>
                        {`${conversion.to_model.brand} ${conversion.to_model.name}`}
                      </Link>
                    ) : (
                      `${conversion.to_model.brand} ${conversion.to_model.name}`
                    )}
                  </td>
                  <td>
                    {/*
                      Composed into single strings rather than adjacent JSX
                      expressions: React separates sibling text nodes with
                      `<!-- -->` in SSR output, which would split "37 community
                      data points" across comment boundaries in the raw HTML.
                      Harmless to a rendering crawler, but this is the phrase we
                      most want lifted verbatim into a snippet.
                    */}
                    <span className={styles.approx}>{`≈ ${conversion.to_setting}`}</span>
                    <span className={styles.paramNote}>
                      {t('catalog.grindConversion.thenAdjust')}
                    </span>
                  </td>
                  <td>
                    <span className={styles.band}>
                      {t('catalog.grindConversion.bandWithPercent', {
                        band: bandLabel(conversion.uncertainty.band, t),
                        percent: percent(conversion.uncertainty.confidence, t),
                      })}
                    </span>
                    <span className={styles.paramNote}>
                      {conversion.uncertainty.sample_size === 1
                        ? t('catalog.grindConversion.samplesOne')
                        : t('catalog.grindConversion.samplesOther', {
                            count: conversion.uncertainty.sample_size,
                          })}
                    </span>
                    <span className={styles.paramNote}>
                      {copy.CONFIDENCE_BAND_COPY[conversion.uncertainty.band]}
                    </span>
                    <span className={styles.paramNote}>
                      {copy.CONVERSION_SOURCE_COPY[conversion.uncertainty.source] ??
                        t('catalog.grindConversion.sourceUnknown')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.explainer}>
          <p>
            {unavailable
              ? t('catalog.grindConversion.unavailable')
              : t('catalog.grindConversion.noneYet', { name: grinderName })}
          </p>
          <p>
            <strong>{t('catalog.grindConversion.zeroPoints')}</strong>
            {t('catalog.grindConversion.zeroPointsMid')}
            <strong>{t('catalog.grindConversion.zeroPointsNone')}</strong>
            {t('catalog.grindConversion.zeroPointsTail')}
          </p>
          <p>{t('catalog.grindConversion.useCategory')}</p>
        </div>
      )}

      <p className="bc-muted">
        <strong>{t('catalog.grindConversion.whyApproximate')}</strong> {disclaimer}
      </p>
    </section>
  );
}
