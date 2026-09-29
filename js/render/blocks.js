// Pure: finds where streamed Markdown can be split so the text before the split
// never needs re-rendering. See plan §6.
//
// A split point is just after a blank line that is:
//   - outside an open ``` / ~~~ fence and outside an open $$ / \[ math block, and
//   - followed by a line that has started and begins a new top-level block:
//     not indented (list continuation / indented code) and not a list marker
//     (which would split a loose list and restart its numbering).
// Only complete lines (ending in \n) are considered, except that the first
// character of the following line is needed to classify it.

const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

// Scans from `from` (a previous boundary, so outside any block).
// Returns { boundary, openFence } where openFence is null or
// { start, contentStart, lang, indented } for a fence still open at the end.
export function scanBlocks(text, from = 0) {
  let boundary = from;
  let fence = null; // { char, length, start, contentStart, lang, indented }
  let math = null; // closing delimiter while inside a display-math block
  let pos = from;

  while (pos < text.length) {
    const end = text.indexOf('\n', pos);
    if (end === -1) break; // incomplete last line
    const line = text.slice(pos, end);
    const next = end + 1;

    if (fence) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.length && !line.slice(m.index + m[0].length).trim()) fence = null;
    } else if (math) {
      if (line.trimEnd().endsWith(math)) math = null;
    } else {
      const trimmed = line.trim();
      const f = FENCE.exec(line);
      if (f) {
        fence = {
          char: f[1][0],
          length: f[1].length,
          start: pos,
          contentStart: next,
          lang: line.slice(f.index + f[0].length).trim().split(/\s+/)[0] ?? '',
          indented: /^\s/.test(line),
        };
      } else if (trimmed.startsWith('$$')) {
        if (!(trimmed.length > 2 && trimmed.endsWith('$$'))) math = '$$';
      } else if (trimmed.startsWith('\\[')) {
        if (!trimmed.endsWith('\\]')) math = '\\]';
      } else if (!trimmed && next < text.length) {
        const lineEnd = text.indexOf('\n', next);
        const following = text.slice(next, lineEnd === -1 ? text.length : lineEnd);
        const startsBlock = following.length > 0 && !/^\s/.test(following) && !LIST_MARKER.test(following);
        if (startsBlock) boundary = next;
      }
    }
    pos = next;
  }
  const openFence = fence && { start: fence.start, contentStart: fence.contentStart, lang: fence.lang, indented: fence.indented };
  return { boundary, openFence };
}

export const findStableBoundary = (text, from = 0) => scanBlocks(text, from).boundary;
