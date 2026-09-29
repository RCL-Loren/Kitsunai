// KitsunAI entry point. Classic vendor scripts (markdownit, hljs, katex) run before this module.

import { openDB } from './db.js';
import { loadSettings } from './data/settings.js';
import { renderSidebar, setActiveNav } from './ui/sidebar.js';
import { renderHome, renderPlaceholder, renderFatal } from './ui/home.js';
import { renderModelsList, renderModelForm } from './ui/models-screen.js';

const root = document.documentElement;
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const sidebar = document.querySelector('.sidebar');
const main = document.querySelector('#main');

function applySystemTheme() {
  root.dataset.theme = prefersLight.matches ? 'light' : 'dark';
}
prefersLight.addEventListener('change', applySystemTheme);

// Routes: [pattern, nav section, render(main, params, query) → cleanup?]
const ROUTES = [
  [/^\/?$/, null, (el) => renderHome(el)],
  [/^\/models$/, 'models', (el) => renderModelsList(el)],
  [/^\/models\/new$/, 'models', (el, _, q) => renderModelForm(el, { setup: q.has('setup') })],
  [/^\/models\/([\w-]+)$/, 'models', (el, [id]) => renderModelForm(el, { id })],
  [/^\/new$/, 'new', (el) => renderPlaceholder(el, 'Choose your companion', 'Starting conversations arrives in milestone 3.')],
  [/^\/chat\/([\w-]+)$/, null, (el) => renderPlaceholder(el, 'Conversation', 'Conversations arrive in milestone 3.')],
  [/^\/settings$/, 'settings', (el) => renderPlaceholder(el, 'Settings', 'Settings arrive in milestone 5.')],
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

  renderSidebar(sidebar);
  try {
    await openDB();
    await loadSettings();
  } catch (err) {
    renderFatal(main, `${err.message} KitsunAI stores conversations in IndexedDB, which may be disabled in private browsing.`);
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
