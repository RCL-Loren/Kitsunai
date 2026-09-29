import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestHeaders } from '../js/providers/index.js';

test('OpenCode Go gets a per-conversation session header; other providers get none', () => {
  assert.deepEqual(requestHeaders({ preset: 'opencode-go' }, 'conv-1'), { 'x-opencode-session': 'conv-1' });
  assert.deepEqual(requestHeaders({ preset: 'opencode-go' }, undefined), {});
  for (const preset of ['llama-cpp', 'ollama', 'lm-studio', 'openrouter', 'custom']) {
    assert.deepEqual(requestHeaders({ preset }, 'conv-1'), {}, preset);
  }
});
