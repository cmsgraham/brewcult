'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface StepperProps {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  /** What sighted users read, e.g. "15g". */
  display: string;
  /** What screen readers hear, e.g. "15 grams". */
  valueText: string;
  onChange: (value: number) => void;
  /** Decimals kept when the user types a value directly. */
  decimals?: number;
  /** Secondary text on the right of the row — the derived ratio, mostly. */
  hint?: ReactNode;
  disabled?: boolean;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * `◂ value ▸` — the single design decision that buys the most seconds
 * (brew_logger_ux §3: "the mobile keyboard is the single biggest time sink").
 *
 * Accessibility:
 *  - the value is a real `spinbutton` with aria-valuenow/min/max/valuetext, so
 *    it is announced as a value and driven with the arrow keys;
 *  - the ± controls are buttons with explicit "Increase/Decrease <field>"
 *    labels, because "◂" is not a name;
 *  - activating the value swaps in a text input for exact entry — the keyboard
 *    is available, it is just never mandatory.
 */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  display,
  valueText,
  onChange,
  decimals = 2,
  hint,
  disabled = false,
}: StepperProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit(raw: string) {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    setEditing(false);
    if (Number.isNaN(parsed)) return;
    onChange(Math.min(max, Math.max(min, round(parsed, decimals))));
  }

  function nudge(direction: 1 | -1) {
    onChange(Math.min(max, Math.max(min, round(value + direction * step, decimals))));
  }

  function onValueKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      nudge(1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      nudge(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  }

  return (
    <div className="bc-stepper" role="group" aria-labelledby={`${id}-label`}>
      <span className="bc-stepper__label" id={`${id}-label`}>
        {label}
      </span>

      <div className="bc-stepper__control">
        <button
          type="button"
          className="bc-stepper__btn"
          aria-label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
          disabled={disabled || value <= min}
        >
          <span aria-hidden="true">◂</span>
        </button>

        {editing ? (
          <input
            ref={inputRef}
            className="bc-stepper__input"
            type="text"
            inputMode="decimal"
            aria-label={`${label}, exact value`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(typed);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="bc-stepper__value"
            role="spinbutton"
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={valueText}
            aria-describedby={`${id}-howto`}
            onClick={() => {
              setTyped(String(value));
              setEditing(true);
            }}
            onKeyDown={onValueKeyDown}
            disabled={disabled}
          >
            {display}
          </button>
        )}

        <button
          type="button"
          className="bc-stepper__btn"
          aria-label={`Increase ${label}`}
          onClick={() => nudge(1)}
          disabled={disabled || value >= max}
        >
          <span aria-hidden="true">▸</span>
        </button>
      </div>

      <span className="bc-stepper__hint">{hint}</span>
      <span className="bc-visually-hidden" id={`${id}-howto`}>
        Arrow keys adjust by {step}. Activate to type an exact value.
      </span>
    </div>
  );
}
