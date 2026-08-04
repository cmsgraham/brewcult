import { type MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://brewcult.coffee';

/**
 * Static routes only for now. Per-coffee entries arrive with the catalog detail
 * pages — listing slugs the site cannot yet render would be worse than omitting
 * them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: { path: string; priority: number; changeFrequency: 'daily' | 'monthly' }[] = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
    { path: '/discover', priority: 0.9, changeFrequency: 'daily' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
  ];

  const lastModified = new Date();
  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
