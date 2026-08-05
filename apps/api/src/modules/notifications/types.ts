/**
 * Notification vocabulary and the shapes the module exchanges.
 *
 * The type list is mirrored by a CHECK constraint in 0009 and by the JSON
 * schema in schemas.ts — three copies, one source of truth, asserted equal by
 * the test suite (the discipline 0007 established for admin roles).
 */

/**
 * Kinds a person can switch off.
 *
 * Deliberately excludes every security message (verification codes, password
 * changed, email changed, MFA enabled/disabled). Those are how somebody finds
 * out their account is being taken over, so they are not preferences and this
 * module never carries them — see the 0009 header.
 */
export const NOTIFICATION_TYPES = ['weekly_recap', 'recipe_forked'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Copy for the preferences screen. Kept beside the vocabulary it describes. */
export const NOTIFICATION_COPY: Record<
  NotificationType,
  { label: string; description: string }
> = {
  weekly_recap: {
    label: 'Weekly brew recap',
    description:
      'A short summary of what you brewed, once a week. Your own data, nobody else’s.',
  },
  recipe_forked: {
    label: 'Someone builds on your recipe',
    description:
      'When another person forks a recipe you published, so you can see where it went.',
  },
};

/** A preference as the API reports it. Absence of a row reads as enabled. */
export interface NotificationPreference {
  type: NotificationType;
  email_enabled: boolean;
}

/** Minimal recipient shape — everything needed to address one message. */
export interface NotificationRecipient {
  userId: string;
  email: string;
  displayName: string | null;
  handle: string;
}

/**
 * The database seam, mirroring the adapter shape the other modules take so the
 * suite can run this against PGlite without a pool.
 */
export type Exec = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: T[] }>;
