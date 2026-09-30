// Preparing images for attachment: validate, downscale and re-encode in the
// browser (canvas), so uploads stay small and every provider can read them.

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_IMAGES = 4;
export const MAX_EDGE = 1568; // px on the longest side (a common provider sweet spot)
const MAX_BYTES_AS_IS = 1.5 * 1024 * 1024; // larger files are re-encoded
const JPEG_QUALITY = 0.85;

// Pure: scale (w, h) to fit within `max` on the longest side; never upscales.
export function fitWithin(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Pure: decides whether a file can be sent as-is and, if not, the output type.
// PNG and JPEG within limits pass through untouched. Everything else becomes
// PNG (keeps text and transparency sharp; GIFs keep their first frame) or JPEG
// for photos. WebP is converted because some local servers can't decode it.
export function encodingPlan({ type, size, width, height }) {
  const fits = Math.max(width, height) <= MAX_EDGE;
  if ((type === 'image/png' || type === 'image/jpeg') && fits && size <= MAX_BYTES_AS_IS) return { keep: true };
  return { keep: false, type: type === 'image/jpeg' ? 'image/jpeg' : 'image/png' };
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const extensionFor = (mime) => EXT[mime] ?? 'img';

// Pure: keeps the original base name, with the extension of the stored type.
export function outputName(name, mime) {
  const base = (name || 'image').replace(/\.[a-z0-9]+$/i, '') || 'image';
  return `${base}.${extensionFor(mime)}`;
}

function canvasBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality));
}

// Browser: File → { blob, name, mime, width, height }. Throws with a message
// fit for a toast when the file isn't a readable image.
export async function prepareImage(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error(`${file.name || 'That file'} isn’t a PNG, JPEG, WebP or GIF image.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name || 'That image'} couldn’t be read.`);
  }
  try {
    const plan = encodingPlan({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
    if (plan.keep) return { blob: file, name: outputName(file.name, file.type), mime: file.type, width: bitmap.width, height: bitmap.height };

    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    if (plan.type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvasBlob(canvas, plan.type, JPEG_QUALITY);
    let mime = plan.type;
    // Large photos saved as PNG get big; fall back to JPEG.
    if (mime === 'image/png' && blob.size > MAX_BYTES_AS_IS) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      blob = await canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      mime = 'image/jpeg';
    }
    return { blob, name: outputName(file.name, mime), mime, width, height };
  } finally {
    bitmap.close?.();
  }
}

// Base64 data URLs for provider requests, cached per attachment id (images in
// history are sent again with every message).
const dataUrlCache = new Map();
const DATA_URL_CACHE_LIMIT = 64;

export async function dataUrlFor(id, blob) {
  let url = dataUrlCache.get(id);
  if (!url) {
    url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    if (dataUrlCache.size >= DATA_URL_CACHE_LIMIT) dataUrlCache.delete(dataUrlCache.keys().next().value);
    dataUrlCache.set(id, url);
  }
  return url;
}
