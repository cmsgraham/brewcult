import Link from 'next/link';
import type { BreadcrumbEntry } from '../../lib/structured-data';
import styles from './catalog.module.css';

/**
 * Visible breadcrumb trail. The same `entries` array feeds
 * `breadcrumbJsonLd()`, so the markup and the structured data can never drift —
 * a mismatch between the two is a structured-data violation, not just a bug.
 *
 * The current page is the last crumb and is not a link (nothing to navigate to)
 * but is still announced via `aria-current`.
 */
export function Breadcrumbs({ entries }: { entries: BreadcrumbEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
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
