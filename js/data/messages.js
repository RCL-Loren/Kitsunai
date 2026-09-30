import { getAll, transaction, promisify } from '../db.js';

export function listMessages(conversationId) {
  return getAll('messages', 'byConversation', IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]));
}

// images: prepared images ({ blob, name, mime, width, height }) for a user
// message. The message stores lightweight references ({ id, name, mime, width,
// height }); the blobs go to the attachments store in the same transaction, so
// a message never points at missing images.
export async function addMessage({ conversationId, role, markdown, metadata = {}, images = [] }) {
  const message = { id: crypto.randomUUID(), conversationId, role, markdown, createdAt: Date.now(), metadata };
  const records = images.map((img) => ({
    id: crypto.randomUUID(),
    conversationId,
    messageId: message.id,
    name: img.name,
    mime: img.mime,
    width: img.width,
    height: img.height,
    size: img.blob.size,
    blob: img.blob,
  }));
  if (records.length) message.attachments = records.map(({ id, name, mime, width, height }) => ({ id, name, mime, width, height }));
  await transaction(['messages', 'attachments'], 'readwrite', async (tx) => {
    for (const r of records) tx.objectStore('attachments').put(r);
    await promisify(tx.objectStore('messages').put(message));
  });
  return message;
}
