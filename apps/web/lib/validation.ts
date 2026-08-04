/**
 * Client-side form validation.
 *
 * The server is the authority (EF §3.3); this exists so people get an answer
 * before a round trip. Tone rules from second_draft §9.7/§10.2 apply to error
 * copy too: say what is needed, never imply the person is doing it wrong.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Deliberately permissive: "has a name, an @, and a dotted domain". */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercase letters, digits, underscore; 3–30 chars. */
const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export const MIN_PASSWORD_LENGTH = 12;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'We need your email address to sign you in.';
  if (!EMAIL_RE.test(email)) return 'That does not look like an email address yet.';
  return undefined;
}

export function validateRequired(value: string, label: string): string | undefined {
  if (!value.trim()) return `${label} is required.`;
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Choose a password so we can keep your account yours.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `A little longer, please — at least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`;
  }
  return undefined;
}

export function validateHandle(value: string): string | undefined {
  const handle = value.trim();
  if (!handle) return 'Pick a handle — this is how people will find you.';
  if (!HANDLE_RE.test(handle)) {
    return 'Handles use 3–30 lowercase letters, numbers or underscores.';
  }
  return undefined;
}

/** True when no field carries a message. */
export function isValid<K extends string>(errors: FieldErrors<K>): boolean {
  return Object.values(errors).every((message) => !message);
}
