import { LocaleLink as Link } from '../components/locale-link';
import { localeParam, translator } from '../lib/locale-server';

/**
 * The locale arrives as a prop rather than from `useLocale()` because this is a
 * server component sitting inside the client `LocaleProvider` — a server child
 * cannot read a client context, and rendering the footer on the client to reach
 * one would ship JavaScript for three links.
 */
export function SiteFooter({ locale = 'en' }: { locale?: string }) {
  const t = translator(localeParam(locale));

  return (
    <footer className="bc-footer">
      <div className="bc-shell bc-footer__inner">
        <p style={{ margin: 0 }}>{t('footer.tagline')}</p>
        <ul className="bc-footer__links">
          <li>
            <Link href="/privacy">{t('footer.privacy')}</Link>
          </li>
          <li>
            <Link href="/terms">{t('footer.terms')}</Link>
          </li>
          <li>
            <Link href="/discover">{t('footer.discover')}</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
