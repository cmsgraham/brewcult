'use client';

import { useEffect, useState } from 'react';
import { isApiError } from '../../lib/api';
import {
  NOTIFICATION_COPY,
  fetchNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreference,
  type NotificationType,
} from '../../lib/notifications-client';
import { Alert } from '../ui/alert';

/**
 * The switches.
 *
 * Optimistic: the toggle moves immediately and rolls back if the request fails.
 * Turning email off is the kind of thing people do while already irritated, and
 * a control that appears not to respond invites a second click — which on a
 * non-optimistic toggle would send a second, opposite request.
 */
export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<NotificationType | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNotificationPreferences()
      .then((next) => {
        if (!cancelled) setPrefs(next);
      })
      .catch(() => {
        if (!cancelled) setError('We could not load your settings. Reload to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(type: NotificationType, next: boolean): Promise<void> {
    const previous = prefs;
    setError(null);
    setPending(type);
    setPrefs((current) =>
      (current ?? []).map((p) => (p.type === type ? { ...p, email_enabled: next } : p)),
    );

    try {
      setPrefs(await updateNotificationPreference(type, next));
    } catch (failure) {
      setPrefs(previous); // put the switch back where they left it
      setError(
        isApiError(failure)
          ? failure.userMessage
          : 'That did not save. Try again in a moment.',
      );
    } finally {
      setPending(null);
    }
  }

  if (prefs === null) {
    return (
      <p className="bc-muted" role="status">
        {error ?? 'Loading your settings…'}
      </p>
    );
  }

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <ul className="bc-prefs">
        {prefs.map((pref) => {
          const copy = NOTIFICATION_COPY[pref.type];
          if (!copy) return null; // a type the client does not know yet
          const inputId = `notify-${pref.type}`;
          return (
            <li key={pref.type} className="bc-prefs__row">
              <div className="bc-prefs__text">
                <label className="bc-prefs__label" htmlFor={inputId}>
                  {copy.label}
                </label>
                <p className="bc-muted bc-prefs__hint">{copy.description}</p>
              </div>
              <input
                id={inputId}
                type="checkbox"
                className="bc-prefs__switch"
                checked={pref.email_enabled}
                disabled={pending === pref.type}
                onChange={(event) => void toggle(pref.type, event.target.checked)}
              />
            </li>
          );
        })}
      </ul>

      {/* Say plainly what these switches do NOT cover, so nobody believes they
          have turned off a security alert they will later need. */}
      <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
        Security emails — sign-in codes, password changes, two-factor changes — are always
        sent, and are not affected by these settings.
      </p>
    </div>
  );
}
