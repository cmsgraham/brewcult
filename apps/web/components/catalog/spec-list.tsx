import { LocaleLink as Link } from '../../components/locale-link';
import { Fragment, type ReactNode } from 'react';
import styles from './catalog.module.css';

export interface SpecRow {
  label: string;
  /** Rendered as-is when present. `null`/empty rows are dropped, never shown
   *  as "—": a blank row tells the reader nothing and costs a scan line. */
  value: ReactNode;
  /** When set, the value is wrapped in a link — this is how a spec row becomes
   *  an edge in the entity graph (§5: no free text where a reference exists). */
  href?: string;
}

/** Definition list of facts. The workhorse of every detail page. */
export function SpecList({ rows }: { rows: SpecRow[] }) {
  const visible = rows.filter(
    (row) => row.value !== null && row.value !== undefined && row.value !== '',
  );
  if (visible.length === 0) return null;

  return (
    <dl className={styles.specs}>
      {visible.map((row) => (
        // A Fragment (not a wrapper element) so `dt`/`dd` stay direct children
        // of the `dl` grid — a wrapper would need `display: contents` and break
        // the row alignment on browsers that treat it inconsistently.
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.href ? <Link href={row.href}>{row.value}</Link> : row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Pill list — tasting notes, varietals, puck prep. Never links: these are
 *  vocabularies, not entities, and a link that filters nothing is a dead end. */
export function TagList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.tags} aria-label={label}>
      {items.map((item) => (
        <li key={item} className={styles.tag}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A short plain-language explanation set off from the main prose. */
export function Explainer({ children }: { children: ReactNode }) {
  return <div className={styles.explainer}>{children}</div>;
}
