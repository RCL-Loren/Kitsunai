import { get, getAll, put, transaction, promisify } from '../db.js';
import { emit } from '../events.js';

// A conversation's modelId is fixed at creation. There is deliberately no way
// to change it: updateConversation only accepts the fields below.
const UPDATABLE = ['title', 'updatedAt'];

export async function listConversations() {
  const all = await getAll('conversations', 'updatedAt');
  return all.reverse();
}

export const getConversation = (id) => get('conversations', id);

export async function createConversation({ title, modelId, modelName }) {
  const now = Date.now();
  const conversation = { id: crypto.randomUUID(), title, modelId, modelName, createdAt: now, updatedAt: now };
  await put('conversations', conversation);
  emit('conversations:changed', { id: conversation.id });
  return conversation;
}

export async function updateConversation(id, changes) {
  const rejected = Object.keys(changes).filter((k) => !UPDATABLE.includes(k));
  if (rejected.length) throw new Error(`Cannot update conversation fields: ${rejected.join(', ')}`);
  const updated = await transaction('conversations', 'readwrite', async (tx) => {
    const store = tx.objectStore('conversations');
    const current = await promisify(store.get(id));
    if (!current) throw new Error('Conversation not found');
    const next = { ...current, ...changes };
    await promisify(store.put(next));
    return next;
  });
  emit('conversations:changed', { id });
  return updated;
}

// Deletes the conversation and all of its messages and images atomically.
export async function deleteConversation(id) {
  await transaction(['conversations', 'messages', 'attachments'], 'readwrite', async (tx) => {
    tx.objectStore('conversations').delete(id);
    const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
    const keys = await promisify(tx.objectStore('messages').index('byConversation').getAllKeys(range));
    for (const key of keys) tx.objectStore('messages').delete(key);
    const images = await promisify(tx.objectStore('attachments').index('conversationId').getAllKeys(IDBKeyRange.only(id)));
    for (const key of images) tx.objectStore('attachments').delete(key);
  });
  emit('conversations:changed', { id, deleted: true });
}

export async function countConversationsForModel(modelId) {
  const all = await getAll('conversations');
  return all.filter((c) => c.modelId === modelId).length;
}
