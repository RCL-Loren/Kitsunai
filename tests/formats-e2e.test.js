// End to end over real HTTP: each adapter against a mock server that only
// speaks one API format, including format detection.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer, RESPONSES } from '../tools/mock-server.js';
import { adapters, detectFormat } from '../js/providers/index.js';

const servers = {};
const endpoints = {};

before(async () => {
  for (const format of ['chat', 'responses', 'messages']) {
    const server = createMockServer({ tps: 20000, latency: 0, reasoning: true, formats: format });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    servers[format] = server;
    endpoints[format] = `http://127.0.0.1:${server.address().port}/v1`;
  }
});

after(() => Object.values(servers).forEach((s) => s.close()));

const modelFor = (format, apiFormat = format) => ({
  endpoint: endpoints[format], model: 'mock-fox', credentials: { apiKey: 'sk-test' }, useProxy: false, parameters: {}, preset: 'custom', apiFormat,
});

for (const format of ['chat', 'responses', 'messages']) {
  test(`${format}: detection finds it starting from Chat Completions`, async () => {
    const { format: detected } = await detectFormat(modelFor(format, 'chat'));
    assert.equal(detected, format);
  });

  test(`${format}: streams the full answer, reasoning, finish and usage`, async () => {
    let text = '';
    let reasoning = '';
    const other = [];
    for await (const e of adapters[format].stream(modelFor(format), { messages: [{ role: 'user', content: 'hi' }] })) {
      if (e.type === 'text') text += e.text;
      else if (e.type === 'reasoning') reasoning += e.text;
      else other.push(e.type);
    }
    assert.ok(RESPONSES.includes(text), 'answer arrives intact');
    assert.match(reasoning, /standard second-order form/);
    assert.ok(other.includes('finish'));
    if (format !== 'chat') assert.ok(other.includes('usage'));
  });
}

test('a wrong format fails with the mismatch message the UI explains', async () => {
  await assert.rejects(
    (async () => { for await (const _ of adapters.chat.stream(modelFor('responses', 'chat'), { messages: [] })) { /* drain */ } })(),
    /different API format — run Test connection/,
  );
});
