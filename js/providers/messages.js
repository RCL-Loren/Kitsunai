// Anthropic Messages API adapter (POST /messages). OpenCode Go serves some of
// its MiniMax and Qwen models only through this format. Auth uses x-api-key.

import { ProviderError } from './errors.js';
import { send, listModels as listAll, mergeExtra, readSSE, parseJSON, isJSONResponse } from './http.js';

const ANTHROPIC_VERSION = '2023-06-01';
// max_tokens is required by this API; used when the model sets no Max tokens.
export const DEFAULT_MAX_TOKENS = 8192;
const AUTH = { auth: 'x-api-key' };

const apiHeaders = (headers, extra) => ({ ...headers, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json', ...extra });

export async function test(model, { signal, fetchImpl, headers = {} } = {}) {
  await send(model, '/messages', {
    method: 'POST',
    signal,
    headers: apiHeaders(headers),
    body: JSON.stringify({ model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  }, fetchImpl, AUTH);
  return 'Connected — the model answered.';
}

export const listModels = (model, options = {}) => listAll(model, { ...options, ...AUTH });

// Pure: turns must alternate and start with the user, so consecutive turns from
// the same role (e.g. a user retrying after an error) are merged.
export function alternate(messages) {
  const out = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last?.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

// Pure: the Messages request body. The system prompt is a top-level field.
export function buildMessagesBody(model, messages) {
  const { temperature, top_p, max_tokens, extra } = model.parameters ?? {};
  const body = {
    model: model.model,
    max_tokens: max_tokens ?? DEFAULT_MAX_TOKENS,
    messages: alternate(messages),
    stream: true,
  };
  if (model.systemPrompt) body.system = model.systemPrompt;
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  return mergeExtra(body, extra);
}

const FINISH = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length' };
const failure = (message) => new ProviderError(`The provider reported an error mid-response: ${message}`, { kind: 'http' });

// Pure: one streamed event → adapter events; null at message_stop.
// `state` carries input token counts from message_start to message_delta.
export function messagesEvents(json, state = {}) {
  switch (json.type) {
    case 'message_start':
      state.inputTokens = json.message?.usage?.input_tokens ?? 0;
      return [];
    case 'content_block_delta': {
      const d = json.delta ?? {};
      if (d.type === 'text_delta' && d.text) return [{ type: 'text', text: d.text }];
      if (d.type === 'thinking_delta' && d.thinking) return [{ type: 'reasoning', text: d.thinking }];
      return [];
    }
    case 'message_delta': {
      const events = [];
      const stop = json.delta?.stop_reason;
      if (stop) events.push({ type: 'finish', finishReason: FINISH[stop] ?? stop });
      const output = json.usage?.output_tokens;
      if (output !== undefined) {
        const input = state.inputTokens ?? 0;
        events.push({ type: 'usage', usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } });
      }
      return events;
    }
    case 'message_stop':
      return null;
    case 'error':
      throw failure(json.error?.message ?? 'unknown error');
    default:
      return []; // ping, content_block_start/stop
  }
}

// Pure: a non-streamed message → adapter events.
export function messageObjectEvents(message) {
  const events = [];
  for (const block of message.content ?? []) {
    if (block.type === 'thinking' && block.thinking) events.push({ type: 'reasoning', text: block.thinking });
    if (block.type === 'text' && block.text) events.push({ type: 'text', text: block.text });
  }
  if (message.stop_reason) events.push({ type: 'finish', finishReason: FINISH[message.stop_reason] ?? message.stop_reason });
  const u = message.usage;
  if (u) events.push({ type: 'usage', usage: { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) } });
  return events;
}

export async function* stream(model, { messages, signal, fetchImpl, headers = {} } = {}) {
  const res = await send(model, '/messages', {
    method: 'POST',
    signal,
    headers: apiHeaders(headers, { accept: 'text/event-stream' }),
    body: JSON.stringify(buildMessagesBody(model, messages)),
  }, fetchImpl, AUTH);

  if (isJSONResponse(res)) {
    yield* messageObjectEvents(await res.json());
    return;
  }
  const state = {};
  yield* readSSE(res, signal, ({ data }) => {
    const json = parseJSON(data);
    return json === undefined ? [] : messagesEvents(json, state);
  });
}

export const messages = { id: 'messages', label: 'Anthropic Messages', listModels, test, stream };
