import { html, raw } from './dom.js';
import { renderMarkdown } from '../render/markdown.js';

// A completed (immutable) message.
export function messageElement(message) {
  const el = document.createElement('article');
  el.className = `message message-${message.role}`;
  el.dataset.id = message.id;
  const { reasoning, status } = message.metadata ?? {};
  el.innerHTML = html`
    ${reasoning ? thoughts(reasoning) : ''}
    <div class="message-body md">${raw(renderMarkdown(message.markdown))}</div>
    ${status === 'stopped' ? html`<p class="message-status">Stopped</p>` : ''}`;
  return el;
}

export function thoughts(text = '') {
  return html`<details class="thoughts"><summary>Thoughts</summary><div class="thoughts-body">${text}</div></details>`;
}
