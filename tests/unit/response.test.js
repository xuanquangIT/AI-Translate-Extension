import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseBatchTranslationResponse,
  parsePartialBatchTranslationResponse,
  parseSingleTranslationResponse,
  validateTranslationOnlyResult
} from '../../src/translation/response.js';

describe('parseSingleTranslationResponse', () => {
  test('accepts plain and fenced translation JSON', () => {
    assert.equal(parseSingleTranslationResponse('{"translation":"Bonjour"}'), 'Bonjour');
    assert.equal(parseSingleTranslationResponse('```json\n{"translation":"Bonjour"}\n```'), 'Bonjour');
  });

  test('skips a leading reasoning block that quotes the contract (Gemma 4 thought output)', () => {
    const thought =
      '<thought>*   Constraints: Return exactly one valid JSON object `{"translation":"translated text"}`.\n' +
      '    *   `{"translation":"Chào thế giới."}`</thought>';
    assert.equal(parseSingleTranslationResponse(`${thought}{"translation":"Chào thế giới."}`), 'Chào thế giới.');
    assert.equal(parseSingleTranslationResponse('<think>plan</think>\n{"translation":"Hola"}'), 'Hola');
  });

  test('reasoning alone, or unterminated reasoning, still fails closed', () => {
    for (const raw of [
      '<thought>`{"translation":"translated text"}`</thought>',
      '<thought>…`{"translation":"Chào"}`'
    ]) {
      assert.throws(() => parseSingleTranslationResponse(raw), /required translation-only JSON/, raw);
    }
  });

  test('fails closed on prose, wrong keys, and extra keys', () => {
    assert.throws(() => parseSingleTranslationResponse('The answer is 4.'), /required translation-only JSON/);
    assert.throws(() => parseSingleTranslationResponse('{"answer":"4"}'), /required translation-only JSON/);
    assert.throws(
      () => parseSingleTranslationResponse('{"translation":"Bonjour","reasoning":"..."}'),
      /required translation-only JSON/
    );
    assert.throws(() => parseSingleTranslationResponse(''), /empty translation/);
  });
});

describe('validateTranslationOnlyResult', () => {
  test('keeps question form', () => {
    assert.equal(
      validateTranslationOnlyResult('What is 2+2?', 'Combien font deux plus deux ?'),
      'Combien font deux plus deux ?'
    );
  });

  test('rejects an answer to a source question', () => {
    assert.throws(
      () => validateTranslationOnlyResult('What is 2+2?', 'The answer is 4.'),
      /preserve the source question/
    );
  });
});

describe('parseBatchTranslationResponse', () => {
  test('accepts valid batch output with optional language', () => {
    assert.deepEqual(
      parseBatchTranslationResponse('{"detected_source_language":"en","translations":[{"id":"t1","text":"Bonjour"}]}'),
      { detected_source_language: 'en', translations: [{ id: 't1', text: 'Bonjour' }] }
    );
    assert.deepEqual(
      parseBatchTranslationResponse('```json\n{"translations":[{"id":"t1","text":"Hello"}]}\n```').translations,
      [{ id: 't1', text: 'Hello' }]
    );
  });

  test('accepts any order when every expected ID is present once', () => {
    assert.deepEqual(
      parseBatchTranslationResponse('{"translations":[{"id":"t2","text":"Deux"},{"id":"t1","text":"Un"}]}', [
        't1',
        't2'
      ]).translations,
      [
        { id: 't2', text: 'Deux' },
        { id: 't1', text: 'Un' }
      ]
    );
  });

  test('rejects missing, duplicate, extra-key, and malformed output', () => {
    const cases = [
      ['{"translations":[{"id":"t1","text":"Un"}]}', ['t1', 't2']],
      ['{"translations":[{"id":"t1","text":"Un"},{"id":"t1","text":"Deux"}]}', ['t1', 't2']],
      ['{"translations":[{"id":"t1","text":"Un"}],"answer":"4"}', []],
      ['{"unexpected":true}', []],
      ['{"translations":[{"id":"t1","text":"Un"},{"id":"t9","text":"Neuf"}]}', ['t1', 't2']]
    ];
    for (const [raw, ids] of cases) {
      assert.throws(() => parseBatchTranslationResponse(raw, ids), /required page-translation JSON/, raw);
    }
  });
});

describe('parsePartialBatchTranslationResponse', () => {
  const segments = [
    { id: 's0', text: 'Hello' },
    { id: 's1', text: 'What is 2 + 2?' },
    { id: 's2', text: 'Goodbye' },
    { id: 's3', text: 'Thanks' }
  ];

  test('keeps valid entries and reports the rest as missing', () => {
    const raw = JSON.stringify({
      detected_source_language: 'en',
      translations: [
        { id: 's0', text: ' Xin chào ' },
        { id: 's1', text: 'The answer is 4.' },
        { id: 's0', text: 'duplicate' },
        { id: 's2', text: '' },
        { id: 's9', text: 'unknown id' }
      ]
    });
    assert.deepEqual(parsePartialBatchTranslationResponse(raw, segments), {
      detected_source_language: 'en',
      translations: [{ id: 's0', text: 'Xin chào' }],
      missingIds: ['s1', 's2', 's3'],
      rejectedIds: ['s1']
    });
  });

  test('accepts fenced output and an empty translation list', () => {
    const fenced = ['```json', '{"translations":[{"id":"s3","text":"Cảm ơn"}]}', '```'].join('\n');
    assert.deepEqual(parsePartialBatchTranslationResponse(fenced, segments).translations, [
      { id: 's3', text: 'Cảm ơn' }
    ]);
    assert.deepEqual(parsePartialBatchTranslationResponse('{"translations":[]}', segments).missingIds, [
      's0',
      's1',
      's2',
      's3'
    ]);
  });

  test('the envelope itself stays strict', () => {
    for (const raw of [
      '',
      'Sure! Here you go: Xin chào',
      '{"translations":[{"id":"s0","text":"Xin chào"}],"answer":"4"}',
      '{"translations":"Xin chào"}'
    ]) {
      assert.throws(
        () => parsePartialBatchTranslationResponse(raw, segments),
        /page translation|page-translation JSON/,
        raw
      );
    }
  });
});

test('batch parsers skip a leading reasoning block', () => {
  const reply =
    '<thought>*   `translations`: `{"id": "s0", "text": "Chào thế giới."}`</thought>' +
    '{"detected_source_language":"en", "translations":[{"id":"s0","text":"Chào thế giới."}]}';
  assert.deepEqual(parseBatchTranslationResponse(reply, ['s0']).translations, [{ id: 's0', text: 'Chào thế giới.' }]);
  assert.deepEqual(parsePartialBatchTranslationResponse(reply, [{ id: 's0', text: 'Hello world.' }]).translations, [
    { id: 's0', text: 'Chào thế giới.' }
  ]);
});
