/**
 * Identity module — shared types.
 *
 * Anything another module is allowed to depend on is re-exported from
 * `index.ts`; dependency-cruiser rejects imports of this file from outside the
 * module (EF §1.2).
 */
import type { QueryResultRow } from 'pg';
import type { Role } from '../../lib/policy.js';

export type { Role };

export type UserStatus = 'active' | 'suspended' | 'deactivated' | 'deleted';

export type AuthProvider = 'google' | 'apple';

/**
 * Minimal query interface shared by `lib/db`'s pool helper and a transaction
 * client. Every repo function takes one, which is what lets the DB-backed test
 * suite drive the real SQL through PGlite.
 */
export type Exec = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: T[] }>;

/** A row of `users`, exactly as stored. Never returned to clients unprojected. */
export interface UserRow {
  id: string;
  handle: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  bio: string | null;
  status: UserStatus;
  role: Role;
  email_verified_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public projection (ID-12): what any authenticated or anonymous caller may see
 * about someone else. Conservative by default — no email, no role, no status.
 */
export interface PublicUserProfile {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  created_at: string;
}

/** Owner/staff projection: adds the P1/P2 fields the subject may see. */
export interface SelfUserProfile extends PublicUserProfile {
  email: string;
  role: Role;
  status: UserStatus;
  email_verified: boolean;
  mfa_enabled: boolean;
  /**
   * Whether THIS session cleared an MFA challenge. Distinct from `mfa_enabled`
   * (enrolment): staff authorization keys on the session, so a client that only
   * sees enrolment would show an operator console the API then refuses.
   */
  mfa?: boolean;
  last_seen_at: string | null;
}

/** Resource shape the `user` policy reasons about. */
export interface UserResource {
  id: string;
  status: UserStatus;
  role: Role;
}

/** Resource shape the `session` policy reasons about (a refresh-token family). */
export interface SessionResource {
  familyId: string;
  userId: string;
}

/** One entry of the "your devices" list (ID-06). */
export interface SessionSummary {
  family_id: string;
  started_at: string;
  last_used_at: string;
  expires_at: string;
  revoked: boolean;
  current: boolean;
  user_agent: string | null;
  ip: string | null;
}

/** Tokens handed to a client after a successful authentication. */
export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  familyId: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
}

/** Google's userinfo response, narrowed to the fields we trust. */
export interface GoogleProfile {
  sub: string;
  email?: string;
  /** HARD GATE for account linking (DG §7.2 item 2). */
  email_verified?: boolean;
  name?: string;
}
