'use client';

import { useEffect, useRef, useState } from 'react';

export interface CopyButtonProps {
  /** The text to place on the clipboard. Never logged, never stored. */
  value: string;
  /** Button label in the resting state. */
  label: string;
  /** Confirmation shown for a moment after a successful copy. */
  doneLabel?: string;
  className?: string;
}

/**
 * Copy-to-clipboard with an honest failure mode.
 *
 * The Clipboard API is unavailable over plain HTTP, in some embedded browsers,
 * and whenever permission is refused. Silently doing nothing there is the worst
 * outcome on a screen where the thing being copied is a recovery code, so a
 * failure says so and points at the text, which is on screen and selectable.
 *
 * The result is announced in a polite live region: a purely visual "Copied"
 * tells a screen-reader user nothing.
 */
export function CopyButton({ value, label, doneLabel = 'Copied', className }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('clipboard unavailable');
      await clipboard.writeText(value);
      setState('done');
    } catch {
      // Deliberately swallowed: the rejection reason is never actionable, and
      // the value must not travel into an error path.
      setState('failed');
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 4000);
  }

  return (
    <span className="bc-actions" style={{ marginTop: 0, gap: '0.5rem', alignItems: 'center' }}>
      <button
        type="button"
        className={className ?? 'bc-button bc-button--quiet'}
        onClick={() => void copy()}
      >
        {state === 'done' ? doneLabel : label}
      </button>
      <span aria-live="polite" className="bc-muted" style={{ fontSize: '0.85rem' }}>
        {state === 'done' ? `${doneLabel} to your clipboard.` : null}
        {state === 'failed'
          ? 'Your browser would not let us reach the clipboard — select the text above and copy it by hand.'
          : null}
      </span>
    </span>
  );
}
