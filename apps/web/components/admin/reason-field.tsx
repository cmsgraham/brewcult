'use client';

import styles from './admin.module.css';

/**
 * The reason box that goes on every staff decision.
 *
 * Required reasons are enforced twice: the field is `aria-required`, and the
 * dialog's confirm button stays disabled until it has content — so the rule is
 * visible to a screen reader *and* impossible to skip with a keyboard. The
 * message under it explains the consequence rather than scolding: this text
 * ends up on an audit record, and may be quoted back to the person it is about.
 */
export function ReasonField({
  id,
  label,
  hint,
  value,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const given = value.trim().length > 0;
  return (
    <div className="bc-field">
      <label htmlFor={id}>
        {label}
        {required ? '' : ' (optional)'}
      </label>
      <span className="bc-field__hint" id={`${id}-hint`}>
        {hint}
      </span>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        aria-required={required}
        aria-invalid={required && !given}
      />
      {required && !given ? (
        <span className="bc-field__error">A reason is required before this can go ahead.</span>
      ) : null}
    </div>
  );
}
