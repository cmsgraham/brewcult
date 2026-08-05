'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  classifyAiError,
  streamAiChat,
  type AiChatMessage,
  type AiEntity,
} from '../../lib/ai-client';
import { EntityLinks } from './entity-links';
import { SafeMarkdown } from './markdown';
import styles from './ai.module.css';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  entities: AiEntity[];
  streaming: boolean;
}

export interface AssistantChatProps {
  fetchImpl?: FetchLike;
  /** Injected in tests so ids are stable. */
  newId?: () => string;
}

const OPENERS = [
  'Why does my coffee taste sour?',
  'What should I change to get more sweetness?',
  'Give me a starting recipe for a V60.',
];

/**
 * The assistant (/ai) — a streaming conversation over `POST /v1/ai/chat`.
 *
 * Accessibility decisions, which are the hard part of a streaming UI:
 *
 *  - The transcript is a live region (`role="log"`, `aria-live="polite"`), so a
 *    finished turn is announced. **The in-flight assistant turn is
 *    `aria-hidden` while it streams**, so a screen reader is not read forty
 *    tokens of the same sentence; when the stream ends the flag drops and the
 *    completed answer becomes part of the log exactly once.
 *  - Tool activity and stream state go to a *separate* visually-hidden status
 *    region, so "looking at your equipment…" never interleaves into the answer.
 *  - **Focus is never moved by the stream.** Nothing here calls `focus()`; the
 *    caret stays wherever the user left it, mid-answer or not.
 *  - Enter sends, Shift+Enter is a newline, and Stop is a real button — the
 *    whole surface is operable without a pointer.
 *
 * Model output is rendered by <SafeMarkdown/> (EF §3.4): a text-only subset,
 * never HTML. Entity links come from the API's `entities[]`, never from prose.
 */
export function AssistantChat({ fetchImpl, newId }: AssistantChatProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'budget' | 'error'; message: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const counter = useRef(0);
  turnsRef.current = turns;

  const nextId = useCallback((): string => {
    if (newId) return newId();
    counter.current += 1;
    return `turn-${counter.current}`;
  }, [newId]);

  // Leaving the page must not leave a socket (and a token budget) running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const appendToAssistant = useCallback((id: string, chunk: string): void => {
    setTurns((current) =>
      current.map((turn) => (turn.id === id ? { ...turn, text: turn.text + chunk } : turn)),
    );
  }, []);

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const trimmed = question.trim();
      if (trimmed === '' || streaming) return;

      setNotice(null);
      setActivity(null);

      const history: AiChatMessage[] = turnsRef.current
        .filter((turn) => turn.text.trim() !== '')
        .map((turn) => ({ role: turn.role, content: turn.text }));
      const messages: AiChatMessage[] = [...history, { role: 'user', content: trimmed }];

      const userTurn: Turn = {
        id: nextId(),
        role: 'user',
        text: trimmed,
        entities: [],
        streaming: false,
      };
      const answerId = nextId();
      const answerTurn: Turn = {
        id: answerId,
        role: 'assistant',
        text: '',
        entities: [],
        streaming: true,
      };

      setTurns((current) => [...current, userTurn, answerTurn]);
      setInput('');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const finish = (): void => {
        setStreaming(false);
        setActivity(null);
        setTurns((current) =>
          current.map((turn) => (turn.id === answerId ? { ...turn, streaming: false } : turn)),
        );
      };

      try {
        await streamAiChat({
          messages,
          signal: controller.signal,
          ...(fetchImpl ? { fetchImpl } : {}),
          onEvent: (event) => {
            switch (event.type) {
              case 'text':
                appendToAssistant(answerId, event.text);
                break;
              case 'tool':
                setActivity(event.label);
                break;
              case 'entities':
                setTurns((current) =>
                  current.map((turn) =>
                    turn.id === answerId ? { ...turn, entities: event.entities } : turn,
                  ),
                );
                break;
              case 'error':
                setNotice({ tone: 'error', message: event.message });
                break;
              case 'done':
                break;
            }
          },
        });
      } catch (error) {
        const failure = classifyAiError(error);
        setNotice({
          tone: failure.kind === 'budget' ? 'budget' : 'error',
          message:
            failure.kind === 'unavailable'
              ? "The assistant isn't answering right now. Nothing else on BrewCult is affected."
              : failure.message,
        });
      } finally {
        finish();
      }
    },
    [appendToAssistant, fetchImpl, nextId, streaming],
  );

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    setStreaming(false);
    setActivity(null);
    setTurns((current) => current.map((turn) => ({ ...turn, streaming: false })));
  }, []);

  const statusLine = activity ?? (streaming ? 'Thinking…' : '');

  return (
    <section className={styles.chat} aria-label="Brew assistant">
      <div className={styles.log} role="log" aria-live="polite" aria-atomic="false">
        {turns.length === 0 ? (
          <p className="bc-muted">
            Ask about a coffee, a brewer, or the cup you just drank. Answers come from your
            brews and the BrewCult catalogue — and say so when they don&apos;t.
          </p>
        ) : null}

        {turns.map((turn) => (
          <article
            key={turn.id}
            className={turn.role === 'user' ? styles.turnUser : styles.turnAssistant}
            // While tokens are landing this turn is invisible to assistive tech;
            // the completed answer is announced once, when streaming stops.
            aria-hidden={turn.streaming ? true : undefined}
          >
            <h2 className="bc-visually-hidden">{turn.role === 'user' ? 'You' : 'BrewCult'}</h2>
            {turn.role === 'user' ? (
              <p className={styles.turnUserText}>{turn.text}</p>
            ) : turn.text === '' ? (
              <p className="bc-muted">…</p>
            ) : (
              <SafeMarkdown text={turn.text} />
            )}
            {turn.role === 'assistant' && !turn.streaming ? (
              <EntityLinks entities={turn.entities} />
            ) : null}
          </article>
        ))}
      </div>

      {/* State, not content: kept out of the transcript so it cannot be mistaken
          for part of an answer, and out of the way visually. */}
      <p className={`bc-muted ${styles.activity}`} role="status" aria-live="polite">
        {statusLine}
      </p>

      {notice ? (
        <div className={`bc-alert ${styles.notice}`} role="status">
          <p>{notice.message}</p>
        </div>
      ) : null}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <label className="bc-visually-hidden" htmlFor="ai-question">
          Ask the brew assistant
        </label>
        <textarea
          id="ai-question"
          className={`bc-input ${styles.composerInput}`}
          rows={2}
          value={input}
          placeholder="Ask about your brew…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(input);
            }
          }}
        />
        <div className={styles.composerActions}>
          <button type="submit" className="bc-button" disabled={streaming || input.trim() === ''}>
            Ask
          </button>
          {streaming ? (
            <button type="button" className="bc-button bc-button--quiet" onClick={stop}>
              Stop
            </button>
          ) : null}
        </div>
      </form>

      {turns.length === 0 ? (
        <ul className={styles.openers}>
          {OPENERS.map((opener) => (
            <li key={opener}>
              <button
                type="button"
                className="bc-button bc-button--quiet"
                onClick={() => void ask(opener)}
              >
                {opener}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
