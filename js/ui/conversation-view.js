import { html, $ } from './dom.js';
import { mascot } from './mascot.js';
import { messageElement, thoughts } from './message-view.js';
import { createComposer } from './composer.js';
import { emit, on } from '../events.js';
import { getConversation } from '../data/conversations.js';
import { listMessages } from '../data/messages.js';
import { getModel } from '../data/models.js';
import { presetFor } from '../providers/index.js';
import { createChatSession } from '../chat/session.js';
import { renderMarkdown } from '../render/markdown.js';

const STICK_THRESHOLD = 80; // px from the bottom that still counts as "following"

// #/chat/:id (existing) or #/new/:modelId (draft, persisted on first send).
export async function renderConversation(main, { id, modelId }) {
  let conversation = null;
  let model;
  let messages = [];

  if (id) {
    conversation = await getConversation(id);
    if (!conversation) {
      main.innerHTML = html`<section class="empty-state">${mascot('error', { size: 88 })}<h2 class="display">Conversation not found</h2><p>It may have been deleted. <a href="#/new">Start a new one</a>.</p></section>`;
      return;
    }
    [model, messages] = await Promise.all([getModel(conversation.modelId), listMessages(id)]);
  } else {
    model = await getModel(modelId);
    if (!model) { location.replace('#/new'); return; }
  }

  const modelName = model?.name ?? conversation.modelName;
  main.innerHTML = html`
    <section class="chat">
      <header class="chat-header">
        <h2 class="chat-title">${conversation?.title ?? 'New conversation'}</h2>
        <span class="model-chip" title="${model ? `${presetFor(model.preset).label} · ${model.model}` : 'Model removed'}">✦ ${modelName}</span>
      </header>
      <div class="chat-log"></div>
      <div class="composer-dock"></div>
    </section>`;

  const log = $('.chat-log', main);
  const title = $('.chat-title', main);
  const nearBottom = () => main.scrollHeight - main.scrollTop - main.clientHeight < STICK_THRESHOLD;
  const scrollToBottom = () => { main.scrollTop = main.scrollHeight; };

  if (messages.length) {
    const fragment = document.createDocumentFragment();
    for (const m of messages) fragment.append(messageElement(m));
    log.append(fragment);
  } else {
    log.innerHTML = html`
      <div class="chat-empty">
        ${mascot('idle', { size: 80 })}
        <h3 class="display">What are we exploring today?</h3>
      </div>`;
  }

  // ── Streaming state (naive: re-render the whole reply once per frame) ──
  let pending = null; // { el, body, thoughtsEl, text, reasoning }
  let frame = 0;
  let errorCard = null;

  function paint() {
    frame = 0;
    if (!pending) return;
    const follow = nearBottom();
    if (pending.text) {
      pending.el.classList.remove('thinking');
      pending.body.innerHTML = renderMarkdown(pending.text, { highlight: false });
    }
    if (pending.reasoning) {
      if (!pending.thoughtsEl) {
        pending.el.insertAdjacentHTML('afterbegin', String(thoughts()));
        pending.thoughtsEl = $('.thoughts-body', pending.el);
      }
      pending.thoughtsEl.textContent = pending.reasoning;
    }
    if (follow) scrollToBottom();
  }

  function showError(error) {
    errorCard = document.createElement('div');
    errorCard.className = 'error-card';
    errorCard.setAttribute('role', 'alert');
    const detail = [error.status && `HTTP ${error.status}`, error.body].filter(Boolean).join('\n');
    errorCard.innerHTML = html`
      ${mascot('error', { size: 56 })}
      <div class="error-content">
        <p class="error-title">${modelName} couldn’t answer.</p>
        <p class="error-message">${error.message}</p>
        ${detail ? html`<details><summary>Details</summary><pre>${detail}</pre></details>` : ''}
        <button type="button" class="btn" data-action="retry">Retry</button>
      </div>`;
    $('[data-action="retry"]', errorCard).addEventListener('click', () => {
      errorCard.remove();
      errorCard = null;
      session.retry();
    });
    log.append(errorCard);
  }

  const session = createChatSession({
    conversation,
    model,
    messages,
    handlers: {
      onConversationCreated(conv) {
        history.replaceState(null, '', `#/chat/${conv.id}`);
        title.textContent = conv.title;
        emit('route:replaced');
      },
      onUserMessage(message) {
        $('.chat-empty', log)?.remove();
        log.append(messageElement(message));
        scrollToBottom();
      },
      onStreamStart() {
        errorCard?.remove();
        errorCard = null;
        const el = document.createElement('article');
        el.className = 'message message-assistant streaming thinking';
        el.innerHTML = html`
          <div class="message-body md"></div>
          <div class="stream-indicator" aria-hidden="true">${mascot('thinking', { size: 40 })}</div>
          <span class="visually-hidden" role="status">${modelName} is responding…</span>`;
        log.append(el);
        pending = { el, body: $('.message-body', el), thoughtsEl: null, text: '', reasoning: '' };
        composer.setStreaming(true);
        scrollToBottom();
      },
      onDelta({ text, reasoning }) {
        if (!pending) return;
        pending.text = text;
        pending.reasoning = reasoning;
        frame ||= requestAnimationFrame(paint);
      },
      onStreamEnd({ message, error }) {
        cancelAnimationFrame(frame);
        frame = 0;
        const follow = nearBottom();
        if (pending) {
          if (message) pending.el.replaceWith(messageElement(message));
          else pending.el.remove();
          pending = null;
        }
        composer.setStreaming(false);
        if (error) showError(error);
        if (follow) scrollToBottom();
        composer.focus();
      },
    },
  });

  const composer = createComposer({
    placeholder: `Message ${modelName}…`,
    onSend: (text) => session.send(text),
    onStop: () => session.stop(),
  });
  $('.composer-dock', main).append(composer.el);
  if (!model) composer.disable('This conversation’s model was removed. It stays readable, but can’t continue.');

  const onKey = (e) => {
    if (e.key === 'Escape' && session.streaming) { e.preventDefault(); session.stop(); }
  };
  document.addEventListener('keydown', onKey);

  // Keep the header in sync with renames from the sidebar.
  const offRename = on('conversations:changed', async ({ id: changed }) => {
    const current = session.conversation;
    if (!current || changed !== current.id) return;
    const fresh = await getConversation(current.id);
    if (fresh) title.textContent = fresh.title;
  });

  scrollToBottom();
  composer.focus();

  return () => {
    document.removeEventListener('keydown', onKey);
    offRename();
    cancelAnimationFrame(frame);
    session.stop(); // leaving mid-stream keeps the partial reply as "stopped"
  };
}
