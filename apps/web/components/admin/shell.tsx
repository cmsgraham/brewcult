import Link from 'next/link';
import { type ReactNode } from 'react';
import { MFA_SETUP_PATH, type AdminActor } from '../../lib/admin-client';
import styles from './admin.module.css';

export type ConsoleSection = 'overview' | 'users' | 'seller-applications' | 'reports' | 'audit';

const SECTIONS: { key: ConsoleSection; label: string; href: string }[] = [
  { key: 'overview', label: 'Overview', href: '/admin' },
  { key: 'users', label: 'People', href: '/admin/users' },
  { key: 'seller-applications', label: 'Seller applications', href: '/admin/seller-applications' },
  { key: 'reports', label: 'Reports', href: '/admin/reports' },
  { key: 'audit', label: 'Audit log', href: '/admin/audit' },
];

/**
 * Chrome for every console screen. Server component — no client JS, and it is
 * only ever rendered *after* the gate says "ready", so the sub-navigation never
 * appears to somebody who should not know the console exists.
 */
export function AdminShell({
  current,
  title,
  lede,
  actor,
  children,
}: {
  current: ConsoleSection;
  title: string;
  lede?: ReactNode;
  actor: AdminActor;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <p className={styles.eyebrow}>Operator console</p>
      <nav aria-label="Operator console">
        <ul className={styles.subnav}>
          {SECTIONS.map((section) => (
            <li key={section.key}>
              <Link
                href={section.href}
                {...(section.key === current ? { 'aria-current': 'page' as const } : {})}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <h1>{title}</h1>
      {lede ? <p className="bc-lede">{lede}</p> : null}

      {children}

      <p className={styles.pagerNote} style={{ marginTop: '2.5rem' }}>
        Signed in as @{actor.handle} · every action you take here is written to the
        append-only audit log (EF §3.7), with your name on it. Two-factor is on for this
        session — <Link href={MFA_SETUP_PATH}>manage it</Link>.
      </p>
    </div>
  );
}
