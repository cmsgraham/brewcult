'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError } from '../../lib/api';
import {
  CATEGORY_LABEL,
  addCustomEquipment,
  addMyEquipment,
  equipmentTitle,
  fetchMyEquipment,
  makePrimaryEquipment,
  removeMyEquipment,
  searchEquipment,
  type EquipmentCategory,
  type EquipmentSuggestion,
  type OwnedEquipment,
} from '../../lib/equipment-client';
import { Alert } from '../ui/alert';
import { useLocale, useTranslate } from '../locale-provider';
import { catalogCopy } from '../catalog/copy';
import { EquipmentRequestForm } from './equipment-request-form';

/**
 * "Your equipment", for real.
 *
 * This replaced a card reading "The equipment picker arrives with the brew
 * logger — nothing to do for now." The logger shipped, so that copy promised
 * something against a milestone that had already passed, and there was no way
 * to add anything at all.
 *
 * Search rather than a dropdown: the catalogue is ~100 models and only grows,
 * and people know their gear by name ("niche", "v60") long before they would
 * find it by scrolling a grouped <select>.
 *
 * Kept deliberately small otherwise — no purchase dates, prices, condition or
 * photos. Each is a field somebody has to maintain and none changes a brewing
 * suggestion (second_draft §10: ask for what you will use).
 */
