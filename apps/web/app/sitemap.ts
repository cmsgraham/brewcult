import { type MetadataRoute } from 'next';
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
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
  ];

  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [...staticRoutes, ...CATALOG_HUB_SITEMAP_ROUTES].map(
    (route) => ({
      url: `${siteUrl}${route.path}`,
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    }),
  );

  try {
    const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    const pull = async (path: string): Promise<{ items?: unknown[] } | null> => {
      const res = await fetch(`${apiBase}${path}`, { cache: 'no-store' });
      return res.ok ? ((await res.json()) as { items?: unknown[] }) : null;
    };
    const [coffees, roasters, equipment] = await Promise.all([
      pull('/v1/coffees?limit=200'),
      pull('/v1/roasters?limit=200'),
      pull('/v1/equipment?limit=200'),
    ]);

    const detail = catalogSitemapEntries({
      coffees: (coffees?.items ?? []) as never,
      roasters: (roasters?.items ?? []) as never,
      equipment: (equipment?.items ?? []) as never,
    });

    for (const entry of detail) {
      entries.push({
        url: entry.url.startsWith('http') ? entry.url : `${siteUrl}${entry.url}`,
        lastModified: entry.lastModified,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
      });
    }
  } catch {
    // Static + hub routes only.
  }

  return entries;
}
