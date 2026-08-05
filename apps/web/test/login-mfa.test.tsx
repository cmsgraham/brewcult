import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../components/auth/login-form';
import { resetRefreshState } from '../lib/api';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  resetRefreshState();
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function signIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/email/i), 'brain@brewcult.coffee');
  await user.type(screen.getByLabelText(/password/i), 'WorldDomination2026!');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('login — MFA challenge (leg two)', () => {
  it('swaps to the code step instead of navigating when the API asks for MFA', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { mfa_required: true, mfa_token: 'challenge-token' }),
    );

    render(<LoginForm />);
    await signIn(user);

    expect(await screen.findByLabelText(/authentication code/i)).toBeInTheDocument();
    // A challenge is not a session: nothing should have navigated yet.
    expect(push).not.toHaveBeenCalled();
  });

  it('exchanges the challenge token plus a code for a session', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { mfa_required: true, mfa_token: 'challenge-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }));

    render(<LoginForm next="/admin" />);
    await signIn(user);
    await user.type(await screen.findByLabelText(/authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(push).toHaveBeenCalledWith('/admin');

    const verifyCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/auth/mfa/verify'),
    );
    expect(verifyCall).toBeDefined();
    const body: unknown = JSON.parse(String(verifyCall?.[1]?.body ?? '{}'));
    expect(body).toMatchObject({ mfa_token: 'challenge-token', code: '123456' });
  });

  it('sends a recovery code under its own field when the device is lost', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { mfa_required: true, mfa_token: 'challenge-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }));

    render(<LoginForm />);
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: /recovery code/i }));
    await user.type(screen.getByLabelText(/recovery code/i), 'aaaa-bbbb-cccc');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    const verifyCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/auth/mfa/verify'),
    );
    const body = JSON.parse(String(verifyCall?.[1]?.body ?? '{}')) as Record<string, unknown>;
    expect(body['recovery_code']).toBe('aaaa-bbbb-cccc');
    expect(body['code']).toBeUndefined();
  });

  it('keeps the user on the code step when the code is wrong', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { mfa_required: true, mfa_token: 'challenge-token' }))
      .mockResolvedValueOnce(
        jsonResponse(400, { error: 'invalid_code', message: 'That code is not valid.' }),
      );

    render(<LoginForm />);
    await signIn(user);
    await user.type(await screen.findByLabelText(/authentication code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByText(/that code is not valid/i)).toBeInTheDocument();
    // Still on leg two — a bad code must not throw the user back to the password.
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('signs straight in when the account has no MFA', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }));

    render(<LoginForm />);
    await signIn(user);

    expect(push).toHaveBeenCalledWith('/profile');
    expect(screen.queryByLabelText(/authentication code/i)).not.toBeInTheDocument();
  });
});
