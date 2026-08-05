/**
 * Client-minted UUIDv7 (EF §2.2).
 *
 * The brew logger writes a session locally *before* it ever reaches the network,
 * so the id has to be generated on the device. v7 is chosen over v4 because the
 * first 48 bits are the millisecond timestamp: ids sort by creation time, which
 * makes the offline queue replay in the order the brews actually happened and
 * gives the API a keyset-friendly primary key.
 *
 * Idempotency depends on this: `PUT /api/v1/brews/{id}` with the same id is the
 * same brew, however many times a flaky kitchen wifi makes us retry it.
 *
 * Layout (RFC 9562 §5.7):
 *   unix_ts_ms (48) | ver 0b0111 (4) | rand_a (12) | var 0b10 (2) | rand_b (62)
 *
 * `rand_a` carries a monotonic counter rather than pure randomness so two ids
 * minted in the same millisecond still sort in mint order (RFC 9562 §6.2
 * "monotonic random" method).
 */

/** Bytes 6–7 hold 12 bits; keep headroom so a burst inside one ms cannot wrap. */
const COUNTER_MAX = 0x0fff;
const COUNTER_SEED_MAX = 0x0800;

let lastTimestamp = -1;
let counter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
  // Non-crypto fallback (very old browsers, some SSR sandboxes). Ids are
  // identifiers, never secrets or tokens — collision resistance is all we need,
  // and the timestamp + counter carry most of it.
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

function hex(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i += 1) out += HEX[bytes[i] ?? 0];
  return out;
}

/** A fresh UUIDv7. Pass `now` in tests to pin the timestamp. */
export function uuidv7(now: number = Date.now()): string {
  const timestamp = Math.max(0, Math.floor(now));

  if (timestamp === lastTimestamp) {
    counter = (counter + 1) & COUNTER_MAX;
  } else {
    lastTimestamp = timestamp;
    counter = Math.floor(Math.random() * COUNTER_SEED_MAX);
  }

  const bytes = randomBytes(16);

  // 48-bit big-endian millisecond timestamp.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 + the monotonic counter in rand_a.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // RFC 4122 variant (0b10xxxxxx).
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return (
    `${hex(bytes, 0, 4)}-${hex(bytes, 4, 6)}-${hex(bytes, 6, 8)}-` +
    `${hex(bytes, 8, 10)}-${hex(bytes, 10, 16)}`
  );
}

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shape check — used before we trust an id that came back from storage. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_RE.test(value);
}

/** The millisecond timestamp encoded in a v7 id, or null if it isn't one. */
export function uuidV7Timestamp(value: string): number | null {
  if (!isUuidV7(value)) return null;
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}

/** Test seam — forget the monotonic counter state. */
export function resetUuidState(): void {
  lastTimestamp = -1;
  counter = 0;
}
