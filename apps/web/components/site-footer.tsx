import { LocaleLink as Link } from '../components/locale-link';

export function SiteFooter() {
  return (
    <footer className="bc-footer">
      <div className="bc-shell bc-footer__inner">
        <p style={{ margin: 0 }}>
          BrewCult — every great brewer started with bitter coffee.
        </p>
        <ul className="bc-footer__links">
          <li>
            <Link href="/privacy">Privacy</Link>
          </li>
          <li>
            <Link href="/terms">Terms</Link>
          </li>
          <li>
            <Link href="/discover">Discover</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
