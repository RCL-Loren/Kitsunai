// Screen-reader announcements through one polite live region. Streaming tokens
// are never announced — only coarse events such as "response complete".

let region;

export function announce(message) {
  if (!region) {
    region = document.createElement('div');
    region.className = 'visually-hidden';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  // Clear first so repeating the same message is still announced.
  region.textContent = '';
  setTimeout(() => { region.textContent = message; }, 50);
}
