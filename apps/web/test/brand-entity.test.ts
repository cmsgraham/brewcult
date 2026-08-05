/**
 * The brand entity.
 *
 * Every page already carried markup about its own subject; nothing carried the
 * publisher. This is what a search engine associates a name, a logo and a set
 * of official profiles with — the difference between searching "brewcult" and
 * getting a recognised brand versus four blue links.
 *
 * The assertions here are mostly about HONESTY (rule 1 of structured-data.ts):
 * we do not claim profiles we do not own, and we do not advertise a search URL
 * that does not exist.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { brandSameAs } from '../lib/seo';
import { organizationJsonLd, websiteJsonLd } from '../lib/structured-data';

const ORIGINAL = process.env.NEXT_PUBLIC_BRAND_PROFILES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BRAND_PROFILES;
  else process.env.NEXT_PUBLIC_BRAND_PROFILES = ORIGINAL;
});

describe('organization', () => {
  const base = {
    name: 'BrewCult',
    description: 'Brewing intelligence.',
    logoUrl: '/icons/icon-512.png',
  };

  it('emits an absolute logo and a stable @id other documents can reference', () => {
    const doc = organizationJsonLd(base);
    expect(doc['@type']).toBe('Organization');
    expect(doc['@id']).toMatch(/#organization$/);
    expect((doc['logo'] as { url: string }).url).toMatch(/^https:\/\/.+\/icons\/icon-512\.png$/);
  });

  it('OMITS sameAs entirely when there are no profiles', () => {
    // An empty sameAs is not neutral — it is a claim with no evidence.
    expect(organizationJsonLd({ ...base, sameAs: [] })).not.toHaveProperty('sameAs');
  });

  it('omits an email that was not supplied rather than emitting an empty one', () => {
    expect(organizationJsonLd(base)).not.toHaveProperty('email');
  });
});

describe('website', () => {
  it('links to the organization as publisher', () => {
    const doc = websiteJsonLd('BrewCult', 'Brewing intelligence.');
    expect(doc['@type']).toBe('WebSite');
    expect((doc['publisher'] as { '@id': string })['@id']).toMatch(/#organization$/);
  });

  it('does NOT advertise a sitelinks search box', () => {
    // There is no /search?q= route: search on /discover is client-side with no
    // query parameter. Declaring a SearchAction would publish a URL that 404s.
    expect(websiteJsonLd('BrewCult', 'x')).not.toHaveProperty('potentialAction');
  });
});

describe('brandSameAs', () => {
  it('is empty by default — profiles are opt-in, never assumed', () => {
    delete process.env.NEXT_PUBLIC_BRAND_PROFILES;
    expect(brandSameAs()).toEqual([]);
  });

  it('accepts https profiles and drops anything else', () => {
    process.env.NEXT_PUBLIC_BRAND_PROFILES =
      'https://example.com/brewcult, not-a-url , http://insecure.example, ';
    expect(brandSameAs()).toEqual(['https://example.com/brewcult']);
  });
});
