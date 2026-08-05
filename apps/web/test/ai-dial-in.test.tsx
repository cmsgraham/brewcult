/**
 * Dial-in advice in the logger's post-log card (second_draft §7.1/§7.2,
 * brew_logger_ux §6).
 *
 * The four guarantees asserted here are the whole product argument for putting
 * an LLM on this card at all:
 *
 *  1. it shows exactly ONE suggestion, with the reason and an honest basis;
 *  2. when the endpoint is missing or broken the card is byte-for-byte the card
 *     that shipped without AI — a failed request the user never made must not
 *     cost them anything, not even a line of copy;
 *  3. a brew with no taste verdict never asks (no request, no tokens, no nag);
 *  4. a spent daily allowance is explained, not disguised as an error.
 *
 * Nothing here touches a server: `fetch` is a mock throughout.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostLogNote } from '../components/logger/post-log-note';
import { resetRefreshState } from '../lib/api';
import type { PaybackLine } from '../lib/brewing-client';

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

const SESSION_ID = '01920000-0000-7000-8000-000000000001';

const PAYBACK: PaybackLine = {
  line: '3rd brew of this bag. Sour usually means under-extracted. Try 0.5 finer tomorrow?',
  suggestion: {
    text: 'Sour usually means under-extracted. Try 0.5 finer tomorrow?',
    field: 'grind',
    delta: -0.5,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface Options {
  verdict?: 'sour' | 'bitter' | 'weak' | 'good' | null;
  response?: () => Response | Promise<Response>;
}

function renderCard({ verdict = 'sour', response }: Options = {}) {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    response ? await response() : jsonResponse({ advice: 'unused' }),
  );

  render(
    <PostLogNote
      payback={PAYBACK}
      verdict={verdict}
      onRate={() => undefined}
      onLogAnother={() => undefined}
      onRemindMe={() => undefined}
      synced
      pending={0}
      dialIn={{ brewSessionId: SESSION_ID, fetchImpl }}
    />,
  );

  return { fetchImpl };
}

beforeEach(() => {
  resetRefreshState();
  vi.clearAllMocks();
});

describe('dial-in advice', () => {
  it('renders one suggestion, its reason and its basis', async () => {
    const { fetchImpl } = renderCard({
      response: () =>
        jsonResponse({
          advice: 'Your last two brews of this coffee tasted sour — try one step finer.',
          variable: 'grind',
          direction: 'finer',
          confidence: 'medium',
          basis: { brew_count: 3 },
          entities: [],
        }),
    });

    expect(
      await screen.findByText(
        'Your last two brews of this coffee tasted sour — try one step finer.',
      ),
    ).toBeInTheDocument();

    // The request is one POST to the diagnose endpoint, carrying the session id.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/ai/diagnose');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ brew_session_id: SESSION_ID });

    // Warm, never shaming.
    expect(screen.getByText("That happens — here's the usual fix.")).toBeInTheDocument();
    // Honest provenance.
    expect(screen.getByText('Based on your 3 brews of this coffee.')).toBeInTheDocument();
    // One suggestion: the static payback line has stepped aside for the AI's.
    expect(screen.queryByText(PAYBACK.line)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remind me tomorrow' })).not.toBeInTheDocument();
  });

  it('says so when it has no data to stand on, rather than implying it does', async () => {
    renderCard({
      response: () =>
        jsonResponse({
          advice: 'Try one step finer next time.',
          basis: { brew_count: 0, community_brew_count: 0 },
        }),
    });

    expect(
      await screen.findByText(
        'No community data for this coffee yet — this is a general starting point.',
      ),
    ).toBeInTheDocument();
  });

  it('falls back silently to the static payback line when the endpoint 404s', async () => {
    renderCard({ response: () => jsonResponse({ error: 'not_found', message: '' }, 404) });

    expect(await screen.findByText(PAYBACK.line)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remind me tomorrow' })).toBeInTheDocument();
    // Silently: nothing anywhere admits that an AI was even attempted.
    expect(screen.queryByText(/allowance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/assistant/i)).not.toBeInTheDocument();
  });

  it('falls back silently on a 500 too', async () => {
    renderCard({ response: () => jsonResponse({ error: 'internal', message: 'boom' }, 500) });

    expect(await screen.findByText(PAYBACK.line)).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it('falls back silently when the socket dies', async () => {
    renderCard({
      response: () => {
        throw new TypeError('Failed to fetch');
      },
    });

    expect(await screen.findByText(PAYBACK.line)).toBeInTheDocument();
    expect(screen.queryByText(/went wrong/i)).not.toBeInTheDocument();
  });

  it('does not request advice for a brew with no taste verdict', async () => {
    const { fetchImpl } = renderCard({ verdict: null });

    expect(screen.getByText(PAYBACK.line)).toBeInTheDocument();
    // Give the effect every chance to misbehave before asserting it did not.
    await Promise.resolve();
    await waitFor(() => expect(fetchImpl).not.toHaveBeenCalled());
  });

  it('renders a spent allowance as an honest, non-punitive line', async () => {
    renderCard({
      response: () =>
        jsonResponse(
          {
            error: 'ai_budget_exhausted',
            message: "You've used today's AI allowance — it resets tomorrow.",
          },
          429,
        ),
    });

    expect(
      await screen.findByText("You've used today's AI allowance — it resets tomorrow."),
    ).toBeInTheDocument();
    // And the card still does its original job.
    expect(screen.getByText(PAYBACK.line)).toBeInTheDocument();
  });

  it('renders only the entities the API returned, as links to real pages', async () => {
    renderCard({
      response: () =>
        jsonResponse({
          advice: 'Try one step finer. See https://not-a-real-link.example for more.',
          entities: [
            { type: 'coffee', slug: 'ethiopia-chelbesa', name: 'Ethiopia Chelbesa' },
            { type: 'equipment', slug: 'hario-v60-02', name: 'Hario V60 02' },
            // Real entity, but no slug — /roaster/[slug] needs one, so it stays
            // text rather than becoming a link to nowhere.
            { type: 'roaster', id: 'roaster-1', name: 'A Roaster' },
            // A type outside the allowlist is dropped entirely.
            { type: 'article', slug: 'some-news', name: 'Some Article' },
          ],
        }),
    });

    const coffee = await screen.findByRole('link', { name: 'Ethiopia Chelbesa' });
    expect(coffee).toHaveAttribute('href', '/coffee/ethiopia-chelbesa');
    expect(screen.getByRole('link', { name: 'Hario V60 02' })).toHaveAttribute(
      'href',
      '/equipment/hario-v60-02',
    );

    // The URL in the prose stays prose — model output never mints an anchor.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.getByText('A Roaster')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'A Roaster' })).not.toBeInTheDocument();
    expect(screen.queryByText('Some Article')).not.toBeInTheDocument();
  });
});
