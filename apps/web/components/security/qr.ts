/**
 * A small, self-contained QR encoder (ISO/IEC 18004), byte mode, EC level M.
 *
 * ── Why this exists rather than a dependency ─────────────────────────────────
 * The enrolment QR encodes the TOTP `otpauth://` URI, which contains the shared
 * secret. Handing that to a third-party image service (`chart.googleapis.com`,
 * `api.qrserver.com`, …) would mail the user's second factor to a stranger, so
 * the code has to be drawn in the browser from the string we already hold.
 *
 * The remaining choice is "small npm dependency" vs "write it". This lane owns
 * exactly four paths in a monorepo several lanes are editing at once; adding a
 * package means touching `apps/web/package.json` and the shared lockfile, which
 * is a merge hazard for everybody else. ~300 lines of pure, tested arithmetic
 * with no I/O is the cheaper trade. `test/mfa-qr.test.tsx` pins the output
 * against fixtures generated from a reference encoder, so "it renders something
 * square" can never pass for "it scans".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Scope is deliberately narrow: byte mode, EC level M, versions 1–10 (up to 213
 * bytes). An `otpauth://` URI is ~110–140 ASCII characters, so that ceiling has
 * roughly 70 characters of headroom over the longest realistic email address.
 * `encodeQr` returns null past it rather than emitting a wrong symbol — the
 * manual-entry path then carries the flow on its own.
 */

/** Error-correction level M (≈15% recovery) — what authenticator apps expect. */
const EC_LEVEL_M = 0;

/** Highest version this encoder builds. */
const MAX_VERSION = 10;

interface BlockSpec {
  /** EC codewords per block. */
  ec: number;
  /** `[blockCount, dataCodewordsPerBlock]` groups. */
  groups: readonly (readonly [number, number])[];
}

/** ISO/IEC 18004 Table 13–22, level-M rows only. */
const BLOCKS_M: Readonly<Record<number, BlockSpec>> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

/** Alignment-pattern centre coordinates per version (Annex E). */
const ALIGNMENT: Readonly<Record<number, readonly number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/* ------------------------------------------------------------------ *
 * GF(256) — primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

/** Generator polynomial for `degree` EC codewords, coefficients high→low. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ (poly[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder — the EC codewords for one block. */
function errorCorrection(data: readonly number[], ecLength: number): number[] {
  const gen = generatorPoly(ecLength);
  const buffer = [...data, ...new Array<number>(ecLength).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i] as number;
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) {
      buffer[i + j] = (buffer[i + j] as number) ^ gfMul(gen[j] as number, factor);
    }
  }
  return buffer.slice(data.length);
}

/* ------------------------------------------------------------------ *
 * BCH codes for the format (15,5) and version (18,6) information
 * ------------------------------------------------------------------ */

function bchDigit(value: number): number {
  let digit = 0;
  let rest = value;
  while (rest !== 0) {
    digit += 1;
    rest >>>= 1;
  }
  return digit;
}

const G15 = 0b101_0011_0111;
const G15_MASK = 0b101_0100_0001_0010;
const G18 = 0b1_1111_0010_0101;

function formatInfoBits(mask: number): number {
  const data = (EC_LEVEL_M << 3) | mask;
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) {
    d ^= G15 << (bchDigit(d) - bchDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

function versionInfoBits(version: number): number {
  let d = version << 12;
  while (bchDigit(d) - bchDigit(G18) >= 0) {
    d ^= G18 << (bchDigit(d) - bchDigit(G18));
  }
  return (version << 12) | d;
}

/* ------------------------------------------------------------------ *
 * Data encoding
 * ------------------------------------------------------------------ */

function dataCodewordCount(version: number): number {
  const spec = BLOCKS_M[version] as BlockSpec;
  return spec.groups.reduce((total, [blocks, size]) => total + blocks * size, 0);
}

/** Character-count indicator width for byte mode. */
function lengthBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** Bytes of payload this version can carry, or -1 if the version is unusable. */
export function byteCapacity(version: number): number {
  const spec = BLOCKS_M[version];
  if (!spec) return -1;
  return Math.floor((dataCodewordCount(version) * 8 - 4 - lengthBits(version)) / 8);
}

function smallestVersion(byteLength: number): number | null {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteLength <= byteCapacity(version)) return version;
  }
  return null;
}

