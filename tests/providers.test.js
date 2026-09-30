import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestHeaders, detectFormat, adapterFor } from '../js/providers/index.js';
import { isFormatMismatch, httpErrorMessage } from '../js/providers/errors.js';
import { json, stubFetch, model } from './helpers.js';

test('OpenCode Go gets a per-conversation session header; other providers get none', () => {
  assert.deepEqual(requestHeaders({ preset: 'opencode-go' }, 'conv-1'), { 'x-opencode-session': 'conv-1' });
  assert.deepEqual(requestHeaders({ preset: 'opencode-go' }, undefined), {});
  for (const preset of ['llama-cpp', 'ollama', 'lm-studio', 'openrouter', 'custom']) {
    assert.deepEqual(requestHeaders({ preset }, 'conv-1'), {}, preset);
  }
});

// ── Format detection ─────────────────────────────────────────────────────────


const PROTOCOL = { type: 'error', error: { type: 'ModelError', message: 'Model does not support this protocol.' } };
const OPENAI_FMT = { type: 'error', error: { type: 'ModelError', message: 'Model gpt-6-luna is not supported for format openai' } };

test('detects the Responses format for a GPT Luna-style model', async () => {
  const { fetchImpl, calls } = stubFetch({
    'POST /chat/completions': json(400, PROTOCOL),
    'POST /responses': json(200, { status: 'completed', output: [] }),
  });
  const result = await detectFormat(model({ preset: 'opencode-go' }), { fetchImpl });
  assert.equal(result.format, 'responses');
  assert.deepEqual(calls.map((c) => c.key), ['POST /chat/completions', 'POST /responses']);
  assert.ok(calls.every((c) => c.headers.get('x-opencode-session')), 'session header on every probe');
});

test('detects Anthropic Messages after two mismatches', async () => {
  const { fetchImpl, calls } = stubFetch({
    'POST /chat/completions': json(400, PROTOCOL),
    'POST /responses': json(400, OPENAI_FMT),
    'POST /messages': json(200, { content: [] }),
  });
  assert.equal((await detectFormat(model(), { fetchImpl })).format, 'messages');
  assert.equal(calls[2].headers.get('x-api-key'), 'sk-test');
});

test('starts with the current format and stops on the first success', async () => {
  const { fetchImpl, calls } = stubFetch({ 'POST /responses': json(200, { output: [] }) });
  assert.equal((await detectFormat(model({ apiFormat: 'responses' }), { fetchImpl })).format, 'responses');
  assert.equal(calls.length, 1);
});

test('auth failures stop detection immediately', async () => {
  const { fetchImpl, calls } = stubFetch({ 'POST /chat/completions': json(401, { error: { message: 'Invalid API key.' } }) });
  await assert.rejects(detectFormat(model(), { fetchImpl }), /Authentication failed/);
  assert.equal(calls.length, 1);
});

test('a server without the other endpoints (404) keeps the first error', async () => {
  const { fetchImpl } = stubFetch({
    'POST /chat/completions': json(404, { error: { message: 'model "fox-1" not found' } }),
    'POST /responses': json(404, { error: { message: 'File Not Found' } }),
    'POST /messages': json(404, { error: { message: 'File Not Found' } }),
  });
  await assert.rejects(detectFormat(model(), { fetchImpl }), /any supported API format.*model "fox-1" not found/);
});

test('mismatch classification and chat-time wording', () => {
  const err = (status, body) => Object.assign(new Error('x'), { name: 'ProviderError', kind: 'http', status, body: JSON.stringify(body) });
  assert.equal(isFormatMismatch(err(400, PROTOCOL)), true);
  assert.equal(isFormatMismatch(err(400, OPENAI_FMT)), true);
  assert.equal(isFormatMismatch(err(404, {})), true);
  assert.equal(isFormatMismatch(err(400, { error: { message: 'max_tokens too large' } })), false);
  assert.equal(isFormatMismatch(err(401, {})), false);
  assert.match(httpErrorMessage(400, JSON.stringify(PROTOCOL)), /different API format — run Test connection/);
});

test('adapterFor picks by apiFormat; old records without it use Chat Completions', () => {
  assert.equal(adapterFor({ apiFormat: 'responses' }).id, 'responses');
  assert.equal(adapterFor({ apiFormat: 'messages' }).id, 'messages');
  assert.equal(adapterFor({ provider: 'openai-compatible' }).id, 'chat');
});
