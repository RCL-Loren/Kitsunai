import { html } from './dom.js';

export function renderSidebar(el) {
  el.innerHTML = html`
    <h1 class="brand display"><span class="brand-mark" aria-hidden="true">✦</span> KitsunAI</h1>
    <a class="btn btn-primary btn-block" href="#/new" data-nav="new">New chat</a>
    <div class="conversation-list" aria-label="Conversations"></div>
    <div class="sidebar-footer">
      <a class="nav-link" href="#/models" data-nav="models">Models</a>
      <a class="nav-link" href="#/settings" data-nav="settings">Settings</a>
    </div>`;
}

export function setActiveNav(el, section) {
  for (const link of el.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === section;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
