// Renders a streaming reply without re-rendering what is already settled (plan §6).
//
//   el
//   ├── .frozen  append-only; each stable chunk is rendered once, with highlighting
//   └── .live    the unsettled tail, re-rendered without highlighting on each flush
//
// update() only records text. The owner calls flush() once per animation frame,
// so network chunk rate never drives DOM work.

import { renderMarkdown } from './markdown.js';
import { findStableBoundary } from './blocks.js';

export function createStreamRenderer(el, { render = renderMarkdown } = {}) {
  el.innerHTML = '<div class="frozen"></div><div class="live"></div>';
  const frozen = el.firstElementChild;
  const live = el.lastElementChild;

  let text = '';
  let frozenUpTo = 0;
  let frozenHtml = '';
  let dirty = false;

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
      const boundary = findStableBoundary(text, frozenUpTo);
      if (boundary > frozenUpTo) {
        const html = render(text.slice(frozenUpTo, boundary));
        frozen.insertAdjacentHTML('beforeend', html);
        frozenHtml += html;
        frozenUpTo = boundary;
      }
      live.innerHTML = render(text.slice(frozenUpTo), { highlight: false });
      return true;
    },

    // Final render; returns the complete HTML for caching. The chunked DOM is
    // kept when it equals a whole-document render (the usual case), so the
    // settled content never flickers; otherwise (e.g. a reference link defined
    // at the end) the whole message is replaced once.
    finish(finalText = text) {
      text = finalText;
      const full = render(text);
      const tail = render(text.slice(frozenUpTo));
      if (frozenHtml + tail !== full) {
        el.innerHTML = full;
      } else {
        frozen.insertAdjacentHTML('beforeend', tail);
        live.remove();
        frozen.replaceWith(...frozen.childNodes); // same DOM shape as a message from history
      }
      return full;
    },
  };
}
