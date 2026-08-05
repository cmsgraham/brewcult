/**
 * Audit viewer, moderation queue and seller applications (Lane L, deliverables
 * 4, 5, 6).
 *
 * The audit page is a real server component rendered with `fetch` stubbed; the
 * two queues are client components rendered directly. Every suite includes the
 * "Lane K has not deployed this yet" path, because a 404 must read as an
 * unfinished feature, never as a broken console.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsConsole } from '../components/admin/reports-console';
import { SellerApplicationsConsole } from '../components/admin/seller-applications-console';
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

const { default: AdminAuditPage } = await import('../app/admin/audit/page');

// The API serves the current user at /v1/users/me, reached as /api/v1/users/me.
// This constant said '/api/me' — the path the client wrongly used — so the
// stub matched the broken call and the suite stayed green while the real
// console could never identify its operator.
const ME = '/api/v1/users/me';
const AUDIT = '/api/v1/admin/audit';
const REPORTS = '/api/v1/admin/reports';
const APPLICATIONS = '/api/v1/admin/seller-applications';

const STAFF = {
  body: {
    id: 'u-staff',
    handle: 'mod',
    email: 'mod@example.com',
    role: 'admin',
    status: 'active',
    mfa_enabled: true,
    mfa: true,
  },
};

const noParams = () => ({ searchParams: Promise.resolve({}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audit log viewer', () => {
  it('renders entries, filters and a collapsed payload', async () => {
    mockApi({
      [ME]: STAFF,
      [AUDIT]: {
        body: {
          items: [
            {
              id: 'e-1',
              created_at: '2026-08-01T12:30:00.000Z',
              action: 'user.suspended',
              actor_id: 'u-staff',
              actor_handle: 'mod',
              target_type: 'user',
              target_id: 'u-alice',
              payload: { reason: 'Repeated spam' },
            },
            {
              id: 'e-2',
              created_at: '2026-08-01T12:00:00.000Z',
              action: 'session.refresh_reused',
              actor_id: null,
              target_type: null,
              payload: {},
            },
          ],
          next_cursor: 'cursor-2',
        },
      },
    });

    const { container } = render(await AdminAuditPage(noParams()));

    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('user.suspended')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01 12:30 UTC')).toBeInTheDocument();
    expect(screen.getByText('@mod')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();

    // Append-only is stated, not implied — and there is nothing to click that
    // would suggest an entry can be edited.
    expect(screen.getAllByText(/append-only/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /delete|edit/i })).not.toBeInTheDocument();

    // Payload is collapsed, and present.
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText(/Repeated spam/)).toBeInTheDocument();

    // Filters, and forward-only cursor paging.
    expect(screen.getByLabelText('Actor id')).toBeInTheDocument();
    expect(screen.getByLabelText('Action')).toBeInTheDocument();
    expect(screen.getByLabelText('Target type')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Older entries' })).toHaveAttribute(
      'href',
      '/admin/audit?cursor=cursor-2',
    );
  });

  it('carries the active filters into the pagination link', async () => {
    mockApi({ [ME]: STAFF, [AUDIT]: { body: { items: [], next_cursor: 'c-9' } } });

    render(
      await AdminAuditPage({
        searchParams: Promise.resolve({ action: 'user.suspended', target_type: 'user' }),
      }),
    );

    const older = screen.getByRole('link', { name: 'Older entries' });
    expect(older.getAttribute('href')).toContain('action=user.suspended');
    expect(older.getAttribute('href')).toContain('target_type=user');
    expect(older.getAttribute('href')).toContain('cursor=c-9');
  });

  it('handles an empty log without implying nothing happened', async () => {
    mockApi({ [ME]: STAFF, [AUDIT]: { body: { items: [], next_cursor: null } } });

    render(await AdminAuditPage(noParams()));

    expect(screen.getByText(/no entries match those filters/i)).toBeInTheDocument();
    expect(screen.getByText(/not the same as nothing having happened/i)).toBeInTheDocument();
    expect(screen.getByText(/end of the log for these filters/i)).toBeInTheDocument();
  });

  it('degrades to a friendly message when the audit endpoint 404s', async () => {
    mockApi({ [ME]: STAFF });

    render(await AdminAuditPage(noParams()));

    expect(screen.getByText(/not switched on yet/i)).toBeInTheDocument();
    expect(screen.getByText(/entries are still being written/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('404s for a non-staff visitor', async () => {
    mockApi({ [ME]: { body: { id: 'u-x', handle: 'jo', role: 'user' } } });
    await expect(AdminAuditPage(noParams())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('moderation queue', () => {
  const REPORT = {
    id: 'r-1',
    status: 'open' as const,
    reason: 'Undisclosed advertising',
    details: 'Recipe notes link to the poster’s own shop.',
    target_type: 'recipe',
    target_id: 'rec-9',
    created_at: '2026-08-02T09:00:00.000Z',
    reporter: { id: 'u-2', handle: 'jo' },
    assignee: null,
  };

  it('renders the queue and its claim/resolve controls', async () => {
    mockApi({ [REPORTS]: { body: { items: [REPORT], next_cursor: null } } });

    render(<ReportsConsole />);

    expect(await screen.findByText('Undisclosed advertising')).toBeInTheDocument();
    expect(screen.getByText('Nobody yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record as actioned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('open');
  });

  it('requires a resolution note before a report can be closed', async () => {
    const user = userEvent.setup();
    mockApi({
      [REPORTS]: { body: { items: [REPORT], next_cursor: null } },
      [`${REPORTS}/r-1/resolve`]: { body: { ok: true } },
    });

    render(<ReportsConsole />);
    await screen.findByText('Undisclosed advertising');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    const dialog = screen.getByRole('dialog');
    // §18 tone: procedural, and explicit that dismissing is a normal outcome.
    expect(within(dialog).getByText(/not a verdict on the reporter/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Dismiss report' });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByRole('textbox', { name: /resolution note/i }),
      'Link is a disclosed affiliate; within policy.',
    );
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(await screen.findByText(/recorded as dismissed/i)).toBeInTheDocument();
  });

  it('claims a report and says who it belongs to now', async () => {
    const user = userEvent.setup();
    mockApi({
      [REPORTS]: { body: { items: [REPORT], next_cursor: null } },
      [`${REPORTS}/r-1/claim`]: { body: { ok: true } },
    });

    render(<ReportsConsole />);
    await screen.findByText('Undisclosed advertising');

    await user.click(screen.getByRole('button', { name: 'Claim' }));

    expect(await screen.findByText(/it is on your name now/i)).toBeInTheDocument();
  });

  it('degrades when the queue is not deployed', async () => {
    mockApi({});

    render(<ReportsConsole />);

    expect(await screen.findByText(/not switched on yet/i)).toBeInTheDocument();
    expect(screen.getByText(/none are being dropped/i)).toBeInTheDocument();
  });
});

describe('seller applications', () => {
  const APPLICATION = {
    id: 'a-1',
    status: 'pending' as const,
    business_name: 'Cascara Roasting Co.',
    created_at: '2026-07-28T11:00:00.000Z',
    applicant: { id: 'u-3', handle: 'nadia' },
    country: 'Portugal',
  };

  it('explains that approving grants the seller owner role', async () => {
    const user = userEvent.setup();
    mockApi({
      [APPLICATIONS]: { body: { items: [APPLICATION], next_cursor: null } },
      [`${APPLICATIONS}/a-1/approve`]: { body: { ok: true } },
    });

    render(<SellerApplicationsConsole />);
    await screen.findByRole('heading', { name: 'Cascara Roasting Co.' });

    await user.click(screen.getByRole('button', { name: /^approve cascara roasting co\.$/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/seller owner/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/@nadia/)).toBeInTheDocument();
    // A note is welcome, but approval is not blocked on one.
    expect(
      within(dialog).getByRole('button', { name: /approve and grant seller access/i }),
    ).toBeEnabled();

    await user.click(
      within(dialog).getByRole('button', { name: /approve and grant seller access/i }),
    );
    expect(await screen.findByText(/now holds the seller owner role/i)).toBeInTheDocument();
  });

  it('requires a reason to decline', async () => {
    const user = userEvent.setup();
    mockApi({ [APPLICATIONS]: { body: { items: [APPLICATION], next_cursor: null } } });

    render(<SellerApplicationsConsole />);
    await screen.findByRole('heading', { name: 'Cascara Roasting Co.' });

    await user.click(screen.getByRole('button', { name: /^decline cascara roasting co\.$/i }));

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Decline application' });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByRole('textbox', { name: /why this is being declined/i }),
      'No verifiable trading address yet.',
    );
    expect(confirm).toBeEnabled();
  });

  it('degrades when the queue is not deployed', async () => {
    mockApi({});

    render(<SellerApplicationsConsole />);

    expect(await screen.findByText(/not switched on yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument();
  });
});
