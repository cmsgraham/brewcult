'use client';

import { useEffect, useMemo, useState } from 'react';
import { isApiError } from '../../lib/api';
import {
  CATEGORY_LABEL,
  addMyEquipment,
  equipmentTitle,
  fetchEquipmentOptions,
  fetchMyEquipment,
  makePrimaryEquipment,
  removeMyEquipment,
  type EquipmentCategory,
  type EquipmentOption,
  type OwnedEquipment,
} from '../../lib/equipment-client';
import { Alert } from '../ui/alert';

/**
 * "Your equipment", for real.
 *
 * This replaced a card reading "The equipment picker arrives with the brew
 * logger — nothing to do for now." The logger shipped, so the copy was
 * promising something against a milestone that had already passed, and there
 * was no way to add anything.
 *
 * Kept deliberately small: pick from the catalogue, optionally mark the one you
 * mean by default, remove it. No purchase dates, no photos, no condition —
 * every one of those is a field somebody has to maintain and none of them
 * changes a brewing suggestion (second_draft §10: ask for what you will use).
 */
export function EquipmentManager() {
  const [owned, setOwned] = useState<OwnedEquipment[] | null>(null);
  const [options, setOptions] = useState<EquipmentOption[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMyEquipment(), fetchEquipmentOptions()])
      .then(([mine, catalogue]) => {
        if (cancelled) return;
        setOwned(mine);
        setOptions(catalogue);
      })
      .catch(() => {
        if (!cancelled) {
          setOwned([]);
          setError('We could not load your equipment. Reload to try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ownedModelIds = useMemo(
    () => new Set((owned ?? []).map((item) => item.equipment_model_id)),
    [owned],
  );

  /** Catalogue minus what you already have, grouped the way a shelf is. */
  const grouped = useMemo(() => {
    const groups = new Map<EquipmentCategory, EquipmentOption[]>();
    for (const option of options) {
      if (ownedModelIds.has(option.id)) continue;
      const list = groups.get(option.category) ?? [];
      list.push(option);
      groups.set(option.category, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => `${a.brand?.name ?? ''} ${a.name}`.localeCompare(`${b.brand?.name ?? ''} ${b.name}`));
    }
    return groups;
  }, [options, ownedModelIds]);

  async function run(action: () => Promise<OwnedEquipment[]>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setOwned(await action());
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : 'That did not save. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (owned === null) {
    return (
      <p className="bc-muted" role="status">
        {error ?? 'Loading your equipment…'}
      </p>
    );
  }

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {owned.length === 0 ? (
        <p className="bc-muted">
          Nothing here yet. Add the grinder and brewer you use most — that is enough for
          suggestions to talk in your numbers.
        </p>
      ) : (
        <ul className="bc-kit">
          {owned.map((item) => (
            <li key={item.id} className="bc-kit__row">
              <div className="bc-kit__text">
                <span className="bc-kit__name">
                  {equipmentTitle(item)}
                  {item.is_primary ? <span className="bc-kit__badge">Default</span> : null}
                </span>
                <span className="bc-muted bc-kit__meta">
                  {CATEGORY_LABEL[item.category].replace(/s$/, '')}
                  {item.grind_scale_type ? ` · ${item.grind_scale_type} scale` : ''}
                </span>
              </div>
              <div className="bc-kit__actions">
                {item.is_primary ? null : (
                  <button
                    type="button"
                    className="bc-button bc-button--quiet bc-kit__button"
                    disabled={busy}
                    onClick={() => void run(() => makePrimaryEquipment(item.id))}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="bc-button bc-button--quiet bc-kit__button"
                  disabled={busy}
                  onClick={() => void run(() => removeMyEquipment(item.id))}
                >
                  Remove<span className="bc-visually-hidden"> {equipmentTitle(item)}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="bc-kit__add">
        <label className="bc-visually-hidden" htmlFor="add-equipment">
          Add equipment
        </label>
        <select
          id="add-equipment"
          className="bc-input"
          value={selected}
          disabled={busy || options.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Add a piece of equipment…</option>
          {[...grouped.entries()].map(([category, list]) => (
            <optgroup key={category} label={CATEGORY_LABEL[category]}>
              {list.map((option) => (
                <option key={option.id} value={option.id}>
                  {[option.brand?.name, option.name].filter(Boolean).join(' ')}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          className="bc-button"
          disabled={busy || selected === ''}
          onClick={() =>
            void run(async () => {
              const next = await addMyEquipment({ equipment_model_id: selected });
              setSelected('');
              return next;
            })
          }
        >
          Add
        </button>
      </div>

      {options.length === 0 ? (
        <p className="bc-muted" style={{ fontSize: '0.9rem' }}>
          The equipment catalogue is still filling up. If yours is missing, it will appear here
          as we add it.
        </p>
      ) : null}
    </div>
  );
}
