/**
 * `lib/seo.ts` + `lib/structured-data.ts` (CAT-09, REC-06).
 *
 * These are pure functions on purpose, so the two things that decide whether a
 * page ranks — canonical/OG metadata and valid JSON-LD — can be asserted
 * without a renderer.
 *
 * The most important assertions here are the *negative* ones: no fabricated
 * `aggregateRating`, no invented `offers`, no empty properties. Rich results
 * are earned by markup being true, and a test is the only thing that stops a
 * future "just add a rating, it's just markup" change.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_HUB_SITEMAP_ROUTES,
  absoluteUrl,
  buildPageMetadata,
  catalogSitemapEntries,
  coffeeMetadata,
  equipmentMetadata,
  hubCanonicalPath,
  hubMetadata,
  notFoundMetadata,
  recipeMetadata,
  roasterMetadata,
  truncate,
} from '../lib/seo';
import {
  breadcrumbJsonLd,
  coffeeProductJsonLd,
  equipmentProductJsonLd,
  isoDuration,
  itemListJsonLd,
  recipeJsonLd,
  roasterOrganizationJsonLd,
  serializeJsonLd,
} from '../lib/structured-data';

const SITE = 'https://brewcult.coffee';

describe('metadata helpers', () => {
  it('produces a canonical and a full OG block for a page', () => {
    const metadata = buildPageMetadata({
      title: 'Ethiopia Chelbesa, Washed',
      description: 'A washed coffee from Ethiopia, Yirgacheffe.',
      path: '/coffee/cascara-ethiopia-chelbesa-washed',
    });

    expect(metadata.alternates?.canonical).toBe('/coffee/cascara-ethiopia-chelbesa-washed');
    expect(metadata.openGraph?.url).toBe(`${SITE}/coffee/cascara-ethiopia-chelbesa-washed`);
    expect(metadata.openGraph?.title).toBe('Ethiopia Chelbesa, Washed · BrewCult');
    // The shared card that actually exists in public/.
    expect(JSON.stringify(metadata.openGraph?.images)).toContain('/og-1200x630.png');
    // `Metadata['twitter']` is a union whose other members have no `card`.
    expect((metadata.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image');
  });

  it('keeps descriptions inside meta length and never cuts mid-word', () => {
    const long = `${'Ethiopian washed coffee with jasmine and lemon. '.repeat(10)}`;
    const short = truncate(long, 160);

    expect(short.length).toBeLessThanOrEqual(160);
    expect(short.endsWith('…')).toBe(true);
    // The character before the ellipsis is the end of a word, not a fragment
    // boundary introduced by a hard slice.
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });

  it('names the roaster in a coffee title — "[coffee] [roaster]" is how people search', () => {
    const metadata = coffeeMetadata({
      slug: 'cascara-ethiopia-chelbesa-washed',
      name: 'Ethiopia Chelbesa, Washed',
      roasterName: 'Cascara Roasting Co.',
      originLabel: 'Ethiopia, Yirgacheffe',
      processLabel: 'Washed',
      roastLevelLabel: 'Light',
      tastingNotes: ['jasmine', 'lemon'],
    });

    expect(metadata.title).toBe('Ethiopia Chelbesa, Washed — Cascara Roasting Co.');
    expect(metadata.description).toContain('jasmine, lemon');
    expect(metadata.alternates?.canonical).toBe('/coffee/cascara-ethiopia-chelbesa-washed');
  });

  it('puts "grind settings" in a grinder title (§23.1 high-intent query)', () => {
    const grinder = equipmentMetadata({
      slug: 'mahlkonig-x54',
      name: 'X54 Allround',
      brandName: 'Mahlkönig',
      categoryLabel: 'Grinder',
      isGrinder: true,
    });
    expect(grinder.title).toBe('Mahlkönig X54 Allround grind settings and recipes');
    expect(grinder.description).toContain('confidence and sample size');

    const brewer = equipmentMetadata({
      slug: 'chemex-6-cup',
      name: 'Classic 6-Cup',
      brandName: 'Chemex',
      categoryLabel: 'Brewer',
    });
    expect(brewer.title).toBe('Chemex Classic 6-Cup — specs and recipes');
  });

  it('builds roaster and recipe metadata with canonical paths', () => {
    const roaster = roasterMetadata({
      slug: 'meridian-coffee-roasters',
      name: 'Meridian Coffee Roasters',
      location: 'Melbourne, Australia',
      coffeeCount: 4,
    });
    expect(roaster.alternates?.canonical).toBe('/roaster/meridian-coffee-roasters');
    expect(roaster.description).toContain('Melbourne, Australia');

    const recipe = recipeMetadata({
      id: 'recipe-1',
      title: 'Chelbesa on the V60',
      methodLabel: 'Filter',
      brewerName: 'V60 Size 02',
      coffeeName: 'Ethiopia Chelbesa, Washed',
      authorName: 'Anna R.',
    });
    expect(recipe.alternates?.canonical).toBe('/recipes/recipe-1');
    expect(recipe.description).toContain('on the V60 Size 02');
  });

  it('self-canonicalises a filtered hub but noindexes a cursor page', () => {
    const filtered = hubMetadata({
      title: 'Washed coffee from Ethiopia',
      description: 'Browse washed coffee from Ethiopia.',
      basePath: '/coffee',
      filters: { origin: 'Ethiopia', process: 'washed', roast_level: undefined },
    });
    expect(filtered.alternates?.canonical).toBe('/coffee?origin=Ethiopia&process=washed');
    expect(filtered.robots).toBeUndefined();

    const paged = hubMetadata({
      title: 'Coffee',
      description: 'Browse coffee.',
      basePath: '/coffee',
      filters: { origin: 'Ethiopia' },
      cursor: 'WyIyMDI2LTA4',
    });
    // Canonical drops the cursor; the page itself is not indexable.
    expect(paged.alternates?.canonical).toBe('/coffee?origin=Ethiopia');
    expect(paged.robots).toEqual({ index: false, follow: true });
  });

  it('sorts hub filter params so a canonical URL is stable', () => {
    expect(hubCanonicalPath('/coffee', { process: 'washed', origin: 'Ethiopia' })).toBe(
      hubCanonicalPath('/coffee', { origin: 'Ethiopia', process: 'washed' }),
    );
    expect(hubCanonicalPath('/coffee', {})).toBe('/coffee');
  });

  it('never indexes a missing entity', () => {
    expect(notFoundMetadata('Coffee').robots).toEqual({ index: false, follow: false });
  });
});

describe('sitemap contributions', () => {
  it('lists the four hub routes this lane adds', () => {
    expect(CATALOG_HUB_SITEMAP_ROUTES.map((route) => route.path)).toEqual([
      '/coffee',
      '/roaster',
      '/equipment',
      '/recipes',
    ]);
  });

  it('emits absolute URLs and per-entity lastModified', () => {
    const now = new Date('2026-08-04T00:00:00.000Z');
    const entries = catalogSitemapEntries(
      {
        coffees: [{ slug: 'chelbesa', updated_at: '2026-07-01T00:00:00.000Z' }],
        roasters: [{ slug: 'cascara' }],
        equipment: [{ slug: 'mahlkonig-x54' }],
        recipes: [{ id: 'recipe-1', updated_at: null }],
      },
      now,
    );

    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain(`${SITE}/coffee`);
    expect(urls).toContain(`${SITE}/coffee/chelbesa`);
    expect(urls).toContain(`${SITE}/roaster/cascara`);
    expect(urls).toContain(`${SITE}/equipment/mahlkonig-x54`);
    expect(urls).toContain(`${SITE}/recipes/recipe-1`);
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true);

    const coffee = entries.find((entry) => entry.url.endsWith('/coffee/chelbesa'));
    expect(coffee?.lastModified).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    // A missing/invalid timestamp falls back to "now" rather than being omitted.
    expect(entries.find((entry) => entry.url.endsWith('/recipes/recipe-1'))?.lastModified).toEqual(
      now,
    );
  });

  it('degrades to hubs only when no entities are supplied', () => {
    expect(catalogSitemapEntries()).toHaveLength(CATALOG_HUB_SITEMAP_ROUTES.length);
  });
});

describe('JSON-LD: Product (coffee)', () => {
  const doc = coffeeProductJsonLd({
    slug: 'cascara-ethiopia-chelbesa-washed',
    name: 'Ethiopia Chelbesa, Washed',
    description: 'A washed coffee from Ethiopia, Yirgacheffe.',
    roaster: { name: 'Cascara Roasting Co.', slug: 'cascara-roasting-co' },
    roastLevel: 'Light',
    intendedUse: 'Filter',
    tastingNotes: ['jasmine', 'lemon', 'black tea'],
    process: 'Washed',
    varietals: ['74110', 'Heirloom'],
    altitudeMasl: 2100,
    harvestPeriod: '2025/26 main crop',
    origin: { country: 'Ethiopia', region: 'Yirgacheffe' },
    farmName: 'Chelbesa Washing Station',
  });

  it('is a Product whose brand is the roaster organisation', () => {
    expect(doc['@context']).toBe('https://schema.org');
    expect(doc['@type']).toBe('Product');
    expect(doc['url']).toBe(`${SITE}/coffee/cascara-ethiopia-chelbesa-washed`);
    expect(doc['brand']).toMatchObject({
      '@type': 'Organization',
      name: 'Cascara Roasting Co.',
      url: `${SITE}/roaster/cascara-roasting-co`,
    });
    expect(doc['countryOfOrigin']).toBe('Ethiopia');
  });

  it('carries domain facts as PropertyValue rows', () => {
    const props = doc['additionalProperty'] as { '@type': string; name: string; value: string }[];
    const byName = Object.fromEntries(props.map((prop) => [prop.name, prop.value]));

    expect(props.every((prop) => prop['@type'] === 'PropertyValue')).toBe(true);
    expect(byName['Process']).toBe('Washed');
    expect(byName['Varietals']).toBe('74110, Heirloom');
    expect(byName['Altitude']).toBe('2100 masl');
    expect(byName['Origin']).toBe('Ethiopia, Yirgacheffe');
    expect(byName['Farm or washing station']).toBe('Chelbesa Washing Station');
  });

  it('invents no rating and no offer', () => {
    expect(doc['aggregateRating']).toBeUndefined();
    expect(doc['offers']).toBeUndefined();
    expect(doc['review']).toBeUndefined();
  });

  it('omits properties for data the API did not send', () => {
    const sparse = coffeeProductJsonLd({
      slug: 'bare',
      name: 'Bare coffee',
      roaster: { name: 'A Roaster', slug: 'a-roaster' },
    });
    expect(sparse['countryOfOrigin']).toBeUndefined();
    expect(sparse['keywords']).toBeUndefined();
    expect(sparse['description']).toBeUndefined();
    // additionalProperty would be an empty array — dropped rather than emitted.
    expect(sparse['additionalProperty']).toBeUndefined();
  });
});

describe('JSON-LD: Organization (roaster)', () => {
  it('emits an Organization with address and sameAs when known', () => {
    const doc = roasterOrganizationJsonLd({
      slug: 'meridian-coffee-roasters',
      name: 'Meridian Coffee Roasters',
      location: 'Melbourne, Australia',
      websiteUrl: 'https://meridian.example',
    });

    expect(doc['@type']).toBe('Organization');
    expect(doc['url']).toBe(`${SITE}/roaster/meridian-coffee-roasters`);
    expect(doc['sameAs']).toEqual(['https://meridian.example']);
    expect(doc['address']).toMatchObject({
      '@type': 'PostalAddress',
      addressLocality: 'Melbourne, Australia',
    });
  });

  it('drops address and sameAs when the API has neither', () => {
    const doc = roasterOrganizationJsonLd({ slug: 'x', name: 'X' });
    expect(doc['address']).toBeUndefined();
    expect(doc['sameAs']).toBeUndefined();
  });
});

describe('JSON-LD: Product (equipment)', () => {
  it('emits a Brand and flattens scalar specs into PropertyValue rows', () => {
    const doc = equipmentProductJsonLd({
      slug: 'mahlkonig-x54',
      name: 'X54 Allround',
      brand: { name: 'Mahlkönig' },
      category: 'Grinder',
      grindScaleType: 'stepped',
      specs: { burr: 'flat 54mm', nested: { ignored: true } },
    });

    expect(doc['@type']).toBe('Product');
    expect(doc['name']).toBe('Mahlkönig X54 Allround');
    expect(doc['brand']).toEqual({ '@type': 'Brand', name: 'Mahlkönig' });

    const props = doc['additionalProperty'] as { name: string; value: string }[];
    const names = props.map((prop) => prop.name);
    expect(names).toContain('Burr');
    expect(names).toContain('Grind scale');
    // A nested object would stringify to "[object Object]" — dropped instead.
    expect(names).not.toContain('Nested');
  });
});

describe('JSON-LD: Recipe', () => {
  const doc = recipeJsonLd({
    id: 'recipe-1',
    name: 'Chelbesa on the V60',
    description: 'Filter · 1:16.7 · medium-fine grind',
    authorName: 'Anna R.',
    datePublished: '2026-07-01T08:00:00.000Z',
    method: 'Filter',
    ingredients: ['18 g coffee', '300 g water'],
    steps: [
      { name: 'Bloom', text: 'At 0s, pour up to 50 g total.' },
      { name: 'Pour 2', text: 'At 45s, pour up to 180 g total.' },
    ],
    totalTimeSeconds: 195,
    yieldText: '300 g brewed coffee',
    tools: ['V60 Size 02', 'X54 Allround'],
    keywords: ['Filter', 'Ethiopia Chelbesa'],
  });

  it('uses schema.org/Recipe fields honestly', () => {
    expect(doc['@type']).toBe('Recipe');
    expect(doc['author']).toEqual({ '@type': 'Person', name: 'Anna R.' });
    expect(doc['recipeCategory']).toBe('Filter');
    expect(doc['recipeYield']).toBe('300 g brewed coffee');
    expect(doc['recipeIngredient']).toEqual(['18 g coffee', '300 g water']);
    expect(doc['totalTime']).toBe('PT3M15S');
    expect(doc['tool']).toEqual([
      { '@type': 'HowToTool', name: 'V60 Size 02' },
      { '@type': 'HowToTool', name: 'X54 Allround' },
    ]);
  });

  it('emits ordered HowToStep instructions', () => {
    const steps = doc['recipeInstructions'] as { '@type': string; name: string; text: string }[];
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ '@type': 'HowToStep', name: 'Bloom' });
  });

  it('never fabricates nutrition, ratings or a cook time', () => {
    expect(doc['nutrition']).toBeUndefined();
    expect(doc['aggregateRating']).toBeUndefined();
    expect(doc['cookTime']).toBeUndefined();
  });

  it('renders a recipe with no numbers at all without emitting empty fields', () => {
    const sparse = recipeJsonLd({ id: 'r2', name: 'Untitled recipe', method: 'Espresso' });
    expect(sparse['@type']).toBe('Recipe');
    expect(sparse['recipeIngredient']).toBeUndefined();
    expect(sparse['recipeInstructions']).toBeUndefined();
    expect(sparse['totalTime']).toBeUndefined();
    expect(sparse['author']).toBeUndefined();
  });

  it('converts seconds to ISO-8601 durations', () => {
    expect(isoDuration(195)).toBe('PT3M15S');
    expect(isoDuration(120)).toBe('PT2M');
    expect(isoDuration(28)).toBe('PT28S');
    expect(isoDuration(0)).toBeNull();
  });
});

describe('JSON-LD: BreadcrumbList and ItemList', () => {
  it('numbers breadcrumb positions from 1 with absolute item URLs', () => {
    const doc = breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Coffee', path: '/coffee' },
      { name: 'Chelbesa', path: '/coffee/chelbesa' },
    ]);

    expect(doc['@type']).toBe('BreadcrumbList');
    const items = doc['itemListElement'] as { position: number; name: string; item: string }[];
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(items[2]?.item).toBe(`${SITE}/coffee/chelbesa`);
  });

  it('counts an ItemList and links each entry', () => {
    const doc = itemListJsonLd('Coffee', [
      { name: 'A', path: '/coffee/a' },
      { name: 'B', path: '/coffee/b' },
    ]);
    expect(doc['numberOfItems']).toBe(2);
    expect((doc['itemListElement'] as { url: string }[])[0]?.url).toBe(`${SITE}/coffee/a`);
  });
});

describe('serialisation', () => {
  it('escapes "<" so a name containing </script> cannot break out of the tag', () => {
    const doc = coffeeProductJsonLd({
      slug: 'x',
      name: 'Evil </script><script>alert(1)</script>',
      roaster: { name: 'R', slug: 'r' },
    });
    const json = serializeJsonLd(doc);

    expect(json).not.toContain('</script>');
    expect(json).toContain('\\u003c');
    // Still valid JSON, and the value round-trips unchanged.
    expect((JSON.parse(json) as { name: string }).name).toContain('</script>');
  });

  it('absolutizes site-relative paths and leaves absolute URLs alone', () => {
    expect(absoluteUrl('/coffee')).toBe(`${SITE}/coffee`);
    expect(absoluteUrl('https://example.com/x')).toBe('https://example.com/x');
  });
});
