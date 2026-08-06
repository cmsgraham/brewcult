import { type Metadata } from 'next';
import { headers } from 'next/headers';
import { LocaleLink as Link } from '../../components/locale-link';
import { localeFromPath } from '../../lib/i18n';
import { translator } from '../../lib/locale-server';

/**
 * The one page in the tree that cannot read `params.locale`.
 *
 * Next renders `not-found.tsx` without route params — there was no matched
 * route to take them from — so the language comes from the `x-pathname` header
 * that `middleware.ts` sets on every request. A 404 is `noindex` anyway, so
 * reading a header (and rendering dynamically) costs nothing here.
 */
async function currentLocale() {
  try {
    return localeFromPath((await headers()).get('x-pathname') ?? '/');
  } catch {
    // `headers()` throws outside a request scope, e.g. a unit-test render.
    return localeFromPath('/');
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await currentLocale());
  return {
    title: t('notFoundPage.metaTitle'),
    robots: { index: false, follow: true },
  };
}

export default async function NotFound() {
  const t = translator(await currentLocale());

  return (
    <div className="bc-stack">
      <h1>{t('notFoundPage.title')}</h1>
      <p className="bc-lede">{t('notFoundPage.lede')}</p>
      <div className="bc-actions">
        <Link className="bc-button" href="/discover">
          {t('notFoundPage.discover')}
        </Link>
        <Link className="bc-button bc-button--secondary" href="/">
          {t('notFoundPage.home')}
        </Link>
      </div>
    </div>
  );
}
