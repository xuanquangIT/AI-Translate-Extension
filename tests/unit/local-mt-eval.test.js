import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVAL_MODELS,
  buildEvalRequest,
  checkRubric,
  compileCheck,
  findModel,
  groupMeans,
  looksLikeTarget,
  percentile,
  readEvalResponse,
  spreadIndices
} from '../../scripts/local-mt/eval-lib.mjs';
import { buildMtPrompt } from '../../scripts/local-mt/lib.mjs';

const crafted = JSON.parse(readFileSync(new URL('../../scripts/local-mt/eval-items.json', import.meta.url), 'utf8'));

test('instruct models get the exact bridge prompt with thinking disabled', () => {
  const request = buildEvalRequest('instruct', { text: 'Hello.', src: 'en', tgt: 'vi' }, 64);
  assert.equal(request.path, '/v1/chat/completions');
  assert.deepEqual(request.body.messages, [
    { role: 'user', content: buildMtPrompt({ text: 'Hello.', sourceLanguage: 'en', targetLanguage: 'vi' }) }
  ]);
  assert.deepEqual(request.body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.max_tokens, 64);
});

test('Hy-MT2 uses its Chinese prompt when Chinese is involved and its English prompt otherwise', () => {
  const zh = buildEvalRequest('hymt', { text: '你好', src: 'zh', tgt: 'vi' }, 64).body.messages[0].content;
  assert.match(zh, /^将以下文本翻译为越南语/);
  assert.ok(zh.endsWith('\n\n你好'));
  const en = buildEvalRequest('hymt', { text: 'Hi', src: 'ja', tgt: 'vi' }, 64).body.messages[0].content;
  assert.match(en, /^Translate the following text into Vietnamese\./);
});

test('MiLMMT and Seed-X use raw completion prompts in their documented formats', () => {
  const milmmt = buildEvalRequest('milmmt', { text: '我爱你', src: 'zh', tgt: 'en' }, 32);
  assert.equal(milmmt.path, '/completion');
  assert.equal(
    milmmt.body.prompt,
    'Translate this from Chinese (Simplified) to English:\nChinese (Simplified): 我爱你\nEnglish:'
  );
  const seedx = buildEvalRequest('seedx', { text: 'Hello', src: 'en', tgt: 'ko' }, 32);
  assert.equal(seedx.body.prompt, 'Translate the following English sentence into Korean:\nHello <ko>');
  assert.ok(seedx.body.stop.length > 0);
});

test('EraX, Index-Translate, LMT-60, and PLaMo requests follow their model cards', () => {
  const eraxBody = buildEvalRequest('erax', { text: '你好', src: 'zh', tgt: 'vi' }, 32).body;
  const erax = eraxBody.messages;
  assert.equal(erax[0].role, 'system');
  assert.match(erax[0].content, /^Bạn là Trợ lý AI xuất sắc về dịch thuật/);
  assert.equal(erax[1].content, '你好\nDịch sang tiếng Việt.');
  assert.ok(eraxBody.stop.includes('<|im_end|>'));

  const index = buildEvalRequest('indextrans', { text: 'Hi', src: 'en', tgt: 'vi' }, 32).body;
  assert.equal(index.messages[0].content, '请将以下文本翻译为越南语，直接输出翻译结果，不要进行任何解释。\n\nHi');
  assert.deepEqual(index.chat_template_kwargs, { enable_thinking: false });

  const lmt = buildEvalRequest('lmt', { text: 'こんにちは', src: 'ja', tgt: 'vi' }, 32).body.messages[0].content;
  assert.equal(lmt, 'Translate the following text from Japanese into Vietnamese:\nJapanese: こんにちは\nVietnamese:');

  const plamo = buildEvalRequest('plamo', { text: '안녕', src: 'ko', tgt: 'vi' }, 32).body;
  assert.deepEqual(plamo.messages, [{ role: 'user', content: '안녕' }]);
  assert.deepEqual(plamo.chat_template_kwargs, { source_lang: 'ko', target_lang: 'vi' });
  assert.deepEqual(plamo.stop, ['<|plamo:tag|>', '<|plamo:bos|>']);
});

