/**
 * Service-worker registration.
 *
 * Deliberately tiny: `public/sw.js` caches the offline *shell* and static
 * assets and nothing else. It never touches `/api/*` — brew sync is the
 * IndexedDB queue's job (EF §2.2), and a worker that also cached mutations
 * would be two sync engines disagreeing with each other.
 *
 * Registration is skipped in development, where a stale precache fights the
 * Next dev server's chunk hashing for no benefit.
 */
export const SERVICE_WORKER_URL = '/sw.js';

export interface RegisterServiceWorkerOptions {
  enabled?: boolean;
  url?: string;
}

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Resolves false when registration was skipped or failed — never throws. */
export async function registerServiceWorker(
  options: RegisterServiceWorkerOptions = {},
): Promise<boolean> {
  const enabled = options.enabled ?? process.env.NODE_ENV === 'production';
  if (!enabled || !serviceWorkerSupported()) return false;
  try {
    await navigator.serviceWorker.register(options.url ?? SERVICE_WORKER_URL, { scope: '/' });
    return true;
  } catch {
    // An unregistrable worker costs offline asset caching, not the logger.
    return false;
  }
}
