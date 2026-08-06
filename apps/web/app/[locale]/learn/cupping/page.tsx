import { type Metadata } from 'next';
import { localeAlternates } from '../../../../lib/seo';
import { localeParam } from '../../../../lib/locale-server';
import Link from 'next/link';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = localeParam((await params).locale);
  return {
  title: 'How coffee is scored — the SCA cupping form explained',
  description:
    'What fragrance, flavour, aftertaste, acidity, body, uniformity, balance, clean cup, sweetness and overall actually mean, how to identify each one, and how the 100-point score works.',
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
interface Attribute {
  id: string;
  name: string;
  what: string;
  how: string;
  ends: string;
}

const ATTRIBUTES: Attribute[] = [
  {
    id: 'fragrance-aroma',
    name: 'Fragrance / aroma',
    what: 'How the coffee smells — fragrance is the DRY grounds before water touches them, aroma is the wet coffee after. They are scored together as one attribute.',
    how: 'Smell the grounds the moment you grind: that is fragrance. Pour water, wait, then smell again while stirring the surface: that is aroma. Sweet, floral, fruity, nutty and chocolatey smells score well; flat, papery or musty ones do not.',
    ends: 'High: you would know this was good coffee with your eyes closed, before tasting. Low: it smells of little, or of cardboard.',
  },
  {
    id: 'flavour',
    name: 'Flavour',
    what: 'The main event — taste and smell working together in the middle of the sip. Not any single note, but the combined character of the coffee.',
    how: 'Take a sip with some air (cuppers slurp to spray the coffee across the whole palate) and pay attention to the middle of the experience, after the first impression and before the finish. Can you name what you taste — a fruit, a sweetness, a chocolate? Distinct, nameable character scores higher than generic "coffee flavour".',
    ends: 'High: distinct, expressive, you could describe it to a friend. Low: vague, woody, or unpleasant.',
  },
  {
    id: 'aftertaste',
    name: 'Aftertaste',
    what: 'What stays behind after you swallow — both how long it lasts and whether you are glad it did.',
    how: 'Swallow, wait ten seconds, and notice what is still there. Good coffee leaves sweetness or pleasant flavour that fades slowly. Lesser coffee vanishes instantly, or worse, leaves bitterness, dryness or a chemical edge that outstays the good part.',
    ends: 'High: a long, sweet, pleasant finish. Low: short, or lingering in a way you wish it would not.',
  },
  {
    id: 'acidity',
    name: 'Acidity',
    what: 'The brightness or liveliness of the cup — the quality that makes coffee taste vivid rather than flat. This is not "sourness", and more is not better: the score is for how PLEASANT the acidity is, not how much there is.',
    how: 'Notice the sensation at the sides of your tongue right after the sip, the same place a bite of green apple or a squeeze of lime registers. Ask: does it sparkle, like fruit? Or does it bite, like vinegar? A great washed Ethiopian dances; an underripe or under-roasted coffee just puckers.',
    ends: 'High: bright, sweet, fruit-like, integrated. Low: either lifeless and flat, or harsh and sour.',
  },
  {
    id: 'body',
    name: 'Body',
    what: 'The weight and texture of the coffee in your mouth — thin like tea, or heavy like cream. As with acidity, the score is for quality: a delicate body can be excellent, a heavy one can be muddy.',
    how: 'Press your tongue against the roof of your mouth mid-sip and notice the thickness, the way you would compare skimmed milk with whole milk. Then notice the texture: silky, creamy, syrupy — or thin, gritty, astringent (that drying, sandpaper feeling is a texture fault, not a taste).',
    ends: 'High: a texture that suits the coffee, from silky to syrupy. Low: watery, rough, or drying.',
  },
  {
    id: 'uniformity',
    name: 'Uniformity',
    what: 'Whether the coffee tastes the same cup after cup. At a cupping table five cups of each coffee are brewed, and each consistent cup earns two of the ten points.',
    how: 'At home you rarely brew five cups at once, so judge consistency across sips and across brews: does the same bag, brewed the same way, taste the same on Tuesday as it did on Sunday? Inconsistency usually points to uneven roasting or mixed beans.',
    ends: 'High: every cup is the same cup. Low: one brew is lovely and the next is oddly different.',
  },
  {
    id: 'balance',
    name: 'Balance',
    what: 'How the other attributes get along. Flavour, aftertaste, acidity and body in proportion, with nothing shouting over the rest and nothing missing.',
    how: 'After scoring the parts, step back and ask about the whole: does the acidity overwhelm the sweetness? Does big body smother the delicate flavours? Or does every element support the others? Imagine a band — balance is nobody drowning out the singer.',
    ends: 'High: everything in proportion; removing anything would hurt it. Low: one attribute dominates, or something feels absent.',
  },
  {
    id: 'clean-cup',
    name: 'Clean cup',
    what: 'The absence of anything that does not belong — no off-flavours from first sip to last. "Transparency" is a good synonym: nothing between you and the coffee.',
    how: 'Taste from the first sip through the aftertaste asking one question: is there anything here that is not coffee? Mustiness, earthiness where it does not belong, fermented sharpness, mould, medicine. Each of the five cups free of interference earns two points.',
    ends: 'High: nothing but coffee, start to finish. Low: off-notes interrupt, even briefly.',
  },
  {
    id: 'sweetness',
    name: 'Sweetness',
    what: 'The pleasing fullness that comes from ripe, well-developed cherries — closer to the sweetness of a ripe peach than of table sugar. Its opposites are sourness, astringency and "green", grassy flavours.',
    how: 'Let a sip sit a moment and notice whether the coffee feels generous and ripe, or thin and vegetal. Black coffee never tastes like sugar water; what you are looking for is the ripeness that makes fruit taste ready rather than early.',
    ends: 'High: ripe, full, generous. Low: green, grassy, astringent — the taste of cherries picked too soon.',
  },
  {
    id: 'overall',
    name: 'Overall',
    what: 'The honest, holistic verdict — the one place the form asks for your opinion rather than an analysis. It is also the one score everybody on this site gives, cupping or not.',
    how: 'Ask the simplest question in coffee: how good was this, really? Would you buy it again? Does it deliver what its origin and roaster promise? A technically correct but boring coffee loses points here; a distinctive one that you could not stop drinking gains them.',
    ends: 'High: you would seek this out again. Low: correct at best, forgettable at worst.',
  },
];

const SCALE: { score: string; word: string; meaning: string }[] = [
  { score: '6.00–6.75', word: 'Good', meaning: 'Solid specialty-grade quality; the floor of the scale, not an insult.' },
  { score: '7.00–7.75', word: 'Very good', meaning: 'Clearly enjoyable, with real character.' },
  { score: '8.00–8.75', word: 'Excellent', meaning: 'Distinctive and memorable. Most coffees never score here.' },
  { score: '9.00–9.75', word: 'Outstanding', meaning: 'Exceptional character; competition territory.' },
  { score: '10.00', word: 'Exceptional', meaning: 'As good as the attribute gets. Almost never given.' },
];

export default function CuppingGuidePage() {
  return (
    <div className="bc-stack bc-prose">
      <h1>How coffee is scored</h1>
      <p className="bc-lede">
        Every score on BrewCult uses the SCA cupping form — the same ten attributes a
        professional cupping table scores, on the same 6-to-10 scale. We did not invent it, and
        that is the point: an 86 here means what an 86 means everywhere. This page explains each
        attribute, and how to actually find it in your cup.
      </p>

      <section aria-labelledby="scale-heading" className="bc-stack">
        <h2 id="scale-heading">The scale</h2>
        <p>
          Each attribute is scored from <strong>6.00 to 10.00</strong>, in quarter-point steps.
          The scale starts at 6 because the form exists to grade specialty coffee — an attribute
          that would score lower has a defect, and defects are counted separately. Ten attributes
          summed give a score out of 100, and <strong>80 or above is what the word
          &ldquo;specialty&rdquo; formally means</strong>.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="bc-table">
            <thead>
              <tr>
                <th scope="col">Score</th>
                <th scope="col">The form&rsquo;s word</th>
                <th scope="col">What it means in practice</th>
              </tr>
            </thead>
            <tbody>
              {SCALE.map((row) => (
                <tr key={row.word}>
                  <td>{row.score}</td>
                  <td>{row.word}</td>
                  <td>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          On BrewCult only <strong>Overall</strong> is required — it is the one attribute that
          is honestly answerable from an armchair, and it is the same attribute a judge fills
          in. The other nine are there when you want to score properly, and only a complete
          form produces a score out of 100. Nine invented numbers would be worse data than one
          real one.
        </p>
      </section>

      <section aria-labelledby="attributes-heading" className="bc-stack">
        <h2 id="attributes-heading">The ten attributes</h2>
        {ATTRIBUTES.map((attribute) => (
          <article key={attribute.id} id={attribute.id} className="bc-stack" style={{ gap: '0.5rem' }}>
            <h3>{attribute.name}</h3>
            <p>{attribute.what}</p>
            <p>
              <strong>How to find it:</strong> {attribute.how}
            </p>
            <p className="bc-muted">{attribute.ends}</p>
          </article>
        ))}
      </section>

      <section aria-labelledby="defects-heading" className="bc-stack">
        <h2 id="defects-heading">Taints and faults</h2>
        <p>
          Defects are subtracted from the total rather than hidden inside low attribute scores,
          so a defective cup of otherwise great coffee is recorded as exactly that.
        </p>
        <p>
          A <strong>taint</strong> is an off-note you can <em>smell</em> but that does not ruin
          the taste — a whiff of ferment, a papery edge. Each tainted cup costs 2 points. A{' '}
          <strong>fault</strong> is an off-flavour you can <em>taste</em> — mould, phenol
          (medicinal), sour ferment, the raw-potato flavour some East African coffees can carry.
          Each faulty cup costs 4.
        </p>
      </section>

      <section aria-labelledby="try-heading" className="bc-stack">
        <h2 id="try-heading">Try it at home</h2>
        <p>
          You do not need a lab. Grind 8.25&nbsp;g of coffee coarsely into a cup, pour
          150&nbsp;ml of water just off the boil straight onto the grounds, and wait four
          minutes. Break the crust with a spoon and smell as you do — that is your aroma score.
          Skim the foam, wait until it is cool enough, and taste with a decisive slurp. Then
          taste again as it cools: coffee shows its flaws warm and its sweetness cool, and a
          score given at one temperature is half a score.
        </p>
        <p>
          Then go and score something —{' '}
          <Link href="/discover">any coffee in the catalogue</Link> takes your Overall in two
          taps, and the full form when you want it.
        </p>
      </section>
    </div>
  );
}
