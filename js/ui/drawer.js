// Below 800px the sidebar becomes an off-canvas drawer.
// Closed drawers are `inert`, so they are skipped by Tab and screen readers.

const NARROW = matchMedia('(max-width: 800px)');

export function setupDrawer(app) {
  const button = app.querySelector('.menu-button');
  const sidebar = app.querySelector('.sidebar');
  const backdrop = app.querySelector('.drawer-backdrop');
  let open = false;

  function set(value, { restoreFocus = true } = {}) {
    open = value && NARROW.matches;
    app.classList.toggle('drawer-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    backdrop.hidden = !open;
    sidebar.inert = NARROW.matches && !open;
    if (open) sidebar.querySelector('a, button')?.focus();
    else if (restoreFocus && sidebar.contains(document.activeElement)) button.focus();
  }

  button.addEventListener('click', () => set(!open));
  backdrop.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); set(false); }
  });
  // Choosing a destination closes the drawer; the new screen takes focus.
  window.addEventListener('hashchange', () => set(false, { restoreFocus: false }));
  NARROW.addEventListener('change', () => set(false, { restoreFocus: false }));
  set(false, { restoreFocus: false });
}
