import { getAll, put } from '../db.js';

export function listMessages(conversationId) {
  return getAll('messages', 'byConversation', IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]));
}

export async function addMessage({ conversationId, role, markdown, metadata = {} }) {
  const message = { id: crypto.randomUUID(), conversationId, role, markdown, createdAt: Date.now(), metadata };
  await put('messages', message);
  return message;
}
