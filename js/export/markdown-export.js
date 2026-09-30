// Pure Markdown export (plan §8). Message bodies are written verbatim:
// Markdown is canonical, so export is formatting around it, never conversion.

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date, YYYY-MM-DD.
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local date-time without zone, YYYY-MM-DDTHH:mm:ss (an Obsidian datetime property).
export function localDateTime(ms) {
  const d = new Date(ms);
  return `${localDate(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Double-quoted YAML scalar: escape backslash and quote, drop line breaks.
export function yamlString(value) {
  return `"${String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim()}"`;
}

// Lowercase ASCII words joined by hyphens, at most 60 characters.
export function slugify(text, fallback = 'conversation') {
  const slug = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || fallback;
}

export const exportFilename = (title, ms, fallback) => `${localDate(ms)}-${slugify(title, fallback)}.md`;

// Obsidian tags: no spaces or leading '#'; 'llm-chat' first; no duplicates.
export function normalizeTags(tags = []) {
  const clean = ['llm-chat', ...tags]
    .map((t) => String(t).trim().replace(/^#+/, '').replace(/\s+/g, '-'))
    .filter(Boolean);
  return [...new Set(clean)];
}

// Parses the comma-separated tag field from Settings ('llm-chat' is always added on export).
export const parseTagInput = (text) =>
  [...new Set(String(text).split(',').map((t) => t.trim().replace(/^#+/, '').replace(/\s+/g, '-')).filter(Boolean))];

// ── Images ─────────────────────────────────────────────────────────────────

export const ATTACHMENTS_DIR = 'attachments';

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// Pure: a safe, unique file name for an exported image, e.g. "03-1-screenshot.png"
// (message number, image number, original name).
export function attachmentFileName(messageNumber, imageNumber, ref) {
  const base = slugify(String(ref.name ?? '').replace(/\.[a-z0-9]+$/i, ''), 'image');
  return `${String(messageNumber).padStart(2, '0')}-${imageNumber}-${base}.${IMAGE_EXT[ref.mime] ?? 'img'}`;
}

const altText = (ref) => String(ref.name ?? 'image').replace(/[[\]\n]/g, ' ').trim() || 'image';

// Pure: the placeholder that stands in for an image in copied Markdown.
export const imagePlaceholder = (ref) => `[image: ${altText(ref)}]`;

// Pure: a message's Markdown plus one line per image — a relative link when
// imagePath(ref) returns a path, otherwise a placeholder.
export function messageMarkdown(message, imagePath) {
  const text = message.markdown.replace(/\s+$/, '');
  const images = (message.attachments ?? []).map((ref) => {
    const path = imagePath?.(ref);
    return path ? `![${altText(ref)}](${path})` : imagePlaceholder(ref);
  });
  return [text, images.join('\n')].filter(Boolean).join('\n\n');
}

// Pure: every image in a conversation with its exported path, in message order.
export function attachmentPaths(messages) {
  const paths = new Map();
  messages.forEach((m, i) => (m.attachments ?? []).forEach((ref, j) => {
    paths.set(ref.id, `${ATTACHMENTS_DIR}/${attachmentFileName(i + 1, j + 1, ref)}`);
  }));
  return paths;
}

// imagePath(ref) → relative path for exported images; without it, images become placeholders.
export function conversationToMarkdown(conversation, messages, { displayName = 'User', modelName, provider, tags = [], frontmatter = true, imagePath } = {}) {
  const assistantName = modelName || conversation.modelName || 'Assistant';
  const parts = [];

  if (frontmatter) {
    const lines = [
      '---',
      `title: ${yamlString(conversation.title)}`,
      `date: ${localDate(conversation.createdAt)}`,
      `created: ${localDateTime(conversation.createdAt)}`,
      `updated: ${localDateTime(conversation.updatedAt)}`,
      `model: ${yamlString(assistantName)}`,
    ];
    if (provider) lines.push(`provider: ${yamlString(provider)}`);
    lines.push('tags:', ...normalizeTags(tags).map((t) => `  - ${t}`), '---', '');
    parts.push(lines.join('\n'));
  }

  parts.push(`# ${conversation.title.replace(/[\r\n]+/g, ' ')}\n`);
  for (const m of messages) {
    const heading = m.role === 'user' ? displayName || 'User' : assistantName;
    parts.push(`## ${heading}\n\n${messageMarkdown(m, imagePath)}\n`);
  }
  return parts.join('\n');
}
