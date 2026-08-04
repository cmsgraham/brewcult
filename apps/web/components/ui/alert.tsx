import { type ReactNode } from 'react';

export interface AlertProps {
  tone?: 'error' | 'success' | 'info';
  title?: string;
  children: ReactNode;
}

/**
 * Status message. Errors use role="alert" (assertive); everything else is a
 * polite live region so a success note doesn't interrupt a screen reader
 * mid-sentence.
 */
export function Alert({ tone = 'info', title, children }: AlertProps) {
  const toneClass =
    tone === 'error' ? ' bc-alert--error' : tone === 'success' ? ' bc-alert--success' : '';

  return (
    <div
      className={`bc-alert${toneClass}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {title ? <strong>{title} </strong> : null}
      {children}
    </div>
  );
}
