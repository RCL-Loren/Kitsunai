import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, validateModel } from '../js/data/models.js';

test('normalizeModel trims, fills defaults, and drops empty parameters', () => {
  const m = normalizeModel({
    name: '  ', model: ' kimi-k3 ', endpoint: ' https://opencode.ai/zen/go/v1/// ',
    credentials: { apiKey: ' sk-1 ' }, useProxy: 1, preset: 'opencode-go',
    parameters: { temperature: '0.7', top_p: '', max_tokens: undefined, extra: {} },
  });
  assert.equal(m.name, 'kimi-k3', 'name falls back to model id');
  assert.equal(m.model, 'kimi-k3');
  assert.equal(m.endpoint, 'https://opencode.ai/zen/go/v1');
  assert.equal(m.credentials.apiKey, 'sk-1');
  assert.equal(m.useProxy, true);
  assert.equal(m.provider, 'openai-compatible');
  assert.deepEqual(m.parameters, { temperature: 0.7 });
  assert.match(m.id, /^[0-9a-f-]{36}$/);
});

test('normalizeModel keeps an existing id and extra params', () => {
  const m = normalizeModel({ id: 'abc', model: 'x', endpoint: 'http://h/v1', parameters: { extra: { seed: 1 } } });
  assert.equal(m.id, 'abc');
  assert.deepEqual(m.parameters, { extra: { seed: 1 } });
});

test('validateModel reports each invalid field', () => {
  const ok = normalizeModel({ model: 'm', endpoint: 'http://localhost:8080/v1' });
  assert.deepEqual(validateModel(ok), {});

  const bad = normalizeModel({ model: '', endpoint: 'ftp://x', parameters: { temperature: 3, top_p: 0, max_tokens: 1.5 } });
  assert.deepEqual(Object.keys(validateModel(bad)).sort(), ['endpoint', 'max_tokens', 'model', 'name', 'temperature', 'top_p']);
  assert.ok(validateModel(normalizeModel({ model: 'm', endpoint: 'not a url' })).endpoint);
});
