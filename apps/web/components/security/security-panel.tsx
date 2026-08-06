'use client';

import { LocaleLink as Link } from '../../components/locale-link';
import { useLocale, useTranslate } from '../locale-provider';
import { localePath, type Locale } from '../../lib/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isStaffRole, roleLabel, type AdminRole } from '../../lib/admin-client';
import {
  describeMfaError,
  signOut,
  startEnrolment,
  type MfaEnrolment,
} from '../../lib/mfa-client';
import { Alert } from '../ui/alert';
import { EnrolmentStep } from './enrolment-step';
import { ManageMfa } from './manage-mfa';
import { RecoveryCodesStep } from './recovery-codes-step';
import styles from './security.module.css';

export interface SecurityPanelProps {
  handle: string;
  role: AdminRole;
  /** TOTP is enrolled on the account (`mfa_enabled` from `/me`). */
  enrolled: boolean;
  /** This session cleared an MFA challenge (`mfa` from `/me`). */
  sessionVerified: boolean;
}

type View =
  | { kind: 'overview' }
  | { kind: 'enrol'; enrolment: MfaEnrolment }
  | { kind: 'codes'; codes: string[]; origin: 'enrolled' | 'regenerated' };

/**
 * Sign in again, and come back to this page — in the language it was read in.
 *
 * It was a module constant, which meant both the encoded `next` and `/login`
 * itself were pinned to English. `LocaleLink` fixed half of it for the link and
 * nothing for `router.push`, which is the subtler failure: the redirect works,
 * so nobody files a bug, they just quietly end up in the other language.
 */
function signInAgain(locale: Locale): string {
  const back = localePath('/profile/security', locale);
  return `${localePath('/login', locale)}?next=${encodeURIComponent(back)}`;
}

/**
 * The interactive half of /profile/security.
 *
 * ── The three states, and why the third one exists ───────────────────────────
 *   off                      → explain, offer enrolment
 *   on, session verified     → manage (new codes / turn off)
 *   on, session NOT verified → say plainly that a fresh sign-in is the fix
 *
 * That third state is the one the operator console's interstitial links here
 * for. `isStaff()` in the API tests `actor.mfa` — session standing — not
 * `mfa_enabled`. An access token minted before enrolment carries `mfa: false`
 * forever, so somebody who enrols and stays put sees the console keep refusing
 * them with no explanation. Without this case the setup page would send them
 * back to a screen that sends them here: a loop, not a fix.
 *
 * ── What never happens here ──────────────────────────────────────────────────
 * The secret and the recovery codes exist only in the `View` union above, i.e.
 * component state. They are not persisted, not put in the URL, not logged, and
 * not passed to anything that reports errors — `describeMfaError` redacts
 * anything code-shaped out of the one string that reaches the UI.
 */
