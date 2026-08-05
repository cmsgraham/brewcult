'use client';

import { useId, useState } from 'react';
import type { CoffeeRef } from '../../lib/brewing-client';
import { BeanIcon } from '../ui/icon';

export interface BagSwitcherProps {
  active: CoffeeRef | null;
  recent: CoffeeRef[];
  onSwitch: (coffee: CoffeeRef) => void;
  onNewCoffee: () => void;
}

/**
 * Active bag + fast switcher (§8 decision 2: one card for the coffee you are
 * brewing now, switching is one tap from the header — not a carousel).
 *
 * A disclosure, not a modal: opening it does not take the screen away from you,
 * and closing it costs nothing.
 */
export function BagSwitcher({ active, recent, onSwitch, onNewCoffee }: BagSwitcherProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const others = recent.filter((coffee) => (coffee.id ?? coffee.label) !== (active?.id ?? active?.label));

  return (
    <div className="bc-logger__bag">
      <div className="bc-logger__bag-row">
        <h2 className="bc-logger__coffee">
          <BeanIcon className="bc-logger__coffee-icon" />
          {active?.label ?? 'No bag chosen yet'}
        </h2>
        <button
          type="button"
          className="bc-button bc-button--quiet bc-logger__switch"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          Switch bag
        </button>
      </div>

      <div id={id} hidden={!open}>
        <ul className="bc-logger__options">
          {others.map((coffee) => (
            <li key={coffee.id ?? coffee.label}>
              <button
                type="button"
                className="bc-logger__option"
                onClick={() => {
                  setOpen(false);
                  onSwitch(coffee);
                }}
              >
                <span>{coffee.label}</span>
                {coffee.subtitle ? <span className="bc-muted">{coffee.subtitle}</span> : null}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="bc-logger__option"
              onClick={() => {
                setOpen(false);
                onNewCoffee();
              }}
            >
              <span>Brewing a new coffee…</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
