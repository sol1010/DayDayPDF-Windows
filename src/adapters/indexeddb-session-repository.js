export function createSessionRepository(indexedDbFactory, {
  databaseName = 'pdfEditorAutosave',
  version = 1,
  storeName = 'kv',
} = {}) {
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDbFactory.open(databaseName, version);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(key, value) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  }

  async function get(key) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).get(key);
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  }

  async function remove(key) {
    const database = await open();
    return new Promise(resolve => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => { database.close(); resolve(); };
    });
  }

  async function keys() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).getAllKeys();
      request.onsuccess = () => { database.close(); resolve(request.result || []); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  }

  return Object.freeze({ put, get, remove, keys });
}
