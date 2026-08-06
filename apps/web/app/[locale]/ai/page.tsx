import { type Metadata } from 'next';
import { AssistantChat } from '../../../components/ai/assistant-chat';
import { localeParam, translator } from '../../../lib/locale-server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = translator(localeParam((await params).locale));
  return {
    title: t('ai.title'),
    description: t('ai.description'),
    // A private, per-user tool over authenticated data. Nothing here is a
    // landing page and nothing here should be crawled.
    robots: { index: false, follow: false },
  };
}

/**
 * /ai — Brew Intelligence, in conversation (second_draft §7).
 *
 * Client-rendered and never cached: the transcript is per-user, streams over
 * SSE, and every answer depends on cookies. The page itself is deliberately
 * thin — the honest framing lives above the fold, so nobody has to guess how
 * much the assistant actually knows before they ask it something.
 */
export const dynamic = 'force-dynamic';

export default async function AiPage({ params }: { params: Promise<{ locale: string }> }) {
  const t = translator(localeParam((await params).locale));
  return (
    <div className="bc-stack">
      <h1>{t('ai.title')}</h1>
      <p className="bc-lede">{t('ai.lede')}</p>

      <AssistantChat />

      <p className="bc-muted">{t('ai.footnote')}</p>
    </div>
  );
}
