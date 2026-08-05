import { encodeQr, modulesToPath } from './qr';
import styles from './security.module.css';

export interface QrCodeProps {
  /** The `otpauth://` URI. Never leaves the browser. */
  value: string;
  /**
   * Accessible name. The image itself is unreadable to a screen reader by
   * definition, so this says what it *is* and points at the manual-entry secret
   * that carries the same information in text.
   */
  label: string;
  /** Rendered size in CSS pixels. */
  size?: number;
}

/** Quiet zone, in modules. The spec requires 4 on every side. */
const QUIET_ZONE = 4;

/**
 * The enrolment QR, drawn in the browser from `value`.
 *
 * Inline SVG rather than a canvas or a data-URI PNG, for three reasons: it stays
 * crisp at any zoom (people photograph these from another device, sometimes
 * zoomed right in), it needs no `useEffect`/ref dance so it renders identically
 * on the server and in jsdom, and `role="img"` + `aria-label` gives it a real
 * accessible name without an `<img alt>` wrapper.
 *
 * Colours are hard-coded black-on-white rather than the brand tokens. QR
 * decoding depends on module contrast, and cream-on-espresso in dark mode would
 * invert the symbol — many scanners cope, plenty do not. A white card in an
 * otherwise dark page is the correct call here; it is a machine-readable
 * artefact, not a design element.
 *
 * Returns null when the payload is too long to encode (see `qr.ts`). Callers
 * must keep the manual-entry path visible in that case — which this flow does
 * unconditionally, because scanning is not available to everyone anyway.
 */
export function QrCode({ value, label, size = 232 }: QrCodeProps) {
  const symbol = encodeQr(value);
  if (!symbol) return null;

  const span = symbol.size + QUIET_ZONE * 2;

  return (
    <svg
      className={styles.qr}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      data-testid="mfa-qr"
      data-qr-version={symbol.version}
    >
      <rect width={span} height={span} fill="#ffffff" />
      <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
        <path d={modulesToPath(symbol.modules)} fill="#000000" />
      </g>
    </svg>
  );
}