export function EquipmentManager() {
  const t = useTranslate();
  const { locale } = useLocale();
  // Singular already, in both languages — the catalogue vocabulary spells these
  // for the equipment pages, so this is the same word rather than a second one.
  const categoryLabel = (category: EquipmentCategory) =>
    catalogCopy(locale).EQUIPMENT_CATEGORY_LABEL[category];
  const [owned, setOwned] = useState<OwnedEquipment[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EquipmentSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customBrand, setCustomBrand] = useState('');
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<EquipmentCategory>('grinder');
  const listId = 'equipment-search-results';

  useEffect(() => {
    let cancelled = false;
    fetchMyEquipment()
      .then((mine) => {
        if (!cancelled) setOwned(mine);
      })
      .catch(() => {
        if (!cancelled) {
          setOwned([]);
          setError(t('kit.loadFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced so typing "comandante" is one request at the end rather than ten
  // on the way there. 250ms is below the threshold where a search box starts to
  // feel like it is ignoring you.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchEquipment(q)
        .then((items) => {
          if (!cancelled) setResults(items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const ownedModelIds = useMemo(
    () => new Set((owned ?? []).map((item) => item.equipment_model_id)),
    [owned],
  );

  const run = useCallback(async (action: () => Promise<OwnedEquipment[]>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOwned(await action());
    } catch (failure) {
      setError(
        isApiError(failure) ? failure.userMessage : t('kit.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (owned === null) {
    return (
      <p className="bc-muted" role="status">
        {error ?? t('kit.loading')}
      </p>
    );
  }

  return (
    <div className="bc-stack">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {owned.length === 0 ? (
        <p className="bc-muted">{t('kit.empty')}</p>
      ) : (
        <ul className="bc-kit">
          {owned.map((item) => (
            <li key={item.id} className="bc-kit__row">
              <div className="bc-kit__text">
                <span className="bc-kit__name">
                  {equipmentTitle(item)}
                  {item.is_primary ? (
                    <span className="bc-kit__badge">{t('kit.badgeDefault')}</span>
                  ) : null}
                  {item.is_custom ? (
                    <span className="bc-kit__badge bc-kit__badge--quiet">
                      {t('kit.badgeYours')}
                    </span>
                  ) : null}
                </span>
                <span className="bc-muted bc-kit__meta">
                  {categoryLabel(item.category)}
                  {item.grind_scale_type
                    ? ` · ${t('kit.scaleSuffix', { scale: item.grind_scale_type })}`
                    : ''}
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
                    {t('kit.makeDefault')}
                  </button>
                )}
                <button
                  type="button"
                  className="bc-button bc-button--quiet bc-kit__button"
                  disabled={busy}
                  onClick={() => void run(() => removeMyEquipment(item.id))}
                >
                  {t('common.remove')}
                  <span className="bc-visually-hidden"> {equipmentTitle(item)}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="bc-kit__search">
        <label className="bc-kit__label" htmlFor="equipment-search">
          {t('kit.addLabel')}
        </label>
        <input
          id="equipment-search"
          className="bc-input"
          type="search"
          autoComplete="off"
          placeholder={t('kit.searchPlaceholder')}
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
        />

        {/* Every state gets a sentence. A search box that goes quiet when it
            finds nothing reads as broken rather than as empty. */}
        <p className="bc-muted bc-kit__status" role="status">
          {query.trim() === ''
            ? t('kit.hintType')
            : searching
              ? t('kit.hintSearching')
              : results.length === 0
                ? t('kit.hintNothing')
                : results.length === 1
                  ? t('kit.hintMatchOne')
                  : t('kit.hintMatchMany', { count: results.length })}
        </p>

        {/* The fallback lives HERE — at the moment search disappoints, not
            hidden behind a link somewhere else on the page. A catalogue of 98
            models will always be missing somebody's grinder, and being told
            "not found" with no next step is where people give up. */}
        {query.trim() !== '' && !searching && results.length === 0 && !customOpen ? (
          <button
            type="button"
            className="bc-button bc-button--secondary"
            onClick={() => {
              setCustomName(query.trim());
              setCustomOpen(true);
            }}
          >
            {t('kit.addAsOwn', { query: query.trim() })}
          </button>
        ) : null}

        {customOpen ? (
          <div className="bc-panel bc-stack">
            <p style={{ marginBottom: 0 }}>{t('kit.customNote')}</p>
            <div className="bc-kit__custom">
              <span className="bc-field">
                <label className="bc-kit__label" htmlFor="custom-brand">
                  {t('kit.brand')} <span className="bc-muted">{t('common.optional')}</span>
                </label>
                <input
                  id="custom-brand"
                  className="bc-input"
                  value={customBrand}
                  maxLength={80}
                  onChange={(event) => setCustomBrand(event.target.value)}
                />
              </span>
              <span className="bc-field">
                <label className="bc-kit__label" htmlFor="custom-name">
                  {t('kit.model')}
                </label>
                <input
                  id="custom-name"
                  className="bc-input"
                  value={customName}
                  maxLength={120}
                  onChange={(event) => setCustomName(event.target.value)}
                />
              </span>
              <span className="bc-field">
                <label className="bc-kit__label" htmlFor="custom-category">
                  {t('kit.type')}
                </label>
                <select
                  id="custom-category"
                  className="bc-input"
                  value={customCategory}
                  onChange={(event) =>
                    setCustomCategory(event.target.value as EquipmentCategory)
                  }
                >
                  {(Object.keys(CATEGORY_LABEL) as EquipmentCategory[]).map((category) => (
                    <option key={category} value={category}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="bc-actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="bc-button"
                disabled={busy || customName.trim() === ''}
                onClick={() =>
                  void run(async () => {
                    const next = await addCustomEquipment({
                      ...(customBrand.trim() ? { brand: customBrand.trim() } : {}),
                      name: customName.trim(),
                      category: customCategory,
                    });
                    setCustomOpen(false);
                    setCustomBrand('');
                    setCustomName('');
                    setQuery('');
                    setResults([]);
                    return next;
                  })
                }
              >
                {t('kit.addToMine')}
              </button>
              <button
                type="button"
                className="bc-button bc-button--quiet"
                disabled={busy}
                onClick={() => setCustomOpen(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {results.length > 0 ? (
          <ul className="bc-kit__results" id={listId}>
            {results.map((item) => {
              const already = ownedModelIds.has(item.id);
              return (
                <li key={item.id} className="bc-kit__result">
                  <span className="bc-kit__text">
                    <span className="bc-kit__name">{item.label}</span>
                    {item.sublabel ? (
                      <span className="bc-muted bc-kit__meta">{item.sublabel}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="bc-button bc-kit__button"
                    disabled={busy || already}
                    onClick={() =>
                      void run(async () => {
                        const next = await addMyEquipment({ equipment_model_id: item.id });
                        setQuery('');
                        setResults([]);
                        return next;
                      })
                    }
                  >
                    {already ? t('kit.added') : t('kit.add')}
                    <span className="bc-visually-hidden"> {item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Proposing it for everybody is a SECOND, slower thing — offered after
          the instant option, never instead of it. */}
      <EquipmentRequestForm />
    </div>
  );
}
