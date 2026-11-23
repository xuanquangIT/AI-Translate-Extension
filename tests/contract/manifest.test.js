/** Contract: manifest, package metadata, locale strings, and documented storage keys. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULTS } from '../../src/shared/config.js';

const readJson = (file) => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const manifest = readJson('src/manifest.json');
const pkg = readJson('package.json');
const messages = readJson('src/_locales/en/messages.json');
const contractsDoc = readFileSync(new URL('../../docs/CONTRACTS.md', import.meta.url), 'utf8');

test('MV3 manifest with matching version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version, 'manifest and package versions must match');
});

test('English locale is the default and store strings fit limits', () => {
  assert.equal(manifest.default_locale, 'en');
  assert.ok(messages.extensionName?.message);
  assert.ok(messages.extensionDescription?.message);
  assert.ok(messages.extensionDescription.message.length <= 132, 'description exceeds 132 characters');
});

test('permissions change only deliberately', () => {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['activeTab', 'contextMenus', 'scripting', 'storage'],
    'Permission change: update PRIVACY.md, README, and this test in the same PR.'
  );
});

test('every persistent default is documented', () => {
  for (const key of Object.keys(DEFAULTS)) {
    assert.ok(contractsDoc.includes(`\`${key}\``), `docs/CONTRACTS.md is missing storage key \`${key}\``);
  }
});
