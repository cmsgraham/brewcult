'use client';

import { useState, type ReactNode } from 'react';
import {
  ROLE_LABEL,
  adminClient,
  type AdminRole,
  type AdminUserSummary,
} from '../../lib/admin-client';
import { noteFromError, type ActionNote } from './feedback';

export type UserActionKind = 'suspend' | 'reactivate' | 'force-logout' | 'role';

export interface PendingUserAction {
  kind: UserActionKind;
  user: AdminUserSummary;
}

/** Display name, falling back to the handle. Never the email — that is P2. */
export function nameFor(user: { display_name?: string | null; handle: string }): string {
  const name = user.display_name?.trim();
  return name && name.length > 0 ? name : `@${user.handle}`;
}

/**
 * The four account actions, shared by the table and the detail page so the two
 * can never drift into confirming the same thing with different words.
 *
 * Nothing here decides *whether* an action is allowed — the API does, and a
 * refusal comes back as a normal error (or `mfa_required`, which becomes an
 * enrol prompt rather than a dead end).
 */
export function useUserActions(onSuccess: () => void | Promise<void>) {
  const [pending, setPending] = useState<PendingUserAction | null>(null);
  const [reason, setReason] = useState('');
  const [nextRole, setNextRole] = useState<AdminRole>('user');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<ReactNode>(null);
  const [note, setNote] = useState<ActionNote | null>(null);

  function open(kind: UserActionKind, user: AdminUserSummary) {
    setPending({ kind, user });
    setReason('');
    setNextRole(user.role);
    setDialogError(null);
    setNote(null);
  }

  function close() {
    setPending(null);
    setReason('');
    setDialogError(null);
  }

  async function run() {
    if (!pending) return;
    const { kind, user } = pending;
    const who = nameFor(user);
    setBusy(true);
    setDialogError(null);
    try {
      if (kind === 'suspend') {
        await adminClient.suspendUser(user.id, reason.trim());
        setNote({
          tone: 'success',
          message: `${who} is suspended and signed out everywhere. The reason is on the audit log.`,
        });
      } else if (kind === 'reactivate') {
        await adminClient.reactivateUser(user.id);
        setNote({ tone: 'success', message: `${who} can sign in again.` });
      } else if (kind === 'force-logout') {
        await adminClient.forceLogout(user.id);
        setNote({
          tone: 'success',
          message: `${who} has been signed out of every device. They can sign back in.`,
        });
      } else {
        await adminClient.changeRole(user.id, nextRole, reason.trim());
        setNote({
          tone: 'success',
          message: `${who} is now ${ROLE_LABEL[nextRole]}. The change is on the audit log.`,
        });
      }
      close();
      await onSuccess();
    } catch (error) {
      const failure = noteFromError(error);
      if (failure.mfa) {
        // The session, not the operator, is the problem — say so where the
        // enrol link can live, and get the modal out of the way.
        setNote(failure);
        close();
      } else {
        // Everything else belongs in the dialog: the button they just pressed is
        // right there, and the typed reason is not lost.
        setDialogError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    pending,
    reason,
    setReason,
    nextRole,
    setNextRole,
    busy,
    dialogError,
    note,
    setNote,
    open,
    close,
    run,
  };
}
