'use client';

import { useEffect, useState } from 'react';
import { formatDuration, LIMIT, STEP } from '../../lib/brewing-client';
import { Stepper } from './stepper';

export interface BrewTimerProps {
  seconds: number | null;
  /** Epoch ms the timer was started at; null when it isn't running. */
  startedAt: number | null;
  onSecondsChange: (seconds: number) => void;
  onStartedAtChange: (startedAt: number | null) => void;
  now?: () => number;
}

/**
 * Optional, non-modal timer (§8 decision 4 — plain timer, brew-along is later).
 *
 * It survives backgrounding, a phone call and a reload because the only state
 * that matters is `startedAt`, which lives in the persisted draft: the elapsed
 * time is *derived* from the wall clock, never accumulated by an interval that
 * a suspended tab would stop firing. The interval below only repaints.
 *
 * Typing "2:45" is always allowed. Nobody is forced to have started a timer to
 * log a brew.
 */
export function BrewTimer({
  seconds,
  startedAt,
  onSecondsChange,
  onStartedAtChange,
  now = () => Date.now(),
}: BrewTimerProps) {
  const running = startedAt !== null;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(interval);
  }, [running]);

  const liveSeconds = running ? Math.max(0, Math.round((now() - (startedAt ?? 0)) / 1000)) : 0;

  return (
    <div className="bc-timer">
      {running ? (
        <div className="bc-stepper" role="group" aria-label="Brew time">
          <span className="bc-stepper__label">Time</span>
          <div className="bc-stepper__control">
            <output className="bc-timer__running" aria-live="off">
              {formatDuration(liveSeconds)}
            </output>
          </div>
          <span className="bc-stepper__hint">running</span>
        </div>
      ) : (
        <Stepper
          label="Time"
          value={seconds ?? 0}
          step={STEP.brew_time_s}
          min={LIMIT.brew_time_s.min}
          max={LIMIT.brew_time_s.max}
          decimals={0}
          display={formatDuration(seconds ?? 0)}
          valueText={`${Math.floor((seconds ?? 0) / 60)} minutes ${(seconds ?? 0) % 60} seconds`}
          onChange={onSecondsChange}
        />
      )}

      <button
        type="button"
        className="bc-button bc-button--quiet bc-timer__toggle"
        onClick={() => {
          if (running) {
            onSecondsChange(liveSeconds);
            onStartedAtChange(null);
          } else {
            onStartedAtChange(now());
          }
        }}
      >
        <span aria-hidden="true">⏱</span> {running ? 'Stop timer' : 'Start timer'}
      </button>
    </div>
  );
}
