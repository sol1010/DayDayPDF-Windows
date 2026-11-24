import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

import { createEditorStore } from '../../src/state/editor-store.js';
import { createViewportZoom } from '../../src/ui/editor/viewport-zoom.js';
import {
  createWindowsAccessPolicy,
  normalizeWindowsAccessPolicy,
} from '../../src/state/windows-access-policy.js';

function documentState(id, name) {
  return {
    id, name, pages: [{ id: `page-${id}` }], selected: new Set([0]),
    zoom: 1, fitWidth: true, currentPage: 0, undoStack: [], redoStack: [],
    lastSelected: 0, scrollTop: 0, dirty: false, fileHandle: null,
  };
}

test('EditorStore owns document order, tab selection, and activation by stable id', () => {
  const store = createEditorStore();
  const first = documentState(11, '첫 문서');
  const second = documentState(22, '둘째 문서');
  store.documents.push(first, second);
  store.selectedDocuments.add(first);
  store.tabSelectionAnchor = first;
  store.activate(second);

  assert.deepEqual(store.documents.map(document => document.id), [11, 22]);
  assert.equal('tabOrder' in store, false);
  assert.equal('activeDocumentId' in store, false);
  assert.equal(store.activeDocument, second);
  assert.throws(() => store.activate(documentState(33, '열리지 않은 문서')), /열린 문서만/);

  store.documents = [second];
  assert.equal(store.selectedDocuments.size, 0);
  assert.equal(store.tabSelectionAnchor, null);
  assert.equal(store.activeDocument, second);
});

test('active pages, selection, view, history, dirty, and file handle have one document owner', () => {
  const store = createEditorStore();
  const first = documentState(1, 'A');
  const second = documentState(2, 'B');
  store.documents.push(first, second);
  store.activate(first);

  const firstUndo = { pages: [{ id: 'before-A' }] };
  store.pages.push({ id: 'page-A2' });
  store.selectedPages = new Set([1]);
  store.zoom = 1.75;
  store.fitWidth = false;
  store.currentPage = 1;
  store.undoStack.push(firstUndo);
  store.documentName = 'A 수정';
  store.lastSelected = 1;
  store.dirty = true;
  store.fileHandle = { name: 'a.pdf' };
  store.captureActiveScroll(321.5);

  store.activate(second);
  assert.deepEqual(store.pages, [{ id: 'page-2' }]);
  assert.deepEqual(store.undoStack, []);
  assert.equal(store.dirty, false);
  store.undoStack.push({ pages: [{ id: 'before-B' }] });
  store.captureActiveScroll(77);

  store.activate(first);
  assert.equal(store.pages, first.pages);
  assert.equal(store.selectedPages, first.selected);
  assert.deepEqual(store.undoStack, [firstUndo]);
  assert.equal(store.documentName, 'A 수정');
  assert.equal(store.zoom, 1.75);
  assert.equal(store.fitWidth, false);
  assert.equal(store.scrollTop, 321.5);
  assert.equal(store.fileHandle.name, 'a.pdf');
  assert.deepEqual(second.undoStack, [{ pages: [{ id: 'before-B' }] }]);
  assert.equal(second.scrollTop, 77);
});

test('closing the active document clears active identity without leaking inactive writes', () => {
  const store = createEditorStore();
  const document = documentState(1, '문서');
  store.documents.push(document);
  store.activate(document);
  store.activate(null);
  store.pages.push({ id: 'inactive-only' });
  store.undoStack.push({ pages: [] });

  assert.equal(store.activeDocument, null);
  assert.deepEqual(document.pages, [{ id: 'page-1' }]);
  assert.deepEqual(document.undoStack, []);
});

test('Windows access policy leaves ordinary browsers unrestricted until the native host sets it', () => {
  const policy = createWindowsAccessPolicy();
  assert.deepEqual(policy.current, {
    hosted: false,
    mode: 'browser',
    canOpenNewDocuments: true,
    canEditCurrentDocuments: true,
    canSaveCurrentDocuments: true,
    graceRemainingSeconds: null,
    message: '',
  });
});

