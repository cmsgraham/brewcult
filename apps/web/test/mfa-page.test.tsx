/**
 * `/profile/security` as a route: who gets in, and what the first paint says.
 *
 * The server render matters here beyond the usual reasons. This page is reached
 * from the operator console's "you need two-factor" screen, so the state it
 * shows on arrival *is* the answer to the question that sent the user here. If
 * it had to hydrate before it knew whether MFA was on, somebody who enrolled
 * last year would land on "Two-factor is off" and reasonably conclude something
 * had been reset.
 *
 * These render the real server component with `fetch` stubbed.
 */
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_PATH, fetchMfaStatus } from '../lib/mfa-client';

vi.mock('server-only', () => ({}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * The cookie jar the page sees. `jar` is reassignable per test because the
 * page's behaviour on a failed session lookup now DEPENDS on it: with a session
 * hint and no access cookie, a redirect would throw away a valid month-long
 * session that only the browser can prove.
 */
let jarCookies: Record<string, string> = { bc_access: 'stub' };

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      toString: () =>
        Object.entries(jarCookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      has: (name: string) => name in jarCookies,
      get: (name: string) =>
        name in jarCookies ? { name, value: jarCookies[name] } : undefined,
    }),
}));

/** `redirect()` throws in Next; the stub mirrors that so callers can assert it. */
class RedirectError extends Error {
  constructor(readonly to: string) {
    super('NEXT_REDIRECT');
    this.name = 'RedirectError';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const { default: SecurityPage } = await import('../app/[locale]/profile/security/page');

// jsdom makes `resolveApiUrl` take its browser branch, so requests keep their
// public `/api/...` form rather than being rewritten to the internal origin.
const ME = '/api/v1/users/me';
const LEGACY_ME = '/api/me';

interface Reply {
  status?: number;
  body?: unknown;
}

let requested: string[] = [];

function mockApi(routes: Record<string, Reply>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      requested.push(String(input));
      const reply = routes[String(input)] ?? {
        status: 404,
        body: { error: 'not_found', message: '' },
      };
      const status = reply.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(reply.body ?? {}),
      } as unknown as Response);
    }),
  );
}

const me = (overrides: Record<string, unknown>) => ({
  body: {
    id: 'u-1',
    handle: 'sam',
    email: 'sam@example.com',
    display_name: 'Sam',
    status: 'active',
    role: 'user',
    email_verified: true,
    mfa_enabled: false,
    mfa: false,
    ...overrides,
  },
});

beforeEach(() => {
  requested = [];
  jarCookies = { bc_access: 'stub' };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/profile/security access', () => {
  it('sends a signed-out visitor to sign in, and comes back here afterwards', async () => {
    mockApi({ [ME]: { status: 401, body: { error: 'unauthorized', message: '' } } });

    await expect(SecurityPage()).rejects.toMatchObject({
      name: 'RedirectError',
      to: '/login?next=%2Fprofile%2Fsecurity',
    });
  });

  it('offers to restore instead of redirecting when the device has a session', async () => {
    // No access cookie (it expired) but the hint says a session exists. The
    // refresh cookie is scoped to the auth path, so this request could not
    // carry it — redirecting here is how a valid session got thrown away on
    // every visit after fifteen minutes.
    jarCookies = { bc_session: '1' };
    mockApi({ [ME]: { status: 401, body: { error: 'unauthorized', message: '' } } });

    const output = render(await SecurityPage());
    expect(output.getByText('Signing you back in…')).toBeInTheDocument();
  });

  it('redirects rather than 500s when the identity API is unreachable', async () => {
    mockApi({});
    await expect(SecurityPage()).rejects.toBeInstanceOf(Error);
  });
});

describe('/profile/security first paint', () => {
  it('knows two-factor is off before hydration', async () => {
    mockApi({ [ME]: me({ mfa_enabled: false }) });

    render(await SecurityPage());

    expect(screen.getByRole('heading', { level: 1, name: /signing in safely/i })).toBeInTheDocument();
    expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('Off');
    expect(screen.getByRole('button', { name: /^turn on two-factor$/i })).toBeInTheDocument();
  });

  it('knows two-factor is on before hydration', async () => {
    mockApi({ [ME]: me({ role: 'admin', mfa_enabled: true, mfa: true }) });

    render(await SecurityPage());

    expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('On');
    expect(screen.getByRole('heading', { name: /new recovery codes/i })).toBeInTheDocument();
  });

  it('lands an enrolled-but-unverified operator straight on the fix', async () => {
    mockApi({ [ME]: me({ role: 'moderator', mfa_enabled: true, mfa: false }) });

    render(await SecurityPage());

    expect(
      screen.getByRole('heading', { name: /one more step to use staff areas/i }),
    ).toBeInTheDocument();
  });
});

describe('the /me path', () => {
  it('asks for the route the identity module actually mounts', async () => {
    mockApi({ [ME]: me({}) });
    await SecurityPage();
    expect(requested).toContain(ME);
  });

  it('falls back to the legacy path if /v1/users/me ever 404s', async () => {
    // Insurance against the two `/me` spellings in this repo being reconciled
    // in either direction (see FINAL REPORT) — the page must not break either way.
    mockApi({ [LEGACY_ME]: me({ mfa_enabled: true, mfa: true }) });

    const actor = await fetchMfaStatus();

    expect(actor?.mfaEnrolled).toBe(true);
    expect(requested).toEqual([ME, LEGACY_ME]);
  });

  it('exports the canonical path so callers cannot drift from it', () => {
    expect(ME_PATH).toBe('/api/v1/users/me');
  });
});
