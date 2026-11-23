/**
 * Pure selection and filter logic for the Options model checklist. No DOM and no `chrome.*`.
 *
 * A model is `{ id, name }`. Manual models are always offered by the background, so they are never
 * part of a selection: only discovered ("selectable") models can be ticked. A selection is a
 * `Set` of model ids that only ever contains ids present in the listed models.
 */

/** Case-insensitive match on id or name. Every whitespace-separated term must match. */
export function filterModels(models, query) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [...models];
  return models.filter((model) => {
    const haystack = `${model.id} ${model.name || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Models the user can tick: everything except the manual ones. */
export function selectableModels(models, manualIds = []) {
  const manual = new Set(manualIds);
  return models.filter((model) => !manual.has(model.id));
}

/**
 * Initial selection from the saved `enabledModels`. `null` means a legacy provider, where every
 * discovered model is currently shown, so everything starts ticked. Stale ids are dropped.
 */
export function createSelection(models, enabledModels, manualIds = []) {
  const ids = selectableModels(models, manualIds).map((model) => model.id);
  if (!Array.isArray(enabledModels)) return new Set(ids);
  const enabled = new Set(enabledModels);
  return new Set(ids.filter((id) => enabled.has(id)));
}

/** Returns a new selection with `models` ticked or unticked; manual models are ignored. */
export function setChecked(selection, models, checked, manualIds = []) {
  const next = new Set(selection);
  for (const model of selectableModels(models, manualIds)) {
    if (checked) next.add(model.id);
    else next.delete(model.id);
  }
  return next;
}

/** The `enabledModels` array to save: ticked ids in list order. */
export function selectionToEnabled(models, selection, manualIds = []) {
  return selectableModels(models, manualIds)
    .map((model) => model.id)
    .filter((id) => selection.has(id));
}

/** True when `selection` differs from what is saved (`enabledModels`, `null` = legacy). */
export function selectionChanged(models, selection, enabledModels, manualIds = []) {
  const saved = createSelection(models, enabledModels, manualIds);
  return saved.size !== selection.size || [...saved].some((id) => !selection.has(id));
}

/** @returns {{ selected: number, total: number, manual: number }} */
export function countSelection(models, selection, manualIds = []) {
  const selectable = selectableModels(models, manualIds);
  return {
    selected: selectable.filter((model) => selection.has(model.id)).length,
    total: selectable.length,
    manual: models.length - selectable.length
  };
}

/** "N of M selected", plus how many are shown by the search and how many manual models exist. */
export function describeSelection({ selected, total, manual = 0 }, shown = total) {
  const parts = [`${selected} of ${total} selected`];
  if (shown !== total) parts.push(`${shown} shown`);
  if (manual) parts.push(`${manual} manual always shown`);
  return parts.join(' · ');
}

/** One-line summary of a saved `enabledModels` (`null`/absent = legacy: all discovered models shown). */
export function describeSaved(enabledModels) {
  return Array.isArray(enabledModels) ? `${enabledModels.length} selected` : 'all discovered models shown';
}
