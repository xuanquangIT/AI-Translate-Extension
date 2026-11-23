/**
 * Contract: the message registry, its handlers, its senders, and the docs agree.
 * If this fails after adding a message, update every listed place in one change.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { installChromeMock } from '../helpers/chrome-mock.js';
import { BACKGROUND_MESSAGES, CONTENT_MESSAGES } from '../../src/shared/messages.js';

installChromeMock();
const { handlers } = await import('../../src/background/router.js');

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const contentScript = read('src/content/content.js');
const contractsDoc = read('docs/CONTRACTS.md');

test('registry keys equal their values', () => {
  for (const registry of [BACKGROUND_MESSAGES, CONTENT_MESSAGES]) {
    for (const [key, value] of Object.entries(registry)) assert.equal(key, value);
  }
});

test('background router handles exactly BACKGROUND_MESSAGES', () => {
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(BACKGROUND_MESSAGES).sort());
});

test('content script handles exactly CONTENT_MESSAGES', () => {
  const handled = [...contentScript.matchAll(/case '([A-Z_]+)':/g)].map((match) => match[1]);
  assert.deepEqual(handled.sort(), Object.values(CONTENT_MESSAGES).sort());
});

test('content script only sends registered background messages', () => {
  const sent = [...contentScript.matchAll(/type: '([A-Z_]+)'/g)].map((match) => match[1]);
  for (const type of sent) assert.ok(type in BACKGROUND_MESSAGES, `unregistered message ${type}`);
});

test('every message type is documented in runtime-contracts.md', () => {
  for (const type of [...Object.values(BACKGROUND_MESSAGES), ...Object.values(CONTENT_MESSAGES)]) {
    assert.ok(contractsDoc.includes(`\`${type}\``), `docs/CONTRACTS.md is missing \`${type}\``);
  }
});
