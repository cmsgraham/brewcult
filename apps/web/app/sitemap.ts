import { type MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAG, localePath } from '../lib/i18n';
import { CATALOG_HUB_SITEMAP_ROUTES, catalogSitemapEntries } from '../lib/seo';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://brewcult.coffee';

/**
 * Static app routes plus the catalog hubs. Per-entity URLs (every coffee,
 * roaster, equipment model and public recipe) come from
 * `catalogSitemapEntries`, which is fed by a live catalog fetch below.
 *
 * If the API is unreachable at build/request time we emit the static set rather
 * than failing the route — an incomplete sitemap is recoverable, a 500 is not.
 */
/**
 * Rendered per REQUEST, not at build time.
 *
 * This was `revalidate = 3600`, which makes Next prerender it during
 * `next build` — and the build runs inside Docker with no API container to
 * talk to. So the catalog fetch below always failed, the fallback emitted the
 * static routes alone, and that 8-entry result was baked into the image. Every
 * deploy reset it, and the only thing that ever fixed it was an hour passing
 * without a deploy.
 *
 * A sitemap is fetched by crawlers a handful of times a day. Generating it
 * live costs four API reads and is always right, which is the correct trade
 * for a file whose entire job is to be an accurate index.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: { path: string; priority: number; changeFrequency: 'daily' | 'monthly' }[] = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
    { path: '/discover', priority: 0.9, changeFrequency: 'daily' },
    // The teaching page behind every score — evergreen, and exactly the query
    // ("what does acidity mean in coffee") a search engine should send here.
    { path: '/learn/cupping', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
  ];

  const lastModified = new Date();

  /**
   * One sitemap row per URL per language, each declaring the other.
   *
   * `alternates.languages` is how a search engine learns that `/discover` and
   * `/es/discover` are the same page in two languages rather than two thin
   * pages competing with each other — which is what they would otherwise look
   * like, and what gets one of them dropped.
   */
  const localised = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
    priority: number,
  ): MetadataRoute.Sitemap =>
    LOCALES.map((locale) => ({
      url: `${siteUrl}${localePath(path, locale)}`,
      lastModified,
      changeFrequency,
      priority:
        // The default language is the one already indexed and linked; the
        // translation is equally valid but not more so.
        locale === DEFAULT_LOCALE ? priority : Math.max(0.1, priority - 0.1),
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((other) => [LOCALE_TAG[other], `${siteUrl}${localePath(path, other)}`]),
        ),
      },
    }));

  const entries: MetadataRoute.Sitemap = [
    ...staticRoutes,
    ...CATALOG_HUB_SITEMAP_ROUTES,
  ].flatMap((route) => localised(route.path, route.changeFrequency, route.priority));

  try {
    const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

    /**
     * Page through a collection until it is exhausted.
     *
     * `limit` is 100, not 200: the API rejects anything higher with a 400
     * ("querystring/limit must be <= 100"). Every pull here asked for 200, so
     * every pull 400'd, `pull()` returned null, and the sitemap silently
     * contained no entity URLs at all — the catch below turned a permanent
     * misconfiguration into the same quiet fallback it uses for a transient
     * outage.
     *
     * PAGE_CAP stops a runaway loop from a misbehaving cursor. Hitting it means
     * the sitemap is incomplete, so it says so in the logs rather than
     * truncating in silence.
     */
    const PAGE_LIMIT = 100;
    const PAGE_CAP = 25;
    const pullAll = async (path: string): Promise<unknown[]> => {
      const items: unknown[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PAGE_CAP; page += 1) {
        const url =
          `${apiBase}${path}?limit=${PAGE_LIMIT}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`sitemap: ${path} responded ${res.status}`);
        }
        const body = (await res.json()) as { items?: unknown[]; next_cursor?: string | null };
        items.push(...(body.items ?? []));
        cursor = body.next_cursor ?? null;
        if (!cursor) return items;
      }
      throw new Error(`sitemap: ${path} still paginating after ${PAGE_CAP} pages`);
    };

    const [coffees, roasters, equipment] = await Promise.all([
      pullAll('/v1/coffees'),
      pullAll('/v1/roasters'),
      pullAll('/v1/equipment'),
    ]);

    const detail = catalogSitemapEntries({
      coffees: coffees as never,
      roasters: roasters as never,
      equipment: equipment as never,
    });

    for (const entry of detail) {
      // Detail URLs are paths from the catalogue projection; the same page
      // exists in both languages because the SLUG is language-independent —
      // a coffee is named what the bag says, in either.
      const path = entry.url.startsWith('http')
        ? new URL(entry.url).pathname
        : entry.url;
      entries.push(...localised(path, entry.changeFrequency, entry.priority ?? 0.5));
    }
  } catch (error) {
    // Degrade to the static routes rather than 500 the sitemap — an incomplete
    // index is recoverable, an unreachable one is not. But SAY SO: this catch
    // previously hid a permanent 400 for as long as the site has existed.
    // eslint-disable-next-line no-console
    console.error('[sitemap] catalog fetch failed — emitting static routes only:', error);
  }

  // catalogSitemapEntries() also emits the hub routes, which the static list
  // above already contains — so without this every hub appeared twice. A
  // duplicate <loc> is not fatal to a crawler, but it is exactly the kind of
  // sloppiness Search Console reports back at you.
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
