/**
 * Model `<select>` rendering shared by popup and options. Options carry the
 * model ID as `value` and the provider ID as `data-provider`; always read both.
 */

import { toFavoriteModelKey } from '../../shared/model-keys.js';
import { addOption } from './dom.js';

function appendModel(group, item, favorite = false) {
  const label = `${favorite ? '★ ' : ''}${item.label}${item.tier === 'manual' ? ' · manual' : ''}`;
  const option = addOption(group, item.id, label);
  option.dataset.provider = item.provider;
  option.title = item.id;
}

/**
 * Renders favorites first, then one optgroup per provider, then selects the
 * preferred provider+model, else the preferred model ID, else the first option.
 */
export function renderModelOptions(
  select,
  { models, providers, favorites, preferredModel, preferredProvider, emptyLabel }
) {
  select.replaceChildren();
  const favoriteSet = new Set(favorites);

  const favoriteModels = models.filter((item) => item.isFavorite);
  if (favoriteModels.length) {
    const group = document.createElement('optgroup');
    group.label = 'Favorites';
    favoriteModels.forEach((item) => appendModel(group, item, true));
    select.appendChild(group);
  }

  for (const provider of providers) {
    const providerModels = models.filter(
      (item) => item.provider === provider.id && !favoriteSet.has(toFavoriteModelKey(item.id, item.provider))
    );
    if (!providerModels.length) continue;
    const group = document.createElement('optgroup');
    group.label = provider.name;
    providerModels.forEach((item) => appendModel(group, item));
    select.appendChild(group);
  }

  if (!select.options.length) addOption(select, '', emptyLabel).disabled = true;

  const options = [...select.options];
  const chosen =
    options.find((item) => item.value === preferredModel && item.dataset.provider === preferredProvider) ||
    options.find((item) => item.value === preferredModel) ||
    options.find((item) => !item.disabled);
  if (chosen) chosen.selected = true;
}

/** @returns {{ model: string, modelProvider: string }} */
export function selectedModel(select) {
  const option = select.selectedOptions[0];
  return { model: option?.value || '', modelProvider: option?.dataset.provider || '' };
}

export function isFavoriteSelection(select, favorites) {
  const { model, modelProvider } = selectedModel(select);
  return favorites.includes(toFavoriteModelKey(model, modelProvider));
}
