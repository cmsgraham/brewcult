/**
 * Recipe pages (REC-06) and the tolerant recipe read model.
 *
 * Lane H's API does not exist yet, so two things are under test in equal
 * measure: that a real recipe payload renders completely, and that the *absence*
 * of the endpoint produces an honest page rather than a 404 or a stack trace.
 *
 * The normaliser tests below are the contract insurance: they pin exactly which
 * field spellings the pages tolerate, so a shape change from Lane H shows up
 * here first.
 */
import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREWER_DETAIL,
  COFFEE_DETAIL,
  FILTER_RECIPE,
  FORKED_ESPRESSO_RECIPE,
  NotFoundError,
  mockApi,
  page,
} from './pages-fixtures';

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

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => (name.toLowerCase() === 'x-nonce' ? 'test-nonce' : null),
    }),
}));

const { default: RecipeDetailPage, generateMetadata } = await import('../app/[locale]/recipes/[id]/page');
const { default: RecipeHubPage } = await import('../app/[locale]/recipes/page');
const { normalizeRecipe } = await import('../components/catalog/catalog-api');

function jsonLdByType(container: HTMLElement): Record<string, Record<string, unknown>> {
  const scripts = container.querySelectorAll('script[type="application/ld+json"]');
  const out: Record<string, Record<string, unknown>> = {};
  for (const script of scripts) {
    const parsed = JSON.parse(script.textContent ?? '{}') as Record<string, unknown>;
    out[String(parsed['@type'])] = parsed;
  }
  return out;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

/* ================================================================== *
 * Recipe detail
 * ================================================================== */

describe('/recipes/[id] — filter recipe', () => {
  const renderRecipe = async () => {
    mockApi({ [`/api/v1/recipes/${FILTER_RECIPE.id}`]: { body: FILTER_RECIPE } });
    return render(await RecipeDetailPage({ params: Promise.resolve({ id: FILTER_RECIPE.id }) }));
  };

  it('renders dose, water, ratio, temperature and total time', async () => {
    await renderRecipe();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Chelbesa on the V60 — 1:16, gentle' }),
    ).toBeInTheDocument();
    expect(screen.getByText('18 g')).toBeInTheDocument();
    expect(screen.getByText('300 g')).toBeInTheDocument();
    expect(screen.getByText('1:16.7')).toBeInTheDocument();
    expect(screen.getByText('94 °C')).toBeInTheDocument();
    expect(screen.getByText('3:15')).toBeInTheDocument();
  });

  it('leads with the coarse grind category and scopes the dial number to a grinder (§6.4)', async () => {
    const { container } = await renderRecipe();

    // The category — the only part that transfers — is the headline value.
    expect(screen.getByText('Medium-fine')).toBeInTheDocument();
    // The dial number is present but explicitly attributed.
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(container.textContent).toContain('on the X54 Allround');
    expect(container.textContent).toContain('That dial number only applies to');
    // ...and it links to that grinder's conversion table.
    expect(screen.getByRole('link', { name: /grind conversions for the X54 Allround/ })).toHaveAttribute(
      'href',
      '/equipment/mahlkonig-x54',
    );
  });

  it('renders the pour schedule with cumulative weights', async () => {
    await renderRecipe();

    expect(screen.getByRole('heading', { name: 'Pour schedule' })).toBeInTheDocument();
    expect(screen.getByText('up to 50 g')).toBeInTheDocument();
    expect(screen.getByText('up to 180 g')).toBeInTheDocument();
    expect(screen.getByText('up to 300 g')).toBeInTheDocument();
    expect(screen.getByText('Bloom — swirl gently.')).toBeInTheDocument();
  });

  it('attributes the author and frames the recipe as a starting point', async () => {
    const { container } = await renderRecipe();

    expect(container.textContent).toContain('By Anna R.');
    expect(container.textContent).toContain('This is a starting point, not a rule');
    // §10.2 autonomy: suggestions, and never blame.
    expect(container.textContent).toContain('change one thing at a time');
    expect(container.textContent).toContain(
      'A cup that misses on the first go is the normal outcome',
    );
  });

  it('links back to the coffee and the brewer (§5 entity graph)', async () => {
    await renderRecipe();

    expect(screen.getByRole('link', { name: 'Ethiopia Chelbesa, Washed' })).toHaveAttribute(
      'href',
      '/coffee/cascara-ethiopia-chelbesa-washed',
    );
    expect(screen.getAllByRole('link', { name: 'V60 Size 02' })[0]).toHaveAttribute(
      'href',
      '/equipment/hario-v60-02',
    );
  });

  it('emits Recipe + BreadcrumbList JSON-LD with real HowToSteps', async () => {
    const { container } = await renderRecipe();

    const docs = jsonLdByType(container);
    const recipe = docs['Recipe'];
    expect(recipe?.['name']).toBe('Chelbesa on the V60 — 1:16, gentle');
    expect(recipe?.['author']).toEqual({ '@type': 'Person', name: 'Anna R.' });
    expect(recipe?.['totalTime']).toBe('PT3M15S');
    expect(recipe?.['recipeIngredient']).toContain('18 g coffee');
    expect(recipe?.['recipeIngredient']).toContain('Ground medium-fine');
    expect(recipe?.['recipeYield']).toBe('300 g brewed coffee');

    const steps = recipe?.['recipeInstructions'] as { '@type': string; name: string }[];
    expect(steps).toHaveLength(3);
    expect(steps[0]?.name).toBe('Bloom');

    expect(recipe?.['tool']).toEqual([
      { '@type': 'HowToTool', name: 'V60 Size 02' },
      { '@type': 'HowToTool', name: 'X54 Allround' },
    ]);
    expect(docs['BreadcrumbList']?.['itemListElement']).toHaveLength(3);
  });

  it('produces canonical + OG metadata', async () => {
    mockApi({ [`/api/v1/recipes/${FILTER_RECIPE.id}`]: { body: FILTER_RECIPE } });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: FILTER_RECIPE.id }) });

    expect(metadata.alternates?.canonical).toBe(`/recipes/${FILTER_RECIPE.id}`);
    expect(metadata.openGraph?.url).toBe(`https://brewcult.coffee/recipes/${FILTER_RECIPE.id}`);
    expect(JSON.stringify(metadata.openGraph?.images)).toContain('/og-1200x630.png');
    expect(metadata.description).toContain('Ethiopia Chelbesa, Washed');
  });
});

