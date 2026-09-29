// OpenAI-compatible Chat Completions adapter (OpenCode Go, llama.cpp, Ollama,
// LM Studio, OpenRouter, ...).

import { providerFetch, RELAY_MARKER } from './transport.js';
import { ProviderError, httpErrorMessage, extractErrorDetail } from './errors.js';
import { createSSEParser } from './sse.js';

const hostOf = (endpoint) => {
  try { return new URL(endpoint).host; } catch { return endpoint; }
};

export function buildHeaders(model, extra = {}) {
  const headers = { ...extra };
  if (model.credentials?.apiKey) headers.authorization = `Bearer ${model.credentials.apiKey}`;
  return headers;
}

// Sends a request and turns every failure mode into a ProviderError with a
// message fit for the UI. AbortErrors pass through untouched.
export async function send(model, path, init = {}, fetchImpl) {
  const url = model.endpoint.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await providerFetch(model, url, { ...init, headers: buildHeaders(model, init.headers) }, fetchImpl);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ProviderError(
      model.useProxy
        ? 'Couldn’t reach the local relay. Start KitsunAI with “node tools/serve.js”.'
        : `Couldn’t reach ${hostOf(model.endpoint)}. The server may be offline, or it may not allow browser requests — try turning on “Use local relay”.`,
      { kind: 'network' },
    );
  }
  if (model.useProxy && !res.headers.get(RELAY_MARKER)) {
    throw new ProviderError('The local relay isn’t running. Start KitsunAI with “node tools/serve.js”.', { kind: 'relay-missing', status: res.status });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const relayError = res.headers.get('x-kitsunai-relay-error');
    throw new ProviderError(relayError ? extractErrorDetail(body) : httpErrorMessage(res.status, body), {
      kind: relayError ? 'relay' : 'http',
      status: res.status,
      body,
    });
  }
  return res;
}

export async function listModels(model, { signal, fetchImpl } = {}) {
  const res = await send(model, '/models', { method: 'GET', signal }, fetchImpl);
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json?.data)) throw new ProviderError('The /models response was not in the expected format.', { kind: 'protocol' });
  return json.data.map((m) => m.id).filter(Boolean).sort();
}

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

// Pure: the Chat Completions request body. Extra JSON is merged last so users
// can override anything (e.g. "stream_options": null for picky servers).
export function buildChatBody(model, messages) {
  const { temperature, top_p, max_tokens, extra } = model.parameters ?? {};
  const body = {
    model: model.model,
    messages: model.systemPrompt ? [{ role: 'system', content: model.systemPrompt }, ...messages] : messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (max_tokens !== undefined) body.max_tokens = max_tokens;
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === null) delete body[k];
    else body[k] = v;
  }
  return body;
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
  if (/application\/json/.test(res.headers.get('content-type') ?? '')) {
    yield* chunkEvents(await res.json());
    return;
  }

  let queue = [];
  let done = false;
  const parser = createSSEParser(({ data }) => {
    if (done) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return; // ignore non-JSON keep-alives some proxies inject
    }
    queue.push(...chunkEvents(json));
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (!done) {
      let result;
      try {
        result = await reader.read();
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        throw new ProviderError('The connection dropped before the response finished.', { kind: 'network' });
      }
      if (result.done) { parser.end(); done = true; }
      else parser.push(result.value);
      const events = queue;
      queue = [];
      yield* events;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export const openai = { id: 'openai-compatible', label: 'OpenAI-compatible', listModels, test, stream };
