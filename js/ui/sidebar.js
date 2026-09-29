import { html, $ } from './dom.js';
import { on } from '../events.js';
import { listConversations, updateConversation, deleteConversation } from '../data/conversations.js';

export function renderSidebar(el) {
  el.innerHTML = html`
    <h1 class="brand display"><span class="brand-mark" aria-hidden="true">✦</span> KitsunAI</h1>
    <a class="btn btn-primary btn-block" href="#/new" data-nav="new">New chat</a>
    <nav class="conversation-list" aria-label="Conversations"></nav>
    <div class="sidebar-footer">
      <a class="nav-link" href="#/models" data-nav="models">Models</a>
      <a class="nav-link" href="#/settings" data-nav="settings">Settings</a>
    </div>`;
  mountConversationList($('.conversation-list', el));
}

export function setActiveNav(el, section) {
  for (const link of el.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

const activeId = () => /^#\/chat\/([\w-]+)/.exec(location.hash)?.[1] ?? null;

function mountConversationList(listEl) {
  let editing = false;
  let redrawPending = false;

  async function draw() {
    if (editing) { redrawPending = true; return; }
    const conversations = await listConversations();
    listEl.innerHTML = conversations.length
      ? html`<ul class="conv-list" role="list">${conversations.map((c) => html`
          <li class="conv-item" data-id="${c.id}">
            <a class="conv-link" href="#/chat/${c.id}" title="${c.title}">${c.title}</a>
            <span class="conv-actions">
              <button type="button" class="icon-btn" data-action="rename" aria-label="Rename “${c.title}”" title="Rename">✎</button>
              <button type="button" class="icon-btn" data-action="delete" aria-label="Delete “${c.title}”" title="Delete">✕</button>
            </span>
          </li>`)}</ul>`
      : html`<p class="conv-empty">No conversations yet.</p>`;
    markActive();
  }

  function markActive() {
    const id = activeId();
    for (const item of listEl.querySelectorAll('.conv-item')) {
      const active = item.dataset.id === id;
      item.classList.toggle('active', active);
      const link = $('.conv-link', item);
      if (active) link?.setAttribute('aria-current', 'page');
      else link?.removeAttribute('aria-current');
    }
  }

  function finishEditing() {
    editing = false;
    if (redrawPending) { redrawPending = false; draw(); }
  }

  function startRename(item) {
    const link = $('.conv-link', item);
    const original = link.textContent;
    editing = true;
    item.classList.add('editing');
    const input = document.createElement('input');
    input.className = 'conv-rename';
    input.value = original;
    input.setAttribute('aria-label', 'Conversation title');
    link.replaceWith(input);
    input.select();

    let done = false;
    const commit = async (save) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (save && title && title !== original) {
        await updateConversation(item.dataset.id, { title }); // emits conversations:changed → redraw
      }
      finishEditing();
      draw();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }

  function startDelete(item) {
    editing = true;
    const title = $('.conv-link', item).textContent;
    item.classList.add('confirming');
    item.innerHTML = html`
      <span class="conv-confirm-text">Delete “${title}”?</span>
      <span class="conv-confirm-actions">
        <button type="button" class="btn btn-danger btn-sm" data-action="confirm-delete">Delete</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-delete">Cancel</button>
      </span>`;
    $('[data-action="cancel-delete"]', item).focus();
  }

  listEl.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const item = button.closest('.conv-item');
    const { action } = button.dataset;
    if (action === 'rename') startRename(item);
    if (action === 'delete') startDelete(item);
    if (action === 'cancel-delete') { finishEditing(); draw(); }
    if (action === 'confirm-delete') {
      const wasActive = item.dataset.id === activeId();
      editing = false;
      await deleteConversation(item.dataset.id);
      if (wasActive) location.hash = '#/';
    }
  });

  on('conversations:changed', draw);
  on('route:replaced', markActive);
  window.addEventListener('hashchange', markActive);
  draw();
}
