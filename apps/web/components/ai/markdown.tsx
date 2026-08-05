/**
 * Safe-subset markdown renderer for model output (EF §3.4).
 *
 * **No dependency, no `dangerouslySetInnerHTML`, no HTML parsing at all.** The
 * source string is tokenised into a small block/inline grammar and rendered as
 * React elements, so every character that is not one of the handful of markers
 * below ends up as a *text node*. `<img onerror=alert(1)>` in a model answer is
 * therefore the eleven-word sentence it looks like, not an element — the browser
 * never sees markup, because we never hand it markup.
 *
 * Two deliberate omissions:
 *
 *  - **Links are stripped to their text.** `[click here](https://evil.example)`
 *    renders as "click here". A model that can mint anchors is a phishing and
 *    exfiltration surface; real references arrive in the API's `entities[]` and
 *    are rendered by <EntityLinks/> through an allowlist.
 *  - **Images render as their alt text.** Same reason, plus a remote `img src`
 *    is a pixel-tracked read receipt on a private conversation.
 *
 * Supported: paragraphs, `#`–`####` headings, `-`/`*`/`+` and `1.` lists,
 * `> quotes`, fenced and inline code, `**bold**`, `*italic*`, `~~strike~~`.
 */
import { Fragment, type ReactNode } from 'react';
import styles from './ai.module.css';

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string };

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Line-based block parse — cheap, total, and impossible to make emit markup. */
export function parseMarkdownBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence (or end of input — both end the block)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // Chat and cards already own h1/h2; model headings never outrank them.
      const depth = (heading[1] ?? '#').length;
      blocks.push({
        kind: 'heading',
        level: depth <= 2 ? 3 : 4,
        text: (heading[2] ?? '').trim(),
      });
      index += 1;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = ordered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!match) break;
        items.push(match[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? '');
        if (!match) break;
        quoted.push(match[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim() === '' ||
        FENCE.test(current) ||
        HEADING.test(current) ||
        BULLET.test(current) ||
        ORDERED.test(current) ||
        QUOTE.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
}

/*
 * Inline grammar. Order matters: code first (so markers inside backticks stay
 * literal), then images and links (which are *unwrapped*, never linked), then
 * emphasis.
 */
const INLINE_SOURCE = [
    '(`+)([\\s\\S]*?)\\1', // 1,2  inline code
    '!\\[([^\\]]*)\\]\\([^)\\s]*\\)', // 3    image -> alt text
    '\\[([^\\]]*)\\]\\([^)\\s]*\\)', // 4    link  -> label only
    '\\*\\*([\\s\\S]+?)\\*\\*', // 5    bold
    '__([\\s\\S]+?)__', // 6    bold
    '~~([\\s\\S]+?)~~', // 7    strike
    '\\*([^*\\n]+?)\\*', // 8    italic
    '_([^_\\n]+?)_', // 9    italic
].join('|');

const MAX_DEPTH = 4;

/** Inline markers → React nodes. Anything unmatched is a literal text node. */
export function renderInline(source: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  if (depth > MAX_DEPTH) return [source];

  let cursor = 0;
  let key = 0;
  // A *fresh* regex per call, deliberately: this function recurses (bold can
  // contain code, links contain emphasis) and a shared /g regex would have its
  // `lastIndex` reset by the inner call, restarting the outer scan forever.
  const pattern = new RegExp(INLINE_SOURCE, 'g');

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    key += 1;

    if (match[2] !== undefined) {
      nodes.push(
        <code key={key} className={styles.code}>
          {match[2]}
        </code>,
      );
    } else if (match[3] !== undefined) {
      // Image: the alt text is the only part a reader needs, and the only part
      // that cannot phone home.
      if (match[3] !== '') nodes.push(<Fragment key={key}>{match[3]}</Fragment>);
    } else if (match[4] !== undefined) {
      nodes.push(<Fragment key={key}>{renderInline(match[4], depth + 1)}</Fragment>);
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(match[5] ?? match[6] ?? '', depth + 1)}</strong>);
    } else if (match[7] !== undefined) {
      nodes.push(<s key={key}>{renderInline(match[7], depth + 1)}</s>);
    } else if (match[8] !== undefined || match[9] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[8] ?? match[9] ?? '', depth + 1)}</em>);
    }
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

/** Soft line breaks inside a paragraph survive as <br/>, which chat answers need. */
function withBreaks(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    nodes.push(<Fragment key={`${keyPrefix}-l-${index}`}>{renderInline(line)}</Fragment>);
  });
  return nodes;
}

export interface SafeMarkdownProps {
  text: string;
}

/**
 * Render model-authored text. The only safe way to put an LLM's words on a
 * BrewCult page.
 */
export function SafeMarkdown({ text }: SafeMarkdownProps) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'heading':
            return block.level === 3 ? (
              <h3 key={key}>{renderInline(block.text)}</h3>
            ) : (
              <h4 key={key}>{renderInline(block.text)}</h4>
            );
          case 'code':
            return (
              <pre key={key} className={styles.codeBlock}>
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={key} className={styles.quote}>
                {withBreaks(block.lines, key)}
              </blockquote>
            );
          case 'list':
            return block.ordered ? (
              <ol key={key} className={styles.list}>
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className={styles.list}>
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'paragraph':
          default:
            return <p key={key}>{withBreaks(block.lines, key)}</p>;
        }
      })}
    </div>
  );
}
