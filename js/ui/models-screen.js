import { html, $, $$ } from './dom.js';
import { toast } from './toast.js';
import { renderSetupComplete } from './home.js';
import { on } from '../events.js';
import { listModels, getModel, saveModel, deleteModel, normalizeModel, validateModel } from '../data/models.js';
import { countConversationsForModel } from '../data/conversations.js';
import { PRESETS, presetFor, adapterFor, getStatus, setStatus, testModel } from '../providers/index.js';

const STATUS_LABEL = { unverified: 'Not tested', testing: 'Testing…', ready: 'Ready', error: 'Error' };

function statusBadge(modelId) {
  const { state, message } = getStatus(modelId);
  return html`<span class="status status-${state}" title="${message ?? ''}"><span class="status-dot" aria-hidden="true"></span>${STATUS_LABEL[state]}</span>`;
}

// ── List ────────────────────────────────────────────────────────────────────

export async function renderModelsList(main) {
  async function draw() {
    const models = await listModels();
    main.innerHTML = html`
      <section class="screen screen-enter">
        <header class="screen-header">
          <h2 class="display">Models</h2>
          <a class="btn btn-primary" href="#/models/new">+ Add Model</a>
        </header>
        ${models.length ? html`
          <ul class="model-list" role="list">
            ${models.map((m) => html`
              <li class="card model-card" data-id="${m.id}">
                <div class="model-card-main">
                  <a class="model-card-name" href="#/models/${m.id}"><span class="sparkle" aria-hidden="true">✦</span> ${m.name}</a>
                  <div class="model-card-meta">${presetFor(m.preset).label} · <code>${m.model}</code>${m.useProxy ? ' · via relay' : ''}</div>
                  <div class="model-card-status">${statusBadge(m.id)}</div>
                </div>
                <div class="model-card-actions">
                  <button class="btn btn-ghost" data-action="test" type="button">Test</button>
                  <a class="btn btn-ghost" href="#/models/${m.id}">Edit</a>
                </div>
              </li>`)}
          </ul>` : html`
          <p class="muted">No models yet. Add one to start chatting.</p>`}
      </section>`;

    for (const button of $$('[data-action="test"]', main)) {
      button.addEventListener('click', async () => {
        const model = models.find((m) => m.id === button.closest('[data-id]').dataset.id);
        const status = await testModel(model);
        if (status.state === 'error') toast(status.message, { kind: 'error', duration: 6000 });
      });
    }
  }

  await draw();
  const offStatus = on('model-status:changed', ({ modelId }) => {
    const slot = $(`[data-id="${modelId}"] .model-card-status`, main);
    if (slot) slot.innerHTML = statusBadge(modelId);
  });
  const offModels = on('models:changed', draw);
  return () => { offStatus(); offModels(); };
}

// ── Form ────────────────────────────────────────────────────────────────────

const BLANK = { preset: 'opencode-go', name: '', endpoint: PRESETS[0].endpoint, model: '', credentials: { apiKey: '' }, useProxy: true, systemPrompt: '', parameters: {} };

function field(name, label, control, hint = '') {
  return html`
    <div class="field" data-field="${name}">
      <label for="f-${name}">${label}</label>
      ${control}
      ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
      <p class="field-error" id="f-${name}-error" hidden></p>
    </div>`;
}

