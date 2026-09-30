import { chat } from './openai.js';
import { responses } from './responses.js';
import { messages } from './messages.js';
import { ProviderError, isFormatMismatch } from './errors.js';
import { emit } from '../events.js';

// One adapter per API format; a model's apiFormat picks its adapter.
export const adapters = { chat, responses, messages };

export const API_FORMATS = [
  { id: 'chat', label: 'Chat Completions' },
  { id: 'responses', label: 'Responses' },
  { id: 'messages', label: 'Anthropic Messages' },
];

export const formatLabel = (id) => API_FORMATS.find((f) => f.id === id)?.label ?? API_FORMATS[0].label;

export function adapterFor(model) {
  const adapter = adapters[model.apiFormat ?? 'chat'];
  if (!adapter) throw new Error(`Unknown API format "${model.apiFormat}"`);
  return adapter;
}

// Presets only prefill the form (endpoint, relay). The API format is per model.
export const PRESETS = [
  { id: 'opencode-go', label: 'OpenCode Go', endpoint: 'https://opencode.ai/zen/go/v1', needsKey: true, useProxy: true,
    sessionHeader: 'x-opencode-session',
    hint: 'Uses the local relay. Test connection detects each model’s API format (Chat Completions, Responses or Anthropic Messages).' },
  { id: 'llama-cpp', label: 'llama.cpp', endpoint: 'http://localhost:8080/v1', needsKey: false, useProxy: false, hint: 'Local llama-server.' },
  { id: 'ollama', label: 'Ollama', endpoint: 'http://localhost:11434/v1', needsKey: false, useProxy: false, hint: 'Local Ollama server.' },
  { id: 'lm-studio', label: 'LM Studio', endpoint: 'http://localhost:1234/v1', needsKey: false, useProxy: false, hint: 'Local LM Studio server.' },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', needsKey: true, useProxy: false, hint: 'Hosted; supports browser requests.' },
  { id: 'custom', label: 'Custom', endpoint: '', needsKey: false, useProxy: false, hint: 'Any OpenAI-compatible or Anthropic-compatible endpoint.' },
];

export const presetFor = (id) => PRESETS.find((p) => p.id === id) ?? PRESETS.at(-1);

// Extra request headers a provider asks for. OpenCode Go wants a stable
// per-conversation session ID for routing and prompt caching. Other providers
// get none: a custom header on a direct browser call would trigger a CORS
// preflight that local servers may reject.
export function requestHeaders(model, sessionId) {
  const header = presetFor(model.preset).sessionHeader;
  return header && sessionId ? { [header]: sessionId } : {};
}

// Finds the API format a model accepts by sending a tiny test request in each
// format, starting with the one currently set. Stops at the first success, and
// at any error that isn't "wrong format" (a bad key fails every format alike).
// Resolves { format, message }; throws the most useful ProviderError otherwise.
export async function detectFormat(model, { signal, fetchImpl } = {}) {
  const current = model.apiFormat ?? 'chat';
  const order = [current, ...API_FORMATS.map((f) => f.id).filter((id) => id !== current)];
  let firstError = null;
  for (const format of order) {
    try {
      const message = await adapters[format].test({ ...model, apiFormat: format }, {
        signal, fetchImpl, headers: requestHeaders(model, crypto.randomUUID()),
      });
      return { format, message };
    } catch (err) {
      if (err.name === 'AbortError' || !isFormatMismatch(err)) throw err;
      firstError ??= err;
    }
  }
  throw new ProviderError(
    `The endpoint didn’t accept this model in any supported API format (Chat Completions, Responses, Anthropic Messages). ${firstError.message}`,
    { kind: 'http', status: firstError.status, body: firstError.body },
  );
}

// Connection status is in memory only: 'unverified' | 'testing' | 'ready' | 'error'.
const statuses = new Map();

export const getStatus = (modelId) => statuses.get(modelId) ?? { state: 'unverified' };

export function setStatus(modelId, status) {
  statuses.set(modelId, status);
  emit('model-status:changed', { modelId, ...status });
}

// Tests a saved model. Resolves { state, message, format } where `format` is
// the detected API format (the caller saves it if it changed).
export async function testModel(model) {
  setStatus(model.id, { state: 'testing' });
  try {
    const { format, message } = await detectFormat(model);
    const changed = format !== (model.apiFormat ?? 'chat');
    setStatus(model.id, { state: 'ready', message: changed ? `${message} Uses the ${formatLabel(format)} API.` : message });
    return { ...getStatus(model.id), format };
  } catch (err) {
    setStatus(model.id, { state: 'error', message: err.message });
    return getStatus(model.id);
  }
}
