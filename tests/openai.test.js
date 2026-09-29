import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listModels, test as testConnection, send } from '../js/providers/openai.js';
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
