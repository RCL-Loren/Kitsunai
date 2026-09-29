// KitsunAI entry point. Classic vendor scripts (markdownit, hljs, katex) run before this module.

const root = document.documentElement;
const prefersLight = matchMedia('(prefers-color-scheme: light)');

function applySystemTheme() {
  root.dataset.theme = prefersLight.matches ? 'light' : 'dark';
}
prefersLight.addEventListener('change', applySystemTheme);

const missing = ['markdownit', 'hljs', 'katex'].filter((name) => !(name in globalThis));
if (missing.length) console.error(`[KitsunAI] Missing vendored libraries: ${missing.join(', ')}. Run scripts/vendor.sh.`);
