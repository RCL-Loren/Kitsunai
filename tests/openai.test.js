import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listModels, test as testConnection, send, stream, buildChatBody, chunkEvents } from '../js/providers/openai.js';
import { providerFetch } from '../js/providers/transport.js';
import { httpErrorMessage, extractErrorDetail } from '../js/providers/errors.js';

const model = (over = {}) => ({
  endpoint: 'https://api.example.com/v1/', model: 'fox-1', credentials: { apiKey: 'sk-test' }, useProxy: false, ...over,
});

// Records calls and answers from a route table: { 'GET /models': Response | fn }
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const upstream = headers.get('x-kitsunai-upstream');
    const path = new URL(upstream ?? url, 'http://local').pathname.replace(/^\/v1/, '');
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ url, key, headers, body: init.body });
    const route = routes[key];
    if (!route) throw new TypeError('Failed to fetch');
    return typeof route === 'function' ? route() : route.clone();
  };
  return { fetchImpl, calls };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('providerFetch goes direct or through the relay', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push([url, new Headers(init.headers).get('x-kitsunai-upstream')]); return new Response('ok'); };
  await providerFetch({ useProxy: false }, 'https://a/v1/models', {}, f);
  await providerFetch({ useProxy: true }, 'https://a/v1/models', { headers: { authorization: 'Bearer k' } }, f);
  assert.deepEqual(seen, [['https://a/v1/models', null], ['/relay', 'https://a/v1/models']]);
});

test('listModels returns sorted ids and sends the bearer token', async () => {
  const { fetchImpl, calls } = stubFetch({ 'GET /models': json(200, { data: [{ id: 'b' }, { id: 'a' }] }) });
  assert.deepEqual(await listModels(model(), { fetchImpl }), ['a', 'b']);
  assert.equal(calls[0].url, 'https://api.example.com/v1/models');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer sk-test');
});

test('no authorization header without a key', async () => {
  const { fetchImpl, calls } = stubFetch({ 'GET /models': json(200, { data: [] }) });
  await listModels(model({ credentials: { apiKey: '' } }), { fetchImpl });
  assert.equal(calls[0].headers.get('authorization'), null);
});

test('test() sends a 1-token completion, even when /models is public', async () => {
  const { fetchImpl, calls } = stubFetch({
    'GET /models': json(200, { data: [{ id: 'fox-1' }] }),
    'POST /chat/completions': json(200, { choices: [] }),
  });
  assert.match(await testConnection(model(), { fetchImpl }), /answered/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'POST /chat/completions');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.max_tokens, 1);
  assert.equal(body.model, 'fox-1');
  assert.equal(calls[0].headers.get('content-type'), 'application/json');
});

test('test() surfaces bad model ids and auth failures', async () => {
  const badModel = stubFetch({ 'POST /chat/completions': json(400, { error: { message: 'model "fox-1" not found' } }) });
  await assert.rejects(testConnection(model(), { fetchImpl: badModel.fetchImpl }), (err) => {
    assert.equal(err.kind, 'http');
    assert.equal(err.status, 400);
    assert.match(err.message, /model "fox-1" not found/);
    return true;
  });
  const badKey = stubFetch({ 'POST /chat/completions': json(401, { type: 'error', error: { message: 'Missing API key.' } }) });
  await assert.rejects(testConnection(model({ credentials: { apiKey: '' } }), { fetchImpl: badKey.fetchImpl }), /Authentication failed.*Missing API key/);
});

test('network failures explain CORS and suggest the relay', async () => {
  const { fetchImpl } = stubFetch({});
  await assert.rejects(listModels(model(), { fetchImpl }), (err) => err.kind === 'network' && /Use local relay/.test(err.message));
  await assert.rejects(listModels(model({ useProxy: true }), { fetchImpl }), (err) => err.kind === 'network' && /tools\/serve\.js/.test(err.message));
});

test('detects a static server with no relay', async () => {
  const { fetchImpl } = stubFetch({ 'GET /models': new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(listModels(model({ useProxy: true }), { fetchImpl }), (err) => err.kind === 'relay-missing');
});

test('relay upstream failures use the relay message', async () => {
  const { fetchImpl } = stubFetch({
    'GET /models': json(502, { error: { message: 'Relay could not reach api.example.com: ENOTFOUND' } }, { 'x-kitsunai-relay': '1', 'x-kitsunai-relay-error': '1' }),
  });
  await assert.rejects(listModels(model({ useProxy: true }), { fetchImpl }), (err) => err.kind === 'relay' && /ENOTFOUND/.test(err.message));
});

test('aborts pass through untouched', async () => {
  const fetchImpl = async () => { throw new DOMException('aborted', 'AbortError'); };
  await assert.rejects(send(model(), '/models', {}, fetchImpl), { name: 'AbortError' });
});

test('error message helpers', () => {
  assert.equal(extractErrorDetail('{"error":"plain"}'), 'plain');
  assert.equal(extractErrorDetail('{"detail":"fastapi style"}'), 'fastapi style');
  assert.equal(extractErrorDetail('<html><b>Bad</b> gateway</html>'), 'Bad gateway');
  assert.match(httpErrorMessage(429, ''), /^Rate limited.*\(429\)$/);
  assert.match(httpErrorMessage(503, '{"error":{"message":"overloaded"}}'), /server error.*503: overloaded/);
});

// ── Streaming ───────────────────────────────────────────────────────────────

// A Response whose body emits `chunks` (strings) one by one.
function sseResponse(chunks, { close = true, fail = false } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) return controller.enqueue(encoder.encode(chunks[i++]));
      if (fail) return controller.error(new TypeError('terminated'));
      if (close) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;

async function collect(iter) {
  const out = [];
  for await (const e of iter) out.push(e);
  return out;
}

test('buildChatBody adds system prompt, parameters, and extra overrides', () => {
  const body = buildChatBody(
    { model: 'm', systemPrompt: 'Be brief.', parameters: { temperature: 0.2, max_tokens: 50, extra: { seed: 1, stream_options: null } } },
    [{ role: 'user', content: 'hi' }],
  );
  assert.deepEqual(body, {
    model: 'm',
    messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }],
    stream: true,
    temperature: 0.2,
    max_tokens: 50,
    seed: 1,
  });
  assert.deepEqual(buildChatBody({ model: 'm', parameters: {} }, []).stream_options, { include_usage: true });
});

