// KitsunAI entry point. Classic vendor scripts (markdownit, hljs, katex) run before this module.

import { openDB } from './db.js';
import { loadSettings, getSettings } from './data/settings.js';
import { on } from './events.js';
import { renderSidebar, setActiveNav } from './ui/sidebar.js';
import { renderHome, renderFatal } from './ui/home.js';
import { renderSettings } from './ui/settings-screen.js';
import { renderModelsList, renderModelForm } from './ui/models-screen.js';
import { renderNewChat } from './ui/new-chat.js';
import { renderConversation } from './ui/conversation-view.js';
import { attachCodeCopy } from './render/code-blocks.js';
import { startProfile, stopProfile } from './dev/perf.js';

const root = document.documentElement;
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const sidebar = document.querySelector('.sidebar');
const main = document.querySelector('#main');

// Theme: the setting, or the OS preference when set to "system". Mirrored to
// localStorage so the inline script in index.html can apply it before first paint.
function applyTheme() {
  const setting = getSettings().theme;
  root.dataset.theme = setting === 'system' ? (prefersLight.matches ? 'light' : 'dark') : setting;
  try { localStorage.setItem('kitsunai-theme', setting); } catch { /* storage unavailable */ }
}
prefersLight.addEventListener('change', applyTheme);
on('settings:changed', ({ key }) => { if (key === 'theme') applyTheme(); });

// Routes: [pattern, nav section, render(main, params, query) → cleanup?]
const ROUTES = [
  [/^\/?$/, null, (el) => renderHome(el)],
  [/^\/models$/, 'models', (el) => renderModelsList(el)],
  [/^\/models\/new$/, 'models', (el, _, q) => renderModelForm(el, { setup: q.has('setup') })],
  [/^\/models\/([\w-]+)$/, 'models', (el, [id]) => renderModelForm(el, { id })],
  [/^\/new$/, 'new', (el) => renderNewChat(el)],
  [/^\/new\/([\w-]+)$/, null, (el, [modelId]) => renderConversation(el, { modelId })],
  [/^\/chat\/([\w-]+)$/, null, (el, [id]) => renderConversation(el, { id })],
  [/^\/settings$/, 'settings', (el) => renderSettings(el)],
];

let cleanup = null;
let navToken = 0;

async function route() {
  const [path, search = ''] = location.hash.replace(/^#/, '').split('?');
  const query = new URLSearchParams(search);
  const match = ROUTES.map(([re, nav, render]) => [re.exec(path), nav, render]).find(([m]) => m);
  if (!match) { location.replace('#/'); return; }
  const [m, nav, render] = match;

  const token = ++navToken;
  cleanup?.();
  cleanup = null;
  setActiveNav(sidebar, nav);
  main.scrollTop = 0;
  try {
    const result = await render(main, m.slice(1), query);
    // Ignore cleanups from screens that were navigated away from mid-render.
    if (token === navToken) cleanup = typeof result === 'function' ? result : null;
    else if (typeof result === 'function') result();
  } catch (err) {
    console.error('[KitsunAI]', err);
    renderFatal(main, err.message);
  }
}

async function boot() {
  const missing = ['markdownit', 'hljs', 'katex'].filter((name) => !(name in globalThis));
  if (missing.length) console.error(`[KitsunAI] Missing vendored libraries: ${missing.join(', ')}. Run scripts/vendor.sh.`);

  attachCodeCopy(main);
  try {
    await openDB();
    await loadSettings();
    applyTheme();
    renderSidebar(sidebar);
  } catch (err) {
    renderFatal(main, `${err.message} KitsunAI stores conversations in IndexedDB, which may be disabled in private browsing.`);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

// Developer hooks for performance work (see DevDocs/perf-notes.md).
window.kitsunai = {
  debug: {
    seed: async (n = 500) => (await import('./dev/seed.js')).seed(n),
    startProfile,
    stopProfile,
  },
};

boot();
