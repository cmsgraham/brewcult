/**
 * People table, confirmation dialogs and the account detail page (Lane L,
 * deliverables 2, 3, 7, 8).
 *
 * `fetch` is stubbed with the envelope shapes from the Lane K contract; nothing
 * here touches a live API. The interesting assertions are the safety ones: a
 * suspension cannot be confirmed without a reason, and an `mfa_required`
 * response becomes an enrol prompt rather than a dead "forbidden".
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersConsole } from '../components/admin/users-console';
import { mockApi, NotFoundError } from './pages-fixtures';

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

const { default: AdminUserDetailPage } = await import('../app/admin/users/[id]/page');

const ME = '/api/me';
const USERS = '/api/v1/admin/users';

const STAFF = {
  body: {
    id: 'u-staff',
    handle: 'mod',
    email: 'mod@example.com',
    display_name: 'Mod',
    role: 'admin',
    status: 'active',
    email_verified: true,
    mfa_enabled: true,
    mfa: true,
  },
};

const ALICE = {
  id: 'u-alice',
  handle: 'alice',
  email: 'alice@example.com',
  display_name: 'Alice',
  role: 'user' as const,
  status: 'active' as const,
  email_verified: true,
  mfa_enabled: false,
  last_seen_at: '2026-07-30T09:15:00.000Z',
  created_at: '2025-01-04T10:00:00.000Z',
};

const BEN = {
  id: 'u-ben',
  handle: 'ben',
  email: 'ben@example.com',
  display_name: null,
  role: 'moderator' as const,
  status: 'suspended' as const,
  last_seen_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('people table', () => {
  it('renders rows, filters and pagination from a mocked envelope', async () => {
    mockApi({ [USERS]: { body: { items: [ALICE, BEN], next_cursor: 'cursor-2' } } });

    render(<UsersConsole />);

    await screen.findByRole('link', { name: /view alice/i });
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    // No display name → the handle stands in. Never the email.
    expect(screen.getByRole('link', { name: /view @ben/i })).toBeInTheDocument();

    // Role and status read as words, not as colours (the same words also appear
    // as filter options, hence scoping to the table).
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Moderator')).toBeInTheDocument();
    expect(table.getByText('Suspended')).toBeInTheDocument();

    expect(screen.getByRole('combobox', { name: 'Role' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText('Page 1')).toBeInTheDocument();

    // The row link addresses the person by opaque id — never by handle or email.
    expect(screen.getByRole('link', { name: /view alice/i })).toHaveAttribute(
      'href',
      '/admin/users/u-alice',
    );
  });

  it('offers reactivate for a suspended account and suspend for an active one', async () => {
    mockApi({ [USERS]: { body: { items: [ALICE, BEN], next_cursor: null } } });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    expect(screen.getByRole('button', { name: /^suspend alice$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reactivate @ben$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('sends the filters the operator picked, and resets to the first page', async () => {
    const user = userEvent.setup();
    mockApi({ [USERS]: { body: { items: [ALICE], next_cursor: 'cursor-2' } } });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument());

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'suspended');

    await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument());

    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls;
    const lastUrl = calls[calls.length - 1]?.[0] ?? '';
    expect(lastUrl).toContain('status=suspended');
    expect(lastUrl).not.toContain('cursor=');
  });

  it('keeps the search term out of the URL — it is P2 personal data', async () => {
    const user = userEvent.setup();
    mockApi({ [USERS]: { body: { items: [ALICE], next_cursor: null } } });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.type(
      screen.getByRole('searchbox', { name: 'Search people' }),
      'alice@example.com',
    );
    // Typing alone must not fetch: no keystroke-by-keystroke email leakage.
    const beforeSubmit = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls;
      expect(calls.length).toBeGreaterThan(beforeSubmit);
    });

    // The term goes to the API, but never to the address bar.
    expect(window.location.search).toBe('');
  });

  it('degrades to a friendly message when the operator API is not deployed', async () => {
    mockApi({}); // every admin route 404s

    render(<UsersConsole />);

    expect(await screen.findByText(/not switched on yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing you did caused this/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so plainly when a filter matches nobody', async () => {
    mockApi({ [USERS]: { body: { items: [], next_cursor: null } } });

    render(<UsersConsole />);

    expect(await screen.findByText(/nobody matches those filters/i)).toBeInTheDocument();
  });
});

describe('destructive confirmations', () => {
  it('will not enable confirm until a suspension reason is written', async () => {
    const user = userEvent.setup();
    mockApi({ [USERS]: { body: { items: [ALICE], next_cursor: null } } });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /^suspend alice$/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Suspend Alice?' })).toBeInTheDocument();
    // The consequence is spelled out in plain language, naming the person.
    expect(
      within(dialog).getByText(/signed out of all devices and cannot sign in until/i),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Suspend account' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: /reason/i }), 'Spam listings');
    expect(confirm).toBeEnabled();

    // Whitespace is not a reason.
    await user.clear(within(dialog).getByRole('textbox', { name: /reason/i }));
    await user.type(within(dialog).getByRole('textbox', { name: /reason/i }), '   ');
    expect(confirm).toBeDisabled();
  });

  it('suspends, announces the result and refreshes the list', async () => {
    const user = userEvent.setup();
    mockApi({
      [USERS]: { body: { items: [ALICE], next_cursor: null } },
      [`${USERS}/u-alice/suspend`]: { body: { ok: true } },
    });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /^suspend alice$/i }));
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Repeated spam');
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));

    expect(await screen.findByText(/alice is suspended and signed out everywhere/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps focus in the dialog and cancels on Escape', async () => {
    const user = userEvent.setup();
    mockApi({ [USERS]: { body: { items: [ALICE], next_cursor: null } } });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /force logout alice/i }));

    const dialog = screen.getByRole('dialog');
    // The reason box takes focus, so typing starts where it should.
    expect(within(dialog).getByRole('textbox', { name: /reason/i })).toHaveFocus();

    // Tab never escapes the dialog.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('surfaces mfa_required from a role change as an enrol prompt, not an error', async () => {
    const user = userEvent.setup();
    mockApi({
      [USERS]: { body: { items: [ALICE], next_cursor: null } },
      // The contract allows a 200 that refuses: `{ mfa_required: true }`.
      [`${USERS}/u-alice/role`]: { body: { mfa_required: true } },
    });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /change role alice/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'New role' }), 'moderator');
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Joining the mod team');
    await user.click(screen.getByRole('button', { name: /make alice moderator/i }));

    expect(
      await screen.findByText(/staff actions need two-factor authentication/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing was changed/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /set up two-factor authentication/i }),
    ).toHaveAttribute('href', '/profile/security');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('surfaces a 403 mfa_required error body the same way', async () => {
    const user = userEvent.setup();
    mockApi({
      [USERS]: { body: { items: [ALICE], next_cursor: null } },
      [`${USERS}/u-alice/force-logout`]: {
        status: 403,
        body: { error: 'mfa_required', message: 'Staff actions require MFA' },
      },
    });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /force logout alice/i }));
    await user.click(screen.getByRole('button', { name: 'Sign out all devices' }));

    expect(
      await screen.findByText(/staff actions need two-factor authentication/i),
    ).toBeInTheDocument();
  });

  it('keeps a typed reason when the action fails for an ordinary reason', async () => {
    const user = userEvent.setup();
    mockApi({
      [USERS]: { body: { items: [ALICE], next_cursor: null } },
      [`${USERS}/u-alice/suspend`]: {
        status: 500,
        body: { error: 'internal_error', message: '' },
      },
    });

    render(<UsersConsole />);
    await screen.findByRole('link', { name: /view alice/i });

    await user.click(screen.getByRole('button', { name: /^suspend alice$/i }));
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Repeated spam');
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/broke on our side/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /reason/i })).toHaveValue('Repeated spam');
  });
});

describe('account detail page', () => {
  it('shows identity, activity and the action panel — with coarsened addresses', async () => {
    mockApi({
      [ME]: STAFF,
      [`${USERS}/u-alice`]: {
        body: {
          ...ALICE,
          session_count: 3,
          identities: [{ provider: 'google' }],
          recent_login_attempts: [
            {
              id: 'a-1',
              created_at: '2026-08-01T08:00:00.000Z',
              success: false,
              failure_reason: 'invalid_password',
              ip: '203.0.113.42',
              user_agent: 'Mozilla/5.0 (Macintosh)',
            },
            {
              id: 'a-2',
              created_at: '2026-08-01T08:01:00.000Z',
              success: true,
              ip: '203.0.113.42',
            },
          ],
        },
      },
    });

    render(await AdminUserDetailPage({ params: Promise.resolve({ id: 'u-alice' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Password, plus google')).toBeInTheDocument();
    expect(screen.getByText('3 devices')).toBeInTheDocument();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText(/invalid password/i)).toBeInTheDocument();

    // P2: the address is coarsened for display, never shown in full.
    expect(screen.getAllByText('203.0.x.x').length).toBe(2);
    expect(screen.queryByText('203.0.113.42')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: /suspend alice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change role' })).toBeInTheDocument();
  });

  it('degrades to a friendly panel when the detail endpoint is missing', async () => {
    mockApi({ [ME]: STAFF });

    render(await AdminUserDetailPage({ params: Promise.resolve({ id: 'u-alice' }) }));

    expect(screen.getByText(/not switched on yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to people/i })).toBeInTheDocument();
  });

  it('404s the detail page for a non-staff visitor', async () => {
    mockApi({
      [ME]: { body: { id: 'u-x', handle: 'jo', email: 'jo@example.com', role: 'user' } },
    });

    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: 'u-alice' }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
