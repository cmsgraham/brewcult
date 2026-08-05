/**
 * Notification persistence: preferences and the delivery ledger.
 *
 * Every function takes the `Exec` seam so the suite can run the real SQL
 * against PGlite — nothing here is mocked in tests.
 */
import {
  NOTIFICATION_TYPES,
  type Exec,
  type NotificationPreference,
  type NotificationRecipient,
  type NotificationType,
} from './types.js';

/**
 * Every type with its effective setting, defaults included.
 *
 * The table stores only deviations (0009), so this starts from "all enabled"
 * and applies the rows that exist. The UI therefore never has to know that an
 * absent row means yes.
 */
export async function listPreferences(
  exec: Exec,
  userId: string,
): Promise<NotificationPreference[]> {
  const res = await exec<{ notification_type: string; email_enabled: boolean }>(
    `SELECT notification_type, email_enabled
       FROM notification_preferences
      WHERE user_id = $1::uuid`,
    [userId],
  );

  const overrides = new Map(res.rows.map((r) => [r.notification_type, r.email_enabled]));
  return NOTIFICATION_TYPES.map((type) => ({
    type,
    email_enabled: overrides.get(type) ?? true,
  }));
}

/**
 * Write one deviation. Upsert rather than insert-or-update in code: two tabs
 * toggling the same switch must not race into a duplicate-key error.
 */
export async function setPreference(
  exec: Exec,
  userId: string,
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  await exec(
    `INSERT INTO notification_preferences (user_id, notification_type, email_enabled)
          VALUES ($1::uuid, $2, $3)
     ON CONFLICT (user_id, notification_type)
       DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = now()`,
    [userId, type, enabled],
  );
}

/** True when we are allowed to email this person this kind of thing. */
export async function isEnabled(
  exec: Exec,
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  const res = await exec<{ email_enabled: boolean }>(
    `SELECT email_enabled
       FROM notification_preferences
      WHERE user_id = $1::uuid AND notification_type = $2`,
    [userId, type],
  );
  // Absent row = enabled (0009 header).
  return res.rows[0]?.email_enabled ?? true;
}

/**
 * Claim the right to send exactly once.
 *
 * Returns true if THIS caller won the claim. Implemented as an INSERT that
 * absorbs the conflict rather than a SELECT followed by an INSERT: the latter
 * has a window between the check and the write, and the scheduler has no
 * distributed lock, so two runs overlapping during a rolling restart would both
 * pass the check and both send.
 *
 * Claim BEFORE sending, not after. A crash between claim and send costs one
 * missed weekly digest; claiming after would let a crash between send and
 * record produce a duplicate on the retry — and people forgive a missing recap
 * far more readily than the same mail twice.
 */
export async function claimDelivery(
  exec: Exec,
  userId: string,
  type: NotificationType,
  dedupeKey: string,
): Promise<boolean> {
  const res = await exec<{ id: string }>(
    `INSERT INTO notification_deliveries (user_id, notification_type, dedupe_key)
          VALUES ($1::uuid, $2, $3)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
       RETURNING id`,
    [userId, type, dedupeKey],
  );
  return res.rows.length > 0;
}

/** Release a claim whose send failed, so the next run may retry it. */
export async function releaseDelivery(
  exec: Exec,
  userId: string,
  dedupeKey: string,
): Promise<void> {
  await exec(
    `DELETE FROM notification_deliveries WHERE user_id = $1::uuid AND dedupe_key = $2`,
    [userId, dedupeKey],
  );
}

/** Addressing details for one user, or null if they cannot receive mail. */
export async function findRecipient(
  exec: Exec,
  userId: string,
): Promise<NotificationRecipient | null> {
  const res = await exec<{
    id: string;
    email: string;
    display_name: string | null;
    handle: string;
  }>(
    `SELECT id::text AS id, email, display_name, handle
       FROM users
      WHERE id = $1::uuid
        AND status = 'active'
        AND email_verified_at IS NOT NULL`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    handle: row.handle,
  };
}