describe('/recipes/[id] — espresso and fork lineage', () => {
  const renderForked = async () => {
    mockApi({
      [`/api/v1/recipes/${FORKED_ESPRESSO_RECIPE.id}`]: { body: FORKED_ESPRESSO_RECIPE },
    });
    return render(
      await RecipeDetailPage({ params: Promise.resolve({ id: FORKED_ESPRESSO_RECIPE.id }) }),
    );
  };

  it('uses the espresso schema, not the filter one (§6.3)', async () => {
    await renderForked();

    expect(screen.getByText('Dose in')).toBeInTheDocument();
    expect(screen.getByText('Yield out')).toBeInTheDocument();
    expect(screen.getByText('36 g')).toBeInTheDocument();
    expect(screen.getByText('1:2')).toBeInTheDocument();
    expect(screen.getByText('28s')).toBeInTheDocument();
    // No pour schedule on an espresso recipe.
    expect(screen.queryByRole('heading', { name: 'Pour schedule' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Puck preparation' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Puck preparation' })).getByText('Wdt')).toBeInTheDocument();
  });

  it('shows permanent upstream attribution and the diff (§6.6)', async () => {
    const { container } = await renderForked();

    const lineage = screen.getByRole('link', { name: 'Daybreak espresso — house shot' });
    expect(lineage).toHaveAttribute('href', `/recipes/${FORKED_ESPRESSO_RECIPE.parent_recipe.id}`);
    expect(container.textContent).toContain('Forked from');
    expect(container.textContent).toContain('by Anna R.');
    expect(container.textContent).toContain('2 changes: yield out g, shot time s');
  });

  it('falls back to the handle when an author has no display name', async () => {
    const { container } = await renderForked();
    expect(container.textContent).toContain('By @sam');
  });

  it('renders a recipe with no grinder recorded without inventing one', async () => {
    const { container } = await renderForked();
    expect(screen.getByText('Fine')).toBeInTheDocument();
    expect(container.textContent).toContain('No dial number was recorded');
  });
});

