import { test } from 'node:test';
import assert from 'node:assert/strict';
import { test as testConnection, stream, buildMessagesBody, alternate, DEFAULT_MAX_TOKENS } from '../js/providers/messages.js';
import { json, sseResponse, sse, stubFetch, collect, model } from './helpers.js';

test('request body: system, required max_tokens, parameters, extra', () => {
  const body = buildMessagesBody(model({ systemPrompt: 'Be brief.', parameters: { temperature: 0.5, extra: { top_k: 20 } } }), [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(body, {
    model: 'fox-1',
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    system: 'Be brief.',
    temperature: 0.5,
    top_k: 20,
  });
  assert.equal(buildMessagesBody(model({ parameters: { max_tokens: 99 } }), []).max_tokens, 99);
});

test('turns alternate: same-role turns merge and a leading assistant turn is dropped', () => {
  assert.deepEqual(alternate([
    { role: 'assistant', content: 'orphan' },
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'c' },
  ]), [{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }]);
});

test('streams text, thinking, finish and usage with x-api-key auth', async () => {
  const body = sse([
    { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Consider.' } } },
    { event: 'ping', data: { type: 'ping' } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi ' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'there.' } } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 7 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
  const { fetchImpl, calls } = stubFetch({ 'POST /messages': () => sseResponse(body.match(/[\s\S]{1,23}/g)) });
  const events = await collect(stream(model(), { messages: [{ role: 'user', content: 'hi' }], fetchImpl }));
  assert.deepEqual(events, [
    { type: 'reasoning', text: 'Consider.' },
    { type: 'text', text: 'Hi ' },
    { type: 'text', text: 'there.' },
    { type: 'finish', finishReason: 'length' },
    { type: 'usage', usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } },
  ]);
  const h = calls[0].headers;
  assert.equal(h.get('x-api-key'), 'sk-test');
  assert.equal(h.get('authorization'), null, 'no Bearer header (OpenCode Go reports it as a missing key)');
  assert.equal(h.get('anthropic-version'), '2023-06-01');
});

test('error events throw', async () => {
  const { fetchImpl } = stubFetch({ 'POST /messages': () => sseResponse([sse([{ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }])]) });
  await assert.rejects(collect(stream(model(), { messages: [], fetchImpl })), /Overloaded/);
});

test('non-streamed JSON messages are understood', async () => {
  const { fetchImpl } = stubFetch({
    'POST /messages': json(200, { content: [{ type: 'thinking', thinking: 'Hmm.' }, { type: 'text', text: 'Answer.' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 } }),
  });
  assert.deepEqual(await collect(stream(model(), { messages: [], fetchImpl })), [
    { type: 'reasoning', text: 'Hmm.' },
    { type: 'text', text: 'Answer.' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'usage', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
  ]);
});

test('test() sends a 1-token message', async () => {
  const { fetchImpl, calls } = stubFetch({ 'POST /messages': json(200, { content: [] }) });
  await testConnection(model(), { fetchImpl });
  assert.equal(JSON.parse(calls[0].body).max_tokens, 1);
  assert.equal(calls[0].headers.get('x-api-key'), 'sk-test');
});