test('buildEvalRequest rejects unknown styles and languages', () => {
  assert.throws(() => buildEvalRequest('nope', { text: 'x', src: 'en', tgt: 'vi' }, 8), /Unknown prompt style/);
  assert.throws(() => buildEvalRequest('milmmt', { text: 'x', src: 'en', tgt: 'xx' }, 8), /Unsupported language/);
});

test('readEvalResponse reads chat and completion replies and strips thinking blocks', () => {
  const chat = readEvalResponse({
    choices: [{ message: { content: '<think>hmm</think>\nXin chào' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3 }
  });
  assert.deepEqual(
    { text: chat.text, promptTokens: chat.promptTokens, completionTokens: chat.completionTokens, finish: chat.finish },
    { text: 'Xin chào', promptTokens: 10, completionTokens: 3, finish: 'stop' }
  );
  const completion = readEvalResponse({
    content: ' Bonjour ',
    tokens_evaluated: 7,
    tokens_predicted: 2,
    stop_type: 'limit'
  });
  assert.equal(completion.text, 'Bonjour');
  assert.equal(completion.finish, 'length');
  assert.equal(completion.completionTokens, 2);
});

test('compileCheck w: prefix matches whole Vietnamese words only', () => {
  assert.ok(compileCheck('w:bà').test('Bà: Cháu ăn chưa?'));
  assert.ok(!compileCheck('w:bà').test('bàn ghế'));
  assert.ok(!compileCheck('w:tôi').test('tối nay'));
  assert.ok(compileCheck('w:(Lee|Yi|Lý)').test('trưởng phòng Lý'));
});

test('checkRubric counts required and forbidden patterns', () => {
  const item = { require: ['w:bà', '\\{count\\}'], forbid: ['w:tôi'] };
  assert.deepEqual(checkRubric(item, 'Bà có {count} tin nhắn'), { passed: 3, total: 3, failures: [] });
  const bad = checkRubric(item, 'Tôi có tin nhắn');
  assert.equal(bad.passed, 0);
  assert.deepEqual(bad.failures, ['missing w:bà', 'missing \\{count\\}', 'forbidden w:tôi']);
});

test('every crafted item is well formed, its patterns compile, and its reference passes its own rubric', () => {
  const ids = new Set();
  for (const item of crafted.items) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    for (const field of ['id', 'domain', 'src', 'tgt', 'source', 'reference']) {
      assert.equal(typeof item[field], 'string', `${item.id}.${field}`);
    }
    assert.ok(Array.isArray(item.require) && Array.isArray(item.forbid), item.id);
    const result = checkRubric(item, item.reference);
    assert.deepEqual(result.failures, [], `${item.id} reference fails its rubric`);
    assert.ok(looksLikeTarget(item.tgt, item.reference), `${item.id} reference is not in ${item.tgt}`);
  }
});

test('looksLikeTarget detects output in the wrong script', () => {
  assert.ok(looksLikeTarget('vi', 'Xin chào các bạn'));
  assert.ok(!looksLikeTarget('vi', 'Hello everyone'));
  assert.ok(looksLikeTarget('ja', 'こんにちは'));
  assert.ok(!looksLikeTarget('ko', '你好'));
});

test('percentile, groupMeans, and spreadIndices are deterministic', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([], 95), 0);
  assert.deepEqual(
    groupMeans(
      [
        { k: 'a', v: 2 },
        { k: 'a', v: 4 },
        { k: 'b', v: 1 }
      ],
      (r) => r.k,
      ['v']
    ),
    {
      a: { n: 2, v: 3 },
      b: { n: 1, v: 1 }
    }
  );
  assert.deepEqual(spreadIndices(10, 4), [0, 2, 5, 7]);
  assert.deepEqual(spreadIndices(3, 5), [0, 1, 2]);
});

test('the model catalog has unique ids, GGUF files, and known prompt styles', () => {
  const ids = new Set(EVAL_MODELS.map((model) => model.id));
  assert.equal(ids.size, EVAL_MODELS.length);
  for (const model of EVAL_MODELS) {
    assert.match(model.file, /\.gguf$/);
    assert.ok(
      ['instruct', 'hymt', 'milmmt', 'seedx', 'erax', 'indextrans', 'lmt', 'plamo'].includes(model.style),
      model.id
    );
  }
  assert.equal(findModel('gemma4-e2b').style, 'instruct');
  assert.throws(() => findModel('missing'), /Unknown model/);
});
