import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTitle, contextFor } from '../js/chat/session.js';

test('deriveTitle uses the first meaningful line without Markdown markers', () => {
  assert.equal(deriveTitle('Suppose the magnetic field is approximately 0.1 T'), 'Suppose the magnetic field is approximately 0.1 T');
  assert.equal(deriveTitle('\n\n## **Plasma** source `design`\nmore'), 'Plasma source design');
  assert.equal(deriveTitle('- [the docs](https://x.y) say'), 'the docs say');
  assert.equal(deriveTitle('```python\nprint(1)\n```\nWhy?'), 'print(1)');
  assert.equal(deriveTitle('$$\nx\n$$'), 'x');
  assert.equal(deriveTitle('   '), 'New conversation');
});

test('deriveTitle truncates long lines to 60 characters', () => {
  const title = deriveTitle('word '.repeat(40));
  assert.ok(title.length <= 60);
  assert.ok(title.endsWith('…'));
});

test('contextFor keeps everything up to the last user message', () => {
  const m = (role, markdown) => ({ role, markdown });
  const history = [m('user', 'a'), m('assistant', 'b'), m('user', 'c'), m('assistant', 'partial')];
  assert.deepEqual(contextFor(history), [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ]);
  assert.deepEqual(contextFor([]), []);
});