describe('/recipes/[id] — the API not existing yet', () => {
  it('explains rather than 404s when the recipes route is missing', async () => {
    mockApi({ '/api/v1/recipes': { status: 404 } });

    render(await RecipeDetailPage({ params: Promise.resolve({ id: 'some-id' }) }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Recipes are not switched on yet' }),
    ).toBeInTheDocument();
    // A shared link is not broken — say so.
    expect(screen.getByText(/the link itself is fine/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse coffees' })).toHaveAttribute('href', '/coffee');
  });

  it('marks a missing recipe noindex so a stub page cannot be indexed', async () => {
    mockApi({ '/api/v1/recipes': { status: 404 } });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'some-id' }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('distinguishes a server error from a missing endpoint', async () => {
    mockApi({ '/api/v1/recipes': { status: 500, body: { error: 'internal' } } });
    render(await RecipeDetailPage({ params: Promise.resolve({ id: 'some-id' }) }));
    expect(
      screen.getByRole('heading', { name: 'We could not load this recipe' }),
    ).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Recipe hub
 * ================================================================== */

describe('/recipes', () => {
  it('lists recipes and links each one', async () => {
    mockApi({ '/api/v1/recipes': { body: page([FILTER_RECIPE, FORKED_ESPRESSO_RECIPE]) } });

    render(await RecipeHubPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('link', { name: 'Chelbesa on the V60 — 1:16, gentle' })).toHaveAttribute(
      'href',
      `/recipes/${FILTER_RECIPE.id}`,
    );
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
  });

  it('resolves a coffee slug to the uuid the API filters on', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/recipes': { body: page([FILTER_RECIPE]) },
    });

    render(
      await RecipeHubPage({
        searchParams: Promise.resolve({ coffee: 'cascara-ethiopia-chelbesa-washed' }),
      }),
    );

    const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    const recipesCall = calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/v1/recipes'));
    expect(recipesCall).toContain(`coffee_product_id=${COFFEE_DETAIL.id}`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'for Ethiopia Chelbesa, Washed',
    );
  });

  it('resolves a brewer slug and names it in the heading', async () => {
    mockApi({
      '/api/v1/equipment/chemex-6-cup': { body: BREWER_DETAIL },
      '/api/v1/recipes': { body: page([FILTER_RECIPE]) },
    });

    render(await RecipeHubPage({ searchParams: Promise.resolve({ brewer: 'chemex-6-cup' }) }));

    const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    const recipesCall = calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/v1/recipes'));
    expect(recipesCall).toContain(`brewer_model_id=${BREWER_DETAIL.id}`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'on the Chemex Classic 6-Cup',
    );
  });

  it('ignores an unresolvable slug filter and says so', async () => {
    mockApi({ '/api/v1/recipes': { body: page([FILTER_RECIPE]) } });

    const { container } = render(
      await RecipeHubPage({ searchParams: Promise.resolve({ coffee: 'no-such-coffee' }) }),
    );
    expect(container.textContent).toContain('so that filter was ignored');
  });

  it('explains itself while the recipes API is still being built', async () => {
    mockApi({ '/api/v1/recipes': { status: 404 } });

    const { container } = render(await RecipeHubPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toContain('Recipes are not switched on yet');
    expect(screen.getByRole('link', { name: 'the equipment pages' })).toHaveAttribute(
      'href',
      '/equipment',
    );
  });
});

/* ================================================================== *
 * Recipe normaliser — the Lane H contract seam
 * ================================================================== */

describe('normalizeRecipe', () => {
  it('accepts the shared-types shape as published', () => {
    const recipe = normalizeRecipe(FILTER_RECIPE);
    expect(recipe?.method).toBe('filter');
    expect(recipe?.grind?.category).toBe('medium_fine');
    expect(recipe?.author?.display_name).toBe('Anna R.');
  });

  it('accepts `parent_recipe` and bare `parent_recipe_id` alike', () => {
    expect(normalizeRecipe(FORKED_ESPRESSO_RECIPE)?.parent?.title).toBe(
      'Daybreak espresso — house shot',
    );
    // §6.6: lineage must survive even when only the id came back.
    const idOnly = normalizeRecipe({ id: 'r', title: 'T', parent_recipe_id: 'parent-id' });
    expect(idOnly?.parent?.id).toBe('parent-id');
  });

  it('infers the method from params when the top-level field is absent', () => {
    const recipe = normalizeRecipe({
      id: 'r',
      title: 'T',
      params: { method: 'espresso', dose_in_g: 18, yield_out_g: 36 },
    });
    expect(recipe?.method).toBe('espresso');
  });

  it('rejects a payload with no id rather than rendering a broken link', () => {
    expect(normalizeRecipe({ title: 'No id' })).toBeNull();
    expect(normalizeRecipe(null)).toBeNull();
    expect(normalizeRecipe('not an object')).toBeNull();
  });

  it('survives a minimal payload', () => {
    const recipe = normalizeRecipe({ id: 'r' });
    expect(recipe?.title).toBe('Untitled recipe');
    expect(recipe?.params).toBeNull();
    expect(recipe?.changed_fields).toEqual([]);
  });
});
