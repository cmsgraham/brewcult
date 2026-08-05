import { initialsFrom, readImageUrl } from '../../lib/media-client';
import styles from './media.module.css';

/**
 * A catalog entity's picture — a bag of coffee, a grinder, a roaster's mark.
 *
 * Two rules, both about not breaking what already works:
 *
 *  1. **The image is read tolerantly.** `readImageUrl` accepts every spelling
 *     the API might land on (`image_url`, `imageUrl`, `image`, a nested media
 *     object, an array of them) and answers null for anything else. A payload
 *     shape change therefore degrades to the text-only card that ships today,
 *     never to a crash inside a server component.
 *  2. **No image renders nothing at all, by default.** Today no catalog entity
 *     has a picture, and stamping an empty grey rectangle on every card would
 *     make a working catalogue look broken. `fallback="monogram"` is available
 *     for grids that need uniform rows once artwork exists — that is a call for
 *     the surface, not for this component.
 *
 * Plain `<img>` rather than `next/image`: uploaded media is served from a
 * separate origin and `next/image` refuses hosts absent from
 * `next.config.mjs#images.remotePatterns` (see the lane report).
 */

export interface EntityImageProps {
  /** The entity payload; the URL is read out of it tolerantly. */
  entity?: unknown;
  /** …or pass the URL directly when you already have one. */
  src?: string | null;
  /** Names the picture. Cards pass the entity name; it is never decorative. */
  alt: string;
  /** Prefer the small derivative — right for cards and rails. */
  prefer?: 'full' | 'thumbnail';
  shape?: 'landscape' | 'square';
  /** What to draw when there is no picture. Default: nothing. */
  fallback?: 'none' | 'monogram';
  /** Seed for the monogram letters; defaults to `alt`. */
  monogramFrom?: string | null;
  className?: string;
}

export function EntityImage({
  entity,
  src,
  alt,
  prefer = 'thumbnail',
  shape = 'landscape',
  fallback = 'none',
  monogramFrom,
  className,
}: EntityImageProps) {
  const url = src ?? readImageUrl(entity, { prefer });
  const shapeClass = shape === 'square' ? ` ${styles.entityImageSquare}` : '';

  if (url === null) {
    if (fallback === 'none') return null;
    const initials = initialsFrom(monogramFrom ?? alt);
    return (
      <span
        className={`${styles.entityMonogram}${shapeClass}${className ? ` ${className}` : ''}`}
        role="img"
        aria-label={`${alt} — no photo yet`}
        data-testid="entity-monogram"
      >
        <span aria-hidden="true">{initials === '' ? '☕' : initials}</span>
      </span>
    );
  }

  return (
    /* Plain <img> on purpose — see the header note. */
    <img
      className={`${styles.entityImage}${shapeClass}${className ? ` ${className}` : ''}`}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-testid="entity-image"
    />
  );
}
