// One delegated listener per root handles every code block's Copy button.

export function attachCodeCopy(root) {
  const onClick = async (e) => {
    const button = e.target.closest('[data-copy-code]');
    if (!button || !root.contains(button)) return;
    const code = button.closest('.code-block')?.querySelector('pre code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      flash(button, 'Copied');
    } catch {
      flash(button, 'Copy failed');
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function flash(button, label) {
  clearTimeout(button._resetTimer);
  button.textContent = label;
  button.classList.add('copied');
  button._resetTimer = setTimeout(() => {
    button.textContent = 'Copy';
    button.classList.remove('copied');
  }, 1400);
}
