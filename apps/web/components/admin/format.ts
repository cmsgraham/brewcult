/**
 * Console formatting helpers.
 *
 * Timestamps render as UTC `YYYY-MM-DD HH:MM` rather than a localised string:
 * two operators comparing notes on an incident need the same string, and an
 * audit trail read in two time zones is an audit trail read wrong. Anything
 * unparseable degrades to a word — a broken date must never take out the row.
 */
export function formatWhen(value: string | null | undefined, fallback = 'Never'): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Coarsen an IP for display (EF §4.1 — P2, "minimal display"). Enough to see
 * "same network" or "somewhere new"; not a home address on a screen share.
 */
export function coarseIp(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const trimmed = value.trim();
  if (trimmed.includes(':')) {
    const groups = trimmed.split(':').filter(Boolean).slice(0, 3);
    return groups.length > 0 ? `${groups.join(':')}:…` : 'Not recorded';
  }
  const octets = trimmed.split('.');
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.x.x`;
  return 'Not recorded';
}

/** Truncate a user agent to something that fits a cell without a tooltip. */
export function shortAgent(value: string | null | undefined): string {
  if (!value) return 'Unknown device';
  return value.length > 48 ? `${value.slice(0, 47)}…` : value;
}
