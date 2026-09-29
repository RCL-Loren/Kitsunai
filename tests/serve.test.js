import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServe, checkRelayRequest, forwardHeaders, UPSTREAM_HEADER } from '../tools/serve.js';
import { createMockServer } from '../tools/mock-server.js';

let app, mock, appURL, mockURL, echo, echoURL, lastEchoHeaders;

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

before(async () => {
  mock = createMockServer({ tps: 5000, latency: 0 });
  mockURL = `http://127.0.0.1:${await listen(mock)}/v1`;
  echo = http.createServer((req, res) => {
    lastEchoHeaders = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  echoURL = `http://127.0.0.1:${await listen(echo)}/`;
  app = createServe();
  appURL = `http://localhost:${await listen(app)}`;
});

after(() => {
  for (const s of [app, mock, echo]) s.close();
});

test('serves index.html and blocks traversal and dotfiles', async () => {
  const res = await fetch(`${appURL}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /KitsunAI/);

  assert.equal((await fetch(`${appURL}/..%2F..%2Fetc%2Fpasswd`)).status, 403);
  assert.equal((await fetch(`${appURL}/.git/config`)).status, 404);
  assert.equal((await fetch(`${appURL}/nope.js`)).status, 404);
});

test('relays a streaming completion unchanged', async () => {
  const res = await fetch(`${appURL}/relay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [UPSTREAM_HEADER]: `${mockURL}/chat/completions` },
    body: JSON.stringify({ model: 'mock-fox', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'relay must not add CORS headers');
  const text = await res.text();
  assert.match(text, /^data: \{/);
  assert.match(text, /data: \[DONE\]\n\n$/);
});

test('relays GET requests and upstream error statuses', async () => {
  const models = await fetch(`${appURL}/relay`, { headers: { [UPSTREAM_HEADER]: `${mockURL}/models` } });
  assert.equal(models.status, 200);
  assert.equal((await models.json()).data[0].id, 'mock-fox');

  const missing = await fetch(`${appURL}/relay`, { headers: { [UPSTREAM_HEADER]: `${mockURL}/nope` } });
  assert.equal(missing.status, 404);
});

test('forwards auth but strips browser and relay headers', async () => {
  await fetch(`${appURL}/relay`, {
    method: 'POST',
    headers: { authorization: 'Bearer k', 'content-type': 'application/json', cookie: 'a=b', 'x-kitsunai-upstream': echoURL },
    body: '{}',
  });
  assert.equal(lastEchoHeaders.authorization, 'Bearer k');
  assert.equal(lastEchoHeaders.cookie, undefined);
  assert.equal(lastEchoHeaders['x-kitsunai-upstream'], undefined);

  const h = forwardHeaders({ 'sec-fetch-mode': 'cors', origin: 'x', 'x-api-key': 'k', 'anthropic-version': '1' });
  assert.deepEqual(h, { 'x-api-key': 'k', 'anthropic-version': '1' });
});

test('returns 502 when upstream is unreachable', async () => {
  const res = await fetch(`${appURL}/relay`, { headers: { [UPSTREAM_HEADER]: 'http://127.0.0.1:1/' } });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('x-kitsunai-relay-error'), '1');
  assert.match((await res.json()).error.message, /could not reach/);
});

test('rejects cross-origin, cross-site, rebinding, and bad upstreams', () => {
  const req = (headers) => ({ headers: { host: 'localhost:8000', [UPSTREAM_HEADER]: 'https://example.com/v1', ...headers } });
  assert.equal(checkRelayRequest(req({}), 8000), null);
  assert.equal(checkRelayRequest(req({ origin: 'http://localhost:8000', 'sec-fetch-site': 'same-origin' }), 8000), null);
  assert.match(checkRelayRequest(req({ origin: 'https://evil.example' }), 8000), /Cross-origin/);
  assert.match(checkRelayRequest(req({ 'sec-fetch-site': 'cross-site' }), 8000), /Cross-site/);
  assert.match(checkRelayRequest(req({ host: 'evil.example:8000' }), 8000), /localhost/);
  assert.match(checkRelayRequest(req({ [UPSTREAM_HEADER]: 'file:///etc/passwd' }), 8000), /http/);
  assert.match(checkRelayRequest(req({ [UPSTREAM_HEADER]: 'nope' }), 8000), /invalid/);
  assert.match(checkRelayRequest(req({ [UPSTREAM_HEADER]: 'http://localhost:8000/relay' }), 8000), /itself/);
});
