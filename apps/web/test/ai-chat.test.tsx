/**
 * The assistant page (/ai) and the SSE reader behind it.
 *
 * The load-bearing test in this file is **"model output is text"**: a streamed
 * answer containing `<img onerror=…>` must produce a sentence, not an element
 * (EF §3.4 — model output is rendered as sanitised markdown, never interpreted
 * as HTML). If that assertion ever goes red, the assistant is a stored-XSS
 * delivery mechanism and the page must not ship.
 *
 * The rest: chunked tokens assemble in order, a mid-stream abort keeps what
 * arrived and crashes nothing, tool calls show as quiet human status lines
 * rather than JSON, entity links come only from the API's `entities[]`, and a
 * spent daily allowance reads as an allowance and not as an error.
 *
 * No live API and no streaming server — `fetch` is a mock returning a
 * ReadableStream we drive by hand.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantChat } from '../components/ai/assistant-chat';
import { createSseParser, parseAiFrame, resetAiStreamState } from '../lib/ai-client';
import { resetRefreshState } from '../lib/api';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/* ------------------------------------------------------------------ *
 * Fake transport
 * ------------------------------------------------------------------ */

function scriptedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function openStream(): {
  stream: ReadableStream<Uint8Array>;
  push: (text: string) => void;
} {
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
    },
  });
  return {
    stream,
    // Enqueuing onto a cancelled stream throws; after an abort that is exactly
    // the situation under test, and the throw is not the thing being asserted.
    push: (text: string) => {
      try {
        sink?.enqueue(encoder.encode(text));
      } catch {
        /* stream already cancelled */
      }
    },
  };
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

function chatFetch(response: () => Response) {
  return vi.fn(async (_url: string, _init?: RequestInit) => response());
}

