import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { clonePage } from '../../src/core/compatibility.js';
import { objRotation, normRotation, rotateScreenDelta } from '../../src/core/geometry.js';
import { parseRange } from '../../src/core/range.js';
import { createCropResizeFeature } from '../../src/features/crop-resize/crop-resize.js';
import { createDocumentModelFeature } from '../../src/features/documents/document-model.js';
import { createImageHandlingFeature } from '../../src/features/image-handling/image-handling.js';
import { createMergeFeature } from '../../src/features/merge/merge-documents.js';
import { createOriginalSourceEditor } from '../../src/features/original-editor/original-source-editor.js';
import { createOverlayEditorFeature } from '../../src/features/overlay-editor/overlay-editor.js';
import { createPageOrganizerFeature } from '../../src/features/page-organizer/page-organizer.js';
import { createPrintExportFeature } from '../../src/features/print-export/print-export.js';
import { createRecoveryFeature } from '../../src/features/recovery/recovery.js';
import { createSearchViewFeature } from '../../src/features/search-view/search-view.js';
import { createUnlockFeature } from '../../src/features/unlock/unlock-document.js';

const documentModel = createDocumentModelFeature();
test('merge snapshots retain unsaved edits and allow the same open document more than once', () => {
  const feature = createMergeFeature({ clonePage });
  const original = page('Open', { src: 4, rot: 90, texts: [{ text: 'unsaved', clipSrc: 8, clipIdx: 0 }] });
  const snapshot = { kind: 'pages', pages: [clonePage(original)], sourceIds: [4, 8] };
  const result = feature.materialize([snapshot, { kind: 'file', count: 1 }, snapshot], [], () => 12);
  assert.deepEqual(result.pages.map(p => p.src), [4, 12, 4]);
  assert.deepEqual(result.sourceIds, [4, 8, 12]);
  assert.equal(result.pages[2].rot, 90);
  assert.equal(result.pages[2].texts[0].text, 'unsaved');
  result.pages[0].texts[0].text = 'edited result';
  assert.equal(result.pages[2].texts[0].text, 'unsaved');
  assert.equal(original.texts[0].text, 'unsaved');
});
const page = (name, extra = {}) => ({ name, src: 1, idx: 0, rot: 0, texts: [], ...extra });

test('document feature preserves the runtime document shape, page DTO fields, and locked-source identity', () => {
  const document = documentModel.createDocument(7, '문서');
  assert.deepEqual(document, {
    id: 7, name: '문서', pages: [], selected: new Set(), zoom: 1, fitWidth: true,
    fitDone: false, currentPage: 0, undoStack: [], redoStack: [], lastSelected: -1,
    scrollTop: 0, srcIds: [], dirty: false, _atSavedState: true, fileHandle: null,
  });
  assert.deepEqual(documentModel.createSourcePages(31, 2), [
    { src: 31, idx: 0, rot: 0, texts: [] },
    { src: 31, idx: 1, rot: 0, texts: [] },
  ]);
  const sources = new Map([[31, { locked: true }], [32, { locked: false }]]);
  assert.deepEqual(documentModel.lockedSourceIds([
    { src: 31 }, { src: 31 }, { src: 32 }, { src: null },
  ], id => sources.get(id)), [31]);
});

test('page organizer keeps index selection, object identity, rotation cache swap, and deep clipboard clones', () => {
  const feature = createPageOrganizerFeature({ clonePage });
  const pages = [page('A'), page('B'), page('C'), page('D')];
  assert.deepEqual(feature.targetIndexes(pages, new Set(), 9), [3]);
  assert.deepEqual(feature.targetIndexes(pages, new Set([3, 1]), 0), [1, 3]);

  const moved = feature.move(pages, new Set([1, 2]), 1, 4);
  assert.deepEqual(moved.pages.map(item => item.name), ['A', 'D', 'B', 'C']);
  assert.deepEqual([...moved.selectedIndexes], [2, 3]);
  assert.equal(moved.pages[2], pages[1]);

  const rotating = page('R', { _w1: 100, _h1: 200 });
  feature.rotate([rotating], [0], -90);
  assert.deepEqual({ rot: rotating.rot, width: rotating._w1, height: rotating._h1 },
    { rot: 270, width: 200, height: 100 });

  const source = page('copy', { texts: [{ text: '원본' }], crop: [.1, .2, .3, .4] });
  const [copy] = feature.copy([source], [0]);
  copy.texts[0].text = '사본';
  copy.crop[0] = .9;
  assert.equal(source.texts[0].text, '원본');
  assert.equal(source.crop[0], .1);

  const removed = feature.remove(pages, new Set([0, 2]));
  assert.deepEqual(removed.pages.map(item => item.name), ['B', 'D']);
  assert.equal(removed.selectedIndexes.size, 0);
  assert.deepEqual(feature.createBlankPage(), {
    src: null, idx: -1, rot: 0, texts: [], blank: [595.28, 841.89],
  });
});

