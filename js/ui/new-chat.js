import { html, $$ } from './dom.js';
import { mascot } from './mascot.js';
import { listModels } from '../data/models.js';
import { presetFor, getStatus } from '../providers/index.js';

// "✦ New Adventure ✦ — Choose your companion". Picking a model opens a draft
// conversation (#/new/:modelId) that is persisted on the first send.
export async function renderNewChat(main) {
  const models = await listModels();

  if (!models.length) {
    main.innerHTML = html`
      <section class="empty-state screen-enter">
        ${mascot('idle', { size: 96 })}
        <h2 class="display">No companions yet</h2>
        <p>Add a model first, then start your adventure.</p>
        <a class="btn btn-primary" href="#/models/new?setup">Add a model</a>
      </section>`;
    return;
  }

  main.innerHTML = html`
    <section class="picker screen-enter">
      <p class="picker-kicker display" aria-hidden="true">✦ New Adventure ✦</p>
      <h2 class="display" id="picker-title">Choose your companion</h2>
      <ul class="companion-list" role="list" aria-labelledby="picker-title">
        ${models.map((m) => html`
          <li>
            <a class="companion card card-glow" href="#/new/${m.id}">
              <span class="companion-cursor" aria-hidden="true">▶</span>
              <span class="companion-text">
                <span class="companion-name">${m.name}</span>
                <span class="companion-meta">${presetFor(m.preset).label}${getStatus(m.id).state === 'ready' ? ' · ● Ready' : ''}</span>
              </span>
            </a>
          </li>`)}
      </ul>
    </section>`;

  // JRPG menu feel: arrow keys move the cursor between companions.
  const items = $$('.companion', main);
  items[0]?.focus();
  main.querySelector('.companion-list').addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (i === -1) return;
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  });
}
