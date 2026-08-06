import { LocaleLink as Link } from '../../components/locale-link';
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

function bandLabel(band: 'low' | 'medium' | 'high'): string {
  return `${band.charAt(0).toUpperCase()}${band.slice(1)} confidence`;
}

function percent(confidence: number): string {
  if (!Number.isFinite(confidence)) return 'unknown';
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
  const scaleCopy = grindScaleType ? copy.GRIND_SCALE_COPY[grindScaleType] : null;

  return (
    <section className={styles.section} aria-labelledby="grind-conversions">
      <h2 id="grind-conversions">Grind settings on other grinders</h2>

      <p>
        A number on a grinder dial only means something on that grinder — even two
        units of the same model differ. So instead of pretending &ldquo;18&rdquo; travels,
        BrewCult records what people actually landed on after switching, and shows you
        the spread.
      </p>
      {scaleCopy ? <p className="bc-muted">{scaleCopy}</p> : null}

      {conversions.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>
              Community-recorded settings equivalent to a setting on the {grinderName}. Every
              row is an approximate starting point.
            </caption>
            <thead>
              <tr>
                <th scope="col">On the {grinderName}</th>
                <th scope="col">Grinder</th>
                <th scope="col">Approximate start</th>
                <th scope="col">How much to trust it</th>
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
                    <span className={styles.paramNote}>then adjust by taste</span>
                  </td>
                  <td>
                    <span className={styles.band}>
                      {`${bandLabel(conversion.uncertainty.band)} (${percent(conversion.uncertainty.confidence)})`}
                    </span>
                    <span className={styles.paramNote}>
                      {`${conversion.uncertainty.sample_size} ${
                        conversion.uncertainty.sample_size === 1
                          ? 'community data point'
                          : 'community data points'
                      }`}
                    </span>
                    <span className={styles.paramNote}>
                      {copy.CONFIDENCE_BAND_COPY[conversion.uncertainty.band]}
                    </span>
                    <span className={styles.paramNote}>
                      {copy.CONVERSION_SOURCE_COPY[conversion.uncertainty.source] ??
                        'Source not recorded.'}
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
              ? 'We could not load conversions just now — that is on us, not on you.'
              : `Nobody has recorded a confirmed conversion from the ${grinderName} yet.`}
          </p>
          <p>
            <strong>0 community data points</strong>, so confidence is{' '}
            <strong>none yet</strong>. When you fork a recipe onto a different grinder and log a
            brew you liked, that pair gets recorded here — that is where every number on this
            page comes from.
          </p>
          <p>
            In the meantime, use the coarse category on the recipe (fine, medium-fine, medium
            and so on). It is the one part of a grind setting that survives a change of grinder.
          </p>
        </div>
      )}

      <p className="bc-muted">
        <strong>Why these are approximate:</strong> {disclaimer}
      </p>
    </section>
  );
}
