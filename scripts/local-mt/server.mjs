/**
 * Local OpenAI-compatible bridge between LingoFlux and one llama-server per loaded local model
 * (scripts/local-mt/models.mjs: Gemma 4 E2B on 37814, Index-Translate 2B on 37815).
 *
 *   LingoFlux ──POST /v1/chat/completions (JSON envelope, "model": id)──▶ this bridge (127.0.0.1:37813)
 *     ──one request per segment, in parallel──▶ that model's llama-server (continuous batching)
 *
 * Standalone use serves a single upstream:
 * Usage: node scripts/local-mt/server.mjs [--port 37813] [--upstream http://127.0.0.1:37814]
 *        [--concurrency 32] [--model gemma-4-e2b-q4_k_m]
 * Binds to 127.0.0.1 only and sends no CORS headers, so web pages cannot read its replies; the
 * extension's service worker can, through its host permissions. Page text is never logged.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { MAX_SEGMENT_TOKENS, chatCompletion, parseEnvelope, translateEnvelope } from './lib.mjs';
import { BRIDGE_PORT, LLAMA_PORT, modelId } from './paths.mjs';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Greedy decoding keeps translations stable (sampling changed the wording run to run) and was the setting measured
 * in docs/LOCAL_MT.md. Thinking is switched off: it adds latency and tokens and does not help short segments.
 */
export const DEFAULT_SAMPLING = Object.freeze({ temperature: 0 });

/** The llama-server chat request for one segment. */
export function completionBody(prompt, maxTokens, sampling = DEFAULT_SAMPLING) {
  return {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
    ...sampling
  };
}

export function parseArgs(argv, env = process.env) {
  const get = (flag, envName, fallback) => {
    const index = argv.indexOf(flag);
    if (index >= 0 && argv[index + 1]) return argv[index + 1];
    return env[envName] || fallback;
  };
  return {
    port: Number(get('--port', 'LOCAL_MT_PORT', BRIDGE_PORT)),
    upstream: String(get('--upstream', 'LOCAL_MT_UPSTREAM', `http://127.0.0.1:${LLAMA_PORT}`)).replace(/\/+$/, ''),
    concurrency: Number(get('--concurrency', 'LOCAL_MT_CONCURRENCY', 32)),
    model: String(get('--model', 'LOCAL_MT_MODEL', modelId()))
  };
}

/** Returns a translateText function that calls llama-server's OpenAI endpoint for one segment. */
export function upstreamTranslator({ upstream, sampling = DEFAULT_SAMPLING, fetchImpl = fetch }) {
  const complete = async (prompt, maxTokens) => {
    const response = await fetchImpl(`${upstream}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(completionBody(prompt, maxTokens, sampling))
    });
    if (!response.ok) throw new Error(`llama-server returned HTTP ${response.status}.`);
    return response.json();
  };
  return async ({ prompt, maxTokens }) => {
    let data = await complete(prompt, maxTokens);
    // A reply cut at max_tokens is an incomplete translation: retry once with a larger budget, then fail closed.
    if (data?.choices?.[0]?.finish_reason === 'length') {
      const larger = Math.min(MAX_SEGMENT_TOKENS, maxTokens * 4);
      if (larger > maxTokens) data = await complete(prompt, larger);
      if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('The local model output was cut off.');
    }
    return {
      text: data?.choices?.[0]?.message?.content ?? '',
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0
    };
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Picks the loaded model a request asks for. An unknown or missing name goes to the first route, so a LingoFlux
 * provider saved with another model id keeps working after the tray switches models.
 */
export function pickRoute(routes, requested) {
  const name = String(requested || '').trim();
  return routes.find((route) => route.id === name) ?? routes[0];
}

/**
 * Builds the request handler. Pass `routes` ([{ id, translateText, buildPrompt? }], one per loaded model) or the
 * single-model shorthand `model` + `translateText`. `translateText` is injectable for tests.
 */
export function createHandler({ model, concurrency, translateText, buildPrompt, routes, log = () => {} }) {
  const table = routes?.length ? routes : [{ id: model, translateText, buildPrompt }];
  return async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
        const data = table.map((route) => ({ id: route.id, object: 'model', owned_by: 'local' }));
        return send(res, 200, { object: 'list', data });
      }
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
      if (req.method !== 'POST' || !(path === '/v1/chat/completions' || path === '/chat/completions')) {
        return send(res, 404, { error: { message: 'Not found.' } });
      }

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (error) {
        return send(res, 400, { error: { message: error.message || 'Invalid JSON body.' } });
      }
      let envelope;
      try {
        envelope = parseEnvelope(body);
      } catch (error) {
        return send(res, 400, { error: { message: error.message } });
      }

      const route = pickRoute(table, body.model);
      const started = performance.now();
      const { content, usage } = await translateEnvelope(
        envelope,
        route.translateText,
        route.concurrency ?? concurrency,
        route.buildPrompt
      );
      const ms = performance.now() - started;
      const count = envelope.kind === 'batch' ? envelope.segments.length : 1;
      log(
        `${route.id}: ${envelope.kind} ${count} seg → ${envelope.targetLanguage}: ${ms.toFixed(0)} ms, ` +
          `${usage.completion_tokens} out tok, ${((usage.completion_tokens / ms) * 1000).toFixed(0)} tok/s`
      );
      return send(res, 200, chatCompletion(body.model || route.id, content, usage));
    } catch (error) {
      return send(res, 502, { error: { message: `Local translation failed: ${error.message}` } });
    }
  };
}

/**
 * Starts the bridge. `options.routes` ([{ id, upstream, buildPrompt, concurrency }]) serves several llama-servers;
 * without it, one route is built from `options.model` and `options.upstream`.
 */
export function startServer(options = parseArgs(process.argv.slice(2))) {
  const specs = options.routes?.length
    ? options.routes
    : [{ id: options.model, upstream: options.upstream, concurrency: options.concurrency }];
  const routes = specs.map((spec) => ({
    id: spec.id,
    buildPrompt: spec.buildPrompt,
    concurrency: spec.concurrency ?? options.concurrency,
    translateText: upstreamTranslator({ upstream: spec.upstream })
  }));
  const handler = createHandler({
    routes,
    concurrency: options.concurrency,
    log: (line) => console.log(`[local-mt] ${line}`)
  });
  const server = http.createServer(handler);
  server.listen(options.port, '127.0.0.1', () => {
    const list = specs.map((spec) => `"${spec.id}" → ${spec.upstream}`).join(', ');
    console.log(`[local-mt] bridge on http://127.0.0.1:${options.port}/v1: ${list} (default "${specs[0].id}")`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
