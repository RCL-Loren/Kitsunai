import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mathPlugin } from '../js/render/math-plugin.js';

const require = createRequire(import.meta.url);
const markdownit = require('../vendor/markdown-it/markdown-it.min.js');

const md = markdownit().use(mathPlugin, { render: (tex, display) => `[${display ? 'D' : 'I'}:${tex}]` });
const render = (src) => md.render(src).trim();
const inline = (src) => md.renderInline(src);

test('inline $…$', () => {
  assert.equal(inline('where $\\zeta$ is damping'), 'where <span class="math-inline">[I:\\zeta]</span> is damping');
  assert.equal(inline('$E=mc^2$'), '<span class="math-inline">[I:E=mc^2]</span>');
  assert.equal(inline('$a$ and $b$'), '<span class="math-inline">[I:a]</span> and <span class="math-inline">[I:b]</span>');
});

test('currency is not math', () => {
  assert.equal(inline('costs $5 and $10'), 'costs $5 and $10');
  assert.equal(inline('from $5 to $10.'), 'from $5 to $10.');
  assert.equal(inline('$5, then $x$ later'), '$5, then <span class="math-inline">[I:x]</span> later');
  assert.equal(inline('a $ b $ c'), 'a $ b $ c', 'space after opener / before closer');
  assert.equal(inline('$x$5'), '$x$5', 'closer followed by digit');
  assert.equal(inline('just one $'), 'just one $');
});

test('escaped dollars are literal', () => {
  assert.equal(inline('\\$5 and \\$x\\$'), '$5 and $x$');
  assert.equal(inline('$a\\$b$'), '<span class="math-inline">[I:a\\$b]</span>');
});

test('\\( … \\) and inline display forms', () => {
  assert.equal(inline('see \\(x^2\\) here'), 'see <span class="math-inline">[I:x^2]</span> here');
  assert.equal(inline('then $$x^2$$ inline'), 'then <span class="math-display">[D:x^2]</span> inline');
  assert.equal(inline('then \\[y\\] inline'), 'then <span class="math-display">[D:y]</span> inline');
  assert.equal(inline('\\(unclosed'), '(unclosed', 'falls back to the normal escape');
  assert.equal(inline('\\[unclosed'), '[unclosed', 'unclosed \\[ is a literal bracket');
  assert.equal(inline('\\[x\\]'), '<span class="math-display">[D:x]</span>', 'LLMs use \\[…\\] for math, so it wins over escaped brackets');
});

test('code spans and fences are untouched', () => {
  assert.equal(inline('`$x$` and $y$'), '<code>$x$</code> and <span class="math-inline">[I:y]</span>');
  assert.equal(render('```\n$$\nx\n$$\n```'), '<pre><code>$$\nx\n$$\n</code></pre>');
});

test('display block, multi-line', () => {
  const src = 'The transfer function is\n\n$$\nH(s)=\\frac{\\omega_0^2}\n{s^2+2\\zeta\\omega_0s+\\omega_0^2}\n$$\n\nwhere $\\zeta$ is the damping ratio.';
  assert.equal(render(src), [
    '<p>The transfer function is</p>',
    '<div class="math-block">[D:H(s)=\\frac{\\omega_0^2}\n{s^2+2\\zeta\\omega_0s+\\omega_0^2}]</div>',
    '<p>where <span class="math-inline">[I:\\zeta]</span> is the damping ratio.</p>',
  ].join('\n'));
});

test('display block forms', () => {
  assert.equal(render('$$x^2$$'), '<div class="math-block">[D:x^2]</div>');
  assert.equal(render('$$ a\nb $$'), '<div class="math-block">[D:a\nb]</div>');
  assert.equal(render('\\[\na\n\\]'), '<div class="math-block">[D:a]</div>');
  assert.equal(render('$$x$$ is text'), '<p><span class="math-display">[D:x]</span> is text</p>');
});

test('display block interrupts a paragraph and works in lists and quotes', () => {
  assert.equal(render('Hence\n$$\nx\n$$'), '<p>Hence</p>\n<div class="math-block">[D:x]</div>');
  assert.match(render('- item\n\n  $$\n  y\n  $$'), /<li>\n<p>item<\/p>\n<div class="math-block">\[D:y\]<\/div>\n<\/li>/);
  assert.match(render('> $$\n> z\n> $$'), /<blockquote>\n<div class="math-block">\[D:z\]<\/div>\n<\/blockquote>/);
});

test('unclosed display block stays text (mid-stream)', () => {
  assert.equal(render('$$\nx = 1'), '<p>$$\nx = 1</p>');
  assert.equal(render('$$$$'), '<p>$$$$</p>');
});
