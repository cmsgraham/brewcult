import { type Metadata } from 'next';
import { LocaleLink as Link } from '../../../components/locale-link';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The rules of BrewCult, in plain language.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <div className="bc-stack">
      <h1>Terms</h1>
      <p className="bc-lede">
        The rules, in plain language. The reviewed legal text lands before public launch;
        nothing there will contradict what is on this page.
      </p>

      <h2>Who can join</h2>
      <p>You need to be 16 or older to hold a BrewCult account.</p>

      <h2>How we expect people to behave</h2>
      <p>
        Beginner questions are welcome, always. Gear-shaming, budget-shaming and
        &ldquo;just buy a better grinder&rdquo; answers are not what this place is for. There
        are no public downvotes here by design — quality rises through usefulness, saves and
        forks. Explaining patiently is what earns standing.
      </p>

      <h2>Your content</h2>
      <p>
        Your recipes, brews and posts stay yours. You give us permission to show them on the
        platform and let other members fork recipes with attribution. Delete your account and
        your personal data goes; public recipes others have built on stay up with your name
        removed, so their work does not break.
      </p>

      <h2>Our side of it</h2>
      <p>
        We keep the service running, we tell you what we do with your data (see{' '}
        <Link href="/privacy">Privacy</Link>), and we do not let paid placement change what
        the AI recommends. Suggestions are suggestions — brewing advice is not a guarantee
        about a cup of coffee.
      </p>

      <h2>Ending things</h2>
      <p>
        You can delete your account any time from <Link href="/profile">your profile</Link>.
        We may suspend accounts that break the behaviour rules above, and we will say which
        rule and why.
      </p>
    </div>
  );
}
