import { html, $ } from './dom.js';
import { toast } from './toast.js';
import { getSettings } from '../data/settings.js';
import { ACCEPTED_TYPES, MAX_IMAGES, prepareImage } from '../attachments/images.js';

// Message input. Enter sends (Shift+Enter = newline) unless the sendOnEnter
// setting is off; Cmd/Ctrl+Enter always sends. While streaming the button is Stop.
// Images can be attached with the button, pasted, or dropped on the box.
export function createComposer({ placeholder, onSend, onStop }) {
  const form = document.createElement('form');
  form.className = 'composer';
  form.innerHTML = html`
    <ul class="composer-attachments" aria-label="Attached images" hidden></ul>
    <div class="composer-box">
      <button type="button" class="icon-btn composer-attach" aria-label="Attach images" title="Attach images (or paste / drop them)">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <input type="file" class="composer-file" accept="${ACCEPTED_TYPES.join(',')}" multiple hidden>
      <textarea rows="1" placeholder="${placeholder}" aria-label="Message" spellcheck="true"></textarea>
      <button type="submit" class="btn btn-primary composer-button">Send</button>
    </div>
    <p class="composer-hint"></p>`;

  const box = $('.composer-box', form);
  const textarea = $('textarea', form);
  const button = $('.composer-button', form);
  const attachButton = $('.composer-attach', form);
  const fileInput = $('.composer-file', form);
  const tray = $('.composer-attachments', form);
  const hint = $('.composer-hint', form);
  let streaming = false;
  let images = []; // [{ ...prepared, url }]

  const updateHint = () => {
    hint.textContent = getSettings().sendOnEnter
      ? 'Enter to send · Shift+Enter for a new line'
      : '⌘/Ctrl+Enter to send · Enter for a new line';
  };
  updateHint();

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  // ── Attachments ─────────────────────────────────────────────────────────
  function renderTray() {
    tray.hidden = !images.length;
    tray.replaceChildren(...images.map((img, i) => {
      const li = document.createElement('li');
      li.className = 'attachment-chip';
      li.innerHTML = html`
        <img src="${img.url}" alt="${img.name}" width="56" height="56">
        <button type="button" class="attachment-remove" aria-label="Remove ${img.name}" title="Remove">✕</button>`;
      $('.attachment-remove', li).addEventListener('click', () => {
        URL.revokeObjectURL(images[i].url);
        images.splice(i, 1);
        renderTray();
        textarea.focus();
      });
      return li;
    }));
  }

  async function addFiles(files) {
    const candidates = [...files].filter((f) => f.type.startsWith('image/'));
    if (!candidates.length) return;
    const room = MAX_IMAGES - images.length;
    if (candidates.length > room) toast(`Up to ${MAX_IMAGES} images per message.`, { kind: 'error' });
    for (const file of candidates.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareImage(file);
        images.push({ ...prepared, url: URL.createObjectURL(prepared.blob) });
        renderTray();
      } catch (err) {
        toast(err.message, { kind: 'error' });
      }
    }
  }

  const takeImages = () => {
    const taken = images.map(({ url, ...img }) => img);
    for (const img of images) URL.revokeObjectURL(img.url);
    images = [];
    renderTray();
    return taken;
  };

  attachButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = ''; // allow picking the same file again
  });
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return; // ordinary text paste
    e.preventDefault();
    addFiles(files);
  });
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  box.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || textarea.disabled) return;
    e.preventDefault();
    box.classList.add('drop-target');
  });
  box.addEventListener('dragleave', (e) => {
    if (!box.contains(e.relatedTarget)) box.classList.remove('drop-target');
  });
  box.addEventListener('drop', (e) => {
    box.classList.remove('drop-target');
    if (!hasFiles(e) || textarea.disabled) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  // ── Sending ─────────────────────────────────────────────────────────────
  function submit() {
    if (streaming || textarea.disabled) return;
    const text = textarea.value;
    if (!text.trim() && !images.length) return;
    textarea.value = '';
    autosize();
    onSend(text, takeImages());
  }

  textarea.addEventListener('input', autosize);
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return; // never interrupt IME composition
    const force = e.metaKey || e.ctrlKey;
    if (force || (getSettings().sendOnEnter && !e.shiftKey)) {
      e.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (streaming) onStop();
    else submit();
  });

  return {
    el: form,
    focus: () => textarea.focus(),
    setStreaming(value) {
      streaming = value;
      button.textContent = value ? 'Stop' : 'Send';
      button.classList.toggle('btn-primary', !value);
      button.classList.toggle('composer-stop', value);
      button.setAttribute('aria-label', value ? 'Stop generating' : 'Send message');
    },
    // Puts an unsent draft back (e.g. saving failed) unless the user started a new one.
    restore(text, restoredImages = []) {
      if (textarea.value.trim() || images.length) return;
      textarea.value = text;
      images = restoredImages.map((img) => ({ ...img, url: URL.createObjectURL(img.blob) }));
      renderTray();
      autosize();
      textarea.focus();
    },
    disable(reason) {
      textarea.disabled = true;
      button.disabled = true;
      attachButton.hidden = true;
      textarea.placeholder = reason;
      hint.textContent = '';
    },
  };
}
