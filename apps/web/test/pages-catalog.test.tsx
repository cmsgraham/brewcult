/**
 * Coffee, roaster and equipment pages (CAT-09).
 *
 * These are async server components, so each test awaits the component function
 * and renders the element it returns. Every child is deliberately synchronous
 * (the CSP nonce is read once by the page and passed down) precisely so this
 * works — a page whose structured data cannot be unit-tested is a page whose
 * structured data will silently rot.
 *
 * No live API: `fetch` is stubbed with payloads copied from the real dev server.
 */
import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREWER_DETAIL,
  COFFEE_DETAIL,
  COFFEE_DETAIL_NO_LOT,
  COFFEE_SUMMARY,
  EQUIPMENT_BRANDS,
  GRINDER_DETAIL,
  GRIND_CONVERSIONS,
  GRIND_CONVERSIONS_EMPTY,
  NotFoundError,
  ORIGINS,
  ROASTER_DETAIL,
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

const { default: CoffeeDetailPage } = await import('../app/[locale]/coffee/[slug]/page');
const { default: CoffeeHubPage } = await import('../app/[locale]/coffee/page');
const { default: RoasterDetailPage } = await import('../app/[locale]/roaster/[slug]/page');
const { default: RoasterHubPage } = await import('../app/[locale]/roaster/page');
const { default: EquipmentDetailPage } = await import('../app/[locale]/equipment/[slug]/page');
const { default: EquipmentHubPage } = await import('../app/[locale]/equipment/page');

/** Parse every JSON-LD block the render emitted, keyed by `@type`. */
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
 * Coffee detail
 * ================================================================== */

