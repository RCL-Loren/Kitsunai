// Shared HTTP plumbing for all API-format adapters: auth headers, error
// handling, /models listing, and reading SSE streams.

import { providerFetch, RELAY_MARKER } from './transport.js';
import { ProviderError, httpErrorMessage, extractErrorDetail } from './errors.js';
import { createSSEParser } from './sse.js';

const hostOf = (endpoint) => {
  try { return new URL(endpoint).host; } catch { return endpoint; }
};

// auth: 'bearer' (OpenAI-style) or 'x-api-key' (Anthropic-style).
export function buildHeaders(model, extra = {}, auth = 'bearer') {
  const headers = { ...extra };
  const key = model.credentials?.apiKey;
  if (key) {
    if (auth === 'x-api-key') headers['x-api-key'] = key;
    else headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

// Sends a request and turns every failure mode into a ProviderError with a
// message fit for the UI. AbortErrors pass through untouched.
export async function send(model, path, init = {}, fetchImpl, { auth = 'bearer' } = {}) {
  const url = model.endpoint.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await providerFetch(model, url, { ...init, headers: buildHeaders(model, init.headers, auth) }, fetchImpl);
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

export async function listModels(model, { signal, fetchImpl, auth } = {}) {
  const res = await send(model, '/models', { method: 'GET', signal }, fetchImpl, { auth });
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json?.data)) throw new ProviderError('The /models response was not in the expected format.', { kind: 'protocol' });
  return json.data.map((m) => m.id).filter(Boolean).sort();
}

// Pure: merges the model's "Extra request JSON" last, so users can override
// anything; null removes a field (e.g. "stream_options": null).
export function mergeExtra(body, extra) {
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === null) delete body[k];
    else body[k] = v;
  }
  return body;
}

// Reads an SSE response and yields adapter events. `handle({ event, data })`
// returns an array of events, or null when the stream is logically finished.
// Aborts throw AbortError; a dropped connection throws ProviderError('network').
export async function* readSSE(res, signal, handle) {
  let queue = [];
  let done = false;
  const parser = createSSEParser((message) => {
    if (done) return;
    const events = handle(message);
    if (events === null) done = true;
    else queue.push(...events);
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

// Parses SSE data as JSON; returns undefined for keep-alives or junk.
export function parseJSON(data) {
  try { return JSON.parse(data); } catch { return undefined; }
}

export const isJSONResponse = (res) => /application\/json/.test(res.headers.get('content-type') ?? '');
