// Renders a streaming reply without re-rendering what is already settled (plan §6).
//
//   el
//   ├── .frozen  append-only; each stable chunk is rendered once, with highlighting,
//   │            into .frozen-chunk groups of ~FROZEN_CHUNK_BLOCKS blocks whose
//   │            content-visibility lets off-screen parts skip layout while the
//   │            reply grows (otherwise per-frame layout grows with reply size)
//   └── .live    the unsettled tail, re-rendered (without highlighting) on each flush
//
// Fast path: while the tail ends in an open top-level code fence, the code is
// appended to text nodes in block-level chunks of CHUNK_LINES lines instead of
// re-rendering the block. Earlier chunks keep their layout, so a 5,000-line
// block costs the same per frame as a 5-line one (see perf-notes.md).
//
// update() only records text. The owner calls flush() once per animation frame,
// so network chunk rate never drives DOM work.

import { renderMarkdown } from './markdown.js';
import { scanBlocks } from './blocks.js';

// Reference-style definitions can change how earlier chunks render, so only
// then is a whole-document comparison render worth its cost in finish().
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
const CHUNK_LINES = 100;
export const FROZEN_CHUNK_BLOCKS = 24;

function openFenceElement(lang) {
  const block = document.createElement('div');
  block.className = 'code-block';
  block.innerHTML = '<div class="code-header"><span class="code-lang"></span>'
    + '<button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy</button></div><pre><code class="hljs"></code></pre>';
  block.querySelector('.code-lang').textContent = lang || 'text';
  return { block, code: block.querySelector('code') };
}

// Appends code text in block-level chunks (textContent stays exact for copying).
function createChunkedAppender(code) {
  let node = null;
  let lines = 0;
  const newChunk = () => {
    const chunk = document.createElement('span');
    chunk.className = 'code-chunk';
    node = document.createTextNode('');
    chunk.append(node);
    code.append(chunk);
    lines = 0;
  };
  newChunk();
  return (text) => {
    let start = 0;
    while (start < text.length) {
      const room = CHUNK_LINES - lines;
      let end = start;
      for (let i = 0; i < room; i++) {
        const nl = text.indexOf('\n', end);
        if (nl === -1) { end = text.length; break; }
        end = nl + 1;
        lines++;
      }
      node.appendData(text.slice(start, end));
      start = end;
      if (lines >= CHUNK_LINES) newChunk();
    }
  };
}

export function createStreamRenderer(el, { render = renderMarkdown } = {}) {
  el.innerHTML = '<div class="frozen"></div><div class="live"></div>';
  const frozen = el.firstElementChild;
  const live = el.lastElementChild;

  let text = '';
  let frozenUpTo = 0;
  let frozenHtml = '';
  let dirty = false;
  let fence = null; // { start, append, renderedUpTo } while appending to an open fence
  let chunk = null;

  function freeze(html) {
    if (!chunk || chunk.childElementCount >= FROZEN_CHUNK_BLOCKS) {
      chunk = document.createElement('div');
      chunk.className = 'frozen-chunk';
      frozen.append(chunk);
    }
    chunk.insertAdjacentHTML('beforeend', html);
  }

  return {
    // Receives the whole reply so far (the session accumulates deltas).
    update(fullText) {
      text = fullText;
      dirty = true;
    },

    // Applies pending text to the DOM. Returns true if anything changed.
    flush() {
      if (!dirty) return false;
      dirty = false;
      const { boundary, openFence } = scanBlocks(text, frozenUpTo);
      if (boundary > frozenUpTo) {
        const html = render(text.slice(frozenUpTo, boundary));
        freeze(html);
        frozenHtml += html;
        frozenUpTo = boundary;
      }

      if (openFence && !openFence.indented) {
        if (fence?.start !== openFence.start) {
          // Text before the fence (within the tail) renders normally, once.
          live.innerHTML = render(text.slice(frozenUpTo, openFence.start), { highlight: false });
          const { block, code } = openFenceElement(openFence.lang);
          live.append(block);
          fence = { start: openFence.start, append: createChunkedAppender(code), renderedUpTo: openFence.contentStart };
        }
        fence.append(text.slice(fence.renderedUpTo));
        fence.renderedUpTo = text.length;
      } else {
        fence = null;
        live.innerHTML = render(text.slice(frozenUpTo), { highlight: false });
      }
      return true;
    },

    // Final render; returns the complete HTML for caching. The chunked DOM is
    // kept (settled content never flickers) unless the text has reference-style
    // definitions and a whole-document render differs.
    finish(finalText = text) {
      text = finalText;
      const tail = render(text.slice(frozenUpTo));
      const full = REFERENCE_DEFINITION.test(text) ? render(text) : frozenHtml + tail;
      if (frozenHtml + tail !== full) {
        el.innerHTML = render(text, { chunk: FROZEN_CHUNK_BLOCKS });
      } else {
        // Keep the chunks (unwrapping would force layout of the whole reply at
        // once); only the wrapper elements go.
        live.remove();
        if (tail.trim()) freeze(tail);
        frozen.replaceWith(...frozen.children);
      }
      return full;
    },
  };
}