describe('/coffee/[slug]', () => {
  it('renders the coffee, its roaster, provenance and tasting notes', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/coffees': { body: page([COFFEE_SUMMARY]) },
      '/api/v1/recipes': { status: 404 },
    });

    const ui = await CoffeeDetailPage({
      params: Promise.resolve({ slug: 'cascara-ethiopia-chelbesa-washed' }),
    });
    const { container } = render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ethiopia Chelbesa, Washed' }),
    ).toBeInTheDocument();

    // The roaster is a link, not a string (§5 — the entity graph is the moat).
    expect(screen.getByRole('link', { name: 'Cascara Roasting Co.' })).toHaveAttribute(
      'href',
      '/roaster/cascara-roasting-co',
    );

    expect(screen.getByText('Chelbesa Washing Station')).toBeInTheDocument();
    expect(screen.getByText('74110, 74112, Heirloom')).toBeInTheDocument();
    expect(screen.getByText('2100 masl')).toBeInTheDocument();
    expect(screen.getByText('2025/26 main crop')).toBeInTheDocument();

    const notes = screen.getByRole('list', { name: 'Tasting notes' });
    expect(within(notes).getByText('jasmine')).toBeInTheDocument();
    expect(within(notes).getByText('black tea')).toBeInTheDocument();

    // The farm story is real editorial content, not a truncated blurb.
    expect(container.textContent).toContain('Smallholder cherry from the Gedeb woreda');
  });

  it('explains process, roast level and intended use in plain language', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await CoffeeDetailPage({
        params: Promise.resolve({ slug: 'cascara-ethiopia-chelbesa-washed' }),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Washed process' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Light roast' })).toBeInTheDocument();
    // Anti-gatekeeping tone (§9.7): the copy never blames the reader's gear.
    expect(container.textContent).toContain('The fruit is stripped off the seed before drying');
  });

  it('teaches what a roast date means and dates the batches (§6.2)', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await CoffeeDetailPage({
        params: Promise.resolve({ slug: 'cascara-ethiopia-chelbesa-washed' }),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Roast date and freshness' })).toBeInTheDocument();
    expect(container.textContent).toContain('between 4 and 21 days off roast');
    expect(screen.getByText('20 Jul 2026')).toBeInTheDocument();
  });

  it('renders fully for a coffee with no lot data and no roast batches', async () => {
    mockApi({
      '/api/v1/coffees/meridian-yirgacheffe-natural': { body: COFFEE_DETAIL_NO_LOT },
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await CoffeeDetailPage({
        params: Promise.resolve({ slug: 'meridian-yirgacheffe-natural' }),
      }),
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Yirgacheffe Natural' })).toBeInTheDocument();
    // Missing data is named as our gap, never framed as the coffee's fault.
    expect(container.textContent).toContain('That is a gap in our data, not a gap in the coffee');
    expect(container.textContent).toContain('We do not have roast dates for this coffee yet');
  });

  it('degrades gracefully when the recipes API does not exist yet', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await CoffeeDetailPage({
        params: Promise.resolve({ slug: 'cascara-ethiopia-chelbesa-washed' }),
      }),
    );

    // The page still renders its primary content...
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // ...and says why the section is empty instead of leaving a silent hole.
    expect(container.textContent).toContain('Recipes are not switched on yet');
  });

  it('emits Product + BreadcrumbList JSON-LD with the CSP nonce', async () => {
    mockApi({
      '/api/v1/coffees/cascara-ethiopia-chelbesa-washed': { body: COFFEE_DETAIL },
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await CoffeeDetailPage({
        params: Promise.resolve({ slug: 'cascara-ethiopia-chelbesa-washed' }),
      }),
    );

    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script.getAttribute('nonce')).toBe('test-nonce');
    }

    const docs = jsonLdByType(container);
    expect(docs['Product']?.['name']).toBe('Ethiopia Chelbesa, Washed');
    expect(docs['Product']?.['brand']).toMatchObject({ name: 'Cascara Roasting Co.' });
    expect(docs['BreadcrumbList']?.['itemListElement']).toHaveLength(3);
  });

  it('404s a slug the API does not know', async () => {
    mockApi({ '/api/v1/coffees/nope': { status: 404 } });
    await expect(
      CoffeeDetailPage({ params: Promise.resolve({ slug: 'nope' }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('shows an honest error panel — not a 404 — when the API is broken', async () => {
    mockApi({ '/api/v1/coffees/chelbesa': { status: 500, body: { error: 'internal' } } });
    render(await CoffeeDetailPage({ params: Promise.resolve({ slug: 'chelbesa' }) }));
    expect(screen.getByRole('heading', { name: 'We could not load this coffee' })).toBeInTheDocument();
    expect(screen.getByText(/That is on us, not on you/)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Coffee hub
 * ================================================================== */

describe('/coffee', () => {
  it('lists coffees, offers API-backed filters and paginates by cursor', async () => {
    mockApi({
      '/api/v1/coffees': { body: page([COFFEE_SUMMARY], 'CURSOR123') },
      '/api/v1/origins': { body: ORIGINS },
    });

    const { container } = render(await CoffeeHubPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('link', { name: 'Ethiopia Chelbesa, Washed' })).toHaveAttribute(
      'href',
      '/coffee/cascara-ethiopia-chelbesa-washed',
    );

    // Filter names map 1:1 onto the catalog API's query schema.
    for (const name of ['Origin', 'Process', 'Roast level', 'Brewed as']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    // Origin options come from /origins, de-duplicated to countries.
    expect(within(screen.getByLabelText('Origin')).getByRole('option', { name: 'Ethiopia' })).toBeInTheDocument();

    const next = screen.getByRole('link', { name: /Next page/ });
    expect(next).toHaveAttribute('href', '/coffee?cursor=CURSOR123');
    expect(container.querySelector('form[method="get"]')).toBeTruthy();
  });

  it('titles a filtered view after the query it answers', async () => {
    mockApi({
      '/api/v1/coffees': { body: page([COFFEE_SUMMARY]) },
      '/api/v1/origins': { body: ORIGINS },
    });

    render(
      await CoffeeHubPage({
        searchParams: Promise.resolve({ origin: 'Ethiopia', process: 'washed' }),
      }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Washed coffee from Ethiopia' }),
    ).toBeInTheDocument();
    // Filters survive into the next-page URL.
    expect(screen.queryByRole('link', { name: /Next page/ })).toBeNull();
  });

  it('ignores a filter value the API would reject', async () => {
    mockApi({
      '/api/v1/coffees': { body: page([COFFEE_SUMMARY]) },
      '/api/v1/origins': { body: ORIGINS },
    });

    render(await CoffeeHubPage({ searchParams: Promise.resolve({ process: 'not-a-process' }) }));

    const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    const coffeeCall = calls.map((call) => String(call[0])).find((url) => url.includes('/coffees'));
    expect(coffeeCall).not.toContain('not-a-process');
  });

  it('says something useful when nothing matches', async () => {
    mockApi({
      '/api/v1/coffees': { body: page([]) },
      '/api/v1/origins': { body: ORIGINS },
    });

    const { container } = render(
      await CoffeeHubPage({ searchParams: Promise.resolve({ origin: 'Kenya' }) }),
    );
    expect(container.textContent).toContain('Nothing matches those filters yet');
    expect(screen.getByRole('link', { name: 'Clear the filters' })).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Roaster
 * ================================================================== */

describe('/roaster/[slug]', () => {
  it('renders the profile, location and their coffees grid', async () => {
    mockApi({ '/api/v1/roasters/meridian-coffee-roasters': { body: ROASTER_DETAIL } });

    const { container } = render(
      await RoasterDetailPage({ params: Promise.resolve({ slug: 'meridian-coffee-roasters' }) }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Meridian Coffee Roasters' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Melbourne, Australia')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ethiopia Chelbesa, Washed' })).toBeInTheDocument();

    // Discontinued lots are separated with the §6.1 seasonality explanation.
    expect(screen.getByRole('heading', { name: 'No longer roasted' })).toBeInTheDocument();
    expect(container.textContent).toContain('Lots rotate with the harvest');

    // Origins are derived from their coffees and link back into the hub.
    expect(screen.getByRole('link', { name: 'All Ethiopia coffees' })).toHaveAttribute(
      'href',
      '/coffee?origin=Ethiopia',
    );
  });

  it('emits Organization + BreadcrumbList JSON-LD', async () => {
    mockApi({ '/api/v1/roasters/meridian-coffee-roasters': { body: ROASTER_DETAIL } });

    const { container } = render(
      await RoasterDetailPage({ params: Promise.resolve({ slug: 'meridian-coffee-roasters' }) }),
    );

    const docs = jsonLdByType(container);
    expect(docs['Organization']?.['name']).toBe('Meridian Coffee Roasters');
    expect(docs['Organization']?.['address']).toMatchObject({
      addressLocality: 'Melbourne, Australia',
    });
    expect(docs['BreadcrumbList']).toBeDefined();
  });

  it('renders a roaster with no coffees without breaking', async () => {
    mockApi({
      '/api/v1/roasters/empty': {
        body: { ...ROASTER_DETAIL, slug: 'empty', coffees: [], coffee_count: 0 },
      },
    });

    const { container } = render(
      await RoasterDetailPage({ params: Promise.resolve({ slug: 'empty' }) }),
    );
    expect(container.textContent).toContain('No coffees listed for');
  });

  it('404s an unknown roaster', async () => {
    mockApi({ '/api/v1/roasters/nope': { status: 404 } });
    await expect(
      RoasterDetailPage({ params: Promise.resolve({ slug: 'nope' }) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('/roaster', () => {
  it('lists roasters with their coffee counts', async () => {
    mockApi({ '/api/v1/roasters': { body: page([ROASTER_DETAIL]) } });

    render(await RoasterHubPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Coffee roasters' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meridian Coffee Roasters' })).toHaveAttribute(
      'href',
      '/roaster/meridian-coffee-roasters',
    );
    expect(screen.getByText('2 coffees in the catalogue')).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Equipment
 * ================================================================== */

describe('/equipment/[slug]', () => {
  it('renders specs, category and a linked brand', async () => {
    mockApi({
      '/api/v1/equipment/mahlkonig-x54': { body: GRINDER_DETAIL },
      '/api/v1/grind-conversions': { body: GRIND_CONVERSIONS },
    });

    render(await EquipmentDetailPage({ params: Promise.resolve({ slug: 'mahlkonig-x54' }) }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mahlkönig X54 Allround' }),
    ).toBeInTheDocument();
    expect(screen.getByText('flat 54mm')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Mahlkönig' })[0]).toHaveAttribute(
      'href',
      '/equipment?brand=Mahlk%C3%B6nig',
    );
  });

  it('always shows confidence and sample size next to a converted setting (§6.4)', async () => {
    mockApi({
      '/api/v1/equipment/mahlkonig-x54': { body: GRINDER_DETAIL },
      '/api/v1/grind-conversions': { body: GRIND_CONVERSIONS },
    });

    const { container } = render(
      await EquipmentDetailPage({ params: Promise.resolve({ slug: 'mahlkonig-x54' }) }),
    );

    expect(
      screen.getByRole('heading', { name: 'Grind settings on other grinders' }),
    ).toBeInTheDocument();

    // The number is never presented as exact.
    expect(screen.getByText('≈ 2.6')).toBeInTheDocument();
    // Confidence — as a band *and* a percentage.
    expect(screen.getByText('Medium confidence (62%)')).toBeInTheDocument();
    // Sample size, in words a person can weigh.
    expect(screen.getByText('37 community data points')).toBeInTheDocument();
    // And the API's disclaimer, verbatim.
    expect(container.textContent).toContain(
      'Converted grind settings are approximate starting points',
    );
  });

  it('still renders the conversion section — with 0 data points — when there is none', async () => {
    mockApi({
      '/api/v1/equipment/mahlkonig-x54': { body: GRINDER_DETAIL },
      '/api/v1/grind-conversions': { body: GRIND_CONVERSIONS_EMPTY },
    });

    const { container } = render(
      await EquipmentDetailPage({ params: Promise.resolve({ slug: 'mahlkonig-x54' }) }),
    );

    expect(
      screen.getByRole('heading', { name: 'Grind settings on other grinders' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 community data points')).toBeInTheDocument();
    expect(screen.getByText('none yet')).toBeInTheDocument();
    expect(container.textContent).toContain(
      'Converted grind settings are approximate starting points',
    );
    // Falls back to the one thing that does transfer between grinders.
    expect(container.textContent).toContain('use the coarse category on the recipe');
  });

  it('keeps the disclaimer even when the conversions endpoint fails', async () => {
    mockApi({
      '/api/v1/equipment/mahlkonig-x54': { body: GRINDER_DETAIL },
      '/api/v1/grind-conversions': { status: 500, body: { error: 'internal' } },
    });

    const { container } = render(
      await EquipmentDetailPage({ params: Promise.resolve({ slug: 'mahlkonig-x54' }) }),
    );

    expect(container.textContent).toContain('We could not load conversions just now');
    expect(screen.getByText('0 community data points')).toBeInTheDocument();
    expect(container.textContent).toContain(
      'Converted grind settings are approximate starting points',
    );
  });

  it('shows no grind-conversion section for a brewer, but does show recipes', async () => {
    mockApi({
      '/api/v1/equipment/chemex-6-cup': { body: BREWER_DETAIL },
      '/api/v1/recipes': { status: 404 },
    });

    const { container } = render(
      await EquipmentDetailPage({ params: Promise.resolve({ slug: 'chemex-6-cup' }) }),
    );

    expect(screen.queryByRole('heading', { name: 'Grind settings on other grinders' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Recipes for the Chemex Classic 6-Cup' }),
    ).toBeInTheDocument();
    // Empty specs are named rather than rendered as blank rows.
    expect(container.textContent).toContain('We do not have detailed specs for this model yet');
  });

  it('emits Product + BreadcrumbList JSON-LD', async () => {
    mockApi({
      '/api/v1/equipment/mahlkonig-x54': { body: GRINDER_DETAIL },
      '/api/v1/grind-conversions': { body: GRIND_CONVERSIONS },
    });

    const { container } = render(
      await EquipmentDetailPage({ params: Promise.resolve({ slug: 'mahlkonig-x54' }) }),
    );

    const docs = jsonLdByType(container);
    expect(docs['Product']?.['name']).toBe('Mahlkönig X54 Allround');
    expect(docs['Product']?.['brand']).toEqual({ '@type': 'Brand', name: 'Mahlkönig' });
    expect(docs['BreadcrumbList']).toBeDefined();
  });
});

describe('/equipment', () => {
  it('lists equipment with category and brand filters from the API', async () => {
    mockApi({
      '/api/v1/equipment-brands': { body: EQUIPMENT_BRANDS },
      '/api/v1/equipment': { body: page([GRINDER_DETAIL, BREWER_DETAIL]) },
    });

    render(await EquipmentHubPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('link', { name: 'Mahlkönig X54 Allround' })).toHaveAttribute(
      'href',
      '/equipment/mahlkonig-x54',
    );
    expect(within(screen.getByLabelText('Brand')).getByRole('option', { name: 'Chemex' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Category')).getByRole('option', { name: 'Grinders' })).toBeInTheDocument();
  });

  it('renames the page after the category being browsed', async () => {
    mockApi({
      '/api/v1/equipment-brands': { body: EQUIPMENT_BRANDS },
      '/api/v1/equipment': { body: page([GRINDER_DETAIL]) },
    });

    render(await EquipmentHubPage({ searchParams: Promise.resolve({ category: 'grinder' }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Grinders' })).toBeInTheDocument();
  });

  it('survives the equipment-brands endpoint being unavailable', async () => {
    mockApi({
      '/api/v1/equipment-brands': { status: 500 },
      '/api/v1/equipment': { body: page([GRINDER_DETAIL]) },
    });

    render(await EquipmentHubPage({ searchParams: Promise.resolve({}) }));
    // Grid still renders; the brand select degrades to "any brand" only.
    expect(screen.getByRole('link', { name: 'Mahlkönig X54 Allround' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Brand')).getAllByRole('option')).toHaveLength(1);
  });
});
