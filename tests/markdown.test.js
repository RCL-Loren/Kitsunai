import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMarkdownRenderer, HIGHLIGHT_LIMIT } from '../js/render/markdown.js';

const require = createRequire(import.meta.url);
const render = createMarkdownRenderer({
  markdownit: require('../vendor/markdown-it/markdown-it.min.js'),
  hljs: require('../vendor/highlight/highlight.min.js'),
  katex: require('../vendor/katex/katex.min.js'),
});

test('fenced code gets a header, copy button, and highlighting', () => {
  const html = render('```python\nprint("hi")\n```');
  assert.match(html, /<div class="code-block"><div class="code-header"><span class="code-lang">python<\/span><button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy<\/button><\/div>/);
  assert.match(html, /<code class="hljs language-python"><span class="hljs-built_in">print<\/span>/);
});

test('highlighting can be skipped for the live streaming block', () => {
  const html = render('```python\nprint("hi")\n```', { highlight: false });
  assert.match(html, /<code class="hljs language-python">print\(&quot;hi&quot;\)\n<\/code>/);
});

test('unknown or missing languages are escaped, not auto-detected', () => {
  assert.match(render('```nope\n<b>x</b>\n```'), /<span class="code-lang">nope<\/span>.*<code class="hljs">&lt;b&gt;x&lt;\/b&gt;/s);
  assert.match(render('```\nplain\n```'), /<span class="code-lang">text<\/span>/);
  assert.match(render('    indented'), /<span class="code-lang">text<\/span>.*indented/s);
});

test('language labels are escaped', () => {
  assert.doesNotMatch(render('```"><img>\nx\n```'), /<img>/);
});

test('extra technical languages are available', () => {
  for (const lang of ['latex', 'matlab', 'julia', 'verilog', 'vhdl']) {
    assert.match(render(`\`\`\`${lang}\nx\n\`\`\``), new RegExp(`language-${lang}`));
  }
});

test('```math fences render display math', () => {
  const html = render('```math\nx^2\n```');
  assert.match(html, /^<div class="math-block"><span class="katex-display">/);
});

test('KaTeX renders inline and display math, and bad TeX does not throw', () => {
  assert.match(render('$E=mc^2$'), /<span class="math-inline"><span class="katex">/);
  assert.match(render('$$\n\\frac{a}{b}\n$$'), /<div class="math-block"><span class="katex-display">/);
  assert.match(render('$\\frac{a$'), /katex-error/);
});

test('raw HTML is escaped and dangerous links are not linked', () => {
  const html = render('<script>alert(1)</script> [x](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('links open safely in a new tab; bare URLs are linkified', () => {
  assert.match(render('[a](https://example.com)'), /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">a<\/a>/);
  assert.match(render('see https://example.com'), /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">/);
});

test('images load lazily without a referrer', () => {
  assert.match(render('![alt](https://example.com/a.png)'), /<img src="https:\/\/example.com\/a.png" alt="alt" loading="lazy" referrerpolicy="no-referrer">/);
});

test('tables are wrapped for horizontal scrolling', () => {
  const html = render('| a | b |\n|---|---|\n| 1 | $x$ |');
  assert.match(html, /^<div class="table-wrap"><table>/);
  assert.match(html, /<\/table><\/div>\n$/);
  assert.match(html, /<td><span class="math-inline">/);
});

test('very large code blocks skip highlighting', () => {
  const big = 'x = 1\n'.repeat(Math.ceil(HIGHLIGHT_LIMIT / 6) + 10);
  const html = render('```python\n' + big + '```');
  assert.match(html, /not highlighted \(large\)/);
  assert.doesNotMatch(html, /hljs-number/);
  assert.match(render('```python\nx = 1\n```'), /hljs-number/);
});

test('chunked rendering wraps groups of top-level blocks and is otherwise identical', () => {
  const doc = Array.from({ length: 60 }, (_, i) => i % 5 === 0 ? `## Heading ${i}` : i % 7 === 0 ? '```js\nx\n```' : `Paragraph ${i} with $x_{${i}}$.`).join('\n\n') + '\n\n- a\n- b\n';
  const plain = render(doc);
  const chunked = render(doc, { chunk: 24 });
  assert.equal((chunked.match(/<div class="frozen-chunk">/g) ?? []).length, 3);
  const unwrapped = chunked.replace(/<\/div><div class="frozen-chunk">/g, '').replace(/^<div class="frozen-chunk">/, '').replace(/<\/div>$/, '');
  assert.equal(unwrapped, plain);
  assert.equal(render('Short.\n\nMessage.', { chunk: 24 }), render('Short.\n\nMessage.'), 'short messages are not wrapped');
});
