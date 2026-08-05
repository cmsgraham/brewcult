/**
 * The data-subject controls on the profile page (EF §4.3).
 *
 * Deletion is the most destructive thing a signed-in person can do here, and it
 * had no test at all — which is how it shipped calling `/api/me`, a path that
 * strips to `/me` and 404s. The component reports 404 as "coming soon", so a
 * feature that was implemented and working the whole time told every user it
 * did not exist yet. These tests pin the endpoint, the confirmation step, and
 * the honesty of the not-built-yet message.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

const apiFetch = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return { ...actual, apiFetch };
});

const { AccountActions } = await import('../components/profile/account-actions');

const USER_ID = '75f0acba-9738-45dc-9d12-c1a250ed3f83';

function renderActions(overrides: Partial<Parameters<typeof AccountActions>[0]> = {}) {
  return render(
    <AccountActions userId={USER_ID} exportEnabled deletionEnabled {...overrides} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account deletion', () => {
  it('never fires on the first click — it asks first', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm account deletion' })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('lets someone back out, having called nothing', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.click(screen.getByRole('button', { name: 'Keep my account' }));

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Confirm account deletion' })).not.toBeInTheDocument();
  });

  it('DELETEs /api/v1/users/:id — not /api/me, which does not exist', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({});
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith(`/api/v1/users/${USER_ID}`, { method: 'DELETE' });
    expect(await screen.findByText(/scheduled for deletion/i)).toBeInTheDocument();
  });

  it('still tells the truth when the endpoint really is missing', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../lib/api');
    apiFetch.mockRejectedValueOnce(new ApiError(404, { error: 'not_found', message: '' }));
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

    // "Coming soon" is the right answer for an unbuilt endpoint — it was only
    // wrong because the path was pointing at nothing.
    expect(await screen.findByText(/nearly ready/i)).toBeInTheDocument();
  });

  it('hides deletion entirely when the feature flag is off', () => {
    renderActions({ deletionEnabled: false });
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });
});

describe('data export', () => {
  it('posts to the export endpoint and confirms warmly', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({});
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Export my data' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith('/api/me/export', { method: 'POST' });
    expect(await screen.findByText(/packing up your data/i)).toBeInTheDocument();
  });
});
