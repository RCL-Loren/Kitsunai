import { html, $ } from './dom.js';
import { getSettings } from '../data/settings.js';

// Message input. Enter sends (Shift+Enter = newline) unless the sendOnEnter
// setting is off; Cmd/Ctrl+Enter always sends. While streaming the button is Stop.
export function createComposer({ placeholder, onSend, onStop }) {
  const form = document.createElement('form');
  form.className = 'composer';
  form.innerHTML = html`
    <div class="composer-box">
      <textarea rows="1" placeholder="${placeholder}" aria-label="Message" spellcheck="true"></textarea>
      <button type="submit" class="btn btn-primary composer-button">Send</button>
    </div>
    <p class="composer-hint"></p>`;

  const textarea = $('textarea', form);
  const button = $('.composer-button', form);
  const hint = $('.composer-hint', form);
  let streaming = false;

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

  function submit() {
    if (streaming || textarea.disabled) return;
    const text = textarea.value;
    if (!text.trim()) return;
    textarea.value = '';
    autosize();
    onSend(text);
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
    // Puts an unsent draft back (e.g. saving failed) unless the user typed something new.
    restore(text) {
      if (textarea.value.trim()) return;
      textarea.value = text;
      autosize();
      textarea.focus();
    },
    disable(reason) {
      textarea.disabled = true;
      button.disabled = true;
      textarea.placeholder = reason;
      hint.textContent = '';
    },
  };
}
