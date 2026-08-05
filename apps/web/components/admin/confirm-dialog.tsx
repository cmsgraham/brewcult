'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import styles from './admin.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /**
   * What will happen, in plain language, naming the person: "Alice will be
   * signed out of all devices and cannot sign in until reactivated."
   */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Adds the danger treatment (border + wording), never colour alone. */
  destructive?: boolean;
  /** Blocks confirm — e.g. a required reason that is still empty. */
  confirmDisabled?: boolean;
  busy?: boolean;
  /** Inputs the action needs (a reason box, a role picker). */
  children?: ReactNode;
  /** Rendered inside the dialog so the failure lands where the eye already is. */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation for anything irreversible or user-visible.
 *
 * Accessibility contract (WCAG 2.1.2 / 2.4.3):
 *  - `role="dialog" aria-modal="true"`, labelled by its own heading and
 *    described by the consequence sentence.
 *  - Focus moves into the dialog on open and is **trapped**: Tab and Shift+Tab
 *    cycle within it, so a keyboard operator can never end up typing into the
 *    table behind a modal that is about to suspend somebody.
 *  - Escape cancels; focus returns to the control that opened it.
 *  - Cancel is the safe default and gets initial focus for destructive actions,
 *    so a stray Enter/Space does nothing.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  confirmDisabled = false,
  busy = false,
  children,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusables = useCallback((): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    // No visibility filtering: everything inside this dialog is rendered to be
    // used, and `offsetParent` is meaningless without layout (jsdom, print).
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;

    // A text input (the reason) gets focus so typing can start immediately;
    // otherwise the safe control does, never the destructive one.
    const root = dialogRef.current;
    const field = root?.querySelector<HTMLElement>('textarea, input, select');
    const fallback = root?.querySelector<HTMLElement>('[data-autofocus="true"]');
    (field ?? fallback ?? root)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const elements = focusables();
    if (elements.length === 0) return;
    const first = elements[0] as HTMLElement;
    const last = elements[elements.length - 1] as HTMLElement;
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    // The backdrop is decorative — it has no click-to-dismiss, because losing a
    // typed suspension reason to a stray click is worse than an extra Escape.
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className={destructive ? styles.consequence : undefined}>
          {consequence}
        </div>

        {children}

        {error ? (
          <p className="bc-field__error" role="alert" style={{ marginTop: '0.75rem' }}>
            {error}
          </p>
        ) : null}

        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`bc-button${destructive ? ` ${styles.destructive}` : ''}`}
            onClick={onConfirm}
            disabled={confirmDisabled || busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button
            type="button"
            className="bc-button bc-button--quiet"
            onClick={onCancel}
            disabled={busy}
            data-autofocus="true"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
