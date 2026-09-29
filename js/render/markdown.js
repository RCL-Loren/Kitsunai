// The one Markdown pipeline for user and assistant messages.
// createMarkdownRenderer is pure (libraries are injected) so Node tests can use it;
// renderMarkdown is the browser instance built from the vendored globals.

import { mathPlugin } from './math-plugin.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

const MATH_FENCES = new Set(['math', 'latex-display', 'katex']);
// Above this size a code block renders as plain text: tens of thousands of
// highlight spans cost hundreds of ms to parse and lay out (see perf-notes.md).
export const HIGHLIGHT_LIMIT = 32 * 1024;
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
    const tooLarge = code.length > HIGHLIGHT_LIMIT;
    const body = known && !tooLarge && env?.highlight !== false
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(code);
    const label = escapeHtml(lang || 'text');
    const note = tooLarge && known && env?.highlight !== false ? '<span class="code-note">not highlighted (large)</span>' : '';
    return `<div class="code-block"><div class="code-header"><span class="code-lang">${label}${note}</span>`
      + `<button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy</button></div>`
      + `<pre><code class="hljs${known ? ` language-${label}` : ''}">${body}</code></pre></div>\n`;
  };
  md.renderer.rules.code_block = (tokens, idx) =>
    `<div class="code-block"><div class="code-header"><span class="code-lang">text</span>`
    + `<button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy</button></div>`
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

  // chunk > 0 wraps every `chunk` top-level blocks in <div class="frozen-chunk">
  // (content-visibility: auto), so long messages only lay out their visible part.
  // Done at the HTML-string level: moving built DOM nodes into wrappers costs
  // ~1 s for a 200 KB message. Short messages render without wrappers.
  return function render(src, { highlight = true, chunk = 0 } = {}) {
    const env = { highlight };
    if (!chunk) return md.render(src, env);
    const tokens = md.parse(src, env);
    const groups = [];
    let current = [];
    let blocks = 0;
    for (const token of tokens) {
      current.push(token);
      if (token.level === 0 && token.nesting <= 0 && ++blocks % chunk === 0) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
    if (groups.length <= 2) return md.renderer.render(tokens, md.options, env);
    return groups.map((g) => `<div class="frozen-chunk">${md.renderer.render(g, md.options, env)}</div>`).join('');
  };
}

let browserRenderer;

export function renderMarkdown(src, options) {
  browserRenderer ??= createMarkdownRenderer({ markdownit: globalThis.markdownit, hljs: globalThis.hljs, katex: globalThis.katex });
  return browserRenderer(src, options);
}
