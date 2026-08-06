/**
 * Client-side form validation.
 *
 * The server is the authority (EF §3.3); this exists so people get an answer
 * before a round trip. Tone rules from second_draft §9.7/§10.2 apply to error
 * copy too: say what is needed, never imply the person is doing it wrong.
 *
 * ── WHY EVERY VALIDATOR TAKES A TRANSLATOR ──────────────────────────────────
 * These messages are read by a person, in the language they are reading the
 * page in, so they belong in the catalogue like all the other copy. Passing `t`
 * in — rather than importing a catalogue here — keeps this module free of any
 * opinion about where the locale comes from: a client form hands it `useTranslate()`,
 * and a server caller could hand it `translator(locale)`.
 */
import type { Translator } from './i18n';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Deliberately permissive: "has a name, an @, and a dotted domain". */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercase letters, digits, underscore; 3–30 chars. */
const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export const MIN_PASSWORD_LENGTH = 12;

export function validateEmail(t: Translator, value: string): string | undefined {
  const email = value.trim();
  if (!email) return t('validation.emailMissing');
  if (!EMAIL_RE.test(email)) return t('validation.emailMalformed');
  return undefined;
}

/**
 * `label` is a translated noun, not a field name — and the two are not always
 * the same word. English slots a capitalised "Password" into "{label} is
 * required."; Spanish reads better as "Necesitamos tu contraseña.", so its
 * label is "tu contraseña". Hence a catalogue key per label rather than reusing
 * the one on the input, which has to stay a bare noun.
 */
export function validateRequired(
  t: Translator,
  value: string,
  label: string,
): string | undefined {
  if (!value.trim()) return t('validation.required', { label });
  return undefined;
}

export function validatePassword(t: Translator, value: string): string | undefined {
  if (!value) return t('validation.passwordMissing');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return t('validation.passwordShort', { min: MIN_PASSWORD_LENGTH });
  }
  return undefined;
}

export function validateHandle(t: Translator, value: string): string | undefined {
  const handle = value.trim();
  if (!handle) return t('validation.handleMissing');
  if (!HANDLE_RE.test(handle)) return t('validation.handleMalformed');
  return undefined;
}

/** True when no field carries a message. */
export function isValid<K extends string>(errors: FieldErrors<K>): boolean {
  return Object.values(errors).every((message) => !message);
}
