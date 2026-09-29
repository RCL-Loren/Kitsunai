import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSSEParser } from '../js/providers/sse.js';

function parse(chunks) {
  const events = [];
  const parser = createSSEParser((e) => events.push(e));
  for (const c of chunks) parser.push(c);
  parser.end();
  return events;
}

const STREAM = 'data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n';

test('parses whole events', () => {
  assert.deepEqual(parse([STREAM]).map((e) => e.data), ['{"a":1}', '{"a":2}', '[DONE]']);
});

test('chunk boundaries anywhere give identical results', () => {
  const whole = parse([STREAM]);
  for (let size = 1; size <= 7; size++) {
    const chunks = STREAM.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
    assert.deepEqual(parse(chunks), whole, `chunk size ${size}`);
  }
});

test('handles CRLF and CR line endings, including a split CRLF', () => {
  assert.deepEqual(parse(['data: x\r\n\r\ndata: y\r\r']).map((e) => e.data), ['x', 'y']);
  assert.deepEqual(parse(['data: x\r', '\n\r', '\n']).map((e) => e.data), ['x']);
});

test('joins multi-line data and reads event/id fields', () => {
  const [e] = parse(['event: delta\nid: 7\ndata: line1\ndata: line2\n\n']);
  assert.deepEqual(e, { event: 'delta', id: '7', data: 'line1\nline2' });
});

test('ignores comments and keep-alives; only strips one leading space', () => {
  assert.deepEqual(parse([': ping\n\ndata:  two spaces\n\n']).map((e) => e.data), [' two spaces']);
});

test('flushes a final event without a trailing blank line', () => {
  assert.deepEqual(parse(['data: last']).map((e) => e.data), ['last']);
});

test('empty events are not dispatched', () => {
  assert.deepEqual(parse(['\n\n\nevent: x\n\n']), []);
});
