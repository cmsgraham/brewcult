/**
 * JSON-LD injection under the strict CSP (middleware.ts).
 *
 * The edge policy has **no `unsafe-inline` for scripts**, so every inline
 * `<script>` this app emits — including structured data — carries the
 * per-request nonce that `middleware.ts` puts on the `x-nonce` request header.
 *
 * Two notes:
 *  - Most browsers do not apply `script-src` to `type="application/ld+json"`
 *    (it never executes), but "most" is not a policy. The nonce costs nothing
 *    and makes the page correct under any CSP implementation.
 *  - Reading `headers()` opts the route into dynamic rendering. That is
 *    unavoidable for a per-request nonce, and it is not a performance problem
 *    here: every upstream fetch is `revalidate`-cached, so a dynamic render is
 *    a template fill, not a round-trip to the API.
 *
 * The nonce is read by the *page* (`readCspNonce`) and passed down, keeping
 * `<JsonLd>` a synchronous component — async components cannot be nested inside
 * a rendered tree in unit tests, and structured data is exactly the thing we
 * want covered by tests.
 */
import { headers } from 'next/headers';
import { serializeJsonLd, type JsonLdDocument } from '../../lib/structured-data';

/** The per-request CSP nonce, or undefined when middleware did not run. */
export async function readCspNonce(): Promise<string | undefined> {
  try {
    return (await headers()).get('x-nonce') ?? undefined;
  } catch {
    // `headers()` throws outside a request scope (e.g. a unit-test render).
    // A page without structured data is better than a page that 500s.
    return undefined;
  }
}

export interface JsonLdProps {
  documents: JsonLdDocument[];
  nonce?: string | undefined;
}

export function JsonLd({ documents, nonce }: JsonLdProps) {
  if (documents.length === 0) return null;

  return (
    <>
      {documents.map((document, index) => (
        <script
          // Index is a stable key here: `documents` is a fixed-length literal
          // array built by the page, never a reordered list.
          key={`${String(document['@type'])}-${index}`}
          type="application/ld+json"
          // Omitted rather than emitted empty: `nonce=""` matches nothing, and
          // some parsers treat it as an explicit empty-nonce declaration.
          {...(nonce ? { nonce } : {})}
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(document) }}
        />
      ))}
    </>
  );
}