export async function renderModelForm(main, { id, setup = false } = {}) {
  const existing = id ? await getModel(id) : null;
  if (id && !existing) {
    main.innerHTML = html`<section class="screen"><p>That model no longer exists. <a href="#/models">Back to Models</a></p></section>`;
    return;
  }
  const m = existing ?? BLANK;
  const p = m.parameters ?? {};

  main.innerHTML = html`
    <section class="screen screen-enter">
      <header class="screen-header">
        <h2 class="display">${existing ? `Edit ${existing.name}` : setup ? 'Your first companion' : 'Add Model'}</h2>
      </header>
      <form class="model-form" novalidate>
        <fieldset class="preset-picker">
          <legend>Provider</legend>
          <div class="preset-grid">
            ${PRESETS.map((pr) => html`
              <label class="preset-option">
                <input type="radio" name="preset" value="${pr.id}" ${pr.id === m.preset ? 'checked' : ''}>
                <span class="preset-card"><span class="preset-cursor" aria-hidden="true">▶</span>${pr.label}</span>
              </label>`)}
          </div>
          <p class="field-hint" id="preset-hint">${presetFor(m.preset).hint}</p>
        </fieldset>

        <div class="form-grid">
          ${field('endpoint', 'Endpoint', html`<input id="f-endpoint" name="endpoint" type="url" value="${m.endpoint}" placeholder="http://localhost:8080/v1" autocomplete="off" spellcheck="false">`, 'Base URL, ending before /chat/completions.')}
          ${field('apiKey', html`API key <span class="optional" id="key-optional">(optional)</span>`, html`
            <div class="input-with-button">
              <input id="f-apiKey" name="apiKey" type="password" value="${m.credentials?.apiKey ?? ''}" autocomplete="off" spellcheck="false">
              <button class="btn btn-ghost" type="button" data-action="toggle-key" aria-pressed="false">Show</button>
            </div>`, 'Stored only in this browser (IndexedDB).')}
          ${field('model', 'Model identifier', html`
            <div class="input-with-button">
              <input id="f-model" name="model" value="${m.model}" list="model-ids" placeholder="e.g. kimi-k3" autocomplete="off" spellcheck="false">
              <button class="btn btn-ghost" type="button" data-action="fetch-models">Fetch models</button>
            </div>
            <datalist id="model-ids"></datalist>`)}
          ${field('name', 'Display name', html`<input id="f-name" name="name" value="${m.name}" placeholder="Defaults to the model identifier" autocomplete="off">`)}
          <label class="checkbox">
            <input type="checkbox" name="useProxy" ${m.useProxy ? 'checked' : ''}>
            <span>Use local relay <span class="muted">— for providers that block browser requests (CORS). Needs <code>node tools/serve.js</code>.</span></span>
          </label>
        </div>

        <details class="advanced" ${m.systemPrompt || Object.keys(p).length ? 'open' : ''}>
          <summary>System prompt &amp; parameters</summary>
          <div class="form-grid">
            ${field('systemPrompt', 'System prompt', html`<textarea id="f-systemPrompt" name="systemPrompt" rows="4">${m.systemPrompt}</textarea>`)}
            <div class="param-row">
              ${field('temperature', 'Temperature', html`<input id="f-temperature" name="temperature" type="number" step="0.1" min="0" max="2" value="${p.temperature ?? ''}" placeholder="default">`)}
              ${field('top_p', 'Top P', html`<input id="f-top_p" name="top_p" type="number" step="0.05" min="0" max="1" value="${p.top_p ?? ''}" placeholder="default">`)}
              ${field('max_tokens', 'Max tokens', html`<input id="f-max_tokens" name="max_tokens" type="number" step="1" min="1" value="${p.max_tokens ?? ''}" placeholder="default">`)}
            </div>
            ${field('extra', 'Extra request JSON', html`<textarea id="f-extra" name="extra" rows="3" spellcheck="false" placeholder='{"seed": 42}'>${p.extra ? JSON.stringify(p.extra, null, 2) : ''}</textarea>`, 'Merged into every request body.')}
          </div>
        </details>

        <div class="form-status" role="status" aria-live="polite"></div>

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Save</button>
          <button class="btn" type="button" data-action="test">Test connection</button>
          <a class="btn btn-ghost" href="${setup ? '#/' : '#/models'}">Cancel</a>
          ${existing ? html`<button class="btn btn-danger push-right" type="button" data-action="delete">Delete</button>` : ''}
        </div>
        <div class="confirm" hidden></div>
      </form>
    </section>`;

  const form = $('form', main);
  const statusEl = $('.form-status', form);
  let currentPreset = m.preset;
  let lastTest = null; // { snapshot, ok }

  const showStatus = (kind, message) => {
    statusEl.className = `form-status form-status-${kind}`;
    statusEl.textContent = message;
  };

  function clearErrors() {
    for (const el of $$('.field-error', form)) { el.hidden = true; el.textContent = ''; }
    for (const el of $$('[aria-invalid]', form)) { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
  }

  function showErrors(errors) {
    for (const [name, message] of Object.entries(errors)) {
      const err = $(`#f-${name}-error`, form);
      const input = $(`#f-${name}`, form);
      if (err) { err.textContent = message; err.hidden = false; }
      if (input) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', `f-${name}-error`); }
    }
    $('[aria-invalid="true"]', form)?.focus();
  }

  // Reads the form into a normalized model. Returns { model, errors }.
  function readForm() {
    const data = new FormData(form);
    const errors = {};
    let extra;
    const extraText = String(data.get('extra') ?? '').trim();
    if (extraText) {
      try {
        extra = JSON.parse(extraText);
        if (typeof extra !== 'object' || Array.isArray(extra) || extra === null) throw new Error();
      } catch {
        errors.extra = 'Must be a JSON object, e.g. {"seed": 42}';
      }
    }
    const model = normalizeModel({
      id: existing?.id,
      preset: data.get('preset'),
      name: data.get('name'),
      endpoint: data.get('endpoint'),
      model: data.get('model'),
      credentials: { apiKey: data.get('apiKey') },
      useProxy: data.get('useProxy') === 'on',
      systemPrompt: data.get('systemPrompt'),
      parameters: { temperature: data.get('temperature'), top_p: data.get('top_p'), max_tokens: data.get('max_tokens'), extra },
    });
    return { model, errors: { ...validateModel(model), ...errors } };
  }

  const snapshot = (model) => JSON.stringify({ ...model, id: undefined, name: undefined, systemPrompt: undefined, parameters: undefined });

  // Preset switch: prefill endpoint (unless the user typed their own) and relay default.
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'preset') return;
    const prev = presetFor(currentPreset);
    const next = presetFor(e.target.value);
    const endpoint = form.elements.endpoint;
    if (!endpoint.value.trim() || endpoint.value.trim().replace(/\/+$/, '') === prev.endpoint) endpoint.value = next.endpoint;
    form.elements.useProxy.checked = next.useProxy;
    $('#preset-hint', form).textContent = next.hint;
    $('#key-optional', form).hidden = next.needsKey;
    currentPreset = next.id;
    showStatus('', '');
  });
  $('#key-optional', form).hidden = presetFor(m.preset).needsKey;

  form.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'toggle-key') {
      const input = form.elements.apiKey;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      e.target.textContent = show ? 'Hide' : 'Show';
      e.target.setAttribute('aria-pressed', String(show));
    }

    if (action === 'fetch-models' || action === 'test') {
      clearErrors();
      const { model, errors } = readForm();
      const needed = action === 'test' ? ['endpoint', 'model'] : ['endpoint'];
      const blocking = Object.fromEntries(Object.entries(errors).filter(([k]) => needed.includes(k)));
      if (Object.keys(blocking).length) return showErrors(blocking);
      const button = e.target.closest('button');
      button.disabled = true;
      try {
        if (action === 'fetch-models') {
          showStatus('pending', 'Fetching models…');
          const ids = await adapterFor(model).listModels(model);
          $('#model-ids', form).innerHTML = html`${ids.map((id) => html`<option value="${id}"></option>`)}`;
          showStatus('ok', `Found ${ids.length} model${ids.length === 1 ? '' : 's'} — pick one from the Model identifier list.`);
          form.elements.model.focus();
        } else {
          showStatus('pending', 'Testing connection…');
          const message = await adapterFor(model).test(model);
          lastTest = { snapshot: snapshot(model), ok: true, message };
          if (existing) setStatus(existing.id, { state: 'ready', message });
          showStatus('ok', message);
        }
      } catch (err) {
        if (action === 'test' && existing) setStatus(existing.id, { state: 'error', message: err.message });
        showStatus('error', err.message);
      } finally {
        button.disabled = false;
      }
    }

    if (action === 'delete') {
      const count = await countConversationsForModel(existing.id);
      const confirmEl = $('.confirm', form);
      confirmEl.innerHTML = html`
        <p>Delete <strong>${existing.name}</strong>?${
          count === 1 ? ' 1 conversation uses it — it stays readable but can’t continue.'
          : count > 1 ? ` ${count} conversations use it — they stay readable but can’t continue.` : ''}</p>
        <div class="form-actions">
          <button class="btn btn-danger" type="button" data-action="confirm-delete">Delete model</button>
          <button class="btn btn-ghost" type="button" data-action="cancel-delete">Keep it</button>
        </div>`;
      confirmEl.hidden = false;
      $('[data-action="cancel-delete"]', confirmEl).focus();
    }
    if (action === 'cancel-delete') $('.confirm', form).hidden = true;
    if (action === 'confirm-delete') {
      await deleteModel(existing.id);
      toast(`Deleted ${existing.name}`);
      location.hash = '#/models';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const { model, errors } = readForm();
    if (Object.keys(errors).length) return showErrors(errors);
    const saved = await saveModel(model);
    if (lastTest?.ok && lastTest.snapshot === snapshot(saved)) setStatus(saved.id, { state: 'ready', message: lastTest.message });
    else if (existing && snapshot(existing) !== snapshot(saved)) setStatus(saved.id, { state: 'unverified' });

    if (setup) {
      renderSetupComplete(main, saved);
    } else {
      toast(`Saved ${saved.name}`);
      location.hash = '#/models';
    }
  });

  (existing ? form.elements.name : form.elements.model).focus();
}
