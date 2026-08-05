/**
 * The two-factor setup surface (/profile/security), tested where it runs.
 *
 * This page is the only exit from the operator console's MFA interstitial, so
 * the failure modes that matter are not "it threw" — they are quieter:
 *
 *   - the QR renders but the manual key does not, stranding anyone without a
 *     camera or a second device;
 *   - a mistyped digit throws the whole step away, taking the QR with it;
 *   - the recovery codes scroll past and can be dismissed by accident, and the
 *     API cannot ever show them again;
 *   - somebody enrolled but still refused by /admin is told to enrol again,
 *     which is a loop rather than an answer;
 *   - a secret or a one-time code ends up somewhere it is written down.
 *
 * Every test below is one of those. `fetch` is stubbed; no live API is touched.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { resetRefreshState } from '../lib/api';
import { groupSecret, redactSensitive, resetCsrfState } from '../lib/mfa-client';

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
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));

const { SecurityPanel } = await import('../components/security/security-panel');

/** A 20-byte base32 TOTP secret, of the shape `generateTotpSecret()` emits. */
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OTPAUTH = `otpauth://totp/BrewCult:sam%40example.com?secret=${SECRET}&issuer=BrewCult&period=30`;
const CODES = [
  'A1B2C-D3E4F-G5H6J-K7L8M',
  'N9P0Q-R1S2T-U3V4W-X5Y6Z',
  'B7C8D-E9F0G-H1J2K-L3M4N',
];
const GOOD_CODE = '123456';

interface Reply {
  status?: number;
  body?: unknown;
}
type Route = Reply | ((body: unknown, headers: Headers) => Reply);

interface Recorded {
  path: string;
  method: string;
  body: unknown;
  headers: Headers;
}

let calls: Recorded[] = [];

/**
 * `fetch` stub keyed on `METHOD /path`. Anything unrouted 404s — an unexpected
 * request is a bug in the component, and a permissive default would hide it.
 */
function mockApi(routes: Record<string, Route>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ path: String(input), method, body, headers });

      const route = routes[`${method} ${String(input)}`];
      const reply: Reply =
        typeof route === 'function'
          ? route(body, headers)
          : (route ?? { status: 404, body: { error: 'not_found', message: '' } });
      const status = reply.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(reply.body ?? {}),
      } as unknown as Response);
    }),
  );
}

const CSRF: Record<string, Route> = {
  'GET /api/v1/auth/csrf': { body: { csrf_token: 'csrf-abc', header: 'x-csrf-token' } },
};

const ENROL_OK: Route = {
  body: { secret: SECRET, otpauth_url: OTPAUTH, digits: 6, period: 30 },
};

function panel(overrides: Partial<Parameters<typeof SecurityPanel>[0]> = {}) {
  return (
    <SecurityPanel
      handle="sam"
      role="admin"
      enrolled={false}
      sessionVerified={false}
      {...overrides}
    />
  );
}

beforeEach(() => {
  calls = [];
  push.mockClear();
  refresh.mockClear();
  resetCsrfState();
  resetRefreshState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Enrolment
 * ------------------------------------------------------------------ */

describe('enrolment', () => {
  it('offers both a QR code and a typed-in key — scanning is not universal', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/mfa/enrol': ENROL_OK });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    // The QR: a real symbol, with an accessible name that points at the
    // alternative rather than pretending an image can be read out.
    const qr = await screen.findByTestId('mfa-qr');
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr).toHaveAttribute('role', 'img');
    expect(qr.getAttribute('aria-label')).toMatch(/cannot scan/i);
    expect(qr.querySelector('path')?.getAttribute('d')).toBeTruthy();

    // The manual key, grouped so a human can read it off a screen.
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent(groupSecret(SECRET));
    expect(screen.getByRole('button', { name: /copy setup key/i })).toBeInTheDocument();

    // …and the parameters the app needs if it asks.
    expect(screen.getByText(/6-digit codes, refreshing every 30 seconds/i)).toBeInTheDocument();
  });

  it('sends the CSRF token the API demands on cookie-authenticated mutations', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/mfa/enrol': ENROL_OK });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await screen.findByTestId('mfa-qr');

    const enrol = calls.find((c) => c.path.endsWith('/mfa/enrol'));
    expect(enrol?.headers.get('x-csrf-token')).toBe('csrf-abc');
  });

  it('labels the code field for one-time-code autofill and a numeric keypad', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/mfa/enrol': ENROL_OK });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    const field = await screen.findByLabelText(/six-digit code from your app/i);
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('maxlength', '6');
  });

  it('moves focus to the new step so a keyboard user does not lose their place', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/mfa/enrol': ENROL_OK });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    // The heading, not the input: landing in the code field would skip straight
    // past the QR and the setup key, which is the entire point of the step.
    const heading = await screen.findByRole('heading', { name: /pair your authenticator app/i });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});

/* ------------------------------------------------------------------ *
 * Confirmation
 * ------------------------------------------------------------------ */

