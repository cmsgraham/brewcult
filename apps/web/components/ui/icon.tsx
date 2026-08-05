/**
 * The icon set.
 *
 * These replaced emoji (☕ ✅ 🔒 😖 😝 💧) that had been standing in for
 * iconography across the logger, the avatars and the tweak card. Emoji render
 * as somebody else's artwork — a different picture on every platform, in a
 * colour palette we do not control, at a weight that never matches the type
 * around it. That reads as unfinished, and on iOS it reads as *Apple's* app.
 *
 * Rules for anything added here:
 *   - one 24x24 grid, 1.6 stroke, round caps and joins, no fills
 *   - `currentColor` only, so an icon inherits type colour and dark mode for
 *     free (the sole exception in the codebase is the Google "G", whose brand
 *     colours Google mandates)
 *   - decorative by default: `aria-hidden`, with the meaning carried by real
 *     text next to it. An icon is never the only label for a control.
 */

export interface IconProps {
  /** Pixel size of the square. Defaults to 1em so it scales with type. */
  size?: number | string;
  className?: string;
}

function Svg({
  size = '1em',
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...(className ? { className } : {})}
    >
      {children}
    </svg>
  );
}

/** Coffee bean — the house mark for "a coffee", used where a photo is absent. */
export function BeanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="12" rx="5.4" ry="8.8" transform="rotate(-45 12 12)" />
      <path d="M7.6 16.4c2.1-2.1 1.4-3.5 2.2-4.9.8-1.4 2.3-1 4.6-3.9" />
    </Svg>
  );
}

/** Confirmation. Pairs with words like "Logged" — never used alone. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.8l4.7 4.7L19.5 7.2" />
    </Svg>
  );
}

/** A locked/pinned value in the tweak card. */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" />
    </Svg>
  );
}
