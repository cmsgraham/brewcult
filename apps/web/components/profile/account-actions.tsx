'use client';

import { useState } from 'react';
import { apiFetch, isApiError } from '../../lib/api';
import { Alert } from '../ui/alert';
import { useTranslate } from '../locale-provider';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; action: 'export' | 'delete' }
  | { kind: 'note'; tone: 'info' | 'success' | 'error'; message: string };

/**
 * Data-subject rights, self-serve (EF §4.3).
 *
 * Export and deletion are Phase-1 features, not a support ticket. The API half
 * lands with Lane E/F, so a 404 or 501 here is reported as "coming soon"
 * instead of a crash — an unbuilt endpoint should never make the page look
 * broken, and it must never look like the *user* did something wrong.
 */
export function AccountActions({
  userId,
  exportEnabled,
  deletionEnabled,
}: {
  /**
   * Needed because deletion is `DELETE /v1/users/:id`, not a `/me` alias. The
   * API authorises it as owner-only (identity/policies.ts: `delete` requires
   * isOwner), so passing an id here grants nothing — sending someone else's
   * would simply be refused.
   */
  userId: string;
  exportEnabled: boolean;
  deletionEnabled: boolean;
}) {
  const t = useTranslate();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);

  function describe(error: unknown, comingSoon: string): Status {
    if (isApiError(error) && (error.status === 404 || error.status === 501)) {
      return { kind: 'note', tone: 'info', message: comingSoon };
    }
    return {
      kind: 'note',
      tone: 'error',
      message: isApiError(error)
        ? error.userMessage
        : t('account.somethingWrong'),
    };
  }

  async function requestExport() {
    setStatus({ kind: 'working', action: 'export' });
    try {
      await apiFetch('/api/me/export', { method: 'POST' });
      setStatus({
        kind: 'note',
        tone: 'success',
        message: t('account.exportStarted'),
      });
    } catch (error) {
      setStatus(
        describe(error, t('account.exportSoon')),
      );
    }
  }

  async function deleteAccount() {
    setStatus({ kind: 'working', action: 'delete' });
    try {
      // `/api/v1/users/:id`. This called `/api/me`, which strips to `/me` and
      // 404s — and the 404 handler below reports "coming soon", so a feature
      // that has been implemented and working all along told every user it did
      // not exist yet. apiFetch attaches the CSRF token for mutations itself.
      await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      setStatus({
        kind: 'note',
        tone: 'success',
        message: t('account.deletionScheduled'),
      });
      setConfirming(false);
    } catch (error) {
      setConfirming(false);
      setStatus(
        describe(error, t('account.deletionSoon')),
      );
    }
  }

  const working = status.kind === 'working';

  return (
    <div className="bc-stack">
      {status.kind === 'note' ? <Alert tone={status.tone}>{status.message}</Alert> : null}

      <div className="bc-actions" style={{ marginTop: 0 }}>
        {exportEnabled ? (
          <button
            type="button"
            className="bc-button bc-button--secondary"
            onClick={requestExport}
            disabled={working}
          >
            {status.kind === 'working' && status.action === 'export'
              ? t('account.preparing')
              : t('account.exportMine')}
          </button>
        ) : null}

        {deletionEnabled && !confirming ? (
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={() => setConfirming(true)}
            disabled={working}
          >
            {t('account.deleteMine')}
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="bc-panel bc-stack" role="group" aria-label={t('account.confirmLabel')}>
          <p style={{ marginBottom: 0 }}>{t('account.confirmBody')}</p>
          <div className="bc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="bc-button"
              onClick={deleteAccount}
              disabled={working}
            >
              {status.kind === 'working' && status.action === 'delete'
                ? t('account.deleting')
                : t('account.yesDelete')}
            </button>
            <button
              type="button"
              className="bc-button bc-button--quiet"
              onClick={() => setConfirming(false)}
              disabled={working}
            >
              {t('account.keepMine')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
