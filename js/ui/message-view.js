import { html, raw } from './dom.js';
import { renderMarkdown } from '../render/markdown.js';

// Rendered HTML per message id. Completed messages are immutable, so reopening
// a conversation or paging history never renders the same Markdown twice.
// Markdown stays canonical; this cache is memory-only.
const htmlCache = new Map();
const CACHE_LIMIT = 3000;

export function cacheHtml(id, value) {
  if (htmlCache.size >= CACHE_LIMIT) htmlCache.delete(htmlCache.keys().next().value);
  htmlCache.set(id, value);
}

function messageHtml(message) {
  let value = htmlCache.get(message.id);
  if (value === undefined) {
    value = renderMarkdown(message.markdown);
    cacheHtml(message.id, value);
  }
  return value;
}

// A completed (immutable) message.
export function messageElement(message) {
  const el = document.createElement('article');
  el.className = `message message-${message.role}`;
  el.dataset.id = message.id;
  const { reasoning, status } = message.metadata ?? {};
  el.innerHTML = html`
    ${reasoning ? thoughts(reasoning) : ''}
    <div class="message-body md">${raw(messageHtml(message))}</div>
    ${statusLine(status)}
    ${messageActions()}`;
  return el;
}

// Copy / Copy Markdown / Export; handled by one delegated listener in the view.
export const messageActions = () => html`
  <div class="message-actions" role="toolbar" aria-label="Message actions">
    <button type="button" class="action-btn" data-msg-action="copy">Copy</button>
    <button type="button" class="action-btn" data-msg-action="copy-markdown">Copy Markdown</button>
    <button type="button" class="action-btn" data-msg-action="export">Export Markdown</button>
  </div>`;

export const statusLine = (status) => (status === 'stopped' ? html`<p class="message-status">Stopped</p>` : '');

export function thoughts(text = '') {
  return html`<details class="thoughts"><summary>Thoughts</summary><div class="thoughts-body">${text}</div></details>`;
}
