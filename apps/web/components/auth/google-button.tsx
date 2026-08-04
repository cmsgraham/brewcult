import { GOOGLE_OAUTH_START } from '../../lib/api';

/**
 * "Continue with Google" (deployment_guide §7.2).
 *
 * A plain anchor, never fetch(): the endpoint is a 302 into Google's consent
 * screen, and a full document navigation is what sets the state cookie. It is
 * rendered only when the `googleAuth` client-config flag is on (EF §2.5), so a
 * misconfigured or disabled provider never shows a button that dead-ends.
 */
export function GoogleButton({
  enabled,
  next,
}: {
  enabled: boolean;
  next?: string;
}) {
  if (!enabled) return null;

  const href = next
    ? `${GOOGLE_OAUTH_START}?next=${encodeURIComponent(next)}`
    : GOOGLE_OAUTH_START;

  return (
    <>
      <a className="bc-button bc-button--quiet" href={href} rel="nofollow">
        Continue with Google
      </a>
      <p className="bc-divider">or use your email</p>
    </>
  );
}
