import { test } from 'node:test';
import assert from 'node:assert/strict';
import { test as testConnection, stream, buildResponsesBody, responsesEvents } from '../js/providers/responses.js';
import { json, sseResponse, sse, stubFetch, collect, model } from './helpers.js';

test('request body: input, instructions, parameters, extra', () => {
  const body = buildResponsesBody(
    model({ systemPrompt: 'Be brief.', parameters: { temperature: 0.2, max_tokens: 500, extra: { reasoning: { effort: 'low' } } } }),
    [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: '$x$?' }],
  );
  assert.deepEqual(body, {
    model: 'fox-1',
    input: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: '$x$?' }],
    stream: true,
    instructions: 'Be brief.',
    temperature: 0.2,
    max_output_tokens: 500,
    reasoning: { effort: 'low' },
  });
});

test('streams text, reasoning, finish and usage; stops at response.completed', async () => {
  const body = sse([
    { event: 'response.created', data: { type: 'response.created', response: { status: 'in_progress' } } },
    { event: 'response.reasoning_summary_text.delta', data: { type: 'response.reasoning_summary_text.delta', delta: 'Think.' } },
    { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', delta: 'Hello, ' } },
    { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', delta: '$x$' } },
    { event: 'response.completed', data: { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } } },
    { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', delta: 'ignored after completion' } },
  ]);
  const { fetchImpl, calls } = stubFetch({ 'POST /responses': () => sseResponse(body.match(/[\s\S]{1,17}/g)) });
  const events = await collect(stream(model(), { messages: [{ role: 'user', content: 'hi' }], fetchImpl, headers: { 'x-opencode-session': 's1' } }));
  assert.deepEqual(events, [
    { type: 'reasoning', text: 'Think.' },
    { type: 'text', text: 'Hello, ' },
    { type: 'text', text: '$x$' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'usage', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
  ]);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer sk-test');
  assert.equal(calls[0].headers.get('x-opencode-session'), 's1');
});

test('incomplete responses report the length limit', () => {
  assert.deepEqual(
    responsesEvents({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }),
    [{ type: 'finish', finishReason: 'length' }],
  );
});

test('failed responses and error events throw', () => {
  assert.throws(() => responsesEvents({ type: 'response.failed', response: { error: { message: 'overloaded' } } }), /overloaded/);
  assert.throws(() => responsesEvents({ type: 'error', message: 'bad request' }), /bad request/);
});

test('non-streamed JSON responses are understood', async () => {
  const { fetchImpl } = stubFetch({
    'POST /responses': json(200, {
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Hmm.' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Whole answer.' }] },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    }),
  });
  assert.deepEqual(await collect(stream(model(), { messages: [], fetchImpl })), [
    { type: 'reasoning', text: 'Hmm.' },
    { type: 'text', text: 'Whole answer.' },
    { type: 'finish', finishReason: 'stop' },
    { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
  ]);
});

test('test() sends a minimal request (max_output_tokens ≥ 16)', async () => {
  const { fetchImpl, calls } = stubFetch({ 'POST /responses': json(200, { status: 'completed', output: [] }) });
  await testConnection(model(), { fetchImpl });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.max_output_tokens, 16);
  assert.equal(body.model, 'fox-1');
});
