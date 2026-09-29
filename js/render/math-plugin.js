// markdown-it plugin for TeX math. Pure: the caller supplies render(tex, displayMode).
//
// Block:  $$…$$ and \[…\] starting a line (single- or multi-line; may interrupt a paragraph)
// Inline: $…$, \(…\), and $$…$$ / \[…\] mid-line (rendered in display mode)
//
// Pandoc-style rules keep prices from turning into math:
//   - an opening $ must not be followed by whitespace
//   - a closing $ must not be preceded by whitespace or followed by a digit
//   - the first unescaped $ after the opener must be a valid closer, otherwise no math
// so "costs $5 and $10" stays text. \$ is always a literal dollar.

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

const isSpace = (code) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const isDigit = (code) => code >= 0x30 && code <= 0x39;

// Index of the closing single $ for an opener at `start`, or -1.
function findInlineDollarClose(src, start, max) {
  if (start + 1 >= max || isSpace(src.charCodeAt(start + 1))) return -1;
  for (let i = start + 1; i < max; i++) {
    const code = src.charCodeAt(i);
    if (code === BACKSLASH) { i++; continue; }
    if (code !== DOLLAR) continue;
    const valid = !isSpace(src.charCodeAt(i - 1)) && !isDigit(src.charCodeAt(i + 1));
    return valid ? i : -1;
  }
  return -1;
}

// Index of `close` at or after `from`, skipping backslash escapes, or -1.
function findDelimiter(src, close, from, max) {
  for (let i = from; i <= max - close.length; i++) {
    if (src.charCodeAt(i) === BACKSLASH && !src.startsWith(close, i)) { i++; continue; }
    if (src.startsWith(close, i)) return i;
  }
  return -1;
}

const PAIRS = [
  ['$$', '$$', true],
  ['\\[', '\\]', true],
  ['\\(', '\\)', false],
];

function mathInline(state, silent) {
  const { src, posMax } = state;
  const start = state.pos;
  const first = src.charCodeAt(start);
  if (first !== DOLLAR && first !== BACKSLASH) return false;

  for (const [open, close, display] of PAIRS) {
    if (!src.startsWith(open, start)) continue;
    const end = findDelimiter(src, close, start + open.length, posMax);
    if (end === -1) return false;
    const content = src.slice(start + open.length, end);
    if (!content.trim()) return false;
    if (!silent) {
      const token = state.push(display ? 'math_inline_display' : 'math_inline', 'math', 0);
      token.content = content;
      token.markup = open;
    }
    state.pos = end + close.length;
    return true;
  }

  if (first !== DOLLAR) return false;
  const end = findInlineDollarClose(src, start, posMax);
  if (end === -1) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(start + 1, end);
    token.markup = '$';
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false; // indented code

  const line = state.src.slice(pos, max);
  const pair = line.startsWith('$$') ? ['$$', '$$'] : line.startsWith('\\[') ? ['\\[', '\\]'] : null;
  if (!pair) return false;
  const [open, close] = pair;

  const firstLine = line.slice(open.length).trimEnd();
  let content;
  let lastLine = startLine;

  const closeOnFirstLine = findDelimiter(firstLine, close, 0, firstLine.length);
  if (closeOnFirstLine !== -1) {
    // Single line "$$ … $$". Text after the closer means it's inline math in a paragraph.
    if (closeOnFirstLine + close.length !== firstLine.length) return false;
    content = firstLine.slice(0, closeOnFirstLine);
  } else {
    // Multi-line: find a line whose trimmed end is the closer.
    let found = false;
    const parts = [firstLine];
    for (let next = startLine + 1; next < endLine; next++) {
      pos = state.bMarks[next] + state.tShift[next];
      max = state.eMarks[next];
      if (pos < max && state.sCount[next] < state.blkIndent) break; // left the container
      const text = state.src.slice(pos, max);
      const trimmed = text.trimEnd();
      if (trimmed.endsWith(close)) {
        parts.push(trimmed.slice(0, trimmed.length - close.length));
        lastLine = next;
        found = true;
        break;
      }
      parts.push(text);
    }
    if (!found) return false;
    content = parts.join('\n');
  }

  if (!content.trim()) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.markup = open;
  token.map = [startLine, lastLine + 1];
  state.line = lastLine + 1;
  return true;
}

export function mathPlugin(md, { render }) {
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${render(tokens[idx].content, false)}</span>`;
  md.renderer.rules.math_inline_display = (tokens, idx) =>
    `<span class="math-display">${render(tokens[idx].content, true)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${render(tokens[idx].content, true)}</div>\n`;
}
