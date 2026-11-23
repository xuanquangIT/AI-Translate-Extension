/** Contract: the classic content script's duplicated helpers stay equivalent to src/shared. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LIMITS } from '../../src/shared/config.js';
import { sanitizeIncomingText } from '../../src/shared/text.js';

const contentScript = readFileSync(new URL('../../src/content/content.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const match = contentScript.match(new RegExp(`function ${name}\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `function ${name} not found in content.js`);
  return new Function(match[1], match[2]);
}

test('cleanText matches sanitizeIncomingText', () => {
  const cleanText = extractFunction('cleanText');
  const samples = ['', '  plain  ', 'A\u00a0B', 'a  \r\nb', 'x\n\n\n\n\ny', '\t tab \t\nnext', null, undefined, 42];
  for (const sample of samples) assert.equal(cleanText(sample), sanitizeIncomingText(sample), JSON.stringify(sample));
});

test('content script keeps its reinjection guard', () => {
  assert.match(contentScript, /if \(window\.__lingoFluxLoaded\) return;/);
});

test('provider output is never assigned through innerHTML', () => {
  const assignments = [...contentScript.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.deepEqual(
    assignments,
    ["wrapper.dataset.originalHtml || ''"],
    'only Replace-mode restore of original page HTML may use innerHTML'
  );
});

function contentConstant(name) {
  const match = contentScript.match(new RegExp(`const ${name} = ([0-9_]+);`));
  assert.ok(match, `${name} not found in content.js`);
  return Number(match[1].replaceAll('_', ''));
}

test('page batches stay within the background page limits', () => {
  assert.ok(contentConstant('PAGE_BATCH_MAX_SEGMENTS') <= LIMITS.PAGE_SEGMENTS_PER_REQUEST);
  assert.equal(contentConstant('PAGE_SEGMENT_MAX_CHARS'), LIMITS.PAGE_SEGMENT_MAX_CHARS);
});

test('pageSourceText keeps words and skips numbers, symbols, URLs, and oversize text', () => {
  const match = contentScript.match(/function pageSourceText\(node\)\s*\{([\s\S]*?)\n {2}\}/);
  assert.ok(match, 'function pageSourceText not found in content.js');
  const pageSourceText = new Function('PAGE_SEGMENT_MAX_CHARS', 'node', match[1]).bind(
    null,
    LIMITS.PAGE_SEGMENT_MAX_CHARS
  );
  const text = (value) => pageSourceText({ nodeValue: value });
  assert.equal(text('  Hello world \n'), 'Hello world');
  assert.equal(text('Xin chào'), 'Xin chào');
  assert.equal(text('日本'), '日本');
  for (const skipped of ['', '   ', 'a', '42', '3.14 %', '→ • …', '😀😀', 'https://example.com/a', 'x'.repeat(2001)]) {
    assert.equal(text(skipped), '', JSON.stringify(skipped.slice(0, 20)));
  }
});

test('page translation edits text in place and never wraps page nodes', () => {
  const pageSection = contentScript.slice(contentScript.indexOf('whole-page translation'));
  assert.match(pageSection, /node\.nodeValue = /);
  assert.doesNotMatch(pageSection, /replaceChild/);
  // Style reads are allowed only to find an observable box for `display: contents`, never per text node.
  assert.equal(pageSection.match(/getComputedStyle/g)?.length, 1);
  assert.match(pageSection, /function pageObserveTarget[\s\S]*?getComputedStyle[\s\S]*?\n {2}\}/);
});