test('merge feature reorders items and materializes current/file pages without sharing current DTOs', () => {
  const feature = createMergeFeature({ clonePage });
  const items = [{ kind: 'current' }, { kind: 'file', count: 2, name: 'B' }];
  assert.deepEqual(feature.reorder(['A', 'B', 'C'], 0, 3), ['B', 'C', 'A']);
  const current = [page('A', { texts: [{ text: 'x' }] })];
  const result = feature.materialize(items, current, item => item.name === 'B' ? 81 : 0);
  assert.deepEqual(result.sourceIds, [81]);
  assert.deepEqual(result.pages.map(item => [item.src, item.idx]), [[1, 0], [81, 0], [81, 1]]);
  result.pages[0].texts[0].text = 'changed';
  assert.equal(current[0].texts[0].text, 'x');
});

test('crop/resize feature preserves blank-vs-resize behavior, cache invalidation, and rotated image geometry', async () => {
  const feature = createCropResizeFeature({ rotateDelta: rotateScreenDelta, getRotation: objRotation });
  const pages = [page('blank', { blank: [10, 20], _w1: 10, _h1: 20 }), page('pdf', { _w1: 30, _h1: 10 })];
  await feature.resize(pages, [0, 1], 100, 200, 'auto', async item => (
    item.name === 'pdf' ? { width: 300, height: 100 } : { width: 100, height: 200 }
  ));
  assert.deepEqual(pages[0].blank, [100, 200]);
  assert.deepEqual(pages[1].resize, [200, 100]);
  assert.equal('_w1' in pages[0], false);
  feature.applyCrop(pages, [1], [.1, .2, .5, .5]);
  assert.deepEqual(pages[1].crop, [.1, .2, .5, .5]);
  feature.resetCrop(pages, [1]);
  assert.equal('crop' in pages[1], false);

  const image = { fx: .1, fy: .2, fw: .4, fh: .2, rot: 90 };
  feature.cropImageObject(image, [.25, 0, .5, 1], 100, 200);
  assert.ok(Math.abs(image.fx - .2) < 1e-12);
  assert.ok(Math.abs(image.fy - .2) < 1e-12);
  assert.deepEqual({ fw: image.fw, fh: image.fh, rot: image.rot }, { fw: .2, fh: .2, rot: 90 });
});

test('unlock feature validates every replacement before atomically remapping all document pages', async () => {
  const destroyed = [];
  const sources = new Map([
    [1, { bytes: Uint8Array.of(1), doc: { numPages: 2 }, name: 'one.pdf' }],
    [2, { bytes: Uint8Array.of(2), doc: { numPages: 1 }, name: 'two.pdf' }],
  ]);
  const feature = createUnlockFeature({
    decrypt: async bytes => Uint8Array.of(bytes[0], 9),
    openDocument: bytes => ({ promise: Promise.resolve({
      numPages: bytes[0] === 1 ? 2 : 1,
      destroy: () => destroyed.push(bytes[0]),
    }) }),
    detectLocked: async () => false,
    getSource: id => sources.get(id),
  });
  const replacements = await feature.prepare([1, 2], 'pw');
  assert.deepEqual([...replacements.keys()], [1, 2]);
  const documents = [
    { pages: [{ src: 1 }, { src: 2 }], srcIds: [1, 2] },
    { pages: [{ src: 1 }], srcIds: [1] },
  ];
  feature.remapDocuments(documents, new Map([[1, 11], [2, 12]]));
  assert.deepEqual(documents[0].pages.map(item => item.src), [11, 12]);
  assert.deepEqual(documents[0].srcIds, [1, 2, 11, 12]);
  assert.deepEqual(documents[1].srcIds, [1, 11]);
  assert.deepEqual(destroyed, []);
});

