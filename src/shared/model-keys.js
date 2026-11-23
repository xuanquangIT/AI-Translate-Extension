/**
 * Provider-qualified model identity. Model IDs are not globally unique, so a
 * model is always identified by `providerId::modelId`.
 */

const SEPARATOR = '::';

export function toFavoriteModelKey(model, modelProvider) {
  const cleanModel = String(model || '').trim();
  const cleanProvider = String(modelProvider || '').trim();
  return cleanModel && cleanProvider ? `${cleanProvider}${SEPARATOR}${cleanModel}` : '';
}

export function parseFavoriteModelKey(value) {
  const text = String(value || '');
  const index = text.indexOf(SEPARATOR);
  return index > 0 ? { providerId: text.slice(0, index), model: text.slice(index + SEPARATOR.length) } : null;
}

export function isFavoriteModelKey(value) {
  return String(value || '').includes(SEPARATOR);
}
