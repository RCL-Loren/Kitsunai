import { getAttachment } from '../data/attachments.js';

// Object URLs for stored images, shared across views for the session and
// capped; evicted URLs are revoked (images already on screen stay decoded).
const urls = new Map();
const URL_LIMIT = 150;

async function urlFor(id) {
  if (urls.has(id)) return urls.get(id);
  const record = await getAttachment(id);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  if (urls.size >= URL_LIMIT) {
    const [oldId, oldUrl] = urls.entries().next().value;
    urls.delete(oldId);
    URL.revokeObjectURL(oldUrl);
  }
  urls.set(id, url);
  return url;
}

// Fills in <img data-attachment-id> thumbnails inside root that have no src yet.
export async function hydrateImages(root) {
  const pending = root.querySelectorAll('img[data-attachment-id]:not([src])');
  await Promise.all([...pending].map(async (img) => {
    const url = await urlFor(img.dataset.attachmentId);
    if (url) img.src = url;
    else img.closest('.message-image')?.classList.add('missing');
  }));
}

let dialog;

// Full-size view in a native <dialog>: Esc, the close button or a click closes it.
export async function openLightbox(id, name) {
  const url = await urlFor(id);
  if (!url) return;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">✕</button><img alt="">';
    dialog.addEventListener('click', () => dialog.close());
    document.body.append(dialog);
  }
  const img = dialog.querySelector('img');
  img.src = url;
  img.alt = name ?? '';
  dialog.setAttribute('aria-label', name ?? 'Image');
  dialog.showModal();
}
