import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  yamlString, slugify, exportFilename, normalizeTags, parseTagInput, localDate, localDateTime, conversationToMarkdown,
} from '../js/export/markdown-export.js';

const at = (y, mo, d, h = 9, mi = 5, s = 7) => new Date(y, mo - 1, d, h, mi, s).getTime();

test('yamlString quotes and escapes', () => {
  assert.equal(yamlString('Plasma Source Discussion'), '"Plasma Source Discussion"');
  assert.equal(yamlString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  assert.equal(yamlString('two\nlines'), '"two lines"');
  assert.equal(yamlString('key: value # not a comment'), '"key: value # not a comment"');
  assert.equal(yamlString(undefined), '""');
});

test('slugify and filenames', () => {
  assert.equal(slugify('Plasma Source Discussion'), 'plasma-source-discussion');
  assert.equal(slugify('Über café — $E=mc^2$!'), 'uber-cafe-e-mc-2');
  assert.equal(slugify('プラズマ'), 'conversation', 'non-latin falls back');
  assert.equal(slugify('   '), 'conversation');
  assert.ok(slugify('word '.repeat(30)).length <= 60);
  assert.ok(!slugify('a'.repeat(59) + ' bc').endsWith('-'));
  assert.equal(exportFilename('Damped oscillator', at(2026, 9, 29)), '2026-09-29-damped-oscillator.md');
  assert.equal(exportFilename('', at(2026, 1, 2), 'message'), '2026-01-02-message.md');
});

test('local date formats', () => {
  assert.equal(localDate(at(2026, 9, 29)), '2026-09-29');
  assert.equal(localDateTime(at(2026, 9, 29, 14, 3, 9)), '2026-09-29T14:03:09');
});

test('tags always start with llm-chat and are Obsidian-safe', () => {
  assert.deepEqual(normalizeTags(['llm-chat', 'plasma']), ['llm-chat', 'plasma']);
  assert.deepEqual(normalizeTags(['#physics', 'control theory', '', 'physics']), ['llm-chat', 'physics', 'control-theory']);
  assert.deepEqual(parseTagInput(' plasma, #physics , control theory,, plasma '), ['plasma', 'physics', 'control-theory']);
});

const conversation = { title: 'Plasma Source Discussion', modelName: 'GPT-5.6', createdAt: at(2026, 9, 29, 10, 0, 0), updatedAt: at(2026, 9, 29, 11, 30, 0) };
const messages = [
  { role: 'user', markdown: 'Suppose the magnetic field is approximately...' },
  { role: 'assistant', markdown: 'For an electron moving perpendicular to the field,\n\n$$\nr_L = \\frac{m_e v_\\perp}{eB}\n$$\n\n---\n\n...\n\n' },
];

test('conversation export matches the project description example', () => {
  const md = conversationToMarkdown(conversation, messages, { displayName: 'Loren', provider: 'OpenCode Go', tags: ['llm-chat', 'plasma'] });
  assert.equal(md, [
    '---',
    'title: "Plasma Source Discussion"',
    'date: 2026-09-29',
    'created: 2026-09-29T10:00:00',
    'updated: 2026-09-29T11:30:00',
    'model: "GPT-5.6"',
    'provider: "OpenCode Go"',
    'tags:',
    '  - llm-chat',
    '  - plasma',
    '---',
    '',
    '# Plasma Source Discussion',
    '',
    '## Loren',
    '',
    'Suppose the magnetic field is approximately...',
    '',
    '## GPT-5.6',
    '',
    'For an electron moving perpendicular to the field,\n\n$$\nr_L = \\frac{m_e v_\\perp}{eB}\n$$\n\n---\n\n...',
    '',
  ].join('\n'));
});

test('bodies are verbatim; frontmatter is optional; names fall back', () => {
  const md = conversationToMarkdown(conversation, messages, { frontmatter: false, displayName: '' });
  assert.ok(md.startsWith('# Plasma Source Discussion\n'));
  assert.ok(md.includes('## User\n'));
  assert.ok(md.includes('## GPT-5.6\n'));
  assert.ok(md.includes(messages[1].markdown.trimEnd()));
  const noModel = conversationToMarkdown({ ...conversation, modelName: undefined }, messages, { frontmatter: false });
  assert.ok(noModel.includes('## Assistant\n'));
});
