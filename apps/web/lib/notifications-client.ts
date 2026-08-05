/**
 * Notification preferences transport.
 *
 * Paths are written in the PUBLIC form (`/api/v1/...`) because that is what the
 * browser requests; Caddy strips `/api` server-side. Getting this backwards is
 * the single most repeated defect in this codebase — see engineering_foundations
 * §9.1 for the three production bugs it caused.
 */
import { apiFetch, type ApiRequestOptions } from './api';

export const NOTIFICATION_PREFERENCES_PATH = '/api/v1/notifications/preferences';
export const UNSUBSCRIBE_PATH = '/api/v1/notifications/unsubscribe';

/** Mirrors NOTIFICATION_TYPES in the API's notifications module. */
export type NotificationType = 'weekly_recap' | 'recipe_forked';

export interface NotificationPreference {
  type: NotificationType;
  email_enabled: boolean;
}

interface PreferencesResponse {
  preferences: NotificationPreference[];
}

/** Copy lives here, beside the type, so the screen cannot drift from the API. */
export const NOTIFICATION_COPY: Record<
  NotificationType,
  { label: string; description: string }
> = {
  weekly_recap: {
    label: 'Weekly brew recap',
    description:
      'A short summary of what you brewed, once a week. Your own data, nobody else’s. A week with no brews sends nothing at all.',
  },
  recipe_forked: {
    label: 'Someone builds on your recipe',
    description:
      'When another person forks a recipe you published, so you can see where it went.',
  },
};

export async function fetchNotificationPreferences(
  options?: ApiRequestOptions,
): Promise<NotificationPreference[]> {
  const body = await apiFetch<PreferencesResponse>(NOTIFICATION_PREFERENCES_PATH, options);
  return body?.preferences ?? [];
}

export async function updateNotificationPreference(
  type: NotificationType,
  emailEnabled: boolean,
  options?: ApiRequestOptions,
): Promise<NotificationPreference[]> {
  const body = await apiFetch<PreferencesResponse>(NOTIFICATION_PREFERENCES_PATH, {
    ...options,
    method: 'PATCH',
    body: { type, email_enabled: emailEnabled },
  });
  return body?.preferences ?? [];
}

/**
 * Unsubscribe from a mailed link. No session required — the token authorises,
 * and the API answers 200 whether or not it was valid (so this never reports a
 * failure to somebody who was only trying to stop email).
 */
export async function unsubscribeWithToken(
  token: string,
  options?: ApiRequestOptions,
): Promise<void> {
  await apiFetch<unknown>(UNSUBSCRIBE_PATH, {
    ...options,
    method: 'POST',
    body: { token },
  });
}