test('print/export feature preserves all/selected/custom ranges and orientation copies', async () => {
  const feature = createPrintExportFeature({
    clonePage,
    parseRange,
    getViewport: async item => item._landscape
      ? { width: 200, height: 100 }
      : { width: 100, height: 200 },
  });
  const pages = [page('A'), page('B'), page('C')];
  assert.deepEqual(feature.pageIndexes('all', pages, new Set(), ''), [0, 1, 2]);
  assert.deepEqual(feature.pageIndexes('selected', pages, new Set([2, 0]), ''), [0, 2]);
  assert.deepEqual(feature.pageIndexes('custom', pages, new Set(), '1,3'), [0, 2]);
  assert.equal(feature.pageIndexes('selected', pages, new Set(), ''), null);

  const landscape = page('landscape', { _landscape: true, _w1: 200, _h1: 100 });
  const [oriented] = await feature.orient([landscape], [0], 'portrait');
  assert.equal(oriented.rot, 90);
  assert.equal('_w1' in oriented, false);
  assert.equal(landscape.rot, 0);
});

test('search/view feature returns stable page/item indexes and keeps double-page navigation rules', async () => {
  const feature = createSearchViewFeature();
  const pages = [{ text: ['Alpha', 'beta'] }, { text: ['ALPHABET'] }];
  const matches = await feature.find(pages, 'alpha', async item => item.text.map(str => ({ str })));
  assert.deepEqual(matches, [{ k: 0, ii: 0 }, { k: 1, ii: 0 }]);
  assert.equal(feature.step(0, 2, -1), 1);
  assert.equal(feature.basePage(5, 'double'), 4);
  assert.equal(feature.flip(4, 8, 'double', 1), 6);
  assert.equal(feature.flip(6, 8, 'double', 1), 7);
  assert.equal(feature.flip(3, 8, 'scroll', 1), 3);
});

test('overlay and image features preserve category slots, quarter rotation, placement clamp, and raster DTOs', () => {
  const overlay = createOverlayEditorFeature({
    isTextObject: object => !object.type || object.type === 'text',
    getRotation: objRotation,
    normalizeRotation: normRotation,
  });
  const textA = { id: 'ta' }, shapeA = { id: 'sa', type: 'rect' };
  const textB = { id: 'tb' }, shapeB = { id: 'sb', type: 'rect' };
  const ordered = overlay.reorderWithinCategories(
    [textA, shapeA, textB, shapeB],
    item => item === textA || item === shapeA,
    overlay.category,
    true,
  );
  assert.deepEqual(ordered.map(item => item.id), ['tb', 'sb', 'ta', 'sa']);
  const rotated = { rot: 315 };
  overlay.rotateQuarterTurn(rotated);
  assert.equal(rotated.rot, 45);

  const images = createImageHandlingFeature();
  assert.deepEqual(images.fitObject(1000, 500, 500, 500, { fx: .98, fy: .98 }), {
    fx: .4, fy: .7, fw: .6, fh: .3,
  });
  assert.deepEqual(images.rasterPages(44, 2), [
    { src: 44, idx: 0, rot: 0, texts: [] },
    { src: 44, idx: 1, rot: 0, texts: [] },
  ]);
});

test('original source editor keeps async context guards and registers a new immutable source id', async () => {
  const sources = new Map([[1, { name: 'source.pdf' }]]);
  let sequence = 10;
  const feature = createOriginalSourceEditor({
    openDocument: bytes => ({ promise: Promise.resolve({ bytes }) }),
    getSource: id => sources.get(id),
    registerSource: source => { const id = ++sequence; sources.set(id, source); return id; },
    addDocumentSource: (document, id) => document.srcIds.push(id),
  });
  const pageModel = { src: 1, idx: 0 };
  const document = { srcIds: [1] };
  const pages = [pageModel];
  const context = feature.captureContext(document, pages, 0);
  assert.equal(feature.contextValid(context, document, pages), true);
  assert.equal(feature.contextValid(context, document, [{ ...pageModel }]), false);
  const id = await feature.swap(pageModel, Uint8Array.of(8, 9), document);
  assert.equal(id, 11);
  assert.equal(pageModel.src, 11);
  assert.deepEqual(document.srcIds, [1, 11]);
  assert.equal(sources.get(11).name, 'source.pdf');
});

