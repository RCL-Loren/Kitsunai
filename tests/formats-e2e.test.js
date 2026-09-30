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

// ── Images, end to end ───────────────────────────────────────────────────────

const png = { mime: 'image/png', dataUrl: `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}` };
const jpg = { mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${Buffer.alloc(6000, 9).toString('base64')}` };

for (const format of ['chat', 'responses', 'messages']) {
  test(`${format}: images in history and the new turn all reach the provider`, async () => {
    const messages = [
      { role: 'user', content: 'first', images: [png] },
      { role: 'assistant', content: 'noted' },
      { role: 'user', content: 'and this?', images: [jpg] },
    ];
    let text = '';
    for await (const e of adapters[format].stream(modelFor(format), { messages })) if (e.type === 'text') text += e.text;
    assert.match(text, /^Received 2 images \(image\/png, 3 KB; image\/jpeg, 6 KB\)\./);
  });
}

test('a text-only model rejects images with a clear message', async () => {
  const server = createMockServer({ tps: 20000, latency: 0, 'no-vision': true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const m = { ...modelFor('chat'), endpoint: `http://127.0.0.1:${server.address().port}/v1` };
    await assert.rejects(
      (async () => { for await (const _ of adapters.chat.stream(m, { messages: [{ role: 'user', content: 'x', images: [png] }] })) { /* drain */ } })(),
      /doesn’t accept images/,
    );
  } finally {
    server.close();
  }
});
