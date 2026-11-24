const DEFAULT_MAX_BYTES = 150 * 1024 * 1024;

export function createFontCacheRepository(indexedDbFactory, {
  databaseName = 'daydayPdfFontCache',
  version = 1,
  storeName = 'fonts',
  namespace = 'v1',
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now(),
  requestPersistence = null,
} = {}) {
  const available = !!indexedDbFactory?.open;
  let persistenceRequested = false;

  function open() {
    if (!available) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDbFactory.open(databaseName, version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames?.contains?.(storeName)) database.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('글꼴 캐시를 열 수 없습니다'));
    });
  }

  const storageKey = id => `${namespace}:${id}`;
  const cloneBytes = bytes => bytes instanceof Uint8Array
    ? bytes.slice()
    : new Uint8Array(bytes || 0);

  async function requestPersistentStorage() {
    if (persistenceRequested || typeof requestPersistence !== 'function') return;
    persistenceRequested = true;
    try { await requestPersistence(); } catch {}
  }

  async function getEntry(id) {
    const database = await open();
    if (!database) return null;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(storageKey(id));
      let result = null;
      request.onsuccess = () => {
        const record = request.result;
        if (!record?.bytes) return;
        result = Object.freeze({
          bytes: cloneBytes(record.bytes),
          characters: typeof record.characters === 'string' ? record.characters : '',
          kind: record.kind || 'full',
        });
        store.put({ ...record, lastUsed: now() }, storageKey(id));
      };
      request.onerror = () => reject(request.error || new Error('글꼴 캐시를 읽을 수 없습니다'));
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
  }

  async function get(id) {
    const entry = await getEntry(id);
    return entry?.bytes || null;
  }

  async function putEntry(id, entry) {
    const bytes = entry?.bytes;
    if (!bytes?.byteLength) return;
    await requestPersistentStorage();
    const database = await open();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put({
        namespace,
        id,
        bytes: cloneBytes(bytes),
        characters: typeof entry.characters === 'string' ? entry.characters : '',
        kind: entry.kind || 'full',
        size: bytes.byteLength,
        lastUsed: now(),
      }, storageKey(id));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
    await prune();
  }

  async function put(id, bytes) {
    return putEntry(id, { bytes, characters: '', kind: 'full' });
  }

  async function allRecords() {
    const database = await open();
    if (!database) return [];
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).getAll();
      request.onsuccess = () => { database.close(); resolve(request.result || []); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  }

  async function prune() {
    const records = await allRecords();
    const obsolete = records.filter(record => record.namespace !== namespace);
    const current = records.filter(record => record.namespace === namespace)
      .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    let bytes = current.reduce((total, record) => total + (record.size || record.bytes?.byteLength || 0), 0);
    const remove = obsolete.map(record => `${record.namespace}:${record.id}`);
    while (bytes > maxBytes && current.length) {
      const record = current.shift();
      bytes -= record.size || record.bytes?.byteLength || 0;
      remove.push(`${record.namespace}:${record.id}`);
    }
    if (!remove.length) return;
    const database = await open();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      remove.forEach(key => store.delete(key));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
  }

  async function stats() {
    const records = (await allRecords()).filter(record => record.namespace === namespace);
    return Object.freeze({
      count: records.length,
      bytes: records.reduce((total, record) => total + (record.size || record.bytes?.byteLength || 0), 0),
      maxBytes,
    });
  }

  async function clear() {
    const database = await open();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
  }

  return Object.freeze({ available, get, getEntry, put, putEntry, prune, stats, clear });
}
