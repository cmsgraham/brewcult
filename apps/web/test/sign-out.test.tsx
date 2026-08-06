/**
 * Sign out.
 *
 * The product shipped without one. The only control existed inside the security
 * panel, put there to unstick an MFA dead end rather than as the way out of the
 * app — so a signed-in person had no discoverable way to leave, which matters
 * most on a shared or borrowed device.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

const logout = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return { ...actual, authApi: { ...actual.authApi, logout } };
});

const { LocaleProvider } = await import('../components/locale-provider');
const { SignOutButton } = await import('../components/profile/sign-out-button');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignOutButton', () => {
  it('revokes the session server-side, then leaves', async () => {
    const user = userEvent.setup();
    logout.mockResolvedValueOnce(undefined);
    render(<SignOutButton />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // Server-side revocation matters: dropping cookies locally would leave the
    // refresh-token family alive and usable.
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(refresh).toHaveBeenCalled();
  });

  it('still gets you out when the API call fails', async () => {
    const user = userEvent.setup();
    logout.mockRejectedValueOnce(new Error('network'));
    render(<SignOutButton />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // A failed logout must never strand somebody on the page they are leaving.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });

  it('leaves a Spanish reader on the Spanish sign-in page', async () => {
    // Signing out sent everybody to `/login` regardless. The redirect worked,
    // so it never looked like a bug — it just quietly changed your language at
    // the one moment you are most likely to think the site is broken.
    const user = userEvent.setup();
    logout.mockResolvedValueOnce(undefined);
    render(
      <LocaleProvider locale="es">
        <SignOutButton />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/es/login'));
  });
});
