import { type Metadata } from 'next';
import { localeAlternates } from '../../../../lib/seo';
import { localeParam } from '../../../../lib/locale-server';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { guideContent } from './content';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  // The guide's own title and lede, rather than a second copy of them here that
  // could drift — and the Spanish page had an English <title> until now.
  const content = guideContent(locale);
  return {
    title: content.title,
    description: content.lede,
    // Canonical for THIS language plus an hreflang for each, including
    // x-default — without which a search engine picks for a visitor whose
    // language is neither, and it does not pick well.
    alternates: localeAlternates('/learn/cupping', locale),
  };
}

/**
 * The teaching page behind every score on the site.
 *
 * Exists because we adopted the SCA form instead of inventing a scale — and a
 * standard you have to already know is a gate, not a standard. Every attribute
 * gets three things: what it IS, how to actually find it in the cup, and what
 * high and low look like. The tone rule from second_draft §10 applies double
 * here: nothing on this page assumes you have ever been to a cupping.
 *
 * Fully static — no client JS, no fetches — and linked from the scoring form,
 * so "what does acidity mean here?" is one tap from the field asking for it.
 */
export default async function CuppingGuidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeParam((await params).locale);
  const content = guideContent(locale);

  return (
    <div className="bc-stack bc-prose">
      <h1>{content.title}</h1>
      <p className="bc-lede">{content.lede}</p>

      <section aria-labelledby="scale-heading" className="bc-stack">
        <h2 id="scale-heading">{content.scaleHeading}</h2>
        <p>{content.scaleIntro}</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="bc-table">
            <thead>
              <tr>
                <th scope="col">{content.scaleColumns.score}</th>
                <th scope="col">{content.scaleColumns.word}</th>
                <th scope="col">{content.scaleColumns.meaning}</th>
              </tr>
            </thead>
            <tbody>
              {content.scale.map((row) => (
                <tr key={row.word}>
                  <td>{row.score}</td>
                  <td>{row.word}</td>
                  <td>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{content.onlyOverall}</p>
      </section>

      <section aria-labelledby="attributes-heading" className="bc-stack">
        <h2 id="attributes-heading">{content.attributesHeading}</h2>
        {content.attributes.map((attribute) => (
          <article key={attribute.id} id={attribute.id} className="bc-stack" style={{ gap: '0.5rem' }}>
            <h3>{attribute.name}</h3>
            <p>{attribute.what}</p>
            <p>
              <strong>{content.howToFind}</strong> {attribute.how}
            </p>
            <p className="bc-muted">{attribute.ends}</p>
          </article>
        ))}
      </section>

      <section aria-labelledby="defects-heading" className="bc-stack">
        <h2 id="defects-heading">{content.defectsHeading}</h2>
        <p>{content.defectsIntro}</p>
        <p>{content.defectsBody}</p>
      </section>

      <section aria-labelledby="try-heading" className="bc-stack">
        <h2 id="try-heading">{content.tryHeading}</h2>
        <p>{content.tryBody}</p>
        <p>
          {content.tryThen}{' '}
          <Link href="/discover">{content.browseLink}</Link>.
        </p>
      </section>
    </div>
  );
}
