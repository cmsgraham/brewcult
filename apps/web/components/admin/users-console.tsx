'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ROLES,
  ROLE_LABEL,
  STATUS_LABEL,
  USER_STATUSES,
  adminClient,
  type AdminRole,
  type AdminUserStatus,
  type AdminUserSummary,
} from '../../lib/admin-client';
import { RoleBadge, StatusBadge } from './badges';
import { ActionStatus, noteFromError } from './feedback';
import { formatWhen } from './format';
import { UserActionDialog } from './user-action-dialog';
import { nameFor, useUserActions } from './use-user-actions';
import styles from './admin.module.css';

/**
 * The people table (deliverable 2).
 *
 * ── Why the search term is not in the URL ────────────────────────────────────
 * Role, status and the cursor could all live in `?query=` and this could be a
 * server component. The search term cannot: operators search by email, and email
 * is P2 personal data (EF §4.1 — "minimal display, access-logged"). A `?q=` in
 * the address bar puts it in browser history, in the `Referer` of every
 * subsequent request, in shoulder-surfing range, and in any proxy log that
 * records query strings. So the term lives in component state, and search is
 * submit-on-enter rather than as-you-type — which also stops us shipping a
 * prefix of somebody's email to the server on every keystroke.
 *
 * Same reason the row link addresses people by opaque id, never by handle or
 * email, and nothing here is ever written to the console.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: AdminUserSummary[]; nextCursor: string | null }
  | { kind: 'error'; message: string };

const NOT_BUILT =
  'The people directory is not switched on yet — it arrives with the operator API. Nothing is broken, and nothing you did caused this.';

export function UsersConsole() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AdminRole | ''>('');
  const [status, setStatus] = useState<AdminUserStatus | ''>('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [list, setList] = useState<ListState>({ kind: 'loading' });

  const cursor = cursors.length > 0 ? (cursors[cursors.length - 1] ?? null) : null;
  /** Ignores responses for a filter combination the operator has moved on from. */
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = (requestId.current += 1);
    setList({ kind: 'loading' });
    try {
      const result = await adminClient.listUsers({ q: query, role, status, cursor });
      if (id !== requestId.current) return;
      setList({ kind: 'ready', items: result.items, nextCursor: result.next_cursor ?? null });
    } catch (error) {
      if (id !== requestId.current) return;
      setList({ kind: 'error', message: noteFromError(error, NOT_BUILT).message });
    }
  }, [query, role, status, cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useUserActions(load);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setCursors([]);
    setQuery(draft.trim());
  }

  const items = list.kind === 'ready' ? list.items : [];

  return (
    <div className="bc-stack">
      <ActionStatus note={actions.note} />

      <form className={styles.filters} onSubmit={submitSearch} role="search">
        <div className={styles.filter} style={{ minWidth: '16rem', flex: '1 1 16rem' }}>
          <label htmlFor="admin-user-search">Search people</label>
          <input
            id="admin-user-search"
            className="bc-input"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Handle, email or id"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.filter}>
          <label htmlFor="admin-user-role">Role</label>
          <select
            id="admin-user-role"
            className={styles.select}
            value={role}
            onChange={(event) => {
              setCursors([]);
              setRole(event.target.value as AdminRole | '');
            }}
          >
            <option value="">Any role</option>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filter}>
          <label htmlFor="admin-user-status">Status</label>
          <select
            id="admin-user-status"
            className={styles.select}
            value={status}
            onChange={(event) => {
              setCursors([]);
              setStatus(event.target.value as AdminUserStatus | '');
            }}
          >
            <option value="">Any status</option>
            {USER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="bc-button bc-button--secondary">
          Search
        </button>
      </form>

      {list.kind === 'error' ? (
        <div className="bc-panel">
          <p style={{ marginBottom: 0 }}>{list.message}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>
              {list.kind === 'loading'
                ? 'Loading people…'
                : `${items.length} ${items.length === 1 ? 'person' : 'people'} on this page. Email addresses are personal data — need-to-know only.`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last seen</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.kind === 'loading' ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    Nobody matches those filters. An empty result here is usually the filters
                    rather than the directory — try widening one.
                  </td>
                </tr>
              ) : (
                items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span className={styles.identity}>
                        <strong>{nameFor(user)}</strong>
                        <span>@{user.handle}</span>
                        <span>{user.email}</span>
                      </span>
                    </td>
                    <td>
                      <RoleBadge role={user.role} />
                    </td>
                    <td>
                      <StatusBadge status={user.status} />
                    </td>
                    <td className={styles.numeric}>{formatWhen(user.last_seen_at)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <Link className={styles.smallButton} href={`/admin/users/${user.id}`}>
                          View<span className="bc-visually-hidden"> {nameFor(user)}</span>
                        </Link>
                        {user.status === 'suspended' ? (
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => actions.open('reactivate', user)}
                          >
                            Reactivate<span className="bc-visually-hidden"> {nameFor(user)}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.smallButton} ${styles.destructive}`}
                            onClick={() => actions.open('suspend', user)}
                          >
                            Suspend<span className="bc-visually-hidden"> {nameFor(user)}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${styles.smallButton} ${styles.destructive}`}
                          onClick={() => actions.open('force-logout', user)}
                        >
                          Force logout<span className="bc-visually-hidden"> {nameFor(user)}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => actions.open('role', user)}
                        >
                          Change role<span className="bc-visually-hidden"> {nameFor(user)}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.pager}>
        <button
          type="button"
          className="bc-button bc-button--quiet"
          disabled={cursors.length === 0 || list.kind === 'loading'}
          onClick={() => setCursors((stack) => stack.slice(0, -1))}
        >
          Previous page
        </button>
        <button
          type="button"
          className="bc-button bc-button--quiet"
          disabled={list.kind !== 'ready' || list.nextCursor === null}
          onClick={() =>
            setCursors((stack) =>
              list.kind === 'ready' && list.nextCursor ? [...stack, list.nextCursor] : stack,
            )
          }
        >
          Next page
        </button>
        <p className={styles.pagerNote}>Page {cursors.length + 1}</p>
      </div>

      <UserActionDialog
        pending={actions.pending}
        reason={actions.reason}
        onReasonChange={actions.setReason}
        nextRole={actions.nextRole}
        onNextRoleChange={actions.setNextRole}
        busy={actions.busy}
        error={actions.dialogError}
        onConfirm={() => void actions.run()}
        onCancel={actions.close}
      />
    </div>
  );
}
