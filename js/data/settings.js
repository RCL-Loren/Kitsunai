import { getAll, put } from '../db.js';
import { emit } from '../events.js';

export const DEFAULT_SETTINGS = Object.freeze({
  displayName: 'User',
  theme: 'system', // 'system' | 'dark' | 'light'
  exportFrontmatter: true,
  defaultTags: ['llm-chat'],
  sendOnEnter: true,
});

let cache = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
  const rows = await getAll('settings');
  cache = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return cache;
}

// Synchronous read of the last loaded values.
export const getSettings = () => cache;

export async function setSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
  await put('settings', { key, value });
  cache = { ...cache, [key]: value };
  emit('settings:changed', { key, value });
}
