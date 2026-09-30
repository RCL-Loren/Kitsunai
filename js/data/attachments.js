import { get, getAll } from '../db.js';

// Image attachment records: { id, conversationId, messageId, name, mime, width, height, size, blob }.
export const getAttachment = (id) => get('attachments', id);

export const listAttachments = (conversationId) => getAll('attachments', 'conversationId', IDBKeyRange.only(conversationId));
