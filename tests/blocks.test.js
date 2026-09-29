import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { findStableBoundary, scanBlocks } from '../js/render/blocks.js';
import { createMarkdownRenderer } from '../js/render/markdown.js';

const b = findStableBoundary;

test('splits after a blank line once the next block has started', () => {
  assert.equal(b('Para one.\n\nPara two'), 'Para one.\n\n'.length);
  assert.equal(b('Para one.\n\n'), 0, 'next block not started yet');
  assert.equal(b('Para one.\n'), 0);
  assert.equal(b('Para one.\n\nTwo.\n\nThree'), 'Para one.\n\nTwo.\n\n'.length, 'last boundary wins');
});

test('never splits inside fenced code', () => {
  const open = '```python\nx = 1\n\ny = 2\n';
  assert.equal(b(open + '\nmore'), 0);
  const closed = '```python\nx = 1\n\ny = 2\n```\n\nAfter';
  assert.equal(b(closed), closed.length - 'After'.length);
  assert.equal(b('~~~\na\n\n```\n\nb\n~~~\n\nc'), '~~~\na\n\n```\n\nb\n~~~\n\n'.length, 'tilde fence ignores backtick lines');
  assert.equal(b('````\n```\n\nstill code\n````\n\nx'), '````\n```\n\nstill code\n````\n\n'.length, 'closer must be as long as opener');
});

test('never splits inside display math', () => {
  assert.equal(b('$$\na\n\nb\n'), 0);
  const closed = '$$\na\n\nb\n$$\n\nNext';
  assert.equal(b(closed), closed.length - 'Next'.length);
  assert.equal(b('\\[\na\n\nb\n'), 0);
  assert.equal(b('$$x$$\n\nNext'), '$$x$$\n\n'.length, 'single-line display math is closed');
});

test('keeps loose lists and list continuations together', () => {
  assert.equal(b('- a\n\n- b'), 0);
  assert.equal(b('1. a\n\n2. b'), 0);
  assert.equal(b('- a\n\n  continued\n'), 0);
  assert.equal(b('- a\n\n    code in item\n'), 0);
  assert.equal(b('- a\n\n-'), 0, 'a lone dash may become a list item');
  assert.equal(b('- a\n\n---\n'), '- a\n\n'.length, 'a rule is a new block');
  assert.equal(b('- a\n- b\n\nAfter the list'), '- a\n- b\n\n'.length);
});

test('scans from a previous boundary', () => {
  const text = 'One.\n\nTwo.\n\nThree';
  const first = b('One.\n\nTw');
  assert.equal(first, 6);
  assert.equal(b(text, first), 'One.\n\nTwo.\n\n'.length);
});

test('frozen chunks + tail render the same as the whole document', () => {
  const require = createRequire(import.meta.url);
  const render = createMarkdownRenderer({
    markdownit: require('../vendor/markdown-it/markdown-it.min.js'),
    hljs: require('../vendor/highlight/highlight.min.js'),
    katex: require('../vendor/katex/katex.min.js'),
  });
  const doc = [
    '## Title', '', 'Intro with $x$.', '', '$$', 'a', '', 'b', '$$', '', '```js', 'const a = 1;', '', 'const b = 2;', '```', '',
    '| a | b |', '|---|---|', '| 1 | 2 |', '', '- one', '', '- two', '', '> quote', '', 'End.', '',
  ].join('\n');

  // Simulate streaming one character at a time, freezing as boundaries appear.
  let frozenHtml = '';
  let frozenUpTo = 0;
  for (let i = 1; i <= doc.length; i++) {
    const next = b(doc.slice(0, i), frozenUpTo);
    if (next > frozenUpTo) {
      frozenHtml += render(doc.slice(frozenUpTo, next));
      frozenUpTo = next;
    }
  }
  assert.equal(frozenHtml + render(doc.slice(frozenUpTo)), render(doc));
});

test('reports a fence that is still open at the end', () => {
  const text = 'Intro.\n\n```python\ndef f():\n    return 1\n';
  const { boundary, openFence } = scanBlocks(text);
  assert.equal(boundary, 'Intro.\n\n'.length);
  assert.deepEqual(openFence, { start: boundary, contentStart: boundary + '```python\n'.length, lang: 'python', indented: false });
  assert.equal(scanBlocks('```js\nx\n```\n').openFence, null, 'closed fence');
  assert.equal(scanBlocks('```js').openFence, null, 'opener line not complete yet');
  assert.equal(scanBlocks('- item\n\n  ```\n  code\n').openFence.indented, true);
  assert.equal(scanBlocks('~~~\nx\n').openFence.lang, '');
});
