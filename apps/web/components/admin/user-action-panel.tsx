'use client';

import { useRouter } from 'next/navigation';
import { type AdminUserSummary } from '../../lib/admin-client';
import { ActionStatus } from './feedback';
import { UserActionDialog } from './user-action-dialog';
import { nameFor, useUserActions } from './use-user-actions';
import styles from './admin.module.css';

/**
 * Action panel on a person's detail page.
 *
 * Same hook, same dialogs and same words as the table — an operator who learns
 * "suspend needs a reason" in one place has learned it in both. The panel is the
 * only client JavaScript on that page; identity and activity are server-rendered
 * so nothing personal has to travel through a client-side store.
 */
export function UserActionPanel({ user }: { user: AdminUserSummary }) {
  const router = useRouter();
  // The page is server-rendered; a refresh re-runs the RSC fetch so status and
  // session count reflect what just happened, without a client-side copy of the
  // record going stale.
  const actions = useUserActions(() => router.refresh());

  const who = nameFor(user);
  const suspended = user.status === 'suspended';

  return (
    <section aria-labelledby="admin-actions" className="bc-panel bc-stack">
      <h2 id="admin-actions" style={{ marginTop: 0 }}>
        Act on this account
      </h2>
      <ActionStatus note={actions.note} />
      <p className={styles.pagerNote}>
        Each of these is confirmed first, and each one lands on the audit log under your name.
      </p>

      <div className={styles.rowActions}>
        {suspended ? (
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => actions.open('reactivate', user)}
          >
            Reactivate {who}
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.smallButton} ${styles.destructive}`}
            onClick={() => actions.open('suspend', user)}
          >
            Suspend {who}
          </button>
        )}
        <button
          type="button"
          className={`${styles.smallButton} ${styles.destructive}`}
          onClick={() => actions.open('force-logout', user)}
        >
          Sign out all devices
        </button>
        <button
          type="button"
          className={styles.smallButton}
          onClick={() => actions.open('role', user)}
        >
          Change role
        </button>
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
    </section>
  );
}
