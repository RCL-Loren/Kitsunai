import { openai } from './openai.js';
import { emit } from '../events.js';

export const adapters = { [openai.id]: openai };

export function adapterFor(model) {
  const adapter = adapters[model.provider];
  if (!adapter) throw new Error(`Unknown provider "${model.provider}"`);
  return adapter;
}

// Presets only prefill the form. All use the OpenAI-compatible adapter.
export const PRESETS = [
  { id: 'opencode-go', label: 'OpenCode Go', endpoint: 'https://opencode.ai/zen/go/v1', needsKey: true, useProxy: true,
    hint: 'Chat Completions models only (GLM, Kimi, DeepSeek, LongCat, Hy). Requires the local relay.' },
  { id: 'llama-cpp', label: 'llama.cpp', endpoint: 'http://localhost:8080/v1', needsKey: false, useProxy: false, hint: 'Local llama-server.' },
  { id: 'ollama', label: 'Ollama', endpoint: 'http://localhost:11434/v1', needsKey: false, useProxy: false, hint: 'Local Ollama server.' },
  { id: 'lm-studio', label: 'LM Studio', endpoint: 'http://localhost:1234/v1', needsKey: false, useProxy: false, hint: 'Local LM Studio server.' },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', needsKey: true, useProxy: false, hint: 'Hosted; supports browser requests.' },
  { id: 'custom', label: 'Custom', endpoint: '', needsKey: false, useProxy: false, hint: 'Any OpenAI-compatible endpoint.' },
];

export const presetFor = (id) => PRESETS.find((p) => p.id === id) ?? PRESETS.at(-1);

// Connection status is in memory only: 'unverified' | 'testing' | 'ready' | 'error'.
const statuses = new Map();

export const getStatus = (modelId) => statuses.get(modelId) ?? { state: 'unverified' };

export function setStatus(modelId, status) {
  statuses.set(modelId, status);
  emit('model-status:changed', { modelId, ...status });
}

export async function testModel(model) {
  setStatus(model.id, { state: 'testing' });
  try {
    const message = await adapterFor(model).test(model);
    setStatus(model.id, { state: 'ready', message });
  } catch (err) {
    setStatus(model.id, { state: 'error', message: err.message });
  }
  return getStatus(model.id);
}
