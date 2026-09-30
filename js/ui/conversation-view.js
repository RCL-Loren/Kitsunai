import { html, $ } from './dom.js';
import { mascot } from './mascot.js';
import { messageElement, messageActions, thoughts, statusLine } from './message-view.js';
import { toast } from './toast.js';
import { announce } from './announce.js';
import { createComposer } from './composer.js';
import { emit, on } from '../events.js';
import { getConversation } from '../data/conversations.js';
import { listMessages } from '../data/messages.js';
import { getModel } from '../data/models.js';
import { getSettings } from '../data/settings.js';
import { presetFor, formatLabel } from '../providers/index.js';
import { createChatSession } from '../chat/session.js';
import { createStreamRenderer } from '../render/stream-renderer.js';
import { recordPaint } from '../dev/perf.js';
import { copyRendered, copyMarkdown, exportMessage, exportConversation } from '../export/export-actions.js';

const PAGE_SIZE = 30; // messages rendered per history page
const FOLLOW_THRESHOLD = 40; // px from the bottom that still counts as "following"

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
        <button type="button" class="btn btn-ghost btn-sm" data-action="export-conversation" ${conversation ? '' : 'disabled'}>Export</button>
      </header>
      <div class="chat-log" role="region" aria-label="Conversation"></div>
      <div class="composer-dock">
        <button type="button" class="latest-pill" hidden>↓ Latest</button>
      </div>
    </section>`;

  const log = $('.chat-log', main);
  const title = $('.chat-title', main);
  const pill = $('.latest-pill', main);
  const exportButton = $('[data-action="export-conversation"]', main);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const labelFor = (m) => (m.role === 'user' ? getSettings().displayName : modelName);
  const render = (m) => messageElement(m, { label: labelFor(m) });

  // ── Copy / export ───────────────────────────────────────────────────────
  function flash(button, label) {
    const original = button.dataset.label ??= button.textContent;
    button.textContent = label;
    clearTimeout(button.flashTimer);
    button.flashTimer = setTimeout(() => { button.textContent = original; }, 1400);
  }

  log.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-msg-action]');
    if (!button) return;
    const el = button.closest('.message');
    const message = byId.get(el?.dataset.id);
    if (!message) return;
    try {
      const action = button.dataset.msgAction;
      if (action === 'copy') { await copyRendered($('.message-body', el)); flash(button, 'Copied'); announce('Message copied'); }
      if (action === 'copy-markdown') { await copyMarkdown(message); flash(button, 'Copied'); announce('Markdown copied'); }
      if (action === 'export') exportMessage(message);
    } catch (err) {
      toast(`Couldn’t copy: ${err.message}`, { kind: 'error' });
    }
  });

  exportButton.addEventListener('click', async () => {
    try {
      await exportConversation(session.conversation.id);
    } catch (err) {
      toast(`Export failed: ${err.message}`, { kind: 'error' });
    }
  });

  // ── Following the bottom ────────────────────────────────────────────────
  // Only user scrolling changes `following`; content growth never does.
  let following = true;
  const distanceFromBottom = () => main.scrollHeight - main.scrollTop - main.clientHeight;
  const scrollToBottom = () => {
    following = true;
    pill.hidden = true;
    main.scrollTop = main.scrollHeight;
  };
  const onScroll = () => {
    following = distanceFromBottom() < FOLLOW_THRESHOLD;
    if (following) pill.hidden = true;
  };
  main.addEventListener('scroll', onScroll, { passive: true });
  pill.addEventListener('click', scrollToBottom);

  // ── History, rendered lazily from the end ───────────────────────────────
  let oldestRendered = messages.length;
  let sentinel = null;
  let observer = null;

  function renderOlderPage() {
    const start = Math.max(0, oldestRendered - PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const m of messages.slice(start, oldestRendered)) fragment.append(render(m));
    // Native scroll anchoring keeps the reader's place, including when
    // content-visibility swaps size estimates for real sizes above the viewport.
    sentinel.after(fragment);
    oldestRendered = start;
    if (oldestRendered === 0) {
      observer.disconnect();
      sentinel.remove();
    } else {
      // Re-observe so a still-visible sentinel fires again (short messages).
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    }
  }

  if (messages.length) {
    const fragment = document.createDocumentFragment();
    oldestRendered = Math.max(0, messages.length - PAGE_SIZE);
    for (const m of messages.slice(oldestRendered)) fragment.append(render(m));
    log.append(fragment);
    if (oldestRendered > 0) {
      sentinel = document.createElement('div');
      sentinel.className = 'history-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      log.prepend(sentinel);
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) renderOlderPage();
      }, { root: main, rootMargin: '1200px 0px 0px 0px' });
    }
  } else {
    log.innerHTML = html`
      <div class="chat-empty">
        ${mascot('idle', { size: 80 })}
        <h3 class="display">What are we exploring today?</h3>
      </div>`;
  }

  // ── Streaming ───────────────────────────────────────────────────────────
  let pending = null; // { el, renderer, thoughtsEl, text, reasoning }
  let frame = 0;
  let errorCard = null;

  // One frame: flush the renderer, update thoughts, then follow the bottom.
  function paint() {
    frame = 0;
    if (!pending) return;
    const t0 = performance.now();
    if (pending.text) {
      pending.el.classList.remove('thinking');
      pending.renderer.update(pending.text);
      pending.renderer.flush();
    }
    if (pending.reasoning) {
      if (!pending.thoughtsEl) {
        pending.el.insertAdjacentHTML('afterbegin', String(thoughts()));
        pending.thoughtsEl = $('.thoughts-body', pending.el);
      }
      if (pending.thoughtsEl.textContent.length !== pending.reasoning.length) pending.thoughtsEl.textContent = pending.reasoning;
    }
    if (following) main.scrollTop = main.scrollHeight;
    else pill.hidden = false;
    recordPaint(performance.now() - t0);
  }

  function showError(error) {
    errorCard = document.createElement('div');
    errorCard.className = 'error-card message-enter';
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
        exportButton.disabled = false;
        emit('route:replaced');
      },
      onFormatChanged(updated) {
        toast(`${updated.name} uses the ${formatLabel(updated.apiFormat)} API — switched and retrying.`);
        $('.model-chip', main).title = `${presetFor(updated.preset).label} · ${updated.model} · ${formatLabel(updated.apiFormat)} API`;
      },
      onUserMessage(message) {
        $('.chat-empty', log)?.remove();
        byId.set(message.id, message);
        const el = render(message);
        el.classList.add('message-enter');
        log.append(el);
        scrollToBottom();
      },
      onStreamStart() {
        errorCard?.remove();
        errorCard = null;
        const el = document.createElement('article');
        el.className = 'message message-assistant streaming thinking message-enter';
        el.innerHTML = html`
          <div class="message-body md"></div>
          <div class="stream-indicator" aria-hidden="true">${mascot('thinking', { size: 40 })}</div>`;
        el.setAttribute('aria-busy', 'true');
        el.setAttribute('aria-label', `${modelName}, responding`);
        log.append(el);
        pending = { el, renderer: createStreamRenderer($('.message-body', el)), thoughtsEl: null, text: '', reasoning: '' };
        composer.setStreaming(true);
        scrollToBottom();
      },
      onDelta({ text, reasoning }) {
        if (!pending) return;
        pending.text = text;
        pending.reasoning = reasoning;
        frame ||= requestAnimationFrame(paint);
      },
      onStreamEnd({ message, error, aborted, text }) {
        cancelAnimationFrame(frame);
        frame = 0;
        if (pending) {
          const { el, renderer } = pending;
          el.removeAttribute('aria-busy');
          el.setAttribute('aria-label', modelName);
          if (!message && text?.trim() && error) {
            // Streamed but not saved: keep it on screen so nothing is lost.
            renderer.finish(text);
            el.classList.remove('streaming', 'thinking');
            $('.stream-indicator', el)?.remove();
            el.insertAdjacentHTML('beforeend', html`<p class="message-status">Not saved</p>`.toString());
          } else if (message) {
            renderer.finish(message.markdown);
            el.classList.remove('streaming', 'thinking');
            el.dataset.id = message.id;
            $('.stream-indicator', el)?.remove();
            const reasoning = message.metadata.reasoning;
            if (reasoning && !$('.thoughts', el)) el.insertAdjacentHTML('afterbegin', String(thoughts(reasoning)));
            else if (reasoning) $('.thoughts-body', el).textContent = reasoning;
            el.insertAdjacentHTML('beforeend', String(statusLine(message.metadata.status, message.metadata.finishReason)) + messageActions());
            byId.set(message.id, message);
          } else {
            el.remove();
          }
          pending = null;
        }
        composer.setStreaming(false);
        if (error) showError(error);
        announce(error ? `${modelName} couldn’t answer.` : aborted ? 'Response stopped.' : 'Response complete.');
        if (following) main.scrollTop = main.scrollHeight;
        composer.focus();
      },
    },
  });

  const composer = createComposer({
    placeholder: `Message ${modelName}…`,
    onSend: (text) => session.send(text).catch((err) => {
      composer.restore(text);
      toast(`Couldn’t send: ${err.message}`, { kind: 'error', duration: 6000 });
    }),
    onStop: () => session.stop(),
  });
  $('.composer-dock', main).append(composer.el);
  if (!model) composer.disable('This conversation’s model was removed. It stays readable, but can’t continue.');

  const onKey = (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && session.streaming) { e.preventDefault(); session.stop(); }
  };
  document.addEventListener('keydown', onKey);

  // Keep the header in sync with renames from the sidebar.
  const offRename = on('conversations:changed', async ({ id: changed }) => {
    const current = session.conversation;
    if (!current || changed !== current.id) return;
    const fresh = await getConversation(current.id);
    if (fresh) title.textContent = fresh.title;
  });

  // Land at the bottom. Off-screen chunks start at estimated heights and
  // settle to real ones as they render, so keep snapping to the bottom until the
  // height is stable (or the reader takes over with their own scrolling).
  let settling = true;
  let disposed = false;
  const stopSettling = () => { settling = false; };
  const startPaging = () => { if (sentinel && !disposed) observer.observe(sentinel); };
  const SETTLE_STOPPERS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  for (const type of SETTLE_STOPPERS) main.addEventListener(type, stopSettling, { once: true, passive: true });
  scrollToBottom();
  (function settle(framesLeft, lastHeight, stableFrames) {
    requestAnimationFrame(() => {
      if (disposed) return;
      if (!settling) { startPaging(); return; }
      const height = main.scrollHeight;
      scrollToBottom();
      const stable = height === lastHeight ? stableFrames + 1 : 0;
      if (framesLeft > 0 && stable < 3) settle(framesLeft - 1, height, stable);
      else {
        settling = false;
        startPaging(); // only once settled, so it doesn't load a page immediately
      }
    });
  })(30, -1, 0);
  composer.focus({ preventScroll: true });

  return () => {
    disposed = true;
    for (const type of SETTLE_STOPPERS) main.removeEventListener(type, stopSettling);
    document.removeEventListener('keydown', onKey);
    main.removeEventListener('scroll', onScroll);
    observer?.disconnect();
    offRename();
    cancelAnimationFrame(frame);
    session.stop(); // leaving mid-stream keeps the partial reply as "stopped"
  };
}
