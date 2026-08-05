'use client';

import type { BrewPrefill, TasteVerdict } from '@brewcult/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FetchLike } from '../../lib/api';
import {
  buildPayback,
  createLogTimer,
  defaultPrefill,
  draftFromPrefill,
  emitTimeToLog,
  setCoffee,
  setNumericField,
  sessionFromDraft,
  sourceForDraft,
  summarizeDraft,
  grindNumber,
  type BrewDraft,
  type BrewField,
  type BrewSuggestion,
  type CoffeeRef,
  type LocalBrewRecord,
  type PaybackLine,
  type ProvisionalCoffee,
  type TimeToLogMeasurement,
} from '../../lib/brewing-client';
import { createBrewEngine, type BrewEngine } from '../../lib/offline/engine';
import type { QueueState } from '../../lib/offline/queue';
import { registerServiceWorker } from '../../lib/offline/service-worker';
import { uuidv7 } from '../../lib/uuid';
import { BrewPhotoField } from '../media/brew-photo';
import { useBrewPhoto } from '../media/use-brew-photo';
import { BagSwitcher } from './bag-switcher';
import { CoffeePicker } from './coffee-picker';
import { PostLogNote } from './post-log-note';
import { RepeatCard } from './repeat-card';
import { TweakCard } from './tweak-card';

export interface BrewLoggerProps {
  /** Injected in tests; otherwise the logger owns its engine. */
  engine?: BrewEngine;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Receives every time-to-log measurement (§7). */
  onMeasure?: (measurement: TimeToLogMeasurement) => void;
  /** Defaults to production-only; tests and the page can force it. */
  registerServiceWorkerInBrowser?: boolean;
}

type Mode = 'repeat' | 'tweak' | 'picker';

interface LoggedState {
  record: LocalBrewRecord;
  payback: PaybackLine;
  path: 'A' | 'B' | 'C';
}

const EMPTY_SYNC: QueueState = {
  pending: 0,
  syncing: false,
  lastError: null,
  lastSyncedAt: null,
  dropped: 0,
};

/**
 * The brew logger — one screen, three exits (brew_logger_ux §3).
 *
 *   Path A  repeat card   → one tap, ~2s, `source: repeat`
 *   Path B  tweak card    → prefilled steppers, ~8–12s, `source: tweak`
 *   Path C  coffee picker → search + quick-add, once per bag, `source: new`
 *
 * An optional photo rides alongside (§4) and is the one thing here that is
 * explicitly *not* part of the log: it uploads in the background and attaches
 * itself to a session that is already persisted. Path A never shows it.
 *
 * Every log is written to IndexedDB *first* and rendered as logged immediately;
 * the idempotent PUT happens behind the user's back (§5, EF §2.2). The clock
 * that decides whether the 15-second bar is met starts when this component
 * mounts and stops when the device has the session — measured, not estimated.
 */
