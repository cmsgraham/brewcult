import { type Metadata } from 'next';
import { AssistantChat } from '../../../components/ai/assistant-chat';

export const metadata: Metadata = {
  title: 'Brew assistant',
  description:
    'Ask about your brews, your gear and the coffee in front of you — answers grounded in your own logs and the BrewCult catalogue.',
  // A private, per-user tool over authenticated data. Nothing here is a landing
  // page and nothing here should be crawled.
  robots: { index: false, follow: false },
};

/**
 * /ai — Brew Intelligence, in conversation (second_draft §7).
 *
 * Client-rendered and never cached: the transcript is per-user, streams over
 * SSE, and every answer depends on cookies. The page itself is deliberately
 * thin — the honest framing lives above the fold, so nobody has to guess how
 * much the assistant actually knows before they ask it something.
 */
export const dynamic = 'force-dynamic';

export default function AiPage() {
  return (
    <div className="bc-stack">
      <h1>Brew assistant</h1>
      <p className="bc-lede">
        It reads your brew logs, your equipment and the BrewCult catalogue before it answers —
        and when the graph has nothing to say about your coffee, it tells you that instead of
        making something up.
      </p>

      <AssistantChat />

      <p className="bc-muted">
        One suggestion at a time, on purpose: changing three things at once teaches you nothing
        about which one worked. Answers are a starting point — your palate settles it.
      </p>
    </div>
  );
}