test('original source swap discards a PDF that finishes loading after its edit context changes', async () => {
  let resolveOpen, valid = true, destroyed = false, registered = false;
  const feature = createOriginalSourceEditor({
    openDocument: () => ({promise: new Promise(resolve => { resolveOpen = resolve; })}),
    getSource: () => ({name:'original.pdf'}),
    registerSource: () => { registered = true; return 2; },
    addDocumentSource: (document,id) => document.srcIds.push(id),
  });
  const page = {src:1,idx:0}, document = {srcIds:[1]};
  const pending = feature.swap(page,Uint8Array.of(1),document,() => valid);
  valid = false;
  resolveOpen({destroy:async () => { destroyed = true; }});
  assert.equal(await pending,null);
  assert.equal(destroyed,true);
  assert.equal(registered,false);
  assert.equal(page.src,1);
  assert.deepEqual(document.srcIds,[1]);
});

test('recovery feature remaps current pages and both history stacks without changing DTO field names', () => {
  let id = 0;
  const feature = createRecoveryFeature({
    createDocument: name => documentModel.createDocument(++id, name),
    remapPage: (value, idMap) => ({ ...value, src: idMap.get(value.src) }),
    collectSourceRefs: pages => new Set(pages.map(item => item.src)),
  });
  const payload = { active: 9, docs: [{
    name: '복구', dirty: true, atSavedState: false, pages: [{ src: 1, idx: 0, rot: 0, texts: [] }],
    selected: [0, 3], zoom: 12, fitWidth: false, currentPage: 7, lastSelected: 0,
    scrollTop: 22, undoStack: [{ pages: [{ src: 1, idx: 0, texts: [] }], atSavedState: true }],
    redoStack: [{ pages: [{ src: 1, idx: 0, texts: [] }], atSavedState: false }],
  }] };
  const result = feature.materializePayload(payload, new Map([[1, 91]]));
  const document = result.opened[0];
  assert.equal(result.openAt, 0);
  assert.equal(document.pages[0].src, 91);
  assert.deepEqual([...document.selected], [0]);
  assert.equal(document.zoom, 8);
  assert.equal(document.currentPage, 0);
  assert.equal(document.undoStack[0].pages[0].src, 91);
  assert.equal(document.redoStack[0].pages[0].src, 91);
  assert.equal(document.undoStack[0].atSavedState, true);
  assert.equal(document.redoStack[0].atSavedState, false);
  assert.equal(document._atSavedState, false);
  assert.deepEqual(document.srcIds, [91]);

  const autosaved = feature.materializeDocument({
    name: '유휴 복원', dirty: false, scrollTop: 418,
    pages: [{ src: 1, idx: 0, rot: 0, texts: [] }],
  }, new Map([[1, 91]]), { trusted: false, includeRuntimeState: false });
  assert.equal(autosaved.scrollTop, 418);
  assert.equal(autosaved.fitDone, true);
  const legacyAutosave = feature.materializeDocument({
    name: '구버전', dirty: false, pages: [{ src: 1, idx: 0, rot: 0, texts: [] }],
  }, new Map([[1, 91]]), { trusted: false, includeRuntimeState: false });
  assert.equal(legacyAutosave.scrollTop, 0);
  assert.equal(legacyAutosave.fitDone, false);
});

test('feature modules are headless and do not reference editor DOM selectors or browser persistence', async () => {
  const urls = [
    '../../src/features/page-organizer/page-organizer.js',
    '../../src/features/documents/document-model.js',
    '../../src/features/merge/merge-documents.js',
    '../../src/features/crop-resize/crop-resize.js',
    '../../src/features/unlock/unlock-document.js',
    '../../src/features/print-export/print-export.js',
    '../../src/features/search-view/search-view.js',
    '../../src/features/overlay-editor/overlay-editor.js',
    '../../src/features/image-handling/image-handling.js',
    '../../src/features/original-editor/original-source-editor.js',
    '../../src/features/recovery/recovery.js',
  ];
  for (const relative of urls) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\$\(|getElementById|querySelector|localStorage|indexedDB/);
  }
});
