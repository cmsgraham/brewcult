/**
 * The three gate states of the operator console (Lane L, deliverable 1 + 8).
 *
 *   not staff (or signed out) → the ordinary 404. No hint the console exists.
 *   staff, no MFA session      → the enrol interstitial, and NO action controls.
 *   staff, MFA session         → the console.
 *
 * These render the real server components with `fetch` stubbed, so the gate is
 * tested where it actually runs. The UI gate is UX, not security — the API's
 * policy layer is the authority — but a gate that renders the wrong screen turns
 * a working console into a dead end, which is what these lock down.
 */
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MfaRequiredError,
  gateFor,
  isStaff,
  normalizeActor,
  normalizePage,
  queryString,
} from '../lib/admin-client';
import { NotFoundError, mockApi } from './pages-fixtures';

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

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ toString: () => 'bc_access=stub' }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: () => undefined }),
}));

const { default: AdminOverviewPage } = await import('../app/admin/page');
const { default: AdminUsersPage } = await import('../app/admin/users/page');
const { default: AdminReportsPage } = await import('../app/admin/reports/page');

const ME = '/api/me';

function me(overrides: Record<string, unknown>) {
  return {
    body: {
      id: 'u-1',
      handle: 'sam',
      email: 'sam@example.com',
      display_name: 'Sam',
      status: 'active',
      role: 'user',
      email_verified: true,
      mfa_enabled: false,
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gate: not staff', () => {
  it('404s a signed-in member, without hinting the console exists', async () => {
    mockApi({ [ME]: me({ role: 'user', mfa_enabled: true }) });
    await expect(AdminOverviewPage()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s a signed-out visitor', async () => {
    mockApi({ [ME]: { status: 401, body: { error: 'unauthorized', message: '' } } });
    await expect(AdminUsersPage()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s a seller owner — a seller is not staff', async () => {
    mockApi({ [ME]: me({ role: 'seller_owner', mfa_enabled: true }) });
    await expect(AdminReportsPage()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s rather than erroring when the identity API is unreachable', async () => {
    mockApi({});
    await expect(AdminOverviewPage()).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('gate: staff without an MFA-backed session', () => {
  it('shows the enrol interstitial and no action controls at all', async () => {
    mockApi({ [ME]: me({ role: 'moderator', mfa_enabled: false }) });

    render(await AdminUsersPage());

    expect(
      screen.getByRole('heading', { name: /staff actions need two-factor authentication/i }),
    ).toBeInTheDocument();

    const enrol = screen.getByRole('link', { name: /set up two-factor authentication/i });
    expect(enrol).toHaveAttribute('href', '/profile/security');

    // The whole point: a screen full of disabled Suspend buttons would be a
    // tease. There is exactly one next step, and it is a link.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('tells an already-enrolled moderator to sign in again, not to enrol twice', async () => {
    // Session-level `mfa` is false even though the account has TOTP on it.
    mockApi({ [ME]: me({ role: 'admin', mfa_enabled: true, mfa: false }) });

    render(await AdminReportsPage());

    expect(screen.getByText(/two-factor is already on your account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to two-factor settings/i })).toBeInTheDocument();
  });
});

describe('gate: staff with an MFA-backed session', () => {
  it('renders the console for an admin', async () => {
    mockApi({ [ME]: me({ role: 'admin', mfa_enabled: true, mfa: true }) });

    render(await AdminOverviewPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Operator console' })).toBeInTheDocument();
    // "People" is both a sub-nav item and a card — both must go to the same place.
    for (const link of screen.getAllByRole('link', { name: 'People' })) {
      expect(link).toHaveAttribute('href', '/admin/users');
    }
    for (const link of screen.getAllByRole('link', { name: 'Audit log' })) {
      expect(link).toHaveAttribute('href', '/admin/audit');
    }
    expect(
      screen.queryByRole('heading', { name: /staff actions need two-factor/i }),
    ).not.toBeInTheDocument();
  });

  it('degrades to "unavailable" queue depths when Lane K is not deployed', async () => {
    // Only /api/me answers; every admin route 404s.
    mockApi({ [ME]: me({ role: 'moderator', mfa_enabled: true, mfa: true }) });

    render(await AdminOverviewPage());

    expect(screen.getAllByText(/queue depth unavailable/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Operator console' })).toBeInTheDocument();
  });
});

describe('admin-client helpers', () => {
  it('treats a missing session-level mfa flag as the enrolment flag', () => {
    const actor = normalizeActor({ id: 'u-1', handle: 'sam', role: 'admin', mfa_enabled: true });
    expect(actor?.mfaSession).toBe(true);
    expect(isStaff(actor)).toBe(true);
  });

  it('prefers the session-level mfa flag when the API sends one', () => {
    const actor = normalizeActor({
      id: 'u-1',
      handle: 'sam',
      role: 'admin',
      mfa_enabled: true,
      mfa: false,
    });
    expect(actor?.mfaSession).toBe(false);
    expect(gateFor(actor).state).toBe('mfa-required');
  });

  it('collapses "signed out" and "not staff" into one answer', () => {
    expect(gateFor(null).state).toBe('unavailable');
    expect(gateFor(normalizeActor({ id: 'u-2', handle: 'jo', role: 'user' })).state).toBe(
      'unavailable',
    );
  });

  it('survives a junk /me body', () => {
    expect(normalizeActor(null)).toBeNull();
    expect(normalizeActor({ handle: 'no-id' })).toBeNull();
    expect(normalizeActor({ id: 'u-3', handle: 'jo', role: 'wizard' })?.role).toBe('user');
  });

  it('drops empty query params and returns "" for an empty filter set', () => {
    expect(queryString({ q: '', role: 'admin', cursor: null })).toBe('?role=admin');
    expect(queryString({ q: '   ' })).toBe('');
  });

  it('turns a junk envelope into an empty page instead of throwing', () => {
    expect(normalizePage(undefined)).toEqual({ items: [], next_cursor: null });
    expect(normalizePage({ items: [1, 2], next_cursor: '' })).toEqual({
      items: [1, 2],
      next_cursor: null,
    });
  });

  it('has its own error type for mfa_required', () => {
    expect(new MfaRequiredError()).toBeInstanceOf(Error);
    expect(new MfaRequiredError().name).toBe('MfaRequiredError');
  });
});