async function ask(question: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Ask the brew assistant'), question);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

beforeEach(() => {
  resetRefreshState();
  resetAiStreamState();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * The SSE reader, on its own
 * ------------------------------------------------------------------ */

describe('SSE reader', () => {
  it('assembles tokens split across network chunks, in order', () => {
    const parser = createSseParser();
    const text: string[] = [];

    const feed = (chunk: string) => {
      for (const frame of parser.push(chunk)) {
        for (const event of parseAiFrame(frame)) {
          if (event.type === 'text') text.push(event.text);
        }
      }
    };

    // A chunk boundary lands mid-JSON, mid-frame and mid-terminator.
    feed('data: {"type":"token","text":"Sour usually "}\n\ndata: {"type":"token","te');
    feed('xt":"means under-"}\n');
    feed('\ndata: {"type":"token","text":"extracted."}\n\n');

    expect(text.join('')).toBe('Sour usually means under-extracted.');
  });

  it('keeps a partial frame buffered rather than emitting half an answer', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"token","text":"half')).toEqual([]);
    const frames = parser.push('"}\n\n');
    expect(frames).toHaveLength(1);
    expect(parseAiFrame(frames[0]!)).toEqual([{ type: 'text', text: 'half' }]);
  });

  it('drops shapes it cannot name instead of leaking JSON into the answer', () => {
    expect(parseAiFrame({ event: null, data: '{"weird":{"nested":1}}' })).toEqual([]);
    expect(parseAiFrame({ event: null, data: '[DONE]' })).toEqual([{ type: 'done' }]);
  });

  it('turns tool calls into human status lines, never raw names or arguments', () => {
    expect(
      parseAiFrame({
        event: null,
        data: '{"type":"tool","name":"get_user_equipment","arguments":{"user_id":"u1"}}',
      }),
    ).toEqual([{ type: 'tool', label: 'looking at your equipment…' }]);
  });
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

describe('assistant chat', () => {
  it('streams an answer into the transcript in order', async () => {
    const fetchImpl = chatFetch(() =>
      streamResponse(
        scriptedStream([
          'data: {"type":"token","text":"Sour usually "}\n\n',
          'data: {"type":"token","te',
          'xt":"means under-extracted."}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('why is my coffee sour?');

    await waitFor(() =>
      expect(screen.getByText('Sour usually means under-extracted.')).toBeInTheDocument(),
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/ai/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: 'user', content: 'why is my coffee sour?' }],
    });
  });

  it('renders raw HTML in model output as text, creating no elements', async () => {
    const hostile =
      'Try this: <img src=x onerror="alert(1)"> and <script>alert(2)</script> — ' +
      'also [click here](https://evil.example).';
    const fetchImpl = chatFetch(() =>
      streamResponse(
        scriptedStream([
          `data: ${JSON.stringify({ type: 'token', text: hostile })}\n\n`,
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const { container } = render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('tell me something');

    await waitFor(() => expect(screen.getByText(/Try this:/)).toBeInTheDocument());

    // THE security assertion: not one element was created from that string.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();

    // The tags survive as literal characters the reader can see.
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
    expect(screen.getByText(/<script>alert\(2\)<\/script>/)).toBeInTheDocument();

    // A markdown link the model wrote keeps its words and loses its href: only
    // API-provided entities are ever allowed to become anchors.
    expect(screen.getByText(/click here/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'click here' })).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="evil.example"]')).toBeNull();
  });

  it('shows tool activity as a quiet status line, not JSON', async () => {
    const { stream, push } = openStream();
    const fetchImpl = chatFetch(() => streamResponse(stream));

    render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('what should I change?');

    push('data: {"type":"tool","name":"get_brew_history","arguments":{"limit":5}}\n\n');
    await waitFor(() =>
      expect(screen.getByText('reading your recent brews…')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/limit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/get_brew_history/)).not.toBeInTheDocument();
  });

  it('links only the entities the API returned', async () => {
    const fetchImpl = chatFetch(() =>
      streamResponse(
        scriptedStream([
          'data: {"type":"token","text":"Have a look at https://example.com/not-a-link too."}\n\n',
          'data: {"type":"entities","entities":[{"type":"coffee","slug":"ethiopia-chelbesa","name":"Ethiopia Chelbesa"},{"type":"equipment","slug":"hario-v60-02","name":"Hario V60 02"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const { container } = render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('recommend something');

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ethiopia Chelbesa' })).toHaveAttribute(
        'href',
        '/coffee/ethiopia-chelbesa',
      ),
    );
    expect(screen.getByRole('link', { name: 'Hario V60 02' })).toHaveAttribute(
      'href',
      '/equipment/hario-v60-02',
    );
    // The URL in prose is not one of them.
    expect(container.querySelector('a[href*="example.com"]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('survives an abort mid-stream, keeping what already arrived', async () => {
    const user = userEvent.setup();
    const { stream, push } = openStream();
    const fetchImpl = chatFetch(() => streamResponse(stream));

    render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('long question');

    push('data: {"type":"token","text":"Half an answer"}\n\n');
    await waitFor(() => expect(screen.getByText('Half an answer')).toBeInTheDocument());

    // The stream never closes; the user stops it.
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    // Stop disappearing is the "no longer streaming" signal.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument(),
    );
    // What arrived is still on screen, and nothing threw.
    expect(screen.getByText('Half an answer')).toBeInTheDocument();

    // Anything the server sends after the abort is ignored.
    push('data: {"type":"token","text":" — the rest"}\n\n');
    await Promise.resolve();
    expect(screen.queryByText(/the rest/)).not.toBeInTheDocument();
  });

  it('aborts the stream when the page unmounts', async () => {
    const { stream, push } = openStream();
    const fetchImpl = chatFetch(() => streamResponse(stream));

    const view = render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('still going');
    push('data: {"type":"token","text":"Answering"}\n\n');
    await waitFor(() => expect(screen.getByText('Answering')).toBeInTheDocument());

    // No unhandled rejection, no state update on an unmounted tree.
    expect(() => view.unmount()).not.toThrow();
  });

  it('renders a spent allowance honestly rather than as an error', async () => {
    const fetchImpl = chatFetch(() =>
      errorResponse(429, { error: 'ai_budget_exhausted', message: '' }),
    );

    render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('one more question');

    await waitFor(() =>
      expect(screen.getByText(/you've used today's AI allowance/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/resets tomorrow/i)).toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/429/)).not.toBeInTheDocument();
  });

  it('says the assistant is quiet when the endpoint is not there yet', async () => {
    const fetchImpl = chatFetch(() => errorResponse(404, { error: 'not_found', message: '' }));

    render(<AssistantChat fetchImpl={fetchImpl} />);
    await ask('anything');

    await waitFor(() =>
      expect(screen.getByText(/isn't answering right now/i)).toBeInTheDocument(),
    );
  });

  it('announces finished answers without re-announcing every token', async () => {
    const { stream, push } = openStream();
    const fetchImpl = chatFetch(() => streamResponse(stream));

    const { container } = render(<AssistantChat fetchImpl={fetchImpl} />);

    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');

    await ask('hello');
    push('data: {"type":"token","text":"Still typing"}\n\n');
    await waitFor(() => expect(screen.getByText('Still typing')).toBeInTheDocument());

    // Mid-stream the answer is hidden from assistive tech, so the live region
    // does not read the same sentence once per token.
    const streamingTurn = container.querySelector('[aria-hidden="true"]');
    expect(streamingTurn?.textContent).toContain('Still typing');

    push('data: [DONE]\n\n');
    // Finished: it joins the log exactly once.
    await waitFor(() => expect(container.querySelector('[aria-hidden="true"]')).toBeNull());
    expect(screen.getByText('Still typing')).toBeInTheDocument();
  });

  it('keeps focus where the user left it while an answer streams', async () => {
    const { stream, push } = openStream();
    const fetchImpl = chatFetch(() => streamResponse(stream));

    render(<AssistantChat fetchImpl={fetchImpl} />);
    const box = screen.getByLabelText('Ask the brew assistant');
    await ask('focus test');

    box.focus();
    push('data: {"type":"token","text":"tokens arriving"}\n\n');
    await waitFor(() => expect(screen.getByText('tokens arriving')).toBeInTheDocument());

    expect(document.activeElement).toBe(box);
  });
});
