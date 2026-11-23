import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeIncomingText, sanitizeTranslatedText, stableHash } from '../../src/shared/text.js';

test('sanitizeIncomingText normalizes spaces and blank lines', () => {
  assert.equal(sanitizeIncomingText('  A\u00a0line  \r\n\r\n\r\nNext  '), 'A line\n\nNext');
  assert.equal(sanitizeIncomingText(null), '');
});

test('sanitizeTranslatedText strips reasoning, fences, and labels', () => {
  assert.equal(
    sanitizeTranslatedText('<think>internal</think>\n```text\nTranslation: Bonjour\n```', 'Hello'),
    'Bonjour'
  );
});

test('sanitizeTranslatedText removes an echoed prompt prefix', () => {
  assert.equal(sanitizeTranslatedText('Source text: Hello\nTranslation: Bonjour', 'Hello'), 'Bonjour');
});

test('sanitizeTranslatedText keeps a translation that legitimately contains the source', () => {
  assert.equal(sanitizeTranslatedText('API means API', 'API'), 'API means API');
});

test('stableHash is deterministic and input-sensitive', () => {
  assert.equal(stableHash('same input'), stableHash('same input'));
  assert.notEqual(stableHash('same input'), stableHash('different input'));
});