test('stream yields text, reasoning, finish, and usage from split chunks', async () => {
  const raw = [
    chunk({ role: 'assistant', content: '' }),
    chunk({ reasoning_content: 'Think.' }),
    chunk({ content: 'Hello' }),
    chunk({ content: ', $x$' }),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 9 } })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const pieces = raw.match(/[\s\S]{1,13}/g); // split mid-JSON
  const { fetchImpl, calls } = stubFetch({ 'POST /chat/completions': () => sseResponse(pieces) });
  const events = await collect(stream(model(), { messages: [{ role: 'user', content: 'hi' }], fetchImpl }));
  assert.deepEqual(events, [
    { type: 'reasoning', text: 'Think.' },
    { type: 'text', text: 'Hello' },
    { type: 'text', text: ', $x$' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'usage', usage: { total_tokens: 9 } },
  ]);
  assert.equal(JSON.parse(calls[0].body).stream, true);
  assert.equal(calls[0].headers.get('accept'), 'text/event-stream');
});

test('stream accepts the `reasoning` alias and stops at [DONE]', async () => {
  const { fetchImpl } = stubFetch({
    'POST /chat/completions': () => sseResponse([chunk({ reasoning: 'r' }), 'data: [DONE]\n\n', chunk({ content: 'after done' })], { close: false }),
  });
  assert.deepEqual(await collect(stream(model(), { messages: [], fetchImpl })), [{ type: 'reasoning', text: 'r' }]);
});

test('stream ends cleanly when the server closes without [DONE]', async () => {
  const { fetchImpl } = stubFetch({ 'POST /chat/completions': () => sseResponse([chunk({ content: 'a' }), 'data: {"choices":[{"delta":{"content":"b"}}]}']) });
  const events = await collect(stream(model(), { messages: [], fetchImpl }));
  assert.deepEqual(events.map((e) => e.text), ['a', 'b']);
});

test('stream handles servers that ignore stream:true and return JSON', async () => {
  const { fetchImpl } = stubFetch({
    'POST /chat/completions': json(200, { choices: [{ message: { content: 'whole answer' }, finish_reason: 'stop' }] }),
  });
  const events = await collect(stream(model(), { messages: [], fetchImpl }));
  assert.deepEqual(events, [{ type: 'text', text: 'whole answer' }, { type: 'finish', finishReason: 'stop' }]);
});

test('a dropped connection mid-stream becomes a network ProviderError', async () => {
  const { fetchImpl } = stubFetch({ 'POST /chat/completions': () => sseResponse([chunk({ content: 'partial' })], { fail: true }) });
  const seen = [];
  await assert.rejects(async () => { for await (const e of stream(model(), { messages: [], fetchImpl })) seen.push(e); }, (err) => err.kind === 'network');
  assert.deepEqual(seen, [{ type: 'text', text: 'partial' }]);
});

test('an error payload inside the stream is surfaced', async () => {
  const { fetchImpl } = stubFetch({ 'POST /chat/completions': () => sseResponse(['data: {"error":{"message":"context length exceeded"}}\n\n']) });
  await assert.rejects(collect(stream(model(), { messages: [], fetchImpl })), /context length exceeded/);
});

test('aborting mid-stream throws AbortError', async () => {
  const controller = new AbortController();
  const fetchImpl = async (_url, init) => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(chunk({ content: 'x' })));
        init.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  const seen = [];
  await assert.rejects(async () => {
    for await (const e of stream(model(), { messages: [], signal: controller.signal, fetchImpl })) {
      seen.push(e);
      controller.abort();
    }
  }, { name: 'AbortError' });
  assert.equal(seen.length, 1);
});

test('chunkEvents ignores empty deltas', () => {
  assert.deepEqual(chunkEvents({ choices: [{ delta: { content: '' } }] }), []);
  assert.deepEqual(chunkEvents({ choices: [] }), []);
});
