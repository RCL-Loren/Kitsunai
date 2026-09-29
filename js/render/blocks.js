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

export function findStableBoundary(text, from = 0) {
  let boundary = from;
  let fence = null; // { char, length } while inside a fence
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
        fence = { char: f[1][0], length: f[1].length };
      } else if (trimmed.startsWith('$$')) {
        if (!(trimmed.length > 2 && trimmed.endsWith('$$'))) math = '$$';
      } else if (trimmed.startsWith('\\[')) {
        if (!trimmed.endsWith('\\]')) math = '\\]';
      } else if (!trimmed && next < text.length) {
        const following = text.slice(next, text.indexOf('\n', next) === -1 ? text.length : text.indexOf('\n', next));
        const startsBlock = following.length > 0 && !/^\s/.test(following) && !LIST_MARKER.test(following);
        if (startsBlock) boundary = next;
      }
    }
    pos = next;
  }
  return boundary;
}
