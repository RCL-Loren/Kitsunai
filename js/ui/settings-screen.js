import { html, $ } from './dom.js';
import { getSettings, setSetting } from '../data/settings.js';
import { conversationToMarkdown, parseTagInput } from '../export/markdown-export.js';

const THEMES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']];

// Settings save as you change them; there is no Save button.
export function renderSettings(main) {
  const s = getSettings();
  main.innerHTML = html`
    <section class="screen screen-enter">
      <header class="screen-header">
        <h2 class="display">Settings</h2>
        <span class="save-state" role="status" aria-live="polite"></span>
      </header>
      <form class="settings-form" novalidate>
        <section class="settings-group card">
          <h3>Appearance</h3>
          <fieldset class="segmented">
            <legend>Theme</legend>
            ${THEMES.map(([value, label]) => html`
              <label class="segment">
                <input type="radio" name="theme" value="${value}" ${s.theme === value ? 'checked' : ''}>
                <span>${label}</span>
              </label>`)}
          </fieldset>
        </section>

        <section class="settings-group card">
          <h3>Conversations</h3>
          <div class="field">
            <label for="s-displayName">Your name</label>
            <input id="s-displayName" name="displayName" value="${s.displayName}" autocomplete="name">
            <p class="field-hint">Used as your heading in exported conversations.</p>
          </div>
          <label class="checkbox">
            <input type="checkbox" name="sendOnEnter" ${s.sendOnEnter ? 'checked' : ''}>
            <span>Send with Enter <span class="muted">— Shift+Enter adds a new line. When off, Enter adds a new line and ⌘/Ctrl+Enter sends.</span></span>
          </label>
        </section>

        <section class="settings-group card">
          <h3>Export</h3>
          <label class="checkbox">
            <input type="checkbox" name="exportFrontmatter" ${s.exportFrontmatter ? 'checked' : ''}>
            <span>Include YAML frontmatter <span class="muted">— title, date, model and tags as Obsidian properties.</span></span>
          </label>
          <div class="field">
            <label for="s-defaultTags">Default tags</label>
            <input id="s-defaultTags" name="defaultTags" value="${s.defaultTags.join(', ')}" placeholder="plasma, physics" spellcheck="false">
            <p class="field-hint">Comma-separated. <code>llm-chat</code> is always included.</p>
          </div>
          <div class="field">
            <span class="field-label">Preview</span>
            <pre class="export-preview" aria-label="Export preview"></pre>
          </div>
        </section>

        <section class="settings-group card">
          <h3>Privacy &amp; storage</h3>
          <p class="settings-note">Conversations, models and settings are stored only in this browser (IndexedDB). <strong>API keys are stored unencrypted</strong> — anyone with access to this browser profile can read them. Messages are sent only to the model endpoints you configure, through the local relay for models that use it.</p>
        </section>
      </form>
    </section>`;

  const form = $('form', main);
  const saveState = $('.save-state', main);
  const preview = $('.export-preview', main);
  let savedTimer = 0;

  function showSaved() {
    saveState.textContent = 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saveState.textContent = ''; }, 1500);
  }

  function readValue(name) {
    const el = form.elements[name];
    if (name === 'sendOnEnter' || name === 'exportFrontmatter') return el.checked;
    if (name === 'defaultTags') return parseTagInput(el.value);
    if (name === 'displayName') return el.value.trim() || 'User';
    return el.value; // theme (RadioNodeList)
  }

  function updatePreview() {
    const now = Date.now();
    const text = conversationToMarkdown(
      { title: 'Plasma Source Discussion', modelName: 'GPT-5.6', createdAt: now, updatedAt: now },
      [{ role: 'user', markdown: 'Suppose the magnetic field is approximately…' }],
      {
        displayName: readValue('displayName'),
        provider: 'OpenCode Go',
        tags: readValue('defaultTags'),
        frontmatter: readValue('exportFrontmatter'),
      },
    );
    preview.textContent = text.trimEnd();
  }

  async function save(name) {
    const value = readValue(name);
    const current = getSettings()[name];
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    await setSetting(name, value);
    showSaved();
  }

  let typingTimer = 0;
  form.addEventListener('input', (e) => {
    updatePreview();
    if (!['radio', 'checkbox'].includes(e.target.type)) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => save(e.target.name), 400);
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.name) save(e.target.name);
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  updatePreview();
  return () => clearTimeout(typingTimer);
}