test('Windows host policy is normalized, immutable, and keeps save available', () => {
  const changes = [];
  const policy = createWindowsAccessPolicy();
  const unsubscribe = policy.subscribe(snapshot => changes.push(snapshot));
  const snapshot = policy.setFromHost({
    mode: 'offlineGrace',
    canOpenNewDocuments: false,
    canEditCurrentDocuments: true,
    graceRemainingSeconds: 299.9,
    message: '연결이 끊겼습니다',
  });

  assert.equal(snapshot.hosted, true);
  assert.equal(snapshot.canOpenNewDocuments, false);
  assert.equal(snapshot.canEditCurrentDocuments, true);
  assert.equal(snapshot.canSaveCurrentDocuments, true);
  assert.equal(snapshot.graceRemainingSeconds, 299);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(changes.length, 1);

  unsubscribe();
  policy.setFromHost({ mode: 'saveOnly', canSaveCurrentDocuments: false });
  assert.equal(changes.length, 1);
  assert.equal(policy.current.canSaveCurrentDocuments, true);
  assert.throws(() => normalizeWindowsAccessPolicy(null), /접근 정책/);
});

const editorApp = await readFile(new URL('../../src/editor-app.js', import.meta.url), 'utf8');
function appSection(start, end) {
  const from = editorApp.indexOf(start);
  const to = editorApp.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing editor section: ${start}`);
  return editorApp.slice(from, to);
}
function viewRuntime({ mode = 'scroll', mobile = false } = {}) {
  const store = createEditorStore();
  const first = { ...documentState(1, 'A'), fitDone: true };
  const second = { ...documentState(2, 'B'), fitDone: true };
  store.documents.push(first, second);
  const requests = [], frames = [], timers = new Map(), styles = new Map(), savedSettings = new Map();
  let timerId = 0;
  const noop = () => {};
  const viewer = {
    scrollTop: 0, clientWidth: 1024, clientHeight: 852,
    querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 852 }),
  };
  const context = {
    editorStore: store, viewer, viewMode: mode, createViewportZoom,
    document: { documentElement: { style: { setProperty: (name, value) => styles.set(name, value) } } },
    settings: { set: (name, value) => savedSettings.set(name, value) },
    isMobileLayout: () => mobile,
    $: () => ({ style: {} }), resetTransientEditState: noop, setButtons: noop,
    updateUndoButtons: noop, rebuildAll: noop, renderTabs: noop, scheduleAutosave: noop,
    prioritizeReading: noop, rememberPageView: noop, restorePageView: () => false,
    estimatePageSize: () => ({ w: 500, h: 800 }), restoreRegionRect: noop, updateStatus: noop, updateCurrentPage: noop,
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    performance: { now: () => 500 },
    getViewport: page => new Promise(resolve => requests.push({
      page,
      resolve: (width = 500, height = 800) => {
        page._w1 = width; page._h1 = height;
        resolve({ width, height });
      },
    })),
  };
  const api = runInNewContext(`
    let documentViewRevision = 0, thumbW = 168, panelW = 192;
    const initialThumbW = thumbW, THUMB_DISPLAY_MIN = 84, THUMB_DISPLAY_MAX = 168;
    const documentThumbnailViews = new WeakMap();
    const panelMax = () => 1000;
    ${appSection('function switchDoc(d)', 'let closeDocResolve')}
    ${appSection('let viewFitRevision = 0', 'function targetIndices()')}
    ${appSection('function setThumbWidth(', "sidebar.addEventListener('wheel'")}
    ({ switchDoc, setZoom, doFitPage, doFitWidth, scheduleRefitWidth, setThumbWidth, setThumbnailColumns,
       thumbnailView: () => ({ thumbW, panelW }) });
  `, context);
  return { api, store, first, second, requests, frames, timers, styles, savedSettings, viewer };
}

test('desktop tabs start with one thumbnail column and retain independent thumbnail sizes, widths, and zoom', () => {
  const { api, store, first, second, styles, savedSettings } = viewRuntime();
  api.switchDoc(first);
  assert.equal(api.thumbnailView().panelW, 192);
  api.setThumbWidth(120);
  api.setThumbnailColumns(3);
  api.setZoom(1.25);

  api.switchDoc(second);
  assert.equal(api.thumbnailView().thumbW, 168);
  assert.equal(api.thumbnailView().panelW, 192);
  api.setThumbWidth(96);
  api.setThumbnailColumns(2);
  api.setZoom(.8);
  const settingsBeforeReturn = [...savedSettings];

  for (let repeat = 0; repeat < 3; repeat++) {
    api.switchDoc(first);
    assert.equal(api.thumbnailView().thumbW, 120);
    assert.equal(api.thumbnailView().panelW, 416);
    assert.equal(styles.get('--thumbw'), '120px');
    assert.equal(styles.get('--panelw'), '416px');
    assert.equal(store.zoom, 1.25);
    assert.equal(store.fitWidth, false);
    api.switchDoc(second);
    assert.equal(api.thumbnailView().thumbW, 96);
    assert.equal(api.thumbnailView().panelW, 240);
    assert.equal(store.zoom, .8);
  }
  assert.deepEqual([...savedSettings], settingsBeforeReturn, 'restoring a tab must not rewrite startup preferences');
  assert.equal(first.dirty, false);
  assert.equal(second.dirty, false);
});

test('late page/width fitting cannot overwrite a manual zoom in any page mode', async () => {
  for (const mode of ['scroll', 'single', 'double']) {
    for (const method of ['doFitPage', 'doFitWidth']) {
      const { api, first, requests } = viewRuntime({ mode });
      first.fitDone = false;
      api.switchDoc(first);  
      const firstFit = requests.shift();
      const pending = api[method]();
      const requested = requests.shift();
      api.setZoom(1.37);
      firstFit.resolve(400, 600);
      requested.resolve(200, 300);
      await pending;
      assert.equal(first.zoom, 1.37, `${mode}/${method}`);
      assert.equal(first.fitWidth, false);
      assert.equal(first.fitDone, true, 'manual zoom completes first-open fitting');
    }
  }
});

test('late width fitting belongs to its starting tab, including a quick A-B-A round trip', async () => {
  for (const returnToFirst of [false, true]) {
    const { api, first, second, requests } = viewRuntime();
    api.switchDoc(first);
    api.setZoom(1.4);
    const pending = api.doFitWidth();
    const request = requests.shift();
    api.switchDoc(second);
    api.setZoom(.75);
    if (returnToFirst) api.switchDoc(first);
    request.resolve(200, 300);
    await pending;
    assert.equal(first.zoom, 1.4);
    assert.equal(second.zoom, .75);
    assert.equal(first.fitWidth, false);
    assert.equal(second.fitWidth, false);
  }
});

test('interrupted first-open fitting retries on return without borrowing another tab page', async () => {
  const { api, first, second, requests, store } = viewRuntime({ mode: 'double' });
  first.fitDone = false;
  first.pages.push({ id: 'page-A2' });
  api.switchDoc(first);
  const interrupted = requests.shift();
  api.switchDoc(second);
  api.setZoom(.7);
  interrupted.resolve();
  await nextTurn();
  const secondPage = requests.shift();
  assert.equal(secondPage.page, first.pages[1]);
  secondPage.resolve();
  await nextTurn();
  assert.equal(store.zoom, .7);
  assert.equal(first.fitDone, false);

  api.switchDoc(first);
  requests.shift().resolve();
  await nextTurn();
  requests.shift().resolve();
  await nextTurn();
  assert.equal(first.fitDone, true);
  assert.equal(first.zoom, (1000 - 16) / 1000);  
  assert.equal(first.fitWidth, false);
});

test('only the most recent explicit fit request applies, and width fitting remains available', async () => {
  const { api, first, requests } = viewRuntime();
  api.switchDoc(first);
  const older = api.doFitWidth(), oldestRequest = requests.shift();
  const newer = api.doFitWidth(), newestRequest = requests.shift();
  newestRequest.resolve(400, 600);
  await newer;
  assert.equal(first.zoom, 2.5);
  assert.equal(first.fitWidth, true);
  oldestRequest.resolve(200, 300);
  await older;
  assert.equal(first.zoom, 2.5);
  assert.equal(first.fitWidth, true);
});

test('queued automatic refits and scroll restoration are invalidated when leaving a tab', () => {
  const { api, first, second, requests, frames, timers, viewer } = viewRuntime();
  first.scrollTop = 300;
  second.scrollTop = 80;
  api.switchDoc(first);
  api.scheduleRefitWidth();
  const refit = [...timers.values()][0];
  const restoreFirst = frames.shift();
  api.switchDoc(second);
  assert.equal(timers.size, 0);
  refit();  
  assert.equal(requests.length, 0);
  restoreFirst();
  assert.equal(viewer.scrollTop, 80);
  api.switchDoc(first);
  viewer.scrollTop = 450;
  restoreFirst();
  assert.equal(viewer.scrollTop, 450, 'an older callback for the same document must also be ignored');
});

test('mobile tab switches retain the existing shared thumbnail drawer behavior', () => {
  const { api, first, second } = viewRuntime({ mobile: true });
  api.switchDoc(first);
  api.setThumbWidth(96);
  api.switchDoc(second);
  assert.equal(api.thumbnailView().thumbW, 96);
  api.switchDoc(first);
  assert.equal(api.thumbnailView().thumbW, 96);
});

test('zoom anchors preserve the viewed page across width fits with fixed gaps and mixed page sizes', () => {
  let zoom = 1;
  const dimensions = Array.from({ length: 35 }, (_, i) => i % 5 === 0 ? [600, 850] : [842, 595]);
  const viewer = { clientWidth: 1100, clientHeight: 850, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 200, top: 60 }), querySelectorAll: () => wraps };
  let scrollLeft = 0;
  Object.defineProperty(viewer, 'scrollLeft', { get: () => scrollLeft, set(value) {
    scrollLeft = Math.max(0, Math.min(value, Math.max(0, 842 * zoom - viewer.clientWidth)));
  } });
  const wraps = dimensions.map(([width, height], index) => ({ isConnected: true, style: {}, getBoundingClientRect() {
    const left = 200 + Math.max(0, (viewer.clientWidth - width * zoom) / 2) - viewer.scrollLeft;
    const top = 60 + 24 + dimensions.slice(0, index).reduce((sum, [, h]) => sum + h * zoom + 20, 0) - viewer.scrollTop;
    return { left, top, right: left + width * zoom, bottom: top + height * zoom, width: width * zoom, height: height * zoom };
  } }));
  const api = createViewportZoom({ viewer, getZoom: () => zoom, getDocument: () => 'doc', applyZoom: z => { zoom = z; } });
  for (const index of [27, 28, 29, 30]) {
    const page = wraps[index], first = page.getBoundingClientRect();
    viewer.scrollTop += first.top + first.height * .6 - 60 - viewer.clientHeight / 2;
    const point = () => { const r = page.getBoundingClientRect(); return (60 + viewer.clientHeight / 2 - r.top) / r.height; };
    const before = point();
    for (let repeat = 0; repeat < 5; repeat++) for (const width of [1100, 744, 930]) {
      viewer.clientWidth = width;
      api.to((width - 24) / 842);
      assert.ok(Math.abs(point() - before) < 1e-10, 'same document point stays centered on page ' + (index + 1));
    }
  }
});

test('fit page centers a newly opened document without borrowing the previous tab scroll position', async () => {
  const { api, first, second, requests, viewer } = viewRuntime();
  api.switchDoc(first); viewer.scrollTop = 18000;
  second.fitDone = false; second.currentPage = 0;
  second.pages.push({ id: 'second-page' });
  api.switchDoc(second);
  const request = requests.shift();
  assert.equal(request.page, second.pages[0]);
  request.resolve(); await nextTurn();
  assert.equal(second.currentPage, 0); assert.equal(second.fitDone, true);
});


test('thumbnail Shift ranges shrink, reverse and keep their anchor without editing the document', async () => {
  const source = await readFile(new URL('../../src/editor-app.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function toggleSelect('), source.indexOf('function movePages('));
  const editorStore = {pages:Array(10).fill({}),currentPage:2,selectedPages:new Set(),lastSelected:-1,dirty:false,undoStack:[]};
  let refreshes=0;
  const toggle = runInNewContext(body + '\ntoggleSelect', {editorStore, refreshThumbSelection:()=>refreshes++});
  const selected = () => [...editorStore.selectedPages].sort((a,b)=>a-b);
  toggle(7,true); assert.deepEqual(selected(),[2,3,4,5,6,7]);
  toggle(4,true); assert.deepEqual(selected(),[2,3,4]);
  toggle(0,true); assert.deepEqual(selected(),[0,1,2]);
  toggle(2,true); assert.deepEqual(selected(),[2]);
  assert.equal(editorStore.lastSelected,2);
  toggle(9,false); assert.deepEqual(selected(),[2,9]);
  toggle(9,false); assert.deepEqual(selected(),[2]);
  toggle(6,true); assert.deepEqual(selected(),[6,7,8,9]);
  assert.equal(editorStore.lastSelected,9);
  assert.equal(editorStore.dirty,false); assert.deepEqual(editorStore.undoStack,[]);
  editorStore.currentPage=4;
  editorStore.lastSelected=12;
  toggle(2,true); assert.deepEqual(selected(),[2,3,4]); assert.equal(editorStore.lastSelected,4);
  assert.equal(refreshes,8);
});
