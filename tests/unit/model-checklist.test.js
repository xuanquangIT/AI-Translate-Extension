import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countSelection,
  createSelection,
  describeSaved,
  describeSelection,
  filterModels,
  selectableModels,
  selectionChanged,
  selectionToEnabled,
  setChecked
} from '../../src/pages/shared/model-checklist.js';

const models = [
  { id: 'manual-a', name: 'manual-a' },
  { id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini' },
  { id: 'gpt-4.1', name: 'GPT 4.1' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'llama-3', name: 'Meta Llama 3' }
];
const manual = ['manual-a'];
const ids = (list) => list.map((model) => model.id);

test('filterModels matches id or name case-insensitively and returns everything for a blank query', () => {
  assert.deepEqual(ids(filterModels(models, 'SONNET')), ['claude-sonnet-4']);
  assert.deepEqual(ids(filterModels(models, 'meta')), ['llama-3']);
  assert.deepEqual(ids(filterModels(models, 'gpt-4.1')), ['gpt-4.1-mini', 'gpt-4.1']);
  assert.equal(filterModels(models, '').length, models.length);
  assert.equal(filterModels(models, '   ').length, models.length);
  assert.equal(filterModels(models, undefined).length, models.length);
  assert.deepEqual(filterModels(models, 'no-such-model'), []);
});

test('filterModels requires every search term to match and does not mutate its input', () => {
  assert.deepEqual(ids(filterModels(models, 'gpt mini')), ['gpt-4.1-mini']);
  assert.deepEqual(ids(filterModels(models, 'gpt claude')), []);
  const all = filterModels(models, '');
  all.pop();
  assert.equal(models.length, 5);
});

test('createSelection: a new provider ([]) starts with nothing ticked', () => {
  assert.equal(createSelection(models, [], manual).size, 0);
});

test('createSelection: legacy (null) ticks every discovered model but never a manual one', () => {
  const selection = createSelection(models, null, manual);
  assert.deepEqual([...selection], ['gpt-4.1-mini', 'gpt-4.1', 'claude-sonnet-4', 'llama-3']);
  assert.equal(createSelection(models, undefined, manual).size, 4);
});

test('createSelection keeps only saved ids that are still listed and not manual', () => {
  const selection = createSelection(models, ['gpt-4.1', 'gone-model', 'manual-a'], manual);
  assert.deepEqual([...selection], ['gpt-4.1']);
});

test('setChecked ticks and unticks the given models, ignores manual ones, and returns a new Set', () => {
  const start = new Set(['llama-3']);
  const shown = filterModels(models, 'gpt');
  const ticked = setChecked(start, shown, true, manual);
  assert.deepEqual([...ticked].sort(), ['gpt-4.1', 'gpt-4.1-mini', 'llama-3']);
  assert.deepEqual([...start], ['llama-3']);

  const cleared = setChecked(ticked, shown, false, manual);
  assert.deepEqual([...cleared], ['llama-3']);

  assert.equal(setChecked(new Set(), [{ id: 'manual-a' }], true, manual).size, 0);
});

test('select all shown / clear act on the filtered list only', () => {
  const afterSelect = setChecked(new Set(), filterModels(models, 'claude'), true, manual);
  assert.deepEqual([...afterSelect], ['claude-sonnet-4']);
  const afterClear = setChecked(createSelection(models, null, manual), filterModels(models, 'gpt'), false, manual);
  assert.deepEqual([...afterClear], ['claude-sonnet-4', 'llama-3']);
});

test('selectionToEnabled lists ticked discovered ids in list order, without manual models', () => {
  const selection = new Set(['llama-3', 'gpt-4.1', 'manual-a']);
  assert.deepEqual(selectionToEnabled(models, selection, manual), ['gpt-4.1', 'llama-3']);
  assert.deepEqual(selectionToEnabled(models, new Set(), manual), []);
});

test('selectionChanged compares with the saved selection, treating legacy as all ticked', () => {
  const saved = ['gpt-4.1'];
  assert.equal(selectionChanged(models, new Set(['gpt-4.1']), saved, manual), false);
  assert.equal(selectionChanged(models, new Set(['gpt-4.1', 'llama-3']), saved, manual), true);
  assert.equal(selectionChanged(models, new Set(), saved, manual), true);

  const legacyAll = createSelection(models, null, manual);
  assert.equal(selectionChanged(models, legacyAll, null, manual), false);
  assert.equal(selectionChanged(models, setChecked(legacyAll, [{ id: 'llama-3' }], false, manual), null, manual), true);
  assert.equal(selectionChanged(models, new Set(), [], manual), false);
});

test('selectableModels and countSelection separate manual from discovered models', () => {
  assert.equal(selectableModels(models, manual).length, 4);
  assert.deepEqual(countSelection(models, new Set(['gpt-4.1', 'llama-3']), manual), {
    selected: 2,
    total: 4,
    manual: 1
  });
  assert.deepEqual(countSelection([], new Set(), []), { selected: 0, total: 0, manual: 0 });
});

test('describeSelection builds the counter line', () => {
  assert.equal(describeSelection({ selected: 2, total: 120, manual: 0 }), '2 of 120 selected');
  assert.equal(describeSelection({ selected: 2, total: 120, manual: 0 }, 7), '2 of 120 selected · 7 shown');
  assert.equal(describeSelection({ selected: 0, total: 4, manual: 2 }, 4), '0 of 4 selected · 2 manual always shown');
});

test('describeSaved distinguishes a saved selection from a legacy provider', () => {
  assert.equal(describeSaved([]), '0 selected');
  assert.equal(describeSaved(['a', 'b']), '2 selected');
  assert.equal(describeSaved(null), 'all discovered models shown');
  assert.equal(describeSaved(undefined), 'all discovered models shown');
});