class BitBuffer {
  private readonly bits: number[] = [];

  put(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toCodewords(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/** Mode indicator + length + payload + terminator + pad, then RS-interleaved. */
function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewordCount(version) * 8;
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, lengthBits(version));
  for (const byte of bytes) buffer.put(byte, 8);

  buffer.put(0, Math.min(4, capacityBits - buffer.length)); // terminator
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));

  const data = buffer.toCodewords();
  const padBytes = [0xec, 0x11];
  for (let i = 0; data.length < capacityBits / 8; i += 1) {
    data.push(padBytes[i % 2] as number);
  }

  // Split into blocks, compute EC per block, then interleave both halves.
  const spec = BLOCKS_M[version] as BlockSpec;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [blocks, size] of spec.groups) {
    for (let b = 0; b < blocks; b += 1) {
      const block = data.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(errorCorrection(block, spec.ec));
    }
  }

  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i] as number);
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of ecBlocks) out.push(block[i] as number);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Symbol construction
 * ------------------------------------------------------------------ */

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

interface Canvas {
  size: number;
  modules: boolean[][];
  /** Function patterns + reserved areas: never masked, never data. */
  reserved: boolean[][];
}

function blankCanvas(size: number): Canvas {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function placeFunctionPatterns(canvas: Canvas, version: number): void {
  const { size, modules, reserved } = canvas;
  const set = (r: number, c: number, dark: boolean): void => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    (modules[r] as boolean[])[c] = dark;
    (reserved[r] as boolean[])[c] = true;
  };

  // Finder patterns with their separators.
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const ring =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(r0 + r, c0 + c, ring || core);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    set(6, i, dark);
    set(i, 6, dark);
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGNMENT[version] as readonly number[];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // The one module that is always dark (§8.9).
  set(size - 8, 8, true);

  // Reserve the format-information strips; real bits are written after masking.
  for (let i = 0; i <= 8; i += 1) {
    if (!(reserved[8] as boolean[])[i]) set(8, i, false);
    if (!(reserved[i] as boolean[])[8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!(reserved[8] as boolean[])[size - 1 - i]) set(8, size - 1 - i, false);
    if (!(reserved[size - 1 - i] as boolean[])[8]) set(size - 1 - i, 8, false);
  }

  // Version information (6×3 blocks), versions 7 and up.
  if (version >= 7) {
    const bits = versionInfoBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      set(Math.floor(i / 3), (i % 3) + size - 11, dark);
      set((i % 3) + size - 11, Math.floor(i / 3), dark);
    }
  }
}

/** Two-module-wide zig-zag from the bottom-right, skipping column 6. */
function placeData(canvas: Canvas, codewords: readonly number[]): void {
  const { size, modules, reserved } = canvas;
  const totalBits = codewords.length * 8;
  let index = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if ((reserved[row] as boolean[])[col]) continue;
        const dark =
          index < totalBits &&
          (((codewords[index >>> 3] as number) >>> (7 - (index & 7))) & 1) === 1;
        (modules[row] as boolean[])[col] = dark;
        index += 1;
      }
    }
    upward = !upward;
  }
}

function applyMask(canvas: Canvas, mask: number): Canvas {
  const test = MASKS[mask] as (row: number, col: number) => boolean;
  const next: Canvas = {
    size: canvas.size,
    modules: canvas.modules.map((row) => [...row]),
    reserved: canvas.reserved,
  };
  for (let r = 0; r < canvas.size; r += 1) {
    for (let c = 0; c < canvas.size; c += 1) {
      if ((canvas.reserved[r] as boolean[])[c]) continue;
      if (test(r, c)) {
        (next.modules[r] as boolean[])[c] = !((next.modules[r] as boolean[])[c] as boolean);
      }
    }
  }
  return next;
}

/** `10111010000` and `00001011101` — a finder lookalike plus its light margin. */
const FINDER_LOOKALIKE = [0x5d0, 0x05d];

