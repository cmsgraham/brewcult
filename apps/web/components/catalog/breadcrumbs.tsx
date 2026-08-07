import { LocaleLink as Link } from '../../components/locale-link';
import type { BreadcrumbEntry } from '../../lib/structured-data';
import { localeParam, translator } from '../../lib/locale-server';
import styles from './catalog.module.css';

/**
 * Visible breadcrumb trail. The same `entries` array feeds
 * `breadcrumbJsonLd()`, so the markup and the structured data can never drift —
 * a mismatch between the two is a structured-data violation, not just a bug.
 *
 * The current page is the last crumb and is not a link (nothing to navigate to)
 * but is still announced via `aria-current`.
 */
export function Breadcrumbs({
  entries,
  locale,
}: {
  entries: BreadcrumbEntry[];
  /**
   * Only the landmark label is translated — crumb names arrive translated.
   *
   * Required rather than defaulting to `'en'`: the one thing this prop controls
   * is invisible on screen, so a page that forgot it looked completely correct
   * and announced "Breadcrumb" in English to the only people who could tell.
   * The coffee page forgot it for exactly that reason.
   */
  locale: string;
}) {
  if (entries.length === 0) return null;
  const t = translator(localeParam(locale));

  return (
    <nav className={styles.breadcrumbs} aria-label={t('catalog.breadcrumbLabel')}>
      <ol>
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          return (
            <li key={entry.path}>
              {isLast ? (
                <span aria-current="page">{entry.name}</span>
              ) : (
                <Link href={entry.path}>{entry.name}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
