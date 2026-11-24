import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createSettingsAdapter, EDITOR_SETTING_KEYS } from '../../src/adapters/settings-adapter.js';
import { createSessionRepository } from '../../src/adapters/indexeddb-session-repository.js';
import { createFontCacheRepository } from '../../src/adapters/indexeddb-font-cache.js';
import { createBrowserFileAdapter } from '../../src/adapters/browser-file-adapter.js';
import { createPdfJsReader } from '../../src/adapters/pdfjs-reader-adapter.js';
import {
  createAlignedSubsetFontkit, createFontRegistry, createPdfLibAdapter, googleFontsCss2Url,
  googleFontsFileUrl, normalizeFontCharacters, pdfEmbeddedFontName, pdfSubsetFontName,
} from '../../src/adapters/pdf-lib-font-adapter.js';
import {
  FONT_CATALOG, FONT_CATALOG_BY_KEY, fontCss, googleFontUrls, inferSupportedFontKey,
} from '../../src/core/font-catalog.js';
import { createPdfiumAdapter } from '../../src/adapters/pdfium-adapter.js';
import { createWindowTransferAdapter } from '../../src/adapters/window-transfer.js';
import { createWindowPeerAdapter } from '../../src/adapters/window-peer-adapter.js';
import { createDesktopHostAdapter } from '../../src/adapters/desktop-host-adapter.js';
import {
  createWebClipboardBroker, WEB_CLIPBOARD_RECORD_KEY,
} from '../../src/adapters/web-clipboard-broker.js';
import {
  CLIPBOARD_SERIALIZE_WORKER_SOURCE, packShellClipboardPayload, unpackShellClipboardPayload,
} from '../../src/adapters/shell-clipboard-codec.js';

test('desktop host adapter keeps versioned messages and releases every received shared buffer', () => {
  const listeners = new Map();
  const sent = [];
  const sentWithObjects = [];
  const released = [];
  const nativeHost = {
    postMessage: value => sent.push(value),
    postMessageWithAdditionalObjects: (message, objects) => sentWithObjects.push([message, objects]),
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
    releaseBuffer: buffer => released.push(buffer),
  };
  const windowObject = {
    chrome: { webview: nativeHost },
    location: { origin: 'https://app.pdfeditor.local' },
    addEventListener() {}, removeEventListener() {},
  };
  const adapter = createDesktopHostAdapter({ windowObject, mode: 'desktop-view' });
  const messages = [];
  const shared = [];
  adapter.onMessage(value => messages.push(value));
  adapter.onSharedBuffer(value => shared.push(value));
  assert.equal(adapter.mount(), true);
  assert.equal(adapter.send({ type: 'ready' }), true);
  const droppedFile = { name: 'drop.pdf' };
  assert.equal(adapter.sendWithAdditionalObjects({ type: 'drop-files' }, [droppedFile]), true);
  listeners.get('message')({ data: { cmd: 'flush' } });
  const buffer = new ArrayBuffer(4);
  listeners.get('sharedbufferreceived')({
    additionalData: JSON.stringify({ cmd: 'clipboard-data' }),
    getBuffer: () => buffer,
  });
  assert.deepEqual(sent, [{ type: 'ready' }]);
  assert.deepEqual(sentWithObjects, [[{ type: 'drop-files' }, [droppedFile]]]);
  assert.deepEqual(messages, [{ cmd: 'flush' }]);
  assert.equal(shared[0].metadata.cmd, 'clipboard-data');
  assert.equal(released[0], buffer);
  assert.equal(adapter.dispose(), true);
  assert.equal(listeners.size, 0);
});

test('shell clipboard packet keeps editable page metadata beside extracted PDF bytes', () => {
  const pages = [{ src: null, idx: 0, texts: [{ type: 'img', data: 'data:image/png;base64,AA==' }] }];
  const mapping = { '12:4': 0 };
  const pdfBytes = new Uint8Array([37, 80, 68, 70]);
  const packet = packShellClipboardPayload({ pages, mapping, pdfBytes });
  const decoded = unpackShellClipboardPayload(packet);
  assert.deepEqual(decoded.pages, pages);
  assert.deepEqual(decoded.mapping, mapping);
  assert.deepEqual([...decoded.pdfBytes], [...pdfBytes]);
  assert.match(CLIPBOARD_SERIALIZE_WORKER_SOURCE, /PDFDocument\.create/);
  assert.match(CLIPBOARD_SERIALIZE_WORKER_SOURCE, /copyPages/);
  assert.match(CLIPBOARD_SERIALIZE_WORKER_SOURCE, /postMessage/);
});