describe('confirming a code', () => {
  it('shows the recovery codes once, and will not let you leave until you say you saved them', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/enrol': ENROL_OK,
      'POST /api/v1/auth/mfa/confirm': { body: { status: 'enabled', recovery_codes: CODES } },
    });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.type(await screen.findByLabelText(/six-digit code/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    const list = await screen.findByTestId('recovery-codes');
    for (const code of CODES) expect(within(list).getByText(code)).toBeInTheDocument();
    expect(screen.getByText(/you will not see these again/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy all codes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download as a text file/i })).toBeInTheDocument();

    // The acknowledgement is the only exit, and it starts shut.
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /saved my recovery codes/i }));
    expect(done).toBeEnabled();

    await user.click(done);
    expect(screen.queryByTestId('recovery-codes')).not.toBeInTheDocument();
    expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('On');
  });

  it('keeps the step, the QR and the typed code when the API rejects the code', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/enrol': ENROL_OK,
      'POST /api/v1/auth/mfa/confirm': {
        status: 400,
        body: { error: 'bad_request', message: 'That code is not valid.' },
      },
    });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    const field = await screen.findByLabelText(/six-digit code/i);
    await user.type(field, '000000');
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));

    // The API's own words, not a generic "something in the form needs a tweak".
    expect(await screen.findByText('That code is not valid.')).toBeInTheDocument();
    // Everything needed for the next attempt is still on screen.
    expect(screen.getByTestId('mfa-qr')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent(groupSecret(SECRET));
    expect(field).toHaveValue('000000');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('recovery-codes')).not.toBeInTheDocument();
  });

  it('will not submit a half-typed code', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/mfa/enrol': ENROL_OK });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.type(await screen.findByLabelText(/six-digit code/i), '123');

    expect(screen.getByRole('button', { name: /turn on two-factor/i })).toBeDisabled();
    expect(calls.some((c) => c.path.endsWith('/mfa/confirm'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Already on
 * ------------------------------------------------------------------ */

describe('when two-factor is already on', () => {
  it('shows the management options and no enrolment offer', () => {
    mockApi({ ...CSRF });
    render(panel({ enrolled: true, sessionVerified: true }));

    expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('On');
    expect(screen.getByRole('heading', { name: /new recovery codes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate new codes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn off two-factor/i })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^turn on two-factor$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mfa-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mfa-secret')).not.toBeInTheDocument();
  });

  it('regenerating recovery codes needs a current code and shows the new set once', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/recovery-codes': { body: { status: 'ok', recovery_codes: CODES } },
    });
    render(panel({ enrolled: true, sessionVerified: true }));

    const generate = screen.getByRole('button', { name: /generate new codes/i });
    expect(generate).toBeDisabled();

    await user.type(screen.getByLabelText(/code from your app/i), GOOD_CODE);
    expect(generate).toBeEnabled();
    await user.click(generate);

    expect(await screen.findByTestId('recovery-codes')).toBeInTheDocument();
    expect(screen.getByText(/old codes stopped working/i)).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/mfa/recovery-codes'))?.body).toEqual({
      code: GOOD_CODE,
    });
  });

  it('turning it off asks for the password as well as a code, and says what breaks', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/disable': { body: { status: 'ok' } },
    });
    render(panel({ enrolled: true, sessionVerified: true, role: 'admin' }));

    await user.click(screen.getByRole('button', { name: /turn off two-factor/i }));

    // The consequence is stated before the destructive button, not after it.
    expect(screen.getByText(/you will lose access to staff areas/i)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /yes, turn it off/i });
    expect(confirm).toBeDisabled();

    // A code alone is not enough — the password is required too.
    await user.type(screen.getByLabelText(/current code from your app/i), GOOD_CODE);
    expect(confirm).toBeDisabled();
    expect(calls.some((c) => c.path.endsWith('/mfa/disable'))).toBe(false);

    await user.type(screen.getByLabelText(/your password/i), 'correct horse battery');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('Off'),
    );
    expect(calls.find((c) => c.path.endsWith('/mfa/disable'))?.body).toEqual({
      password: 'correct horse battery',
      code: GOOD_CODE,
    });
    expect(screen.getByRole('button', { name: /^turn on two-factor$/i })).toBeInTheDocument();
  });

  it('says the password was wrong, not that the session expired', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      // The API answers a bad password on this route with a 401 whose *code* is
      // `unauthorized`. Mapping that code to "Please sign in again" — which is
      // what the shared error copy does — would send somebody off to
      // re-authenticate over a typo.
      'POST /api/v1/auth/mfa/disable': {
        status: 401,
        body: { error: 'unauthorized', message: 'Password is incorrect.' },
      },
    });
    render(panel({ enrolled: true, sessionVerified: true }));

    await user.click(screen.getByRole('button', { name: /turn off two-factor/i }));
    await user.type(screen.getByLabelText(/your password/i), 'wrong');
    await user.type(screen.getByLabelText(/current code from your app/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /yes, turn it off/i }));

    expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument();
    expect(screen.queryByText(/please sign in again/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('mfa-status-pill')).toHaveTextContent('On');
    expect(screen.getByRole('button', { name: /yes, turn it off/i })).toBeInTheDocument();
  });

  it('still says "sign in again" when the session really has gone', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/disable': {
        status: 401,
        body: { error: 'unauthorized', message: 'Authentication required' },
      },
    });
    render(panel({ enrolled: true, sessionVerified: true }));

    await user.click(screen.getByRole('button', { name: /turn off two-factor/i }));
    await user.type(screen.getByLabelText(/your password/i), 'whatever');
    await user.type(screen.getByLabelText(/current code from your app/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /yes, turn it off/i }));

    expect(await screen.findByText(/please sign in again/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * The interstitial's exact case
 * ------------------------------------------------------------------ */

describe('enrolled, but this session never answered a challenge', () => {
  it('explains the session is the problem and offers a way to fix it', async () => {
    const user = userEvent.setup();
    mockApi({ ...CSRF, 'POST /api/v1/auth/logout': { body: {} } });
    render(panel({ enrolled: true, sessionVerified: false, role: 'moderator' }));

    expect(screen.getByText(/this sign-in did not use it/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /one more step to use staff areas/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/signing out and back in/i)).toBeInTheDocument();

    // It must not read as "enrol again" — that is the loop this page exists to break.
    expect(screen.queryByRole('button', { name: /^turn on two-factor$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign-in/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fprofile%2Fsecurity',
    );

    await user.click(screen.getByRole('button', { name: /sign out and sign back in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?next=%2Fprofile%2Fsecurity'));
    expect(calls.some((c) => c.path.endsWith('/v1/auth/logout') && c.method === 'POST')).toBe(true);
  });

  it('says the same thing right after enrolling, because the token in hand is still pre-MFA', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/enrol': ENROL_OK,
      'POST /api/v1/auth/mfa/confirm': { body: { status: 'enabled', recovery_codes: CODES } },
    });

    render(panel({ role: 'admin' }));
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.type(await screen.findByLabelText(/six-digit code/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.click(await screen.findByRole('checkbox', { name: /saved my recovery codes/i }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(
      screen.getByRole('heading', { name: /one more step to use staff areas/i }),
    ).toBeInTheDocument();
  });

  it('tells a staff member why it is required, and a member why it is worth it', () => {
    mockApi({ ...CSRF });

    const { unmount } = render(panel({ role: 'moderator' }));
    expect(screen.getByText(/append-only audit log/i)).toBeInTheDocument();
    unmount();

    render(panel({ role: 'user' }));
    expect(screen.queryByText(/append-only audit log/i)).not.toBeInTheDocument();
    expect(screen.getByText(/leaked or reused password/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Secret hygiene
 * ------------------------------------------------------------------ */

describe('the secret and the codes stay in the component', () => {
  it('never reaches console.*', async () => {
    const user = userEvent.setup();
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/enrol': ENROL_OK,
      'POST /api/v1/auth/mfa/confirm': { body: { status: 'enabled', recovery_codes: CODES } },
    });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.type(await screen.findByLabelText(/six-digit code/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await screen.findByTestId('recovery-codes');

    const written = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    for (const forbidden of [SECRET, OTPAUTH, GOOD_CODE, ...CODES]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it('never reaches web storage or the URL', async () => {
    const user = userEvent.setup();
    mockApi({
      ...CSRF,
      'POST /api/v1/auth/mfa/enrol': ENROL_OK,
      'POST /api/v1/auth/mfa/confirm': { body: { status: 'enabled', recovery_codes: CODES } },
    });

    render(panel());
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await user.type(await screen.findByLabelText(/six-digit code/i), GOOD_CODE);
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }));
    await screen.findByTestId('recovery-codes');

    const stored = [
      JSON.stringify({ ...window.localStorage }),
      JSON.stringify({ ...window.sessionStorage }),
      document.cookie,
      window.location.href,
    ].join(' ');

    for (const forbidden of [SECRET, GOOD_CODE, ...CODES]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it('redacts anything code-shaped out of a message before it can be rendered', () => {
    // Defence in depth: if the API ever echoed a submitted value back in a
    // validation message, this is what stops it reaching a UI string.
    expect(redactSensitive(`Code ${GOOD_CODE} is not valid.`)).toBe(
      'Code [redacted] is not valid.',
    );
    expect(redactSensitive(`Secret ${SECRET} rejected`)).toBe('Secret [redacted] rejected');
    expect(redactSensitive(`Recovery code ${CODES[0]} used`)).toBe(
      'Recovery code [redacted] used',
    );
    // …without mangling ordinary copy.
    expect(redactSensitive('That code is not valid.')).toBe('That code is not valid.');
  });

  it('groups the setup key for typing without changing what it is', () => {
    expect(groupSecret(SECRET)).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    expect(groupSecret(SECRET).replace(/ /g, '')).toBe(SECRET);
  });
});