/**
 * §8.8.2 penalty rules — lower is better.
 *
 * Rules 3 and 4 are written to match the widely deployed `qrcode` npm encoder
 * bit for bit (rule 3 scores a lookalike once per light margin, so a pattern
 * light on both sides scores twice; rule 4 rounds with `ceil`). Both are
 * defensible readings of a *heuristic* — every mask produces a valid, decodable
 * symbol, so this choice cannot make a code unscannable. Matching a reference
 * exactly is worth more than arguing the reading: it lets `mfa-qr.test.tsx`
 * assert full-matrix equality with that encoder's output, which is the closest
 * thing to "we scanned it" that a unit test can offer.
 */
export function maskPenalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (r: number, c: number): boolean =>
    (modules[r] as readonly boolean[])[c] as boolean;
  let penalty = 0;

  // Rules 1 and 3, over every row and every column.
  for (let i = 0; i < size; i += 1) {
    for (const byRow of [true, false]) {
      const value = (j: number): boolean => (byRow ? at(i, j) : at(j, i));

      let run = 1;
      let window = 0;
      for (let j = 0; j < size; j += 1) {
        if (j > 0) {
          if (value(j) === value(j - 1)) {
            run += 1;
          } else {
            if (run >= 5) penalty += 3 + (run - 5);
            run = 1;
          }
        }
        window = ((window << 1) & 0x7ff) | (value(j) ? 1 : 0);
        if (j >= 10 && FINDER_LOOKALIKE.includes(window)) penalty += 40;
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  }

  // Rule 2 — 2×2 blocks of one colour.
  let dark = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (at(r, c)) dark += 1;
      if (r + 1 >= size || c + 1 >= size) continue;
      if (at(r, c) === at(r, c + 1) && at(r, c) === at(r + 1, c) && at(r, c) === at(r + 1, c + 1)) {
        penalty += 3;
      }
    }
  }

  // Rule 4 — deviation from a 50% dark ratio, in 5% steps.
  penalty += Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10) * 10;

  return penalty;
}

function writeFormatInfo(canvas: Canvas, mask: number): void {
  const { size, modules } = canvas;
  const bits = formatInfoBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    // Copy 1 — around the top-left finder.
    if (i < 6) (modules[i] as boolean[])[8] = dark;
    else if (i < 8) (modules[i + 1] as boolean[])[8] = dark;
    else (modules[size - 15 + i] as boolean[])[8] = dark;
    // Copy 2 — split across the other two finders.
    if (i < 8) (modules[8] as boolean[])[size - 1 - i] = dark;
    else if (i < 9) (modules[8] as boolean[])[15 - i] = dark;
    else (modules[8] as boolean[])[14 - i] = dark;
  }
  (modules[size - 8] as boolean[])[8] = true;
}

export interface QrSymbol {
  version: number;
  size: number;
  /** Row-major, `true` = dark. Excludes the quiet zone. */
  modules: boolean[][];
  mask: number;
}

/**
 * Encode `text` as a QR symbol, or null when it is longer than version 10 at
 * EC level M can hold (213 bytes). `forceMask` exists for the fixture tests.
 */
export function encodeQr(text: string, forceMask?: number): QrSymbol | null {
  const bytes = new TextEncoder().encode(text);
  const version = smallestVersion(bytes.length);
  if (version === null) return null;

  const codewords = buildCodewords(bytes, version);
  const base = blankCanvas(version * 4 + 17);
  placeFunctionPatterns(base, version);
  placeData(base, codewords);

  let best: Canvas | null = null;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  const candidates = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of candidates) {
    const masked = applyMask(base, mask);
    // The format bits are part of the symbol the scanner sees, so they belong
    // in the scored candidate — not bolted on after the winner is chosen.
    writeFormatInfo(masked, mask);
    const score = maskPenalty(masked.modules);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
      bestMask = mask;
    }
  }

  const winner = best as Canvas;
  return { version, size: winner.size, modules: winner.modules, mask: bestMask };
}

/**
 * The symbol as a single SVG path `d` string, one `M…h1v1h-1z` per dark module.
 * A path beats one `<rect>` per module: a version-7 symbol is ~700 dark modules,
 * and 700 DOM nodes inside a React tree is a visible cost for no gain.
 */
export function modulesToPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  for (let r = 0; r < modules.length; r += 1) {
    const row = modules[r] as readonly boolean[];
    for (let c = 0; c < row.length; c += 1) {
      if (row[c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
}
