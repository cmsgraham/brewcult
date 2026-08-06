import { LocaleLink as Link } from '../../components/locale-link';
import { localeParam, translator } from '../../lib/locale-server';
import styles from './catalog.module.css';

/**
 * Hub-page filters as a **plain `<form method="get">`** — no client component,
 * no router hooks, no JavaScript at all.
 *
 * Why it matters here specifically (§23.1 / deliverable 8): these are the pages
 * we want crawled and we want them fast. A native GET form gives us shareable,
 * crawlable, back-button-correct filter URLs and ships zero kilobytes of JS.
 * The only cost is an explicit "Apply" press instead of filter-on-change, which
 * is also the more accessible behaviour.
 *
 * Every option value maps 1:1 onto a query parameter the catalog API already
 * accepts (`apps/api/src/modules/catalog/schemas.ts`), so a filter can never
 * produce a 400.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelect {
  /** Query-parameter name — must match an API query param. */
  name: string;
  label: string;
  /** Shown as the "no filter" option. */
  anyLabel: string;
  options: FilterOption[];
  selected?: string | undefined;
}

export interface FilterBarProps {
  /** Where the form submits — the hub's own path. */
  action: string;
  selects: FilterSelect[];
  /** True when at least one filter is active, so we can offer a reset. */
  hasActiveFilters: boolean;
  legend: string;
  /** Which language the buttons are written in. Option labels arrive translated. */
  locale?: string;
}

export function FilterBar({
  action,
  selects,
  hasActiveFilters,
  legend,
  locale = 'en',
}: FilterBarProps) {
  const t = translator(localeParam(locale));

  return (
    // `aria-label` on the form rather than a `<fieldset>`: a fieldset here would
    // need `display: contents` to stay out of the flex layout, and that is
    // exactly the case browsers still handle inconsistently for form controls.
    <form className={styles.filters} action={action} method="get" aria-label={legend}>
      {selects.map((select) => (
        <div className={styles.filter} key={select.name}>
          <label htmlFor={`filter-${select.name}`}>{select.label}</label>
          <select
            id={`filter-${select.name}`}
            name={select.name}
            defaultValue={select.selected ?? ''}
          >
            <option value="">{select.anyLabel}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className={styles.filterActions}>
        <button className="bc-button" type="submit">
          {t('catalog.filters.apply')}
        </button>
        {hasActiveFilters ? <Link href={action}>{t('catalog.filters.clear')}</Link> : null}
      </div>
    </form>
  );
}

/**
 * Cursor pagination.
 *
 * The API's cursor is an opaque forward-only keyset (`next_cursor`), so there
 * is deliberately no "previous" link and no page numbers — inventing them would
 * mean fabricating an offset the API does not support. "Back to the start" is
 * the honest counterpart to "next".
 */
export function Pagination({
  basePath,
  filters,
  nextCursor,
  itemCount,
  isCursorPage,
  locale = 'en',
}: {
  basePath: string;
  filters: Record<string, string | undefined>;
  nextCursor: string | null;
  itemCount: number;
  isCursorPage: boolean;
  locale?: string;
}) {
  const t = translator(localeParam(locale));
  const withParams = (extra: Record<string, string> = {}): string => {
    const search = new URLSearchParams();
    for (const key of Object.keys(filters).sort()) {
      const value = filters[key];
      if (value !== undefined && value !== '') search.set(key, value);
    }
    for (const [key, value] of Object.entries(extra)) search.set(key, value);
    const query = search.toString();
    return query === '' ? basePath : `${basePath}?${query}`;
  };

  if (nextCursor === null && !isCursorPage) return null;

  return (
    <nav className={styles.pagination} aria-label={t('catalog.pagination.label')}>
      {isCursorPage ? <Link href={withParams()}>{t('catalog.pagination.back')}</Link> : null}
      <span className={styles.count}>
        {itemCount === 1
          ? t('catalog.pagination.countOne')
          : t('catalog.pagination.countOther', { count: itemCount })}
      </span>
      {nextCursor !== null ? (
        <Link href={withParams({ cursor: nextCursor })} rel="next">
          {t('catalog.pagination.next')}
        </Link>
      ) : null}
    </nav>
  );
}
