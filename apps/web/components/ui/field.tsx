import { type InputHTMLAttributes, type ReactNode } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

/**
 * Labelled text input. The label is always a real <label for>, hints and errors
 * are wired through aria-describedby, and an invalid field sets aria-invalid —
 * so the error is announced, not merely coloured (WCAG 1.4.1 / 3.3.1).
 */
export function Field({ id, label, hint, error, ...inputProps }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="bc-field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="bc-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <input
        {...inputProps}
        id={id}
        className="bc-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error ? (
        <span className="bc-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
