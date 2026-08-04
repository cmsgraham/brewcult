import { type MetadataRoute } from 'next';
import { brand } from '../lib/brand';

/**
 * PWA manifest (Next metadata route → /manifest.webmanifest).
 *
 * Icons are the exported brand set in public/icons (tools/brand/dist/
 * manifest-icons.json, re-pathed to /icons/*). Maskable variants come from the
 * full-bleed appicon master, which is optically centred toward the ear — the
 * standalone mark is never pasted into an icon canvas (USAGE.md §Constructions).
 *
 * Colours are the brand anchors: cream background, espresso theme.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BrewCult',
    short_name: 'BrewCult',
    description:
      'Log your brews, dial in your grinder and find coffee worth drinking.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: brand.cream,
    theme_color: brand.espresso,
    lang: 'en',
    dir: 'ltr',
    categories: ['food', 'lifestyle', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
