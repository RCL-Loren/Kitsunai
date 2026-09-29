// OpenAI-compatible Chat Completions adapter (OpenCode Go, llama.cpp, Ollama,
// LM Studio, OpenRouter, ...). Streaming is added in milestone 3.

import { providerFetch, RELAY_MARKER } from './transport.js';
import { ProviderError, httpErrorMessage, extractErrorDetail } from './errors.js';

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
export async function test(model, { signal, fetchImpl } = {}) {
  await send(model, '/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  }, fetchImpl);
  return 'Connected — the model answered.';
}

export const openai = { id: 'openai-compatible', label: 'OpenAI-compatible', listModels, test };
