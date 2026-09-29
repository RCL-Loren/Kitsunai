// The one Markdown pipeline for user and assistant messages.
// createMarkdownRenderer is pure (libraries are injected) so Node tests can use it;
// renderMarkdown is the browser instance built from the vendored globals.

import { mathPlugin } from './math-plugin.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

const MATH_FENCES = new Set(['math', 'latex-display', 'katex']);
const MATH_CACHE_LIMIT = 2000;

export function createMarkdownRenderer({ markdownit, hljs, katex }) {
  const mathCache = new Map();

  function renderMath(tex, displayMode) {
    const key = (displayMode ? 'D' : 'I') + tex;
    let html = mathCache.get(key);
    if (html === undefined) {
      html = katex.renderToString(tex, { displayMode, throwOnError: false, trust: false, output: 'htmlAndMathml' });
      if (mathCache.size >= MATH_CACHE_LIMIT) mathCache.delete(mathCache.keys().next().value);
      mathCache.set(key, html);
    }
    return html;
  }

  const md = markdownit({ html: false, linkify: true, typographer: false, breaks: false });
  md.use(mathPlugin, { render: renderMath });

  // Code blocks: header with language + copy button; highlighting unless env.highlight === false.
  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    const code = token.content;
    if (MATH_FENCES.has(lang.toLowerCase())) return `<div class="math-block">${renderMath(code.trim(), true)}</div>\n`;

    const known = lang && hljs.getLanguage(lang);
    const body = known && env?.highlight !== false
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(code);
    const label = escapeHtml(lang || 'text');
    return `<div class="code-block"><div class="code-header"><span class="code-lang">${label}</span>`
      + `<button type="button" class="code-copy" data-copy-code>Copy</button></div>`
      + `<pre><code class="hljs${known ? ` language-${label}` : ''}">${body}</code></pre></div>\n`;
  };
  md.renderer.rules.code_block = (tokens, idx) =>
    `<div class="code-block"><div class="code-header"><span class="code-lang">text</span>`
    + `<button type="button" class="code-copy" data-copy-code>Copy</button></div>`
    + `<pre><code class="hljs">${escapeHtml(tokens[idx].content)}</code></pre></div>\n`;

  // Links open in a new tab without leaking the opener or referrer.
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, e, self) => self.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('loading', 'lazy');
    tokens[idx].attrSet('referrerpolicy', 'no-referrer');
    return defaultImage(tokens, idx, options, env, self);
  };

  // Wide tables scroll horizontally inside their own wrapper.
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';

  return function render(src, { highlight = true } = {}) {
    return md.render(src, { highlight });
  };
}

let browserRenderer;

export function renderMarkdown(src, options) {
  browserRenderer ??= createMarkdownRenderer({ markdownit: globalThis.markdownit, hljs: globalThis.hljs, katex: globalThis.katex });
  return browserRenderer(src, options);
}
