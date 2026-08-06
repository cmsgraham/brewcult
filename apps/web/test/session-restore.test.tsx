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

const { LocaleProvider } = await import('../components/locale-provider');
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
const csrfToken = () => new Response(JSON.stringify({ csrf_token: 'tok-1' }), { status: 200 });
const forbidden = () =>
  new Response(JSON.stringify({ error: 'forbidden', message: 'csrf' }), { status: 403 });

/** Answers the CSRF mint, and whatever is queued for the refresh itself. */
function apiStub(refreshResponses: Response[]) {
  const queue = [...refreshResponses];
  return vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      String(url).includes('/auth/csrf') ? csrfToken() : (queue.shift() ?? ok()),
    ),
  );
}

describe('restoring in the background', () => {
  it('refreshes and re-renders when the server could not see the session', async () => {
    const stub = apiStub([ok()]);
    vi.stubGlobal('fetch', stub);
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const call = stub.mock.calls.find(([url]) => String(url).includes('/auth/refresh'));
    expect(call?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('sends a CSRF token, because refresh is a mutation and the API says so', async () => {
    // Without this the browser's refresh is a 403, every time, silently — which
    // is what production did for a week: 19 sign-ins, 1 rotation. The old test
    // asserted the URL and the method and would have passed throughout.
    const stub = apiStub([ok()]);
    vi.stubGlobal('fetch', stub);
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = stub.mock.calls.find(([url]) => String(url).includes('/auth/refresh'));
    expect((call?.[1] as RequestInit).headers).toMatchObject({ 'x-csrf-token': 'tok-1' });
  });

  it('mints a fresh token and retries once when the first one is stale', async () => {
    const stub = apiStub([forbidden(), ok()]);
    vi.stubGlobal('fetch', stub);
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const refreshCalls = stub.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(2);
    // Retried ONCE. A loop here would hammer the endpoint on every page load.
    expect(refreshCalls[1]?.[1]).toMatchObject({ method: 'POST' });
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
    const stub = apiStub([unauthorized()]);
    vi.stubGlobal('fetch', stub);
    render(<SessionRestorer restorable />);

    await waitFor(() => expect(document.cookie).not.toContain(SESSION_HINT_COOKIE));
    // No re-render: nothing changed, and a refresh() here would just cost a
    // round trip to draw the same signed-out page.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('tries once per page load, not once per render', async () => {
    const stub = apiStub([ok()]);
    vi.stubGlobal('fetch', stub);
    const { rerender } = render(<SessionRestorer restorable />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(<SessionRestorer restorable />); // what router.refresh() causes
    rerender(<SessionRestorer restorable />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const refreshCalls = stub.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
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

  it('sends a Spanish reader to the Spanish sign-in page', async () => {
    // `next` already arrived in Spanish — the guard that built it knew which
    // page it was protecting. `/login` did not, so a lapsed session was handed
    // to the English sign-in page to come back from.
    fetchMock.mockResolvedValue(unauthorized());
    render(
      <LocaleProvider locale="es">
        <SessionRestoreScreen next="/es/profile/security" />
      </LocaleProvider>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/es/login?next=%2Fes%2Fprofile%2Fsecurity'),
    );
  });
});
