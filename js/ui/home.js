import { html } from './dom.js';
import { mascot } from './mascot.js';
import { listModels } from '../data/models.js';

export async function renderHome(main) {
  const models = await listModels();
  main.innerHTML = models.length
    ? html`
      <section class="empty-state screen-enter">
        ${mascot('idle', { size: 88 })}
        <h2 class="display">What are we exploring today?</h2>
        <p>Start a new conversation with one of your companions.</p>
        <a class="btn btn-primary" href="#/new">New chat</a>
      </section>`
    : html`
      <section class="empty-state screen-enter">
        ${mascot('idle', { size: 112 })}
        <h2 class="display">Let’s set up your first companion</h2>
        <p>KitsunAI talks to any OpenAI-compatible model: OpenCode Go, a local llama.cpp or Ollama server, and more.</p>
        <a class="btn btn-primary" href="#/models/new?setup">Add a model</a>
      </section>`;
}

export function renderSetupComplete(main, model) {
  main.innerHTML = html`
    <section class="empty-state screen-enter">
      ${mascot('happy', { size: 112 })}
      <h2 class="display">All set — your companion is ready.</h2>
      <p>${model.name} is configured. Add more models any time from <a href="#/models">Models</a>.</p>
      <a class="btn btn-primary" href="#/new">Start a conversation</a>
    </section>`;
}

export function renderPlaceholder(main, title, note) {
  main.innerHTML = html`
    <section class="empty-state screen-enter">
      <h2 class="display">${title}</h2>
      <p>${note}</p>
    </section>`;
}

export function renderFatal(main, message) {
  main.innerHTML = html`
    <section class="empty-state">
      ${mascot('error', { size: 112 })}
      <h2 class="display">KitsunAI couldn’t start</h2>
      <p>${message}</p>
    </section>`;
}
