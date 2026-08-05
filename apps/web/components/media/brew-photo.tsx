'use client';

import { ImageUpload } from './image-upload';
import type { BrewPhotoController } from './use-brew-photo';
import styles from './media.module.css';

/**
 * The photo affordance inside the brew logger.
 *
 * It is deliberately *quiet*. The 15-second bar (brew_logger_ux §1) is spent on
 * grind, dose, water, temperature and one tap of taste; a photo is a sharing
 * affordance (§4), so on the tweak card it is a closed `<details>` that costs a
 * glance and nothing else. Opening it is one tap, and picking a photo starts an
 * upload that the "Log brew" button never waits for.
 *
 * After the log it renders open, because at that point there is nothing left to
 * hurry — "log first, attach after" is the path we actually want people on.
 */

export interface BrewPhotoFieldProps {
  controller: BrewPhotoController;
  /** `collapsed` on the tweak card, `inline` after the log. */
  variant?: 'collapsed' | 'inline';
  /** Bound after logging — changes the copy from "will attach" to "attached". */
  logged?: boolean;
}

export function BrewPhotoField({
  controller,
  variant = 'collapsed',
  logged = false,
}: BrewPhotoFieldProps) {
  const uploader = (
    <ImageUpload
      label={logged ? 'Add a photo of this brew' : 'Photo of this brew'}
      controller={controller}
      capture
      compact
      ctaText="Take or choose a photo"
    />
  );

  if (variant === 'inline') {
    return <div className={styles.brewPhoto}>{uploader}</div>;
  }

  return (
    /* `bc-logger__more` is the logger's own disclosure styling (44px summary
       target); the media styles only dress the contents. */
    <details className="bc-logger__more" open={controller.hasPhoto}>
      <summary>Add a photo (optional)</summary>
      <div className={styles.brewPhoto}>
        <p className={styles.brewPhotoNote}>
          It never holds the log up — log the brew and the photo catches up.
        </p>
        {uploader}
      </div>
    </details>
  );
}
