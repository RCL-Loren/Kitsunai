import { get, getAll, put, remove } from '../db.js';
import { emit } from '../events.js';

const PARAM_NUMBERS = ['temperature', 'top_p', 'max_tokens'];
export const API_FORMAT_IDS = ['chat', 'responses', 'messages'];

const toNumber = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

// Pure: turns form-ish input into a stored model record.
export function normalizeModel(input) {
  const parameters = {};
  for (const key of PARAM_NUMBERS) {
    const n = toNumber(input.parameters?.[key]);
    if (n !== undefined) parameters[key] = n;
  }
  const extra = input.parameters?.extra;
  if (extra && typeof extra === 'object' && Object.keys(extra).length) parameters.extra = extra;

  const model = (input.model ?? '').trim();
  return {
    id: input.id || crypto.randomUUID(),
    name: (input.name ?? '').trim() || model,
    // Which API the endpoint speaks for this model; picks the adapter.
    // (Replaces the V1 `provider` field, which was always "openai-compatible".)
    apiFormat: API_FORMAT_IDS.includes(input.apiFormat) ? input.apiFormat : 'chat',
    preset: input.preset || 'custom',
    endpoint: (input.endpoint ?? '').trim().replace(/\/+$/, ''),
    model,
    credentials: { apiKey: (input.credentials?.apiKey ?? '').trim() },
    useProxy: Boolean(input.useProxy),
    systemPrompt: (input.systemPrompt ?? '').trim(),
    parameters,
  };
}

// Pure: returns { field: message } for invalid fields; empty object when valid.
export function validateModel(m) {
  const errors = {};
  if (!m.model) errors.model = 'Enter the model identifier the endpoint expects.';
  if (!m.name) errors.name = 'Give this model a name.';
  try {
    const url = new URL(m.endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.endpoint = 'Use an http:// or https:// URL.';
  } catch {
    errors.endpoint = 'Enter a base URL, e.g. http://localhost:8080/v1';
  }
  const { temperature, top_p, max_tokens } = m.parameters;
  if (temperature !== undefined && !(temperature >= 0 && temperature <= 2)) errors.temperature = 'Between 0 and 2.';
  if (top_p !== undefined && !(top_p > 0 && top_p <= 1)) errors.top_p = 'Greater than 0, at most 1.';
  if (max_tokens !== undefined && !(Number.isInteger(max_tokens) && max_tokens > 0)) errors.max_tokens = 'A positive whole number.';
  return errors;
}

export async function listModels() {
  const all = await getAll('models');
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export const getModel = (id) => get('models', id);

export async function saveModel(input) {
  const model = normalizeModel(input);
  const errors = validateModel(model);
  if (Object.keys(errors).length) throw Object.assign(new Error('Invalid model'), { errors });
  await put('models', model);
  emit('models:changed', { id: model.id });
  return model;
}

export async function deleteModel(id) {
  await remove('models', id);
  emit('models:changed', { id, deleted: true });
}
