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

export function conversationToMarkdown(conversation, messages, { displayName = 'User', modelName, provider, tags = [], frontmatter = true } = {}) {
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
    parts.push(`## ${heading}\n\n${m.markdown.replace(/\s+$/, '')}\n`);
  }
  return parts.join('\n');
}
