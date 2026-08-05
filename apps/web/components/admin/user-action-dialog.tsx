'use client';

import { type ReactNode } from 'react';
import { ROLES, ROLE_CONSEQUENCE, ROLE_LABEL, type AdminRole } from '../../lib/admin-client';
import { ConfirmDialog } from './confirm-dialog';
import { ReasonField } from './reason-field';
import { nameFor, type PendingUserAction, type UserActionKind } from './use-user-actions';
import styles from './admin.module.css';

export interface UserActionDialogProps {
  pending: PendingUserAction | null;
  reason: string;
  onReasonChange: (value: string) => void;
  nextRole: AdminRole;
  onNextRoleChange: (role: AdminRole) => void;
  busy: boolean;
  error: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * One confirmation dialog for all four account actions.
 *
 * The consequence sentence names the person and says what will actually happen
 * to them — "Alice will be signed out of all devices and cannot sign in until
 * reactivated" — because a confirmation that says "Are you sure?" trains people
 * to click yes without reading. Suspend and role changes cannot be confirmed
 * without a reason; the reason is the thing the audit log is for.
 */
export function UserActionDialog({
  pending,
  reason,
  onReasonChange,
  nextRole,
  onNextRoleChange,
  busy,
  error,
  onConfirm,
  onCancel,
}: UserActionDialogProps) {
  if (!pending) return null;

  const { kind, user } = pending;
  const who = nameFor(user);
  const reasonRequired = kind === 'suspend' || kind === 'role';
  const reasonOffered = reasonRequired || kind === 'force-logout';
  const reasonGiven = reason.trim().length > 0;

  const copy: Record<
    UserActionKind,
    { title: string; consequence: ReactNode; confirm: string; destructive: boolean }
  > = {
    suspend: {
      title: `Suspend ${who}?`,
      consequence: (
        <p style={{ marginBottom: 0 }}>
          {who} will be signed out of all devices and cannot sign in until someone
          reactivates the account. Their recipes and posts stay up. The reason below goes on
          the audit log with your name against it.
        </p>
      ),
      confirm: 'Suspend account',
      destructive: true,
    },
    reactivate: {
      title: `Reactivate ${who}?`,
      consequence: (
        <p style={{ marginBottom: 0 }}>
          {who} will be able to sign in again straight away. Old sessions are not restored —
          they sign in fresh.
        </p>
      ),
      confirm: 'Reactivate account',
      destructive: false,
    },
    'force-logout': {
      title: `Sign ${who} out everywhere?`,
      consequence: (
        <p style={{ marginBottom: 0 }}>
          Every session on every device ends immediately. This does not block the account —{' '}
          {who} can sign straight back in. Use it when a session may be compromised.
        </p>
      ),
      confirm: 'Sign out all devices',
      destructive: true,
    },
    role: {
      title: `Change role for ${who}?`,
      consequence: (
        <p style={{ marginBottom: 0 }}>
          {ROLE_CONSEQUENCE[nextRole]} They are {ROLE_LABEL[user.role]} today. Role changes
          are audit-logged and take effect on their next request.
        </p>
      ),
      confirm: `Make ${who} ${ROLE_LABEL[nextRole]}`,
      destructive: true,
    },
  };

  const current = copy[kind];

  return (
    <ConfirmDialog
      open
      title={current.title}
      consequence={current.consequence}
      confirmLabel={current.confirm}
      destructive={current.destructive}
      confirmDisabled={reasonRequired && !reasonGiven}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {kind === 'role' ? (
        <div className={styles.filter} style={{ marginBottom: '1rem' }}>
          <label htmlFor="admin-next-role">New role</label>
          <select
            id="admin-next-role"
            className={styles.select}
            value={nextRole}
            onChange={(event) => onNextRoleChange(event.target.value as AdminRole)}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {reasonOffered ? (
        <ReasonField
          id="admin-action-reason"
          label="Reason"
          hint="One line, procedural. It is stored on the audit log and may be shown to the person if they ask why."
          value={reason}
          onChange={onReasonChange}
          required={reasonRequired}
        />
      ) : null}
    </ConfirmDialog>
  );
}
