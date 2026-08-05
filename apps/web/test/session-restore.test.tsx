/**
 * Keeping people signed in.
 *
 * Production evidence for why this exists: 19 sign-ins in a week, exactly ONE
 * refresh. The rotation machinery was correct and almost never ran, because the
 * refresh cookie is scoped to the auth path — so a page navigation carries no
 * credential at all once the 15-minute access cookie has expired, and every
 * server render decided a returning member was a stranger.
 *
 * These tests pin the recovery: it happens when it should, it happens ONCE, and
 * it never happens for somebody who genuinely is not signed in.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
}));

const { SessionRestorer } = await import('../components/session-restorer');
const { SessionRestoreScreen } = await import('../components/session-restore-screen');
const { resetRefreshState, SESSION_HINT_COOKIE } = await import('../lib/api');

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetRefreshState();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/`;
});

afterEach(() => {
  document.cookie = `${SESSION_HINT_COOKIE}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

const ok = () => new Response('{}', { status: 200 });
const unauthorized = () => new Response('{}', { status: 401 });

describe('restoring in the background', () => {
  it('refreshes and re-renders when the server could not see the session', async () => {
    fetchMock.mockResolvedValue(ok());
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/v1/auth/refresh');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    // The re-render is the point: server components then see a fresh cookie.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('does nothing at all for a visitor with no session', async () => {
    document.cookie = `${SESSION_HINT_COOKIE}=; Max-Age=0; Path=/`;
    render(<SessionRestorer restorable />);

    // A refresh POST on every anonymous page view would be a wasted round trip
    // on every crawl of every public page.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when the server already rendered a live session', async () => {
    render(<SessionRestorer restorable={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forgets the hint after a failure, so the next page load does not retry', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.cookie).not.toContain(SESSION_HINT_COOKIE));
    // No re-render: nothing changed, and a refresh() here would just cost a
    // round trip to draw the same signed-out page.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('tries once per page load, not once per render', async () => {
    fetchMock.mockResolvedValue(ok());
    const { rerender } = render(<SessionRestorer restorable />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<SessionRestorer restorable />); // what router.refresh() causes
    rerender(<SessionRestorer restorable />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the restore screen on a private page', () => {
  it('re-renders the page rather than sending a signed-in person to /login', async () => {
    fetchMock.mockResolvedValue(ok());
    render(<SessionRestoreScreen next="/profile" />);

    expect(screen.getByText('Signing you back in…')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes to /login, keeping where you were headed, when the session is truly gone', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    render(<SessionRestoreScreen next="/profile/security" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fprofile%2Fsecurity'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
