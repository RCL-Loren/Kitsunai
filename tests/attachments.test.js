import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, encodingPlan, outputName, MAX_EDGE } from '../js/attachments/images.js';
import { attachmentFileName, attachmentPaths, messageMarkdown, conversationToMarkdown, imagePlaceholder } from '../js/export/markdown-export.js';
import { chatMessage } from '../js/providers/openai.js';
import { responsesInput } from '../js/providers/responses.js';
import { alternate, buildMessagesBody } from '../js/providers/messages.js';
import { httpErrorMessage } from '../js/providers/errors.js';
import { contextFor } from '../js/chat/session.js';
import { model } from './helpers.js';

// ── Image preparation ────────────────────────────────────────────────────────

test('fitWithin scales the longest side down, never up', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: MAX_EDGE, height: 1176 });
  assert.deepEqual(fitWithin(1000, 3136), { width: 500, height: MAX_EDGE });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

test('encodingPlan keeps small PNG/JPEG as-is and converts the rest', () => {
  assert.deepEqual(encodingPlan({ type: 'image/png', size: 200e3, width: 1200, height: 800 }), { keep: true });
  assert.deepEqual(encodingPlan({ type: 'image/jpeg', size: 900e3, width: 1568, height: 1000 }), { keep: true });
  assert.deepEqual(encodingPlan({ type: 'image/jpeg', size: 900e3, width: 4000, height: 3000 }), { keep: false, type: 'image/jpeg' });
  assert.deepEqual(encodingPlan({ type: 'image/png', size: 5e6, width: 1000, height: 1000 }), { keep: false, type: 'image/png' });
  assert.deepEqual(encodingPlan({ type: 'image/webp', size: 50e3, width: 100, height: 100 }), { keep: false, type: 'image/png' });
  assert.deepEqual(encodingPlan({ type: 'image/gif', size: 50e3, width: 100, height: 100 }), { keep: false, type: 'image/png' });
});

test('outputName keeps the base name with the stored extension', () => {
  assert.equal(outputName('Screen Shot 2026.webp', 'image/png'), 'Screen Shot 2026.png');
  assert.equal(outputName('photo.JPG', 'image/jpeg'), 'photo.jpg');
  assert.equal(outputName('', 'image/png'), 'image.png');
});

// ── Export and Copy Markdown ─────────────────────────────────────────────────

const refs = [
  { id: 'a1', name: 'Screen Shot [1].png', mime: 'image/png' },
  { id: 'a2', name: 'photo.jpg', mime: 'image/jpeg' },
];
const withImages = { role: 'user', markdown: 'What is this circuit?\n', attachments: refs };

test('Copy Markdown replaces images with placeholders', () => {
  assert.equal(messageMarkdown(withImages), 'What is this circuit?\n\n[image: Screen Shot  1 .png]\n[image: photo.jpg]');
  assert.equal(messageMarkdown({ markdown: '', attachments: [refs[1]] }), '[image: photo.jpg]');
  assert.equal(messageMarkdown({ markdown: 'plain' }), 'plain');
  assert.equal(imagePlaceholder({ name: '' }), '[image: image]');
});

test('exported image files get safe, unique names in message order', () => {
  assert.equal(attachmentFileName(3, 1, refs[0]), '03-1-screen-shot-1.png');
  const paths = attachmentPaths([{ attachments: [] }, withImages, { markdown: 'reply' }]);
  assert.deepEqual([...paths], [['a1', 'attachments/02-1-screen-shot-1.png'], ['a2', 'attachments/02-2-photo.jpg']]);
});

test('conversation export links images with relative paths', () => {
  const conversation = { title: 'Circuit', modelName: 'Fox', createdAt: 0, updatedAt: 0 };
  const messages = [withImages, { role: 'assistant', markdown: 'A low-pass filter.' }];
  const paths = attachmentPaths(messages);
  const md = conversationToMarkdown(conversation, messages, { frontmatter: false, displayName: 'Loren', imagePath: (r) => paths.get(r.id) });
  assert.equal(md, [
    '# Circuit', '',
    '## Loren', '',
    'What is this circuit?', '',
    '![Screen Shot  1 .png](attachments/01-1-screen-shot-1.png)',
    '![photo.jpg](attachments/01-2-photo.jpg)', '',
    '## Fox', '',
    'A low-pass filter.', '',
  ].join('\n'));
});

// ── Provider request shapes ──────────────────────────────────────────────────

const img = { mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
const turn = { role: 'user', content: 'What is this?', images: [img] };

test('Chat Completions: text + image_url parts; plain turns stay strings', () => {
  assert.deepEqual(chatMessage(turn), {
    role: 'user',
    content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: img.dataUrl } }],
  });
  assert.deepEqual(chatMessage({ role: 'user', content: '', images: [img] }).content, [{ type: 'image_url', image_url: { url: img.dataUrl } }]);
  assert.deepEqual(chatMessage({ role: 'assistant', content: 'hi' }), { role: 'assistant', content: 'hi' });
});

test('Responses: input_text + input_image parts', () => {
  assert.deepEqual(responsesInput(turn), {
    role: 'user',
    content: [{ type: 'input_text', text: 'What is this?' }, { type: 'input_image', image_url: img.dataUrl }],
  });
});

test('Anthropic Messages: base64 image blocks before the text, merged turns keep images', () => {
  const imageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  assert.deepEqual(buildMessagesBody(model(), [turn]).messages, [{ role: 'user', content: [imageBlock, { type: 'text', text: 'What is this?' }] }]);
  assert.deepEqual(alternate([{ role: 'user', content: 'first' }, turn]), [
    { role: 'user', content: [{ type: 'text', text: 'first' }, imageBlock, { type: 'text', text: 'What is this?' }] },
  ]);
});

test('context keeps attachment references for the session to load', () => {
  assert.deepEqual(contextFor([withImages, { role: 'assistant', markdown: 'ok' }]), [
    { role: 'user', content: withImages.markdown, attachments: refs },
  ]);
});

test('text-only models get a clear message', () => {
  assert.match(httpErrorMessage(400, '{"error":{"message":"image input is not supported - hint: you may need to provide the mmproj"}}'), /doesn’t accept images/);
  assert.match(httpErrorMessage(400, '{"error":{"message":"Invalid content type. image_url is only supported by certain models."}}'), /doesn’t accept images/);
  assert.match(httpErrorMessage(400, '{"error":{"message":"This model does not support image input."}}'), /doesn’t accept images/);
  assert.doesNotMatch(httpErrorMessage(400, '{"error":{"message":"max_tokens is too large"}}'), /images/);
});