test('web clipboard broker keeps editable packets after the source window closes', async () => {
  const values = new Map();
  const repository = {
    put: async (key, value) => values.set(key, value),
    get: async key => values.get(key),
  };
  const pages = [{
    src: null, idx: 0, blank: [595, 842],
    texts: [
      { text: '편집 가능', fx: .1, fy: .2, size: 14 },
      { type: 'rect', fx: .2, fy: .3, fw: .4, fh: .1, fill: '#ffcc00' },
      { type: 'img', data: 'data:image/png;base64,AA==', fx: .3, fy: .4, fw: .2, fh: .2 },
    ],
  }];
  const packet = packShellClipboardPayload({
    pages, mapping: {}, pdfBytes: new Uint8Array(),
  });
  const source = createWebClipboardBroker({
    repository,
    BroadcastChannelConstructor: null,
    cryptoObject: { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    now: () => 1724600000000,
  });
  const reservedId = source.createId();
  assert.equal(reservedId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const committed = await source.put('object', packet, {
    operation: 'copy', sourceDocument: '원본',
  }, { id: reservedId });
  assert.equal(committed.id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.ok(values.has(WEB_CLIPBOARD_RECORD_KEY));
  source.dispose();

  const target = createWebClipboardBroker({
    repository, BroadcastChannelConstructor: null,
  });
  const restored = await target.get({ id: committed.id, kind: 'object' });
  assert.equal(restored.timestamp, 1724600000000);
  assert.equal(restored.meta.sourceDocument, '원본');
  assert.deepEqual(unpackShellClipboardPayload(restored.packet).pages, pages);
  restored.packet[0] = 0;
  assert.notEqual((await target.get({ kind: 'object' })).packet[0], 0);
  target.dispose();
});

test('settings adapter fixes every compatibility key and works with a storage fake', () => {
  assert.deepEqual(Object.values(EDITOR_SETTING_KEYS).sort(), [
    'pdfEditor.autosave', 'pdfEditor.barPin', 'pdfEditor.barPos', 'pdfEditor.drawing', 'pdfEditor.dupQ', 'pdfEditor.glassEffect',
    'pdfEditor.keymap', 'pdfEditor.lastShape', 'pdfEditor.lastShapeText', 'pdfEditor.lastText',
    'pdfEditor.palRecent', 'pdfEditor.panelW', 'pdfEditor.printOptions', 'pdfEditor.shapeTextBarPin',
    'pdfEditor.shapeTextBarPos', 'pdfEditor.startupMode', 'pdfEditor.theme',
    'pdfEditor.thumbW', 'pdfEditor.thumbsKey', 'pdfEditor.toolbarDisplay', 'pdfEditor.toolbarSize', 'pdfEditor.tutorialSeen', 'pdfEditor.viewMode',
  ]);
  const editorSource = readFileSync(new URL('../../src/editor-app.js', import.meta.url), 'utf8');
  const referencedNames = [...new Set([...editorSource.matchAll(
    /settings\.(?:get|set|remove)\('([^']+)'/g,
  )].map(match => match[1]))].sort();
  assert.deepEqual(referencedNames, Object.keys(EDITOR_SETTING_KEYS).sort());
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const settings = createSettingsAdapter(storage);
  settings.set('theme', 'light');
  assert.equal(values.get('pdfEditor.theme'), 'light');
  assert.equal(settings.get('theme'), 'light');
  settings.remove('theme');
  assert.equal(settings.get('theme'), null);
  settings.set('shapeTextBarPin', '1');
  settings.set('shapeTextBarPos', '{"right":12,"top":24}');
  assert.equal(settings.get('shapeTextBarPin'), '1');
  assert.equal(settings.get('shapeTextBarPos'), '{"right":12,"top":24}');
  assert.throws(() => settings.get('unknown'), /알 수 없는 편집기 설정/);
});

function createIndexedDbFake() {
  const values = new Map();
  const calls = [];
  let upgraded = false;
  const database = {
    createObjectStore(name) { calls.push(['createObjectStore', name]); },
    close() { calls.push(['close']); },
    transaction(storeName, mode) {
      calls.push(['transaction', storeName, mode]);
      const transaction = {
        error: null,
        objectStore(name) {
          assert.equal(name, 'kv');
          return {
            put(value, key) {
              values.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key) {
              values.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            get(key) {
              const request = {};
              queueMicrotask(() => { request.result = values.get(key); request.onsuccess?.(); });
              return request;
            },
            getAllKeys() {
              const request = {};
              queueMicrotask(() => { request.result = [...values.keys()]; request.onsuccess?.(); });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    calls,
    factory: {
      open(name, version) {
        calls.push(['open', name, version]);
        const request = { result: database, error: null };
        queueMicrotask(() => {
          if (!upgraded) { upgraded = true; request.onupgradeneeded?.(); }
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

test('IndexedDB repository retains database, version, store, and CRUD semantics', async () => {
  const fake = createIndexedDbFake();
  const repository = createSessionRepository(fake.factory);
  await repository.put('session', { v: 2 });
  assert.deepEqual(await repository.get('session'), { v: 2 });
  assert.deepEqual(await repository.keys(), ['session']);
  await repository.remove('session');
  assert.equal(await repository.get('session'), undefined);
  assert.ok(fake.calls.some(call => call[0] === 'open' && call[1] === 'pdfEditorAutosave' && call[2] === 1));
  assert.ok(fake.calls.some(call => call[0] === 'createObjectStore' && call[1] === 'kv'));
  assert.ok(fake.calls.some(call => call[0] === 'transaction' && call[1] === 'kv' && call[2] === 'readwrite'));
});

function createFontCacheIndexedDbFake() {
  const values = new Map();
  let upgraded = false;
  const database = {
    objectStoreNames: { contains: name => upgraded && name === 'fonts' },
    createObjectStore(name) { assert.equal(name, 'fonts'); upgraded = true; },
    close() {},
    transaction(storeName) {
      assert.equal(storeName, 'fonts');
      let pending = 0;
      let completionQueued = false;
      const transaction = {
        error: null,
        objectStore() {
          const schedule = operation => {
            pending++;
            queueMicrotask(() => {
              operation();
              pending--;
              if (!completionQueued) {
                completionQueued = true;
                queueMicrotask(() => {
                  completionQueued = false;
                  if (!pending) transaction.oncomplete?.();
                });
              }
            });
          };
          return {
            put(value, key) { schedule(() => values.set(key, value)); },
            delete(key) { schedule(() => values.delete(key)); },
            clear() { schedule(() => values.clear()); },
            get(key) {
              const request = {};
              schedule(() => { request.result = values.get(key); request.onsuccess?.(); });
              return request;
            },
            getAll() {
              const request = {};
              schedule(() => { request.result = [...values.values()]; request.onsuccess?.(); });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  return {
    values,
    factory: {
      open(name, version) {
        assert.equal(name, 'daydayPdfFontCache');
        assert.equal(version, 1);
        const request = { result: database, error: null };
        queueMicrotask(() => {
          if (!upgraded) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

test('font cache persists selected bytes, refreshes LRU, caps storage, and clears independently', async () => {
  const fake = createFontCacheIndexedDbFake();
  let now = 100;
  let persistenceRequests = 0;
  const cache = createFontCacheRepository(fake.factory, {
    namespace: 'font-build-a', maxBytes: 4, now: () => ++now,
    requestPersistence: async () => { persistenceRequests++; return true; },
  });
  await cache.put('first', new Uint8Array([1, 2, 3]));
  await cache.put('second', new Uint8Array([4, 5, 6]));
  assert.equal(persistenceRequests, 1);
  assert.equal(await cache.get('first'), null);
  assert.deepEqual([...await cache.get('second')], [4, 5, 6]);
  await cache.putEntry('subset', {
    bytes: new Uint8Array([7]), characters: 'ABC', kind: 'google-text',
  });
  assert.deepEqual(await cache.getEntry('subset'), {
    bytes: new Uint8Array([7]), characters: 'ABC', kind: 'google-text',
  });
  assert.deepEqual(await cache.stats(), { count: 2, bytes: 4, maxBytes: 4 });
  await cache.clear();
  assert.deepEqual(await cache.stats(), { count: 0, bytes: 0, maxBytes: 4 });
});

test('browser file adapter retains picker, handle, download, and dropped-file behavior', async () => {
  const firstFile = { name: 'one.pdf' };
  const openHandle = { kind: 'file', getFile: async () => firstFile };
  const writes = [];
  const saveHandle = {
    name: 'saved.pdf',
    getFile: async () => ({ size: 2 }),
    createWritable: async () => ({
      write: async value => writes.push(value),
      close: async () => writes.push('closed'),
    }),
  };
  const pickerCalls = [];
  const windowObject = {
    showOpenFilePicker: async options => { pickerCalls.push(['open', options]); return [openHandle]; },
    showSaveFilePicker: async options => { pickerCalls.push(['save', options]); return saveHandle; },
  };
  const clicked = [];
  const documentObject = { createElement: () => ({ click() { clicked.push(this); } }) };
  const revoked = [];
  const urlApi = {
    createObjectURL: () => 'blob:fixture',
    revokeObjectURL: value => revoked.push(value),
  };
  class BlobFake { constructor(parts, options) { this.parts = parts; this.options = options; } }
  const scheduled = [];
  const files = createBrowserFileAdapter({
    windowObject, documentObject, urlApi, BlobConstructor: BlobFake,
    schedule: callback => { scheduled.push(callback); },
  });
  assert.equal(files.supportsFileSystemAccess, true);
  assert.deepEqual(await files.pickOpenPdfFiles(), [firstFile]);
  assert.equal(firstFile._handle, openHandle);
  assert.equal((await files.pickSavePdfHandle({ id: 'pdfEditorSave' })).name, 'saved.pdf');
  await files.writeFile(saveHandle, new Uint8Array([1, 2]));
  assert.equal(writes.at(-1), 'closed');
  const createLockedHandle = {
    createWritable: async () => { throw new DOMException('file is locked at open', 'NoModificationAllowedError'); },
  };
  await assert.rejects(
    () => files.writeFile(createLockedHandle, new Uint8Array([3])),
    /file is locked at open/,
  );
  let aborted = false;
  const lockedHandle = {
    createWritable: async () => ({
      write: async () => { throw new DOMException('file is in use', 'NoModificationAllowedError'); },
      abort: async () => { aborted = true; },
    }),
  };
  await assert.rejects(() => files.writeFile(lockedHandle, new Uint8Array([4])), /file is in use/);
  assert.equal(aborted, true);
  let closeAborted = false;
  const closeLockedHandle = {
    createWritable: async () => ({
      write: async () => {},
      close: async () => { throw new DOMException('file is locked at replace', 'NoModificationAllowedError'); },
      abort: async () => { closeAborted = true; },
    }),
  };
  await assert.rejects(
    () => files.writeFile(closeLockedHandle, new Uint8Array([4])),
    /file is locked at replace/,
  );
  assert.equal(closeAborted, true);
  let hangingAborted = false;
  const hangingHandle = {
    createWritable: async () => ({
      write: async () => new Promise(() => {}),
      abort: async () => { hangingAborted = true; },
    }),
  };
  await assert.rejects(
    () => files.writeFile(hangingHandle, new Uint8Array([5]), { writeTimeoutMs: 5 }),
    /파일 쓰기 작업이 응답하지 않아 중단했습니다/,
  );
  assert.equal(hangingAborted, true);
  let closeStarted = false;
  let abortStarted = false;
  const fullyStuckHandle = {
    createWritable: async () => ({
      write: async () => {},
      close: async () => { closeStarted = true; return new Promise(() => {}); },
      abort: async () => { abortStarted = true; return new Promise(() => {}); },
    }),
  };
  await assert.rejects(
    () => files.writeFile(fullyStuckHandle, new Uint8Array([5]), {
      closeTimeoutMs: 5,
      abortTimeoutMs: 5,
    }),
    /파일 저장 완료 작업이 응답하지 않아 중단했습니다/,
  );
  assert.equal(closeStarted, true);
  assert.equal(abortStarted, true);
  const mismatchedHandle = {
    getFile: async () => ({ size: 99 }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
  };
  await assert.rejects(
    () => files.writeFile(mismatchedHandle, new Uint8Array([6, 7])),
    /저장 결과 확인 실패/,
  );
  files.downloadPdf(new Uint8Array([3]), 'out.pdf');
  assert.equal(clicked[0].download, 'out.pdf');
  scheduled[0]();
  assert.deepEqual(revoked, ['blob:fixture']);

  const dropped = { name: 'drop.pdf' };
  const entries = files.captureDroppedFiles([{
    kind: 'file', getAsFile: () => dropped, getAsFileSystemHandle: () => Promise.resolve(openHandle),
  }]);
  assert.deepEqual(await files.resolveDroppedFiles(entries), [dropped]);
  assert.equal(dropped._handle, openHandle);
  assert.equal(pickerCalls[0][1].multiple, true);
});

test('PDF.js reader preserves local-first fallback, version check, worker, and safe options', async () => {
  const warnings = [];
  const calls = [];
  const library = {
    version: '6.2.108', GlobalWorkerOptions: {},
    getDocument: options => { calls.push(['getDocument', options]); return { promise: Promise.resolve() }; },
  };
  const imports = [];
  const reader = await createPdfJsReader({
    version: '6.2.108',
    cdnBase: 'https://cdn.example/pdfjs/',
    protocol: 'https:',
    baseUri: 'https://editor.example/app/',
    importModule: async specifier => {
      imports.push(specifier);
      if (specifier.startsWith('https://editor.example/')) throw new Error('missing local asset');
      return library;
    },
    warn: (...args) => warnings.push(args),
  });
  assert.deepEqual(imports, [
    'https://editor.example/app/assets/pdfjs/6.2.108/legacy/build/pdf.min.mjs',
    'https://cdn.example/pdfjs/legacy/build/pdf.min.mjs',
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(reader.base, 'https://cdn.example/pdfjs/');
  assert.equal(library.GlobalWorkerOptions.workerSrc, 'https://cdn.example/pdfjs/legacy/build/pdf.worker.min.mjs');
  reader.openDocument(new Uint8Array([1]));
  const options = calls[0][1];
  assert.equal(options.isEvalSupported, false);
  assert.equal(options.enableScripting, false);
  assert.equal(options.cMapUrl, 'https://cdn.example/pdfjs/cmaps/');
  assert.equal(options.standardFontDataUrl, 'https://cdn.example/pdfjs/standard_fonts/');
  assert.equal(options.wasmUrl, 'https://cdn.example/pdfjs/wasm/');
  assert.equal(options.iccUrl, 'https://cdn.example/pdfjs/iccs/');
  await assert.rejects(() => createPdfJsReader({
    version: '6.2.108', cdnBase: 'https://cdn/', protocol: 'file:', baseUri: 'file:///app.html',
    importModule: async () => ({ version: '0.0.0', GlobalWorkerOptions: {} }),
  }), /PDF\.js 버전 불일치/);
});

test('pdf-lib and font adapters retain engine bindings, pinned URLs, caching, and screen registration', async () => {
  const library = { PDFDocument: {}, StandardFonts: {}, degrees: () => {}, rgb: () => {} };
  const pdfLib = createPdfLibAdapter(library);
  assert.equal(pdfLib.raw, library);
  assert.equal(pdfLib.PDFDocument, library.PDFDocument);

  const fetched = [];
  const added = [];
  const links = [];
  class FontFaceFake {
    constructor(family, bytes, options) { this.family = family; this.bytes = bytes; this.options = options; }
    async load() { return this; }
  }
  const registry = createFontRegistry({
    gfSha: 'pinned-sha',
    fontCatalog: FONT_CATALOG,
    fontCss,
    googleFontUrls,
    fetchFn: async url => {
      fetched.push(url);
      if (url.startsWith('https://fonts.googleapis.com/')) return {
        ok: true,
        text: async () => "@font-face{src:url('https://fonts.gstatic.com/s/test.woff2') format('woff2')}",
      };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
    },
    windowObject: { FontFace: FontFaceFake },
    documentObject: {
      fonts: { add: value => added.push(value) },
      head: { appendChild: value => links.push(value) },
      createElement: () => ({ dataset: {} }),
    },
    FontFaceConstructor: FontFaceFake,
  });
  assert.match(registry.fonts.notosanskr.urls[0], /pinned-sha/);
  assert.equal(FONT_CATALOG.length, 105);
  assert.equal(FONT_CATALOG.filter(font => font.language === 'ko').length, 35);
  assert.equal(FONT_CATALOG.filter(font => font.language === 'en').length, 70);
  assert.equal(new Set(FONT_CATALOG.map(font => font.key)).size, 105);
  assert.equal(FONT_CATALOG_BY_KEY.nanum.subset, true);
  assert.equal(FONT_CATALOG_BY_KEY.notosanskr.subset, false);
  assert.equal(FONT_CATALOG_BY_KEY.roboto.subset, true);
  assert.match(registry.fonts.kopubbatang.boldUrls[0], /KoPubBatang-Bold\.ttf/);
  assert.equal(registry.fonts.spoqa.supportsKo, true);
  const first = await registry.fetchBytes('spoqa', false);
  const second = await registry.fetchBytes('spoqa', false);
  assert.equal(first, second);
  assert.equal(fetched.length, 1);
  await registry.ensureScreenFont('spoqa', true);
  assert.equal(added.length, 1);
  assert.equal(added[0].options.weight, '700');
  const subset = await registry.fetchFontRecord('poppins', false, 'PDF-1');
  assert.equal(subset.kind, 'google-text');
  assert.ok(subset.characters.includes('-'));
  const cssRequest = fetched.find(url => url.startsWith('https://fonts.googleapis.com/'));
  assert.equal(new URL(cssRequest).searchParams.get('family'), 'Poppins');
  assert.ok(new URL(cssRequest).searchParams.get('text').includes('-'));
  registry.ensureTitleFont('jua');
  registry.ensureTitleFont('jua');
  assert.equal(links.length, 1);
  assert.equal(new URL(links[0].href).searchParams.get('family'), 'Jua');
  assert.match(new URL(links[0].href).searchParams.get('text'), /주/);
  assert.match(new URL(links[0].href).searchParams.get('text'), /아/);
  assert.match(new URL(links[0].href).searchParams.get('text'), /가/);
  assert.match(new URL(links[0].href).searchParams.get('text'), /나/);
  assert.match(new URL(links[0].href).searchParams.get('text'), /다/);
  assert.equal(FONT_CATALOG_BY_KEY.jua.googleFamily, 'Jua');
  const pdfRecord = await registry.fetchPdfFontRecord('poppins', false, 'PDF-1');
  assert.equal(pdfRecord.kind, 'full');
  assert.equal(pdfRecord.embedSubset, true);
  assert.equal(pdfRecord.key, 'poppins');
  assert.equal(pdfRecord.customName,
    pdfSubsetFontName(FONT_CATALOG_BY_KEY.poppins, false, normalizeFontCharacters('PDF-1')));
  assert.match(pdfRecord.customName, /^[A-Z]{6}\+Poppins$/);
  assert.ok(fetched.some(url => /google\/fonts@pinned-sha\/ofl\/poppins\/Poppins-Regular\.ttf/.test(url)));
  const pdfVariableBoldRecord = await registry.fetchPdfFontRecord('montserrat', true, 'Bold');
  assert.equal(pdfVariableBoldRecord.kind, 'full');
  assert.equal(pdfVariableBoldRecord.embedSubset, true);
  assert.match(pdfVariableBoldRecord.customName, /^[A-Z]{6}\+Montserrat-Bold$/);
  assert.equal(pdfVariableBoldRecord.syntheticBold, false);
  assert.equal(pdfEmbeddedFontName(FONT_CATALOG_BY_KEY.jua), 'Jua');
  assert.equal(pdfSubsetFontName(FONT_CATALOG_BY_KEY.jua, false, '가나다'),
    pdfSubsetFontName(FONT_CATALOG_BY_KEY.jua, false, '가나다'));
  assert.equal(normalizeFontCharacters('BABA'), 'AB');
  assert.equal(new URL(googleFontsCss2Url('Noto Sans KR', { weight: 700, text: '한글' })).searchParams.get('family'), 'Noto Sans KR:wght@700');
  assert.equal(googleFontsFileUrl("src:url(https://fonts.gstatic.com/a.woff2) format('woff2')"), 'https://fonts.gstatic.com/a.woff2');
  assert.equal(inferSupportedFontKey('ABCDEF+NanumGothic', '한글'), 'nanum');
  assert.equal(inferSupportedFontKey('NotoSansCJKkr-Bold', '한글'), 'notosanskr');
  assert.equal(inferSupportedFontKey('TimesNewRomanPSMT', 'Hello'), 'robotoslab');
  assert.equal(inferSupportedFontKey('UnknownSubset', '이어쓰기'), 'notosanskr');
});

test('fontkit compatibility adapter preserves long loca only for TrueType subsets that need it', () => {
  const makeFont = locaVersion => {
    const font = locaVersion == null ? {} : { loca: { version: locaVersion } };
    font.createSubset = () => ({
      font,
      loca: { offsets: [] },
      _addGlyph() { return this.loca.version; },
    });
    return font;
  };
  const fonts = [makeFont(1), makeFont(0), makeFont(null)];
  const adapter = createAlignedSubsetFontkit({ create: () => fonts.shift() });

  assert.equal(adapter.create().createSubset()._addGlyph(1), 1);
  assert.equal(adapter.create().createSubset()._addGlyph(1), undefined);
  assert.equal(adapter.create().createSubset()._addGlyph(1), undefined);
});

test('font registry restores disk bytes and grows selected character subsets without losing prior glyphs', async () => {
  const disk = new Map([['spoqa', { bytes: new Uint8Array([9, 9]), characters: '', kind: 'full' }]]);
  const puts = [];
  const fetched = [];
  const added = [];
  const removed = [];
  class FontFaceFake {
    constructor(family, bytes) { this.family = family; this.bytes = bytes; }
    async load() { return this; }
  }
  const registry = createFontRegistry({
    gfSha: 'pinned-sha', fontCatalog: FONT_CATALOG, fontCss, googleFontUrls,
    fetchFn: async url => {
      fetched.push(url);
      if (url.startsWith('https://fonts.googleapis.com/')) return {
        ok: true,
        text: async () => "@font-face{src:url(https://fonts.gstatic.com/s/subset.woff2) format('woff2')}",
      };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
    windowObject: { FontFace: FontFaceFake },
    documentObject: { fonts: { add: value => added.push(value), delete: value => removed.push(value) } },
    FontFaceConstructor: FontFaceFake,
    persistentCache: {
      getEntry: async key => disk.get(key) || null,
      putEntry: async (key, record) => {
        puts.push(key);
        disk.set(key, { ...record, bytes: record.bytes.slice() });
      },
      stats: async () => ({ count: disk.size, bytes: 2, maxBytes: 100 }),
      clear: async () => disk.clear(),
    },
  });
  assert.deepEqual([...await registry.fetchBytes('spoqa', false)], [9, 9]);
  assert.equal(fetched.length, 0);
  await registry.ensureScreenFont('nanum', false, { persist: false, characters: '한' });
  assert.equal(puts.length, 0);
  await registry.ensureScreenFont('nanum', false, { persist: true, characters: '한글추가' });
  assert.deepEqual(puts, ['nanum:text']);
  assert.equal(added.length, 2);
  assert.equal(removed.length, 1);
  const fetchCount = fetched.length;
  await registry.ensureScreenFont('nanum', false, { persist: true, characters: '한글' });
  assert.equal(fetched.length, fetchCount);
  assert.match(disk.get('nanum:text').characters, /추/);
  assert.equal((await registry.persistentStats()).count, 2);
  await registry.clearPersistentCache();
  assert.equal(disk.size, 0);
});

function createPdfiumLibrary() {
  const freed = [];
  const heap = new Uint8Array(256);
  let nextPointer = 8;
  const module = {
    HEAPU8: heap,
    wasmExports: {
      malloc(size) { const pointer = nextPointer; nextPointer += Math.max(1, size); return pointer; },
      free(pointer) { freed.push(pointer); },
    },
  };
  const library = {
    pdfium: module,
    initialized: 0,
    closed: [],
    PDFiumExt_Init() { this.initialized++; },
    FPDF_LoadMemDocument() { return 77; },
    FPDF_CloseDocument(handle) { this.closed.push(handle); },
    PDFiumExt_OpenFileWriter() { return 88; },
    FPDF_SaveAsCopy() { return true; },
    PDFiumExt_GetFileWriterSize() { return 2; },
    PDFiumExt_GetFileWriterData(writer, pointer) { heap.set([9, 8], pointer); },
    PDFiumExt_CloseFileWriter() {},
  };
  return { library, freed };
}

test('PDFium adapter preserves lazy caching, shared wasm, decrypt, cleanup, and reset behavior', async () => {
  const { library } = createPdfiumLibrary();
  const busy = [];
  const engineErrors = [];
  let fetchCount = 0;
  let importCount = 0;
  const adapter = createPdfiumAdapter({
    cdn: 'https://pdfium.example/',
    importModule: async specifier => { importCount++; assert.match(specifier, /index\.browser\.js$/); return { init: async () => library }; },
    fetchFn: async specifier => { fetchCount++; assert.match(specifier, /pdfium\.wasm$/); return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; },
    onBusyChange: (...args) => busy.push(args),
    onEngineError: error => engineErrors.push(error),
  });
  assert.equal(await adapter.get(), library);
  assert.equal(await adapter.get(), library);
  assert.equal(importCount, 1);
  assert.equal(fetchCount, 1);
  assert.equal(library.initialized, 1);
  assert.deepEqual(busy.map(entry => entry[0]), [true, false]);
  assert.equal((await adapter.getWasmBinary()).byteLength, 3);

  const operationResult = await adapter.withDocument(new Uint8Array([4]), async (value, module, handle) => {
    assert.equal(value, library);
    assert.equal(module, library.pdfium);
    assert.equal(handle, 77);
    return 'ok';
  });
  assert.equal(operationResult, 'ok');
  assert.equal(library.closed.at(-1), 77);
  assert.deepEqual([...await adapter.decrypt(new Uint8Array([5]), 'pw')], [9, 8]);

  await assert.rejects(() => adapter.withDocument(new Uint8Array([6]), async () => {
    throw new Error('memory access out of bounds');
  }), /out of bounds/);
  assert.equal(engineErrors.length, 1);
  await adapter.get();
  assert.equal(importCount, 2);
  assert.equal(fetchCount, 1);
});

test('PDFium worker and editor share one in-flight binary read and retry failed responses', async () => {
  let finish, fetches = 0;
  const adapter = createPdfiumAdapter({ cdn: '/bundled/',
    fetchFn: () => { fetches++; return new Promise(resolve => { finish = resolve; }); },
  });
  const first = adapter.getWasmBinary(), second = adapter.getWasmBinary();
  assert.equal(first, second); assert.equal(fetches, 1);
  finish({ ok: false, status: 503 });
  await assert.rejects(first, /503/);
  const retry = adapter.getWasmBinary(); assert.equal(fetches, 2);
  const binary = new Uint8Array([1, 2, 3]).buffer;
  finish({ ok: true, arrayBuffer: async () => binary });
  assert.equal(await retry, binary);
  adapter.reset(); assert.equal(await adapter.getWasmBinary(), binary);
  assert.equal(fetches, 2);
});

test('loading the bundled PDFium engine does not claim to download it', async () => {
  const { library } = createPdfiumLibrary(), messages = [];
  const adapter = createPdfiumAdapter({ cdn: '/bundled/',
    importModule: async () => ({ init: async () => library }),
    fetchFn: async () => ({ arrayBuffer: async () => new Uint8Array([1]).buffer }),
    onBusyChange: (busy, message) => { if (busy) messages.push(message); },
  });
  await adapter.get(); adapter.reset(); await adapter.get();
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => !/다운로드|최초 1회/.test(message)));
});

test('window transfer validates and exchanges detached documents', async () => {
  const receiver = { closed: false, __pdfEditorReceiveMergedDocs: async payload => payload.ok };
  const opened = [];
  const windowObject = {
    name: 'pdfEditorDetached_12345678',
    location: { href: 'https://editor.example/?detached=abcdefgh' },
    document: { documentElement: { outerHTML: '<html></html>' } },
    opener: receiver,
    open: (...args) => { opened.push(args); return { args }; },
  };
  const transfer = createWindowTransferAdapter(windowObject);
  assert.equal(transfer.detachedToken(), 'abcdefgh');
  assert.equal(transfer.captureBootHtml(), '<!DOCTYPE html>\n<html></html>');
  const claim = token => ({ token });
  transfer.setClaimHandler(claim);
  transfer.setFinishHandler(() => true);
  transfer.setReceiveHandler(async () => true);
  transfer.setStartupPromise(Promise.resolve());
  assert.equal(windowObject.__pdfEditorClaimDetachedDoc, claim);
  assert.equal(typeof windowObject.__pdfEditorFinishDetachedDoc, 'function');
  assert.equal(typeof windowObject.__pdfEditorReceiveMergedDocs, 'function');
  assert.ok(windowObject.pdfEditorStartupPromise instanceof Promise);
  transfer.open('https://editor.example/', 'child');
  assert.deepEqual(opened[0], ['https://editor.example/', 'child']);
  assert.equal(transfer.connectedReceiver(), receiver);
  assert.equal(await transfer.receiveDocuments(receiver, { ok: true }), true);


});

test('Windows peer adapter discovers every ready editor window and moves documents only after acknowledgement', async () => {
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
    postMessage(message) {
      for (const target of channels.get(this.name) || []) {
        if (target === this) continue;
        const copy = structuredClone(message);
        queueMicrotask(() => target.listeners.forEach(listener => listener({ data: copy })));
      }
    }
    close() { channels.get(this.name)?.delete(this); }
  }
  const makeWindow = (windowId, windowNumber) => ({
    pdfEditorWindowsContext: {
      sessionId: 'session-12345678', windowId, windowNumber,
    },
    BroadcastChannel: FakeBroadcastChannel,
    crypto: { randomUUID: () => `request-${windowNumber}-12345678` },
    setInterval, clearInterval, setTimeout, clearTimeout,
    focusCalls: 0,
    focus() { this.focusCalls++; },
  });
  const firstWindow = makeWindow('window-a-12345678', 1);
  const secondWindow = makeWindow('window-b-12345678', 2);
  const first = createWindowPeerAdapter(firstWindow);
  const second = createWindowPeerAdapter(secondWindow);
  let draggedPayload = null;
  first.setReceiveHandler(async () => true);
  second.setReceiveHandler(async payload => {
    draggedPayload = payload;
    return payload.accepted;
  });
  first.setDragRequestHandler(async (documentIds, target) => first.transferDocuments(target.id, {
    accepted: true,
    documentIds,
    targetIndex: target.targetIndex,
  }));
  first.updateMetadata({ title: '창 1 · 첫 문서.pdf', documentCount: 2 });
  second.updateMetadata({ title: '창 2 · 둘째 문서.pdf', documentCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(first.supported, true);
  assert.deepEqual(first.peers().map(peer => [peer.windowNumber, peer.documentCount]), [[2, 1]]);
  assert.equal(await first.transferDocuments(second.windowId, { accepted: true }), true);
  assert.equal(await second.requestDraggedDocuments(first.windowId, ['doc-7'], 1), true);
  assert.deepEqual(draggedPayload, { accepted: true, documentIds: ['doc-7'], targetIndex: 1 });
  first.focus(second.windowId);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(secondWindow.focusCalls, 1);

  first.dispose();
  second.dispose();
  assert.equal(first.dispose(), false);
  assert.equal(createWindowPeerAdapter({}).supported, false);
});


test('a display worker fetching wasm does not make the first editing engine initialization a restart',async()=>{
 const {library}=createPdfiumLibrary(),messages=[];
 const adapter=createPdfiumAdapter({cdn:'/bundled/',importModule:async()=>({init:async()=>library}),
 fetchFn:async()=>({arrayBuffer:async()=>new Uint8Array([1]).buffer}),onBusyChange:(busy,message)=>{if(busy)messages.push(message);}});
 await adapter.getWasmBinary();await adapter.get();adapter.reset();await adapter.get();
 assert.doesNotMatch(messages[0],/재시작/);assert.match(messages[1],/재시작/);
});
