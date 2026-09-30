// OpenAI-compatible Chat Completions adapter (OpenCode Go, llama.cpp, Ollama,
// LM Studio, OpenRouter, ...).

import { ProviderError } from './errors.js';
import { send, listModels, mergeExtra, readSSE, parseJSON, isJSONResponse } from './http.js';

// Resolves with a short success message, or throws ProviderError.
// A 1-token completion is the only check that proves endpoint, key and model
// id together: /models is often public (OpenCode Go) or ignores ids (llama.cpp).
export async function test(model, { signal, fetchImpl, headers = {} } = {}) {
  await send(model, '/chat/completions', {
    method: 'POST',
    signal,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  }, fetchImpl);
  return 'Connected — the model answered.';
}

// Pure: a message with images becomes a content array of text + image_url parts.
export function chatMessage({ role, content, images }) {
  if (!images?.length) return { role, content };
  const parts = content ? [{ type: 'text', text: content }] : [];
  for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  return { role, content: parts };
}

// Pure: the Chat Completions request body.
export function buildChatBody(model, messages) {
  const { temperature, top_p, max_tokens, extra } = model.parameters ?? {};
  const turns = messages.map(chatMessage);
  const body = {
    model: model.model,
    messages: model.systemPrompt ? [{ role: 'system', content: model.systemPrompt }, ...turns] : turns,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (max_tokens !== undefined) body.max_tokens = max_tokens;
  return mergeExtra(body, extra);
}

// Pure: maps one parsed chunk to adapter events.
export function chunkEvents(json) {
  if (json.error) {
    const message = typeof json.error === 'string' ? json.error : json.error.message ?? JSON.stringify(json.error);
    throw new ProviderError(`The provider reported an error mid-response: ${message}`, { kind: 'http' });
  }
  const events = [];
  const choice = json.choices?.[0];
  const delta = choice?.delta ?? choice?.message ?? {};
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (reasoning) events.push({ type: 'reasoning', text: reasoning });
  if (delta.content) events.push({ type: 'text', text: delta.content });
  if (choice?.finish_reason) events.push({ type: 'finish', finishReason: choice.finish_reason });
  if (json.usage) events.push({ type: 'usage', usage: json.usage });
  return events;
}

// Streams a chat completion. Yields {type:'text'|'reasoning', text},
// {type:'finish', finishReason}, {type:'usage', usage}. Aborting via `signal`
// throws an AbortError; connection loss throws ProviderError (kind 'network').
// `headers` carries provider-specific extras (e.g. OpenCode Go's session ID).
export async function* stream(model, { messages, signal, fetchImpl, headers = {} } = {}) {
  const res = await send(model, '/chat/completions', {
    method: 'POST',
    signal,
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(buildChatBody(model, messages)),
  }, fetchImpl);

  // Some servers ignore stream:true and answer with one JSON document.
  if (isJSONResponse(res)) {
    yield* chunkEvents(await res.json());
    return;
  }
  yield* readSSE(res, signal, ({ data }) => {
    if (data.trim() === '[DONE]') return null;
    const json = parseJSON(data);
    return json === undefined ? [] : chunkEvents(json);
  });
}

export const chat = { id: 'chat', label: 'Chat Completions', listModels, test, stream };