export function SecurityPanel({ handle, role, enrolled, sessionVerified }: SecurityPanelProps) {
  const { locale } = useLocale();
  const t = useTranslate();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'overview' });
  const [isOn, setIsOn] = useState(enrolled);
  const [needsFreshSignIn, setNeedsFreshSignIn] = useState(enrolled && !sessionVerified);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  const returnedToOverview = useRef(false);

  // Coming *back* to the overview from a step should land focus on it; the
  // first render should not steal focus from the top of the page.
  useEffect(() => {
    if (view.kind !== 'overview') {
      returnedToOverview.current = true;
      return;
    }
    if (returnedToOverview.current) overviewHeading.current?.focus();
  }, [view]);

  const staff = isStaffRole(role);

  async function beginEnrolment(): Promise<void> {
    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      setView({ kind: 'enrol', enrolment: await startEnrolment() });
    } catch (failure) {
      setError(describeMfaError(failure));
    } finally {
      setStarting(false);
    }
  }

  async function endSession(): Promise<void> {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch {
      // Even a failed logout should not strand them here — the sign-in page
      // will sort out whatever session is or is not still valid.
    }
    router.push(signInAgain(locale));
    router.refresh();
  }

  if (view.kind === 'enrol') {
    return (
      <EnrolmentStep
        enrolment={view.enrolment}
        onConfirmed={(codes) => setView({ kind: 'codes', codes, origin: 'enrolled' })}
        onCancel={() => {
          setView({ kind: 'overview' });
          setNotice(null);
        }}
      />
    );
  }

  if (view.kind === 'codes') {
    return (
      <RecoveryCodesStep
        codes={view.codes}
        handle={handle}
        origin={view.origin}
        onAcknowledged={() => {
          if (view.origin === 'enrolled') {
            setIsOn(true);
            // The access token in hand was minted before enrolment, so it still
            // says mfa=false. Saying "you're all set" here would be a lie the
            // operator console would immediately contradict.
            setNeedsFreshSignIn(true);
            setNotice(t('security.mfa.noticeOn'));
          } else {
            setNotice(t('security.mfa.noticeCodesReplaced'));
          }
          setView({ kind: 'overview' });
          router.refresh();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="mfa-status-heading" className="bc-stack">
      <h2
        className={styles.stepHeading}
        id="mfa-status-heading"
        ref={overviewHeading}
        tabIndex={-1}
      >
        {t('security.mfa.panelHeading')}
      </h2>

      <div className={styles.statusRow}>
        <span
          className={`${styles.pill} ${isOn ? styles.pillOn : ''}`}
          data-testid="mfa-status-pill"
        >
          {isOn ? t('security.mfa.on') : t('security.mfa.off')}
        </span>
        {isOn && needsFreshSignIn ? (
          <span className={`${styles.pill} ${styles.pillAttention}`}>
            {t('security.mfa.sessionDidNotUseIt')}
          </span>
        ) : null}
        <span className="bc-muted" style={{ fontSize: '0.9rem' }}>
          @{handle} · {roleLabel(role, t)}
        </span>
      </div>

      {/* Every state change on this page is announced, not just coloured. */}
      <div aria-live="polite">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {isOn && needsFreshSignIn ? (
        <div className="bc-panel bc-stack">
          <h3 style={{ marginTop: 0 }}>{t('security.mfa.freshSignInHeading')}</h3>
          <p>{t('security.mfa.freshSignInOne')}</p>
          <p style={{ marginBottom: 0 }}>{t('security.mfa.freshSignInTwo')}</p>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className="bc-button"
              onClick={() => void endSession()}
              disabled={signingOut}
            >
              {signingOut ? t('security.mfa.signingOut') : t('security.mfa.signOutAndBack')}
            </button>
            {/* Already prefixed; LocaleLink's own prefixing is idempotent. */}
            <Link className="bc-button bc-button--quiet" href={signInAgain(locale)}>
              {t('security.mfa.goToSignIn')}
            </Link>
          </div>
        </div>
      ) : null}

      {isOn ? (
        <>
          {!needsFreshSignIn ? (
            <p className="bc-muted">{t('security.mfa.verifiedNote')}</p>
          ) : null}
          <ManageMfa
            staffRole={staff}
            onRegenerated={(codes) => setView({ kind: 'codes', codes, origin: 'regenerated' })}
            onDisabled={() => {
              setIsOn(false);
              setNeedsFreshSignIn(false);
              setNotice(t('security.mfa.noticeOff'));
              router.refresh();
            }}
          />
        </>
      ) : (
        <div className="bc-stack">
          <p>{t('security.mfa.offPitch')}</p>
          {staff ? (
            <Alert
              tone="info"
              title={t('security.mfa.staffAlertTitle', { role: roleLabel(role, t) })}
            >
              {t('security.mfa.staffAlertBody')}
            </Alert>
          ) : null}
          <div className={styles.inlineActions}>
            <button
              type="button"
              className="bc-button"
              onClick={() => void beginEnrolment()}
              disabled={starting}
            >
              {starting ? t('security.mfa.gettingReady') : t('security.mfa.turnOn')}
            </button>
            <Link className="bc-button bc-button--quiet" href="/profile">
              {t('security.mfa.backToProfile')}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
