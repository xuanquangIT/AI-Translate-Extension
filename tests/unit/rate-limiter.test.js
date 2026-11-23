/** Per-provider rate limiter: concurrency cap, Retry-After handling, fail-fast on long blocks. Fake clock only. */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ProviderHttpError, retryAfterMs } from '../../src/providers/http.js';
import { RateLimitedError, resetRateLimiter, withRateLimit } from '../../src/background/rate-limiter.js';

function fakeClock() {
  const clock = { time: 1_000_000, slept: [] };
  clock.now = () => clock.time;
  clock.sleep = async (ms) => {
    clock.slept.push(ms);
    clock.time += ms;
  };
  return clock;
}

const rateLimited = (retryAfter = null) =>
  new ProviderHttpError('Test failed (429): slow down', { status: 429, retryAfterMs: retryAfter });

beforeEach(() => resetRateLimiter());

test('runs at most maxConcurrent jobs per provider at once', async () => {
  let active = 0;
  let peak = 0;
  const job = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return 'done';
  };
  const results = await Promise.all(Array.from({ length: 6 }, () => withRateLimit('p', job, { maxConcurrent: 2 })));
  assert.deepEqual(results, Array(6).fill('done'));
  assert.equal(peak, 2);
});

test('providers are limited independently', async () => {
  let active = 0;
  let peak = 0;
  const job = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
  };
  await Promise.all(['a', 'b', 'c'].map((key) => withRateLimit(key, job, { maxConcurrent: 1 })));
  assert.equal(peak, 3);
});

test('retries a 429 after the server hint and succeeds', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await withRateLimit(
    'p',
    async () => {
      calls += 1;
      if (calls === 1) throw rateLimited(3000);
      return 'ok';
    },
    { clock, maxWaitMs: 10_000 }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(clock.slept, [3250]);
});

test('a 429 blocks queued requests for the same provider', async () => {
  const clock = fakeClock();
  await assert.rejects(
    withRateLimit(
      'p',
      async () => {
        throw rateLimited(5000);
      },
      { clock, maxRetries: 0 }
    ),
    RateLimitedError
  );
  await withRateLimit('p', async () => 'later', { clock });
  assert.deepEqual(clock.slept, [5250], 'the next request waits for the block to expire');
});

test('fails fast with RateLimitedError when the provider asks to wait too long', async () => {
  const clock = fakeClock();
  let calls = 0;
  await assert.rejects(
    withRateLimit(
      'p',
      async () => {
        calls += 1;
        throw rateLimited(120_000);
      },
      { clock, maxWaitMs: 20_000 }
    ),
    (error) => error instanceof RateLimitedError && error.status === 429 && error.retryAfterMs >= 120_000
  );
  assert.equal(calls, 1);
  assert.deepEqual(clock.slept, []);
});

test('gives up after maxRetries with exponential backoff', async () => {
  const clock = fakeClock();
  let calls = 0;
  await assert.rejects(
    withRateLimit(
      'p',
      async () => {
        calls += 1;
        throw rateLimited();
      },
      { clock, maxRetries: 2, maxWaitMs: 60_000, random: () => 0.5 }
    ),
    RateLimitedError
  );
  assert.equal(calls, 3);
  assert.deepEqual(clock.slept, [2000, 4000]);
});

test('requests queued for a slot re-check a block set while they waited', async () => {
  const clock = fakeClock();
  const fired = [];
  let releaseFirst;
  const first = withRateLimit(
    'p',
    async () => {
      fired.push(['first', clock.now()]);
      await new Promise((resolve) => (releaseFirst = resolve));
      throw rateLimited(4000);
    },
    { clock, maxConcurrent: 1, maxRetries: 0 }
  );
  const second = withRateLimit(
    'p',
    async () => {
      fired.push(['second', clock.now()]);
      return 'ok';
    },
    { clock, maxConcurrent: 1 }
  );
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirst();
  await assert.rejects(first, RateLimitedError);
  assert.equal(await second, 'ok');
  assert.deepEqual(fired, [
    ['first', 1_000_000],
    ['second', 1_004_250]
  ]);
});

test('non-rate-limit errors are rethrown untouched', async () => {
  const error = new ProviderHttpError('Test failed (401): bad key', { status: 401 });
  await assert.rejects(
    withRateLimit('p', async () => {
      throw error;
    }),
    (thrown) => thrown === error
  );
});

test('retryAfterMs reads Retry-After and provider reset headers', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const headers = (values) => new Headers(values);
  assert.equal(retryAfterMs(headers({ 'retry-after': '7' }), now), 7000);
  assert.equal(retryAfterMs(headers({ 'retry-after': 'Thu, 01 Jan 2026 00:00:30 GMT' }), now), 30_000);
  assert.equal(
    retryAfterMs(headers({ 'x-ratelimit-reset-requests': '1m30s', 'x-ratelimit-reset-tokens': '250ms' }), now),
    250,
    'without remaining counts, the shortest reset is used'
  );
  assert.equal(retryAfterMs(headers({ 'x-ratelimit-reset-requests': '1m30s' }), now), 90_000);
  assert.equal(retryAfterMs(headers({ 'anthropic-ratelimit-tokens-reset': '2026-01-01T00:00:12Z' }), now), 12_000);
  assert.equal(
    retryAfterMs(
      headers({
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '20s',
        'x-ratelimit-remaining-tokens': '9000',
        'x-ratelimit-reset-tokens': '6h0m0s'
      }),
      now
    ),
    20_000,
    'an exhausted bucket wins over a long reset on a bucket with quota left'
  );
  assert.equal(retryAfterMs(headers({}), now), null);
  assert.equal(retryAfterMs(headers({ 'x-ratelimit-reset-requests': 'soon' }), now), null);
  assert.equal(retryAfterMs(undefined, now), null);
});
