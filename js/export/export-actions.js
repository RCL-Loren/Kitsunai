// Browser side of copy/export: clipboard, downloads, and gathering data.

import { conversationToMarkdown, exportFilename, messageMarkdown, attachmentPaths } from './markdown-export.js';
import { createZip } from './zip.js';
import { getAttachment } from '../data/attachments.js';
import { deriveTitle } from '../chat/session.js';
import { getConversation } from '../data/conversations.js';
import { listMessages } from '../data/messages.js';
import { getModel } from '../data/models.js';
import { getSettings } from '../data/settings.js';
import { presetFor } from '../providers/index.js';

export function downloadText(filename, text) {
  downloadBlob(filename, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// A copy of the rendered message without UI chrome (code headers, copy buttons).
function cleanClone(bodyEl) {
  const clone = bodyEl.cloneNode(true);
  clone.querySelectorAll('.code-header').forEach((el) => el.remove());
  return clone;
}

// Readable plain text: KaTeX's duplicated MathML/HTML glyphs are replaced by
// the TeX source. innerText needs layout, so the clone is measured off-screen.
function plainText(bodyEl) {
  const clone = cleanClone(bodyEl);
  for (const el of clone.querySelectorAll('.katex-display, .katex')) {
    if (!clone.contains(el)) continue; // inner .katex of a display block already replaced
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.textContent;
    const display = el.classList.contains('katex-display');
    el.replaceWith(display ? `\n$$\n${tex.trim()}\n$$\n` : `$${tex.trim()}$`);
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;white-space:normal';
  host.append(clone);
  document.body.append(host);
  const text = clone.innerText;
  host.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Copy: rich HTML (pastes formatted into docs/email) plus readable plain text.
export async function copyRendered(bodyEl) {
  const plain = plainText(bodyEl);
  if (globalThis.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([cleanClone(bodyEl).innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

// Copy Markdown: the canonical source, exactly as stored; images become
// placeholders like [image: photo.png].
export const copyMarkdown = (message) => navigator.clipboard.writeText(messageMarkdown(message));

// Markdown with images → a .zip of the .md and its attachments/ folder, with
// relative image links (Obsidian and other Markdown apps resolve them).
// Without images → the plain .md, as before.
async function exportWithImages(mdFilename, messages, toMarkdown) {
  const paths = attachmentPaths(messages);
  if (!paths.size) return downloadText(mdFilename, toMarkdown(null));
  const encoder = new TextEncoder();
  const entries = [{ name: mdFilename, data: encoder.encode(toMarkdown((ref) => paths.get(ref.id))) }];
  for (const [id, path] of paths) {
    const record = await getAttachment(id);
    if (record) entries.push({ name: path, data: new Uint8Array(await record.blob.arrayBuffer()) });
  }
  downloadBlob(mdFilename.replace(/\.md$/, '.zip'), new Blob([createZip(entries)], { type: 'application/zip' }));
}

// Export Markdown (one message): the original Markdown, unchanged, plus its images.
export function exportMessage(message) {
  const title = message.markdown.trim() ? deriveTitle(message.markdown) : 'image';
  return exportWithImages(exportFilename(title, message.createdAt, 'message'), [message], (imagePath) => messageMarkdown(message, imagePath));
}

export async function exportConversation(id) {
  const conversation = await getConversation(id);
  if (!conversation) throw new Error('Conversation not found');
  const [messages, model] = await Promise.all([listMessages(id), getModel(conversation.modelId)]);
  const settings = getSettings();
  await exportWithImages(exportFilename(conversation.title, conversation.createdAt), messages, (imagePath) => conversationToMarkdown(conversation, messages, {
    displayName: settings.displayName,
    modelName: model?.name ?? conversation.modelName,
    provider: model ? presetFor(model.preset).label : undefined,
    tags: settings.defaultTags,
    frontmatter: settings.exportFrontmatter,
    imagePath,
  }));
}
