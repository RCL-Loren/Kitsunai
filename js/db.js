// Minimal promise wrapper over IndexedDB. Schema: DevDocs/KitsunAI-Development-Plan.md §3.

const DB_NAME = 'kitsunai';
const DB_VERSION = 2;

let dbPromise;

// Each step upgrades from the previous version, so existing data is kept.
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
    conversations.createIndex('updatedAt', 'updatedAt');
    const messages = db.createObjectStore('messages', { keyPath: 'id' });
    messages.createIndex('byConversation', ['conversationId', 'createdAt']);
    db.createObjectStore('models', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    // Image attachments on user messages: { id, conversationId, messageId, name, mime, width, height, size, blob }
    const attachments = db.createObjectStore('attachments', { keyPath: 'id' });
    attachments.createIndex('conversationId', 'conversationId');
  }
}

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is not available in this browser.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => upgrade(request.result, e.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it can proceed; next call reopens.
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    // An upgrade waits for other open tabs to close their connection. Our tabs do
    // so on 'versionchange' (above), after which the upgrade continues on its own.
    request.onblocked = () => console.warn('[KitsunAI] Waiting for other KitsunAI tabs to release the database…');
  });
  return dbPromise.catch((err) => { dbPromise = undefined; throw err; });
}

export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs fn(tx) in one transaction and resolves with its return value once the
// transaction commits. fn may only await IndexedDB requests (via promisify),
// otherwise the transaction auto-commits early.
export async function transaction(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(tx))
      .then((value) => { result = value; }, (err) => { reject(err); try { tx.abort(); } catch {} });
  });
}

export const get = (store, key) =>
  transaction(store, 'readonly', (tx) => promisify(tx.objectStore(store).get(key)));

export const getAll = (store, index, range) =>
  transaction(store, 'readonly', (tx) => {
    const source = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
    return promisify(source.getAll(range));
  });

export const put = (store, value) =>
  transaction(store, 'readwrite', (tx) => promisify(tx.objectStore(store).put(value)));

export const remove = (store, key) =>
  transaction(store, 'readwrite', (tx) => promisify(tx.objectStore(store).delete(key)));
