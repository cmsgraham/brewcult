'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import {
  MFA_SETUP_PATH,
  describeAdminError,
  isMfaRequiredError,
} from '../../lib/admin-client';
import { Alert } from '../ui/alert';

export interface ActionNote {
  tone: 'success' | 'error' | 'info';
  message: string;
  /** Render the enrol prompt rather than a bare refusal. */
  mfa?: boolean;
}

/**
 * Turn any thrown value into one line an operator can act on.
 *
 * `mfa_required` is the interesting case: the API is not saying "no", it is
 * saying "not from this session". Surfacing that as a generic 403 would leave
 * somebody re-clicking a button that can never work.
 */
export function noteFromError(error: unknown, notBuiltCopy?: string): ActionNote {
  if (isMfaRequiredError(error)) {
    return {
      tone: 'error',
      mfa: true,
      message:
        'Staff actions need two-factor authentication — enrol to continue. Nothing was changed.',
    };
  }
  return {
    tone: 'error',
    message: notBuiltCopy ? describeAdminError(error, notBuiltCopy) : describeAdminError(error),
  };
}

/**
 * The result of the last action, announced.
 *
 * The live region is rendered **always**, empty or not: a region that appears at
 * the same moment as its text is unreliably announced. Errors upgrade to
 * `role="alert"` via `<Alert tone="error">`.
 */
export function ActionStatus({ note }: { note: ActionNote | null }) {
  return (
    <div aria-live="polite" style={{ marginBottom: note ? '1rem' : 0 }}>
      {note ? (
        <Alert tone={note.tone}>
          {note.message}
          {note.mfa ? (
            <>
              {' '}
              <Link href={MFA_SETUP_PATH}>Set up two-factor authentication</Link>.
            </>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
