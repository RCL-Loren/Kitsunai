// OpenAI Responses API adapter (POST /responses). OpenCode Go serves its GPT,
// Grok and Muse Spark models only through this format.

import { ProviderError } from './errors.js';
import { send, listModels, mergeExtra, readSSE, parseJSON, isJSONResponse } from './http.js';

// The API rejects max_output_tokens below 16.
const TEST_MAX_OUTPUT_TOKENS = 16;

export async function test(model, { signal, fetchImpl, headers = {} } = {}) {
  await send(model, '/responses', {
    method: 'POST',
    signal,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.model, input: 'ping', max_output_tokens: TEST_MAX_OUTPUT_TOKENS }),
  }, fetchImpl);
  return 'Connected — the model answered.';
}

// Pure: the Responses request body. The system prompt becomes `instructions`.
export function buildResponsesBody(model, messages) {
  const { temperature, top_p, max_tokens, extra } = model.parameters ?? {};
  const body = {
    model: model.model,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (model.systemPrompt) body.instructions = model.systemPrompt;
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (max_tokens !== undefined) body.max_output_tokens = max_tokens;
  return mergeExtra(body, extra);
}

const usageOf = (u) => u && {
  prompt_tokens: u.input_tokens,
  completion_tokens: u.output_tokens,
  total_tokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
};

// A finished response object → finish/usage events (shared by stream and JSON).
function endEvents(response) {
  const events = [];
  const reason = response?.incomplete_details?.reason;
  const finishReason = response?.status === 'incomplete'
    ? (reason === 'max_output_tokens' ? 'length' : reason ?? 'incomplete')
    : 'stop';
  events.push({ type: 'finish', finishReason });
  const usage = usageOf(response?.usage);
  if (usage) events.push({ type: 'usage', usage });
  return events;
}

const failure = (message) => new ProviderError(`The provider reported an error mid-response: ${message}`, { kind: 'http' });

// Pure: one streamed event → adapter events; null once the response is finished.
export function responsesEvents(json) {
  switch (json.type) {
    case 'response.output_text.delta':
      return json.delta ? [{ type: 'text', text: json.delta }] : [];
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta':
      return json.delta ? [{ type: 'reasoning', text: json.delta }] : [];
    case 'response.completed':
    case 'response.incomplete':
      return endEvents(json.response);
    case 'response.failed':
      throw failure(json.response?.error?.message ?? 'the response failed');
    case 'error':
      throw failure(json.message ?? json.error?.message ?? 'unknown error');
    default:
      return [];
  }
}

// Pure: a non-streamed response object → adapter events.
export function responseObjectEvents(response) {
  const events = [];
  for (const item of response.output ?? []) {
    if (item.type === 'reasoning') {
      const text = (item.summary ?? []).map((s) => s.text).join('\n');
      if (text) events.push({ type: 'reasoning', text });
    }
    if (item.type === 'message') {
      const text = (item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
      if (text) events.push({ type: 'text', text });
    }
  }
  return [...events, ...endEvents(response)];
}

export async function* stream(model, { messages, signal, fetchImpl, headers = {} } = {}) {
  const res = await send(model, '/responses', {
    method: 'POST',
    signal,
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(buildResponsesBody(model, messages)),
  }, fetchImpl);

  if (isJSONResponse(res)) {
    yield* responseObjectEvents(await res.json());
    return;
  }
  let finished = false;
  yield* readSSE(res, signal, ({ data }) => {
    if (finished) return null;
    const json = parseJSON(data);
    if (json === undefined) return [];
    const events = responsesEvents(json);
    if (json.type === 'response.completed' || json.type === 'response.incomplete') finished = true;
    return events;
  });
}

export const responses = { id: 'responses', label: 'Responses', listModels, test, stream };
