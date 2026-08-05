import { type ReactNode } from 'react';
import {
  ROLE_LABEL,
  STATUS_LABEL,
  isStaffRole,
  type AdminRole,
  type AdminUserStatus,
} from '../../lib/admin-client';
import styles from './admin.module.css';

/**
 * Console badges.
 *
 * Every badge carries its meaning in **words**; the border treatment is a second
 * channel, never the only one (WCAG 1.4.1). "Suspended" reads as suspended in a
 * screen reader, in greyscale and at 200% zoom.
 */
export function Badge({
  children,
  tone = 'quiet',
  title,
}: {
  children: ReactNode;
  tone?: 'quiet' | 'strong' | 'warn';
  title?: string;
}) {
  const toneClass =
    tone === 'strong' ? styles.badgeStrong : tone === 'warn' ? styles.badgeWarn : styles.badgeQuiet;
  return (
    <span className={`${styles.badge} ${toneClass}`} {...(title ? { title } : {})}>
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: AdminRole }) {
  return (
    <Badge tone={isStaffRole(role) ? 'strong' : 'quiet'}>
      {ROLE_LABEL[role]}
      {isStaffRole(role) ? <span className="bc-visually-hidden"> (staff role)</span> : null}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: AdminUserStatus }) {
  return (
    <Badge tone={status === 'active' ? 'quiet' : 'warn'}>{STATUS_LABEL[status]}</Badge>
  );
}

/** On/off facts (MFA, email verified) — spelled out, not a green tick. */
export function OnOffBadge({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <Badge tone={on ? 'quiet' : 'warn'}>{on ? onLabel : offLabel}</Badge>;
}
