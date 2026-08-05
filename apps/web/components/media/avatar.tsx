import { initialsFrom, readAvatarUrl } from '../../lib/media-client';
import styles from './media.module.css';
import { BeanIcon } from '../ui/icon';

/**
 * A person's picture, or an honest stand-in for one.
 *
 * ── Why a plain <img> and not next/image ─────────────────────────────────────
 * Uploaded media is served from a *separate origin*, and `next/image` throws at
 * request time for any host that is not listed in `next.config.mjs`
 * `images.remotePatterns`. That file belongs to another lane, so this component
 * takes the origin as data (a URL prop) rather than as configuration, and uses a
 * plain `<img>` with `loading="lazy"` / `decoding="async"`.
 *
 * Switching to `next/image` later is a two-line change here *once the
 * remotePatterns entry exists* — see the lane report. Doing it before that would
 * turn every avatar into a 500.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The fallback is initials on the brand palette (espresso ink on the cream
 * surface, reversed in dark mode). It is deliberately not a generic silhouette:
 * a person with no photo should look like a member, not like a missing record.
 */

export interface AvatarProps {
  /** Direct URL, when the caller already has one. */
  src?: string | null;
  /** …or the whole user payload, read tolerantly for whichever key it uses. */
  user?: unknown;
  displayName?: string | null;
  handle?: string | null;
  /** Rendered size in px. 40 is the nav/list size; 96 the profile size. */
  size?: number;
  /** Overrides the derived alt text. Pass "" for a purely decorative avatar. */
  alt?: string;
  className?: string;
}

export function Avatar({
  src,
  user,
  displayName,
  handle,
  size = 48,
  alt,
  className,
}: AvatarProps) {
  const url = src ?? readAvatarUrl(user);
  const name = displayName ?? handle ?? null;
  const initials = initialsFrom(displayName, handle);

  // An avatar next to the name it belongs to is decoration; an avatar on its
  // own needs to say whose it is. Callers pass alt="" for the former.
  const altText = alt ?? (name ? `${name}'s profile photo` : 'Profile photo');

  const boxStyle = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${Math.max(11, Math.round(size * 0.38))}px`,
  };

  return (
    <span
      className={className ? `${styles.avatar} ${className}` : styles.avatar}
      style={boxStyle}
      data-testid="avatar"
    >
      {url ? (
        /* Plain <img> on purpose — see the header note on next/image. */
        <img
          className={styles.avatarImage}
          src={url}
          alt={altText}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
        />
      ) : initials !== '' ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <BeanIcon />
      )}
      {url ? null : <span className="bc-visually-hidden">{altText} — no photo yet</span>}
    </span>
  );
}
