/**
 * The starting-recipe surface (second_draft §7.1 — starting-recipe generation,
 * grounded in the roaster's recipe, then community recipes, then priors).
 *
 * What matters here is that the *basis* travels with the numbers. A recipe from
 * the roaster and a recipe invented from general priors look identical on a
 * card; only the honest line underneath tells them apart, and §7.2 makes that
 * line non-optional.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartingRecipeCard } from '../components/ai/starting-recipe';
import { resetRefreshState } from '../lib/api';

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderCard(response: () => Response) {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => response());
  render(
    <StartingRecipeCard
      coffeeProductId="coffee-1"
      coffeeName="Ethiopia Chelbesa"
      brewerModelId="v60-02"
      fetchImpl={fetchImpl}
    />,
  );
  return { fetchImpl };
}

beforeEach(() => {
  resetRefreshState();
  vi.clearAllMocks();
});

describe('starting recipe', () => {
  it('asks for nothing until the reader asks for it', () => {
    const { fetchImpl } = renderCard(() => jsonResponse({}));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    ).toBeInTheDocument();
  });

  it('renders the recipe, its basis and a way to brew it', async () => {
    const { fetchImpl } = renderCard(() =>
      jsonResponse({
        recipe: {
          method: 'filter',
          dose_g: 15,
          water_g: 250,
          ratio: 16.7,
          grind_setting: '6.5',
          temperature_c: 94,
          brew_time_s: 165,
          notes: 'Pour in three stages, finishing by 2:00.',
        },
        basis: { label: "The roaster's own recipe for this coffee." },
        entities: [{ type: 'coffee', slug: 'ethiopia-chelbesa', name: 'Ethiopia Chelbesa' }],
      }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    );

    expect(await screen.findByText('15 g')).toBeInTheDocument();
    expect(screen.getByText('250 g')).toBeInTheDocument();
    expect(screen.getByText('1:16.7')).toBeInTheDocument();
    expect(screen.getByText('94 °C')).toBeInTheDocument();
    expect(screen.getByText('2:45')).toBeInTheDocument();
    expect(screen.getByText("The roaster's own recipe for this coffee.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a brew with this' })).toHaveAttribute(
      'href',
      '/brew?coffee_product_id=coffee-1',
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/ai/starting-recipe');
    expect(JSON.parse(String(init.body))).toEqual({
      coffee_product_id: 'coffee-1',
      brewer_model_id: 'v60-02',
    });
  });

  it('admits when there is nothing to ground the recipe in', async () => {
    renderCard(() => jsonResponse({ recipe: { dose_g: 15, water_g: 250 }, basis: {} }));

    await userEvent.click(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    );

    expect(
      await screen.findByText(
        'No community data for this coffee yet — this is a general starting point.',
      ),
    ).toBeInTheDocument();
  });

  it('renders a spent allowance as an allowance, not an error', async () => {
    renderCard(() =>
      jsonResponse({ error: 'ai_budget_exhausted', message: '' }, 429),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    );

    expect(await screen.findByText(/you've used today's AI allowance/i)).toBeInTheDocument();
  });

  it('points at the human recipes below when the endpoint is not there yet', async () => {
    renderCard(() => jsonResponse({ error: 'not_found', message: '' }, 404));

    await userEvent.click(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    );

    await waitFor(() =>
      expect(screen.getByText(/isn't available right now/i)).toBeInTheDocument(),
    );
  });

  it('never renders model prose as HTML', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        recipe: 'Brew it gently. <img src=x onerror="alert(1)">',
        basis: {},
      }),
    );
    const view = render(
      <StartingRecipeCard coffeeProductId="coffee-1" fetchImpl={fetchImpl} />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Get a starting recipe for my setup' }),
    );

    expect(await screen.findByText(/Brew it gently/)).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
  });
});
