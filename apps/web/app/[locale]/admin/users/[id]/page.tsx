import { type Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OnOffBadge, RoleBadge, StatusBadge } from '../../../../../components/admin/badges';
import { coarseIp, formatWhen, shortAgent } from '../../../../../components/admin/format';
import { MfaInterstitial } from '../../../../../components/admin/gate';
import { SessionRestoreScreen } from '../../../../../components/session-restore-screen';
import { AdminShell } from '../../../../../components/admin/shell';
import { UserActionPanel } from '../../../../../components/admin/user-action-panel';
import { nameFor } from '../../../../../components/admin/use-user-actions';
import styles from '../../../../../components/admin/admin.module.css';
import { describeAdminError, type AdminUserDetail } from '../../../../../lib/admin-client';
import { adminGate, serverAdminClient } from '../../_lib/guard';

export const metadata: Metadata = {
  // Deliberately generic: the tab title, browser history and any screen-share
  // preview say nothing about *who* is being looked at (EF §4.1, P2).
  title: 'Account · Operator console',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

const NOT_BUILT =
  'This account view is not switched on yet — it arrives with the operator API. If you were expecting a person here, they have not gone anywhere.';

/**
 * One person, in full (deliverable 3).
 *
 * Everything on this page is P2 personal data (EF §4.1: "encrypted at rest,
 * minimal display, access-logged"). So:
 *  - the route key is the opaque user id; the handle and email never appear in a
 *    URL, a page title or a `Referer` header,
 *  - nothing is logged — no `console.*` anywhere in this feature (the repo's
 *    eslint `no-console` rule keeps that honest),
 *  - login-attempt IPs are coarsened for display, because "which network" is what
 *    an operator actually needs and a full address on a shared screen is not,
 *  - the page is `force-dynamic` and never cached.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const gate = await adminGate();
  // Not "no such page" — "we could not read your session". See _lib/guard.ts.
  if (gate.state === 'restore') {
    const { id: target } = await params;
    return <SessionRestoreScreen next={`/admin/users/${target}`} />;
  }
  if (gate.state === 'unavailable') notFound();
  if (gate.state === 'mfa-required') return <MfaInterstitial actor={gate.actor} />;

  const { id } = await params;

  let user: AdminUserDetail;
  try {
    user = await serverAdminClient.getUser(id);
  } catch (error) {
    return (
      <AdminShell current="users" title="Account" actor={gate.actor}>
        <div className="bc-panel bc-stack">
          <p>{describeAdminError(error, NOT_BUILT)}</p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/admin/users">Back to people</Link>
          </p>
        </div>
      </AdminShell>
    );
  }

  const who = nameFor(user);
  const attempts = user.recent_login_attempts ?? [];
  const identities = user.identities ?? [];

  return (
    <AdminShell
      current="users"
      title={who}
      lede={`@${user.handle} · everything below is personal data. Look at what the job needs, and nothing else.`}
      actor={gate.actor}
    >
      <p>
        <Link href="/admin/users">← Back to people</Link>
      </p>

      <section aria-labelledby="identity" className="bc-stack">
        <h2 id="identity">Identity</h2>
        <dl className={styles.definitions}>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Handle</dt>
          <dd>@{user.handle}</dd>
          <dt>Role</dt>
          <dd>
            <RoleBadge role={user.role} />
          </dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={user.status} />
            {user.status === 'suspended' && user.suspended_reason ? (
              <> · {user.suspended_reason}</>
            ) : null}
          </dd>
          <dt>Email confirmed</dt>
          <dd>
            <OnOffBadge
              on={user.email_verified === true}
              onLabel="Confirmed"
              offLabel="Not confirmed"
            />
          </dd>
          <dt>Two-factor</dt>
          <dd>
            <OnOffBadge on={user.mfa_enabled === true} onLabel="On" offLabel="Off" />
          </dd>
          <dt>Sign-in methods</dt>
          <dd>
            {identities.length === 0
              ? 'Password only'
              : `Password, plus ${identities.map((identity) => identity.provider).join(', ')}`}
          </dd>
          <dt>Account id</dt>
          <dd>
            <code>{user.id}</code>
          </dd>
          <dt>Joined</dt>
          <dd>{formatWhen(user.created_at, 'Unknown')}</dd>
        </dl>
      </section>

      <section aria-labelledby="activity" className="bc-stack">
        <h2 id="activity">Activity</h2>
        <dl className={styles.definitions}>
          <dt>Last seen</dt>
          <dd>{formatWhen(user.last_seen_at)}</dd>
          <dt>Active sessions</dt>
          <dd>
            {typeof user.session_count === 'number'
              ? `${user.session_count} ${user.session_count === 1 ? 'device' : 'devices'}`
              : 'Not reported'}
          </dd>
        </dl>

        <h3>Recent sign-in attempts</h3>
        <p className="bc-muted">
          Failures are normal — people mistype passwords. A run of them from somewhere new is
          the thing worth a second look. Addresses are shown coarsely on purpose.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>Most recent first. Read-only.</caption>
            <thead>
              <tr>
                <th scope="col">When (UTC)</th>
                <th scope="col">Outcome</th>
                <th scope="col">Method</th>
                <th scope="col">From</th>
                <th scope="col">Device</th>
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    No sign-in attempts recorded for this account.
                  </td>
                </tr>
              ) : (
                attempts.map((attempt, index) => (
                  <tr key={attempt.id ?? `${attempt.created_at}-${index}`}>
                    <td className={styles.numeric}>{formatWhen(attempt.created_at, 'Unknown')}</td>
                    <td>
                      <OnOffBadge on={attempt.success} onLabel="Signed in" offLabel="Failed" />
                      {!attempt.success && attempt.failure_reason ? (
                        <> · {attempt.failure_reason.replace(/_/g, ' ')}</>
                      ) : null}
                    </td>
                    <td>{attempt.provider ?? 'Password'}</td>
                    <td className={styles.numeric}>{coarseIp(attempt.ip)}</td>
                    <td>{shortAgent(attempt.user_agent)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <UserActionPanel user={user} />
    </AdminShell>
  );
}
