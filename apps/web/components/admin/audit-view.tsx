import { LocaleLink as Link } from '../../components/locale-link';
import { queryString, type AuditEntry } from '../../lib/admin-client';
import { formatWhen } from './format';
import styles from './admin.module.css';

export interface AuditFilterValues {
  actor: string;
  action: string;
  target_type: string;
}

/**
 * Audit filters as a plain GET form.
 *
 * No client JavaScript: the filters are opaque ids and action names, they belong
 * in the URL (unlike a people search — see users-console), and a read-only log
 * that works with JS disabled is one fewer thing that can break during an
 * incident, which is exactly when this page gets opened.
 */
export function AuditFilters({ values }: { values: AuditFilterValues }) {
  return (
    <form className={styles.filters} method="get" action="/admin/audit">
      <div className={styles.filter}>
        <label htmlFor="audit-actor">Actor id</label>
        <input
          id="audit-actor"
          name="actor"
          className="bc-input"
          defaultValue={values.actor}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className={styles.filter}>
        <label htmlFor="audit-action">Action</label>
        <input
          id="audit-action"
          name="action"
          className="bc-input"
          placeholder="user.suspended"
          defaultValue={values.action}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className={styles.filter}>
        <label htmlFor="audit-target-type">Target type</label>
        <input
          id="audit-target-type"
          name="target_type"
          className="bc-input"
          placeholder="user"
          defaultValue={values.target_type}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" className="bc-button bc-button--secondary">
        Apply filters
      </button>
      <Link className="bc-button bc-button--quiet" href="/admin/audit">
        Clear
      </Link>
    </form>
  );
}

/** Payload, collapsed. Expanded by default it would bury the actual events. */
function Payload({ payload }: { payload: unknown }) {
  if (payload === null || payload === undefined) return <span className="bc-muted">—</span>;
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    text = String(payload);
  }
  if (text === '{}' || text === '') return <span className="bc-muted">—</span>;

  return (
    <details className={styles.payload}>
      <summary>Payload</summary>
      <pre>{text}</pre>
    </details>
  );
}

/**
 * The audit log itself (deliverable 6) — read-only, and it says so.
 *
 * There is no edit control, no delete, no "resolve" on this page, by design:
 * EF §3.7 puts the audit log in storage the app can write but not modify. The
 * caption states that plainly, so nobody goes looking for a way to correct an
 * entry. Corrections are new entries.
 */
export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>
          Append-only. Entries are written by the API and can never be edited or removed from
          here — a correction is another entry, not a change to this one.
        </caption>
        <thead>
          <tr>
            <th scope="col">When (UTC)</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Payload</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.empty}>
                No entries match those filters. That is not the same as nothing having
                happened — widen the filters, or clear them, before drawing a conclusion.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr key={entry.id}>
                <td className={styles.numeric}>{formatWhen(entry.created_at, 'Unknown')}</td>
                <td>
                  {entry.actor_handle ? (
                    <span className={styles.identity}>
                      <strong>@{entry.actor_handle}</strong>
                      {entry.actor_id ? <span>{entry.actor_id}</span> : null}
                    </span>
                  ) : entry.actor_id ? (
                    <span>{entry.actor_id}</span>
                  ) : (
                    <span className="bc-muted">System</span>
                  )}
                </td>
                <td>
                  <code>{entry.action}</code>
                </td>
                <td>
                  {entry.target_type ? (
                    <span className={styles.identity}>
                      <strong>{entry.target_type}</strong>
                      {entry.target_id ? <span>{entry.target_id}</span> : null}
                    </span>
                  ) : (
                    <span className="bc-muted">—</span>
                  )}
                </td>
                <td>
                  <Payload payload={entry.payload} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Cursor pagination, as links.
 *
 * Deliberately forward-only with a "start again": a cursor cannot be walked
 * backwards without keeping a stack, and a fake Previous that silently lands
 * somewhere else is worse than no Previous on a page people use as evidence.
 */
export function AuditPager({
  values,
  nextCursor,
  onFirstPage,
}: {
  values: AuditFilterValues;
  nextCursor: string | null;
  onFirstPage: boolean;
}) {
  const filters = {
    actor: values.actor,
    action: values.action,
    target_type: values.target_type,
  };
  const nextHref = `/admin/audit${queryString({ ...filters, cursor: nextCursor })}`;
  const firstHref = `/admin/audit${queryString(filters)}`;

  return (
    <div className={styles.pager}>
      {nextCursor ? (
        <Link className="bc-button bc-button--quiet" href={nextHref}>
          Older entries
        </Link>
      ) : (
        <p className={styles.pagerNote}>That is the end of the log for these filters.</p>
      )}
      {onFirstPage ? null : (
        <Link className="bc-button bc-button--quiet" href={firstHref}>
          Back to the newest
        </Link>
      )}
    </div>
  );
}
