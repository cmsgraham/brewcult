import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

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

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/login',
}));

const login = vi.fn();
const register = vi.fn();
const requestPasswordReset = vi.fn();
const confirmPasswordReset = vi.fn();

// The forms are tested against a stubbed client, never a live API.
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    authApi: { login, register, requestPasswordReset, confirmPasswordReset },
  };
});

const { ForgotPasswordForm } = await import('../components/auth/forgot-password-form');
const { GoogleButton } = await import('../components/auth/google-button');
const { LoginForm } = await import('../components/auth/login-form');
const { RegisterForm } = await import('../components/auth/register-form');
const { ResetPasswordForm } = await import('../components/auth/reset-password-form');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginForm', () => {
  it('renders labelled fields and a submit button', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('refuses to submit empty required fields and says what is missing', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).not.toHaveBeenCalled();
    expect(await screen.findByText(/we need your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects an address that is not an email', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'nadia-at-example');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).not.toHaveBeenCalled();
    expect(screen.getByText(/does not look like an email address/i)).toBeInTheDocument();
  });

  it('submits valid credentials and moves the person along', async () => {
    const user = userEvent.setup();
    login.mockResolvedValueOnce({});
    render(<LoginForm next="/profile" />);

    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith({
      email: 'nadia@example.com',
      password: 'a-long-enough-password',
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/profile'));
  });

  it('shows the API message in an assertive alert when sign-in fails', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../lib/api');
    login.mockRejectedValueOnce(
      new ApiError(401, { error: 'invalid_credentials', message: 'no' }),
    );
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/reset your password/i);
  });
});

describe('RegisterForm', () => {
  it('requires email, handle, password and the 16+ confirmation', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).not.toHaveBeenCalled();
    expect(await screen.findByText(/we need your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/pick a handle/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a password/i)).toBeInTheDocument();
    expect(
      screen.getByText(/16 or older/i, { selector: '.bc-field__error' }),
    ).toBeInTheDocument();
  });

  it('states plainly what brew logs are used for (EF §4.5)', () => {
    render(<RegisterForm />);
    expect(screen.getByText(/taste profile/i)).toBeInTheDocument();
    expect(screen.getByText(/off switch/i)).toBeInTheDocument();
  });

  it('keeps the anti-gatekeeping norm visible at the point of action', () => {
    render(<RegisterForm />);
    // Display name is optional; nothing about gear is demanded up front.
    expect(screen.getByLabelText(/display name \(optional\)/i)).toBeInTheDocument();
  });

  it('normalises the handle and confirms by email on success', async () => {
    const user = userEvent.setup();
    register.mockResolvedValueOnce({});
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'Nadia@example.com');
    await user.type(screen.getByLabelText('Handle'), 'Nadia_B');
    await user.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // 'Nadia_B' fails the lowercase handle rule before any request is made.
    expect(register).not.toHaveBeenCalled();
    expect(
      screen.getByText(/lowercase letters/i, { selector: '.bc-field__error' }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Handle'));
    await user.type(screen.getByLabelText('Handle'), 'nadia_b');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith({
      email: 'Nadia@example.com',
      handle: 'nadia_b',
      password: 'a-long-enough-password',
    });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });
});

describe('ForgotPasswordForm', () => {
  it('requires an email before asking the API for anything', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(await screen.findByText(/we need your email address/i)).toBeInTheDocument();
  });

  it('gives the same answer whether or not the address exists', async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValueOnce(undefined);
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'nadia@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(/if that address has a BrewCult account/i)).toBeInTheDocument();
  });
});

describe('ResetPasswordForm', () => {
  it('explains itself instead of crashing when the token is missing', () => {
    render(<ResetPasswordForm token="" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/i);
  });

  it('requires a long password and a matching confirmation', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="tok_123" />);

    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(confirmPasswordReset).not.toHaveBeenCalled();
    expect(
      screen.getByText(/at least 12 characters/i, { selector: '.bc-field__error' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('sends the token with the new password', async () => {
    const user = userEvent.setup();
    confirmPasswordReset.mockResolvedValueOnce(undefined);
    render(<ResetPasswordForm token="tok_123" />);

    await user.type(screen.getByLabelText('New password'), 'a-long-enough-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() =>
      expect(confirmPasswordReset).toHaveBeenCalledWith({
        token: 'tok_123',
        password: 'a-long-enough-password',
      }),
    );
  });
});

describe('GoogleButton', () => {
  it('is a plain link to the redirect endpoint, not a fetch', () => {
    render(<GoogleButton enabled next="/profile" />);
    const link = screen.getByRole('link', { name: 'Continue with Google' });
    expect(link).toHaveAttribute('href', '/api/auth/google?next=%2Fprofile');
  });

  it('disappears when the client-config flag says Google is unavailable', () => {
    const { container } = render(<GoogleButton enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