export function BrewLogger({
  engine: providedEngine,
  fetchImpl,
  now,
  onMeasure,
  registerServiceWorkerInBrowser,
}: BrewLoggerProps) {
  const nowFn = useRef<() => number>(now ?? (() => Date.now()));
  nowFn.current = now ?? (() => Date.now());

  const [engine] = useState<BrewEngine>(
    () =>
      providedEngine ??
      createBrewEngine({
        ...(fetchImpl ? { fetchImpl } : {}),
        now: () => nowFn.current(),
      }),
  );

  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [mode, setMode] = useState<Mode>('repeat');
  const [draft, setDraft] = useState<BrewDraft | null>(null);
  const [basis, setBasis] = useState<BrewPrefill['basis']>('defaults');
  const [recent, setRecent] = useState<CoffeeRef[]>([]);
  const [history, setHistory] = useState<LocalBrewRecord[]>([]);
  const [logged, setLogged] = useState<LoggedState | null>(null);
  const [sync, setSync] = useState<QueueState>(EMPTY_SYNC);
  const [suggestion, setSuggestion] = useState<BrewSuggestion | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * The optional brew photo (§4). It owns its own upload entirely; the only
   * thing the logging path below does with it is hand over the session id
   * *after* the brew is already on the device, and that call is synchronous and
   * cannot throw. A photo can therefore never slow, block or fail a log.
   */
  const photo = useBrewPhoto({ engine, ...(fetchImpl ? { fetchImpl } : {}) });
  const photoRef = useRef(photo);
  photoRef.current = photo;

  const timer = useRef(createLogTimer(() => nowFn.current()));
  const draftRef = useRef<BrewDraft | null>(null);
  const historyRef = useRef<LocalBrewRecord[]>([]);
  const loggingRef = useRef(false);
  const touchedRef = useRef(false);

  draftRef.current = draft;
  historyRef.current = history;

  const coffeeId = draft?.coffee?.id ?? null;

  /* --- hydrate from the device, then reconcile with the network ---- */

  useEffect(() => {
    let alive = true;

    void (async () => {
      const bag = (await engine.activeBag()) ?? null;
      const id = bag?.id ?? null;
      const cached = (await engine.cachedPrefill(id)) ?? defaultPrefill();
      const saved = await engine.loadDraft(id);
      const [recentCoffees, localSessions, pendingSuggestion] = await Promise.all([
        engine.recentCoffees(),
        engine.localSessions(id),
        engine.pendingSuggestion(id),
      ]);
      if (!alive) return;

      setBasis(cached.basis);
      setRecent(recentCoffees);
      setHistory(localSessions);
      setSuggestion(pendingSuggestion ?? null);

      // An unfinished draft is the interruption case (§5): a phone call, a
      // reload, a backgrounded tab. Resume it exactly where it was.
      if (saved && (saved.changed.length > 0 || saved.timer_started_at !== null)) {
        setDraft(saved);
        setMode('tweak');
        setResumed(true);
        touchedRef.current = true;
      } else {
        setDraft(draftFromPrefill(cached, { coffee: bag, now: nowFn.current() }));
      }
      setStatus('ready');
      engine.start();

      const fresh = await engine.refreshPrefill(id);
      if (!alive) return;
      // Never clobber something the user is mid-way through editing.
      if (fresh && !touchedRef.current) {
        setDraft(draftFromPrefill(fresh, { coffee: bag, now: nowFn.current() }));
        setBasis(fresh.basis);
      }
      const hydrated = await engine.hydrateSessions(id);
      if (alive && hydrated.length > 0) setHistory(hydrated);
    })();

    return () => {
      alive = false;
      engine.stop();
    };
  }, [engine]);

  useEffect(() => engine.onSyncStateChange(setSync), [engine]);

  useEffect(() => {
    void registerServiceWorker(
      registerServiceWorkerInBrowser === undefined
        ? {}
        : { enabled: registerServiceWorkerInBrowser },
    );
  }, [registerServiceWorkerInBrowser]);

  /* --- the draft is persisted on every change, not on submit ------- */

  useEffect(() => {
    if (status !== 'ready' || !draft) return;
    void engine.saveDraft(draft.coffee?.id ?? null, draft);
  }, [engine, status, draft]);

  const note = useCallback(() => {
    touchedRef.current = true;
    timer.current.noteInteraction();
  }, []);

  /* --- logging ----------------------------------------------------- */

  const logBrew = useCallback(
    async (path: 'A' | 'B' | 'C') => {
      const current = draftRef.current;
      // A double tap on the primary button must not become two brews.
      if (!current || loggingRef.current) return;
      loggingRef.current = true;
      setBusy(true);

      try {
        const at = nowFn.current();
        const source = sourceForDraft(current);
        // A log that carries a coffee change is Path C however it was opened.
        const resolvedPath = source === 'new' ? 'C' : path;
        const id = uuidv7(at);
        const session = sessionFromDraft(current, { id, source, now: at });
        const record: LocalBrewRecord = {
          session,
          coffee_label: current.coffee?.label ?? null,
          brewer_label: current.brewer_label,
          synced: false,
        };

        // Persisted locally === logged. Everything after this is bookkeeping.
        await engine.logBrew(record);

        // The brew is safe. Only *now* does the photo get told which session it
        // belongs to — synchronous, non-throwing, never awaited. If the upload
        // is still in flight it amends the session when it lands; if it failed
        // or there is no signal it parks itself for later. Either way this line
        // cannot add a millisecond to the measurement below.
        photoRef.current.attachTo(session);

        emitTimeToLog(
          timer.current.measure({
            path: resolvedPath,
            source,
            session_id: id,
            offline: typeof navigator === 'undefined' ? false : navigator.onLine === false,
          }),
          onMeasure,
        );

        const prior = historyRef.current;
        const payback = buildPayback({
          brewCountForBag: prior.length + 1,
          verdict: current.verdict,
          priorVerdicts: prior.map((entry) => entry.session.taste?.verdict),
          changed: current.changed,
        });

        setHistory([...prior, record]);
        setLogged({ record, payback, path: resolvedPath });
        setMode('repeat');
        setResumed(false);
        touchedRef.current = false;
        await engine.clearDraft(current.coffee?.id ?? null);

        // What we just brewed is the new "last time".
        setDraft({
          ...current,
          changed: [],
          verdict: null,
          timer_started_at: null,
          updated_at: new Date(at).toISOString(),
        });
      } finally {
        loggingRef.current = false;
        setBusy(false);
      }
    },
    [engine, onMeasure],
  );

  /** The non-blocking "rate it" tap — same session id, so one row, one PUT. */
  const rate = useCallback(
    async (verdict: TasteVerdict | null) => {
      const current = logged;
      if (!current) return;
      const at = nowFn.current();
      const session = {
        ...current.record.session,
        ...(verdict ? { taste: { verdict } } : {}),
        // Carried forward explicitly: a photo that landed after this record was
        // captured lives in the store, not in `logged`, and rating a brew must
        // not quietly detach its picture.
        ...(photoRef.current.mediaId ? { photo_media_id: photoRef.current.mediaId } : {}),
        updated_at: new Date(at).toISOString(),
      };
      const record: LocalBrewRecord = { ...current.record, session };
      await engine.amendBrew(session);

      const prior = historyRef.current.filter((entry) => entry.session.id !== session.id);
      setHistory([...prior, record]);
      setLogged({
        ...current,
        record,
        payback: buildPayback({
          brewCountForBag: prior.length + 1,
          verdict,
          priorVerdicts: prior.map((entry) => entry.session.taste?.verdict),
          changed: session.changed_fields as BrewField[],
        }),
      });
    },
    [engine, logged],
  );

  /* --- coffee / bag ------------------------------------------------ */

  const chooseCoffee = useCallback(
    async (coffee: CoffeeRef, options: { provisional?: ProvisionalCoffee; isNew?: boolean }) => {
      const id = coffee.id ?? null;
      await engine.setActiveBag(coffee);
      const cached = (await engine.cachedPrefill(id)) ?? defaultPrefill();
      const base = draftFromPrefill(cached, {
        coffee: options.isNew ? null : coffee,
        now: nowFn.current(),
      });
      const next = options.isNew
        ? setCoffee(base, coffee, options.provisional ?? null)
        : { ...base, coffee };

      setDraft(next);
      setBasis(cached.basis);
      setRecent(await engine.recentCoffees());
      setHistory(await engine.localSessions(id));
      setSuggestion((await engine.pendingSuggestion(id)) ?? null);
      setLogged(null);
      setResumed(false);
      setMode(options.isNew ? 'tweak' : 'repeat');
      touchedRef.current = options.isNew === true;

      // A coffee we have never brewed may still come with a roaster or
      // community recipe (§3, the purchase→brew loop): take it as the starting
      // point, unless the user has already started moving numbers.
      const fresh = await engine.refreshPrefill(id);
      const editsSoFar = draftRef.current?.changed.length ?? 0;
      const allowed = options.isNew ? 1 : 0;
      if (fresh && editsSoFar <= allowed) {
        const base = draftFromPrefill(fresh, {
          coffee: options.isNew ? null : coffee,
          now: nowFn.current(),
        });
        setDraft(
          options.isNew ? setCoffee(base, coffee, options.provisional ?? null) : { ...base, coffee },
        );
        setBasis(fresh.basis);
      }
    },
    [engine],
  );

  const applySuggestion = useCallback(() => {
    const current = draftRef.current;
    if (!current || !suggestion) return;
    if (suggestion.field === 'grind') {
      const value = grindNumber(current.grind_setting);
      if (value === null) return;
      setDraft(setNumericField(current, 'grind', value + suggestion.delta, nowFn.current()));
    }
    setSuggestion(null);
    void engine.setPendingSuggestion(current.coffee?.id ?? null, null);
  }, [engine, suggestion]);

  /* --- render ------------------------------------------------------ */

  if (status === 'loading' || !draft) {
    return (
      <section className="bc-logger" aria-label="Brew logger">
        <p role="status" className="bc-muted">
          Getting your last brew…
        </p>
      </section>
    );
  }

  return (
    <section className="bc-logger bc-panel" aria-label="Brew logger">
      <BagSwitcher
        active={draft.coffee}
        recent={recent}
        onSwitch={(coffee) => {
          note();
          void chooseCoffee(coffee, {});
        }}
        onNewCoffee={() => {
          note();
          setMode('picker');
        }}
      />

      {resumed && mode === 'tweak' ? (
        <p className="bc-logger__resumed" role="status">
          Picked up where you left off — nothing was lost.
        </p>
      ) : null}

      {logged ? (
        <>
        <PostLogNote
          payback={logged.payback}
          verdict={logged.record.session.taste?.verdict ?? null}
          // The brew is already persisted by this point, so the advice request
          // runs entirely off the logging path — it can never delay a log.
          dialIn={{ brewSessionId: logged.record.session.id }}
          onRate={(verdict) => {
            void rate(verdict);
          }}
          onLogAnother={() => {
            setLogged(null);
            setMode('repeat');
            photo.reset();
            timer.current.reset();
          }}
          {...(logged.payback.suggestion
            ? {
                onRemindMe: () => {
                  void engine.setPendingSuggestion(coffeeId, logged.payback.suggestion ?? null);
                },
              }
            : {})}
          synced={logged.record.synced || (sync.pending === 0 && sync.lastError === null)}
          pending={sync.pending}
          shareText={`${draft.coffee?.label ?? 'This brew'} — ${summarizeDraft(draft)}`}
        />
        {/* "Log first, attach after" — the path we actually want people on,
            including everyone who came through Path A's single tap. */}
        <BrewPhotoField controller={photo} variant="inline" logged />
        </>
      ) : mode === 'picker' ? (
        <CoffeePicker
          recent={recent}
          {...(fetchImpl ? { fetchImpl } : {})}
          onInteract={note}
          onChoose={(coffee, options) => {
            note();
            void chooseCoffee(coffee, { ...options, isNew: true });
          }}
          onCancel={() => setMode('repeat')}
        />
      ) : mode === 'tweak' ? (
        <TweakCard
          draft={draft}
          suggestion={suggestion}
          onApplySuggestion={applySuggestion}
          onDraftChange={setDraft}
          onInteract={note}
          now={() => nowFn.current()}
          busy={busy}
          onChangeCoffee={() => {
            note();
            setMode('picker');
          }}
          onLog={() => {
            note();
            void logBrew('B');
          }}
          onCancel={() => setMode('repeat')}
          photoSlot={<BrewPhotoField controller={photo} />}
        />
      ) : (
        <RepeatCard
          draft={draft}
          basis={basis}
          busy={busy}
          onRepeat={() => {
            note();
            void logBrew('A');
          }}
          onTweak={() => {
            note();
            setMode('tweak');
          }}
        />
      )}

      {sync.pending > 0 ? (
        <p className="bc-logger__queue bc-muted" role="status">
          {sync.pending} brew{sync.pending === 1 ? '' : 's'} waiting to sync. They are safe on
          this device.
        </p>
      ) : null}
    </section>
  );
}
