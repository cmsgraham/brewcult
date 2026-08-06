import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../components/locale-link';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="bc-stack">
      <h1>That page is not here</h1>
      <p className="bc-lede">
        Wrong link, or something we moved. Either way, not your fault.
      </p>
      <div className="bc-actions">
        <Link className="bc-button" href="/discover">
          Discover coffee
        </Link>
        <Link className="bc-button bc-button--secondary" href="/">
          Back home
        </Link>
      </div>
    </div>
  );
}
