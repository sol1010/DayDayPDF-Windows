import { createTextOverlayLayout } from './rendering/text-overlay-layout.js';
import { resizeObjectBox, objectReflectionMatrix, originalResizeMatrix } from './core/object-resize.js';
import { prepareMarkedRestoration } from './features/recovery/marked-page-filter.js';
import { INK_BRUSHES, createInkObject, inkGeometry, inkSvgPath } from './core/ink.js';
import { fragmentStroke, fragmentStrokeBounds, applyFragmentStrokes, cropFragmentStrokes, maskEmbeddedFragment, replacePdfObjectForm, drawEraserTip, eraserBounds, eraseCanvasStroke, replacePdfObjectBitmap } from './features/overlay-editor/object-eraser.js';
import { createDrawingController } from './ui/editor/drawing-controller.js';
import { readThemePreferences, applyThemePreferences, isThemeStorageEvent } from './ui/theme-preferences.js';
import { startPageMarquee } from './ui/editor/page-marquee.js';
'use strict';
import {
  ARROW_HEAD_SIZE_MAX, ARROW_HEAD_SIZE_MIN,
  GF_SHA, PDFIUM_CDN, PDFJS_CDN_BASE, PDFJS_VERSION, WINDOWS_FONT_BASE, WINDOWS_PDFIUM_BASE,
  THUMB_DISPLAY_MAX, THUMB_DISPLAY_MIN, THUMB_RENDER_MAX, cacheByteLimit,
} from './core/config.js';
import { hexA, hexToRgbComponents, opOf } from './core/color.js';
import {
  constrainPolylineVertex, cropSelectionRectFromPoints, cropToViewportPoints, normRotation, objRotation, pagePtToFrac, pageFracToPt, pageRectToDispRect,
  pdfPointBounds, pdfRectToViewport, regionPdfBounds, resizedCropGeometry, rotateScreenDelta, rotateScreenPoint, unrotFrac,
  rotatePolylinePoints, tappedCropSelectionRect,
} from './core/geometry.js';
import { makeRenderKey, makeThumbKey } from './core/render-keys.js';
import { parseRange } from './core/range.js';
import { collectPageSourceRefs } from './core/source-references.js';
import {
  FONT_CATALOG, fontCss, googleFontUrls, inferSupportedFontKey, resolveEditablePdfFont,
} from './core/font-catalog.js';
import {
  clampStrokeWidth, clonePage, remapTransferPageDto, sanitizeTextObject,
  toAutosaveDocumentDto, toDetachedDocumentDto,
} from './core/compatibility.js';
import { waitForStartupContentReady } from './core/startup-guard.js';
import { createEditorTutorial } from './ui/editor/tutorial.js';
import { createToolbarDisplayController } from './ui/editor/toolbar-display.js';
import {
  markChanged, markSaved, restoreSaveCheckpoint, snapshotSaveCheckpoint,
} from './core/history-dirty.js';
import {
  applyObjectScaleSnapshot, arrowBodyPolyline, arrowHeadResizeVectors, arrowHeadSizeDelta, arrowMarkerStrokeWidth, connectedDeletionSet,
  connectorEndDirection, copyConnectedObjectBundle, detachedObjectCopy, detachDanglingConnectors,
  isConnectableShape, objectScaleSnapshot, rekeyPageConnections,
  rotateConnectorJoints, translateObjectBundle,
  connectorPolyline, shapeAnchorVector, shapeSideMidpoints, shapeUnitPolygon,
  syncAttachedArrow, syncPageConnectors,
} from './core/shape-connectors.js';
import { createSettingsAdapter } from './adapters/settings-adapter.js';
import { createSessionRepository } from './adapters/indexeddb-session-repository.js';
import { createFontCacheRepository } from './adapters/indexeddb-font-cache.js';
import { createBrowserFileAdapter } from './adapters/browser-file-adapter.js';
import { pickEditorColor } from './ui/editor/color-sampler.js';
import { createDesktopHostAdapter } from './adapters/desktop-host-adapter.js';
import { createDesktopOutputAdapter } from './adapters/desktop-output-adapter.js';
import { createWebClipboardBroker } from './adapters/web-clipboard-broker.js';
import {
  CLIPBOARD_SERIALIZE_WORKER_SOURCE, unpackShellClipboardPayload, packShellClipboardPayload,
} from './adapters/shell-clipboard-codec.js';
import { createPdfJsReader } from './adapters/pdfjs-reader-adapter.js';
import {
  createAlignedSubsetFontkit, createFontRegistry, createPdfLibAdapter,
} from './adapters/pdf-lib-font-adapter.js';
import { createPdfiumAdapter, readPdfiumFontName } from './adapters/pdfium-adapter.js';
import { createWindowTransferAdapter } from './adapters/window-transfer.js';
import { createWindowPeerAdapter } from './adapters/window-peer-adapter.js';
import { createEditorStore } from './state/editor-store.js';
import { createWindowsAccessPolicy } from './state/windows-access-policy.js';
import { createPagePainter } from './rendering/page-painter.js';
import { averageRasterPixels, createDisplayPainter } from './rendering/display-painter.js';
import { DISPLAY_RASTER_WORKER_SOURCE } from './workers/display-raster-worker.js?source';
import { createOverlayCanvasRenderer } from './rendering/overlay-canvas-renderer.js';
import { createRenderCoordinator } from './rendering/render-coordinator.js';
import { createThumbnailCoordinator } from './rendering/thumbnail-coordinator.js';
import { createPageLifecycle } from './rendering/page-lifecycle.js';
import { createThumbnailWorkerController } from './rendering/thumbnail-worker-controller.js';
import { THUMBNAIL_PREPASS_WORKER_SOURCE } from './workers/thumbnail-prepass-worker.js?source';
import { createPageRenderer, readingQuality } from './rendering/page-renderer.js';
import { createTiledPageRenderer } from './rendering/tiled-page-renderer.js';
import { createThumbnailRenderer } from './rendering/thumbnail-renderer.js';
import { createPageOrganizerFeature } from './features/page-organizer/page-organizer.js';
import { createDocumentModelFeature } from './features/documents/document-model.js';
import { createMergeOpenDocumentsController } from './ui/editor/merge-open-documents-controller.js';
import { createDesktopMergeAdapter } from './adapters/desktop-merge-adapter.js';
import { createMergeFeature } from './features/merge/merge-documents.js';
import { createCropResizeFeature } from './features/crop-resize/crop-resize.js';
import { createUnlockFeature } from './features/unlock/unlock-document.js';
import { createEditorDocumentTools } from './features/document-tools/editor-document-tools.js';
import { createPrintDialogController } from './ui/editor/print-dialog-controller.js';
import { originalPrintBytes, copyOutputPages, embedResizedOutputPages, canvasImageBlob, drawCanvasRgb, createRasterOutputFeature } from './features/print-export/output-preparation.js';
import { createParallelPrintFeature } from './features/print-export/parallel-print.js';
import { PRINT_RASTER_WORKER_SOURCE } from './workers/print-raster-worker.js?source';
import { createPrintExportFeature } from './features/print-export/print-export.js';
import { makePdfPrintCopy, withPrintTitle, printPaperSizes, printPaperSize, addPrintMediaRun, alignPrinterMedia, grayscaleCanvas } from './features/print-export/pdf-print-copy.js';
import { createEditorSecurity } from './features/document-tools/editor-security.js';
import { createSearchViewFeature } from './features/search-view/search-view.js';
import { createOverlayEditorFeature } from './features/overlay-editor/overlay-editor.js';
import { createImageHandlingFeature } from './features/image-handling/image-handling.js';
import { pdfObjectBounds, transformPdfObject } from './features/original-editor/object-bounds.js';
import { createOriginalSourceEditor } from './features/original-editor/original-source-editor.js';
import {
  isInvisiblePdfText, ocrPdfItemBounds, removeTextForReplacement,
} from './features/original-editor/ocr-text-editing.js';
import {
  analyzeOcrGlyph, calibrateOcrLayout, composeOcrRasterEdit, matchOcrRasterFont,
  ocrRasterFrame, ocrRasterPoint, ocrRasterTransform, ocrSymbolsForText, opaqueOcrPatchImages, recognizeOcrEditLine, refineOcrGlyphBoxes,
  validateOcrAppearance,
} from './features/original-editor/ocr-raster-editing.js';
import { analyzeOcrVisualSelection, ocrVisualCanvases } from './features/original-editor/ocr-visual-selection.js';
import { createRecoveryFeature } from './features/recovery/recovery.js';
import { createDomRefs, EDITOR_DOM_IDS } from './ui/editor/dom-refs.js';
import {
  createAppLifecycleController, createDialogsController, createTabController,
  createToolbarController, createViewerController,
} from './ui/editor/ui-controllers.js';
import { createShortcutRouter, isSelectAllShortcut } from './ui/editor/shortcut-router.js';
import { createClipboardController } from './ui/editor/clipboard-controller.js';
import { createContextPasteState, positionContextMenu } from './ui/editor/context-menu.js';
import { createPointerGestureRouter } from './ui/editor/pointer-gesture-router.js';
import { createRegionFragmentView } from './rendering/region-fragment-view.js';
import { createViewportZoom } from './ui/editor/viewport-zoom.js';
import { createViewportScrollSpace } from './ui/editor/viewport-scroll-space.js';
import { createDialogHost } from './ui/editor/dialog-host.js';
import { bindMobileToolbarGesture } from './ui/editor/mobile-toolbar-gesture.js';
import { readPcFonts, pcWritingFonts, sfntFace, embeddingFlags, pcFontWorkerSource, retainPcFontMetadata } from './adapters/pc-fonts.js';
import { createFontPicker } from './ui/editor/font-picker.js';

export async function mountEditorApp({ mode = 'desktop-view' } = {}) {
if (mode !== 'desktop-view' || !window.chrome?.webview) throw new Error('DayDayPDF requires its Windows host.');
const desktopViewMode = true;
const desktopHost = createDesktopHostAdapter({ windowObject: window, mode });
const desktopOutput = createDesktopOutputAdapter(desktopHost);
const settings = createSettingsAdapter(localStorage);
const sessionRepository = createSessionRepository(window.indexedDB);
const idbPut = (key, value) => sessionRepository.put(key, value);
const idbGet = key => sessionRepository.get(key);
const idbDel = key => sessionRepository.remove(key);
const idbKeys = () => sessionRepository.keys();
const webClipboardBroker = desktopViewMode ? null : createWebClipboardBroker({
  repository: sessionRepository,
  BroadcastChannelConstructor: window.BroadcastChannel,
  cryptoObject: window.crypto,
});
const browserFiles = createBrowserFileAdapter({
  windowObject: window, documentObject: document, urlApi: URL, BlobConstructor: Blob,
});
const windowTransfer = createWindowTransferAdapter(window);
const windowPeers = createWindowPeerAdapter(window);

const pcFontBase = desktopViewMode ? 'https://pc-fonts.daydaypdf.invalid/_pcfonts/' : null;
const [installedFaces, pdfjsReader] = await Promise.all([readPcFonts(pcFontBase, fetch), createPdfJsReader({
  version: PDFJS_VERSION,
  cdnBase: PDFJS_CDN_BASE,
  protocol: location.protocol,
  baseUri: document.baseURI,
})]);
const { lib: pdfjsLib, base: PDFJS_BASE } = pdfjsReader;
const pdfiumBase = desktopViewMode
  ? new URL(WINDOWS_PDFIUM_BASE, document.baseURI).href
  : PDFIUM_CDN;
document.documentElement.dataset.pdfjsVersion = pdfjsLib.version;
document.documentElement.dataset.pdfjsSource =
  new URL(PDFJS_BASE).origin === location.origin ? 'local' : 'cdn';

function openPdfDocument(data) {
  return pdfjsReader.openDocument(data);
}

const PDF_EDITOR_BOOT_HTML = desktopViewMode ? null : windowTransfer.captureBootHtml();

const pdfLib = createPdfLibAdapter(PDFLib);
const { PDFDocument, degrees, rgb } = pdfLib;
const pdfFontkit = createAlignedSubsetFontkit(fontkit);
const fontCacheRepository = createFontCacheRepository(window.indexedDB, {
  namespace: GF_SHA,
  maxBytes: 150 * 1024 * 1024,
  requestPersistence: navigator.storage?.persist
    ? () => navigator.storage.persist()
    : null,
});
const fontCatalog = [...FONT_CATALOG, ...pcWritingFonts(installedFaces)];
function configureFontWorker(source) {
  return pcFontWorkerSource(source, installedFaces, pcFontBase, new URL(WINDOWS_FONT_BASE, document.baseURI).href);
}
const fontRegistry = createFontRegistry({
  fetchInstalled: async face => {
    const response = await fetch(pcFontBase + face.id, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('PC 글꼴을 읽을 수 없습니다.');
    const bytes = sfntFace(new Uint8Array(await response.arrayBuffer()), face.index);
    const flags = embeddingFlags(bytes);
    if (flags === null || ![0, 8].includes(flags & 15) || (flags & 512))
      throw new Error('이 글꼴은 편집 가능한 PDF에 포함할 수 없습니다.');
    const openTypeCff = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) === 0x4f54544f;
    return { bytes, openTypeCff, embedSubset: !openTypeCff && !(flags & 256), kind: 'full', characters: '' };
  },
  gfSha: GF_SHA,
  localBase: desktopViewMode ? WINDOWS_FONT_BASE : null,
  fontCatalog,
  fontCss,
  googleFontUrls,
  fetchFn: fetch,
  windowObject: window,
  documentObject: document,
  FontFaceConstructor: window.FontFace,
  persistentCache: fontCacheRepository,
  documentTextSubsets: false,
});
const FONTS = fontRegistry.fonts;
const fetchPdfFontRecord = fontRegistry.fetchPdfFontRecord;
const ensureScreenFont = fontRegistry.ensureScreenFont;
const ensureTitleFont = fontRegistry.ensureTitleFont;
const pendingScreenFontTimers = new Map();
function scheduleScreenFont(key, bold, characters) {
  const cacheKey = `${key || 'spoqa'}${bold ? '_b' : ''}`;
  clearTimeout(pendingScreenFontTimers.get(cacheKey));
  pendingScreenFontTimers.set(cacheKey, setTimeout(() => {
    pendingScreenFontTimers.delete(cacheKey);
    ensureScreenFont(key, bold, { persist: true, characters });
  }, 300));
}

const pdfiumAdapter = createPdfiumAdapter({
  cdn: pdfiumBase,
  fetchFn: fetch,
  onBusyChange: (on, message) => spin(on, message),
  onEngineError: error => {
    console.warn('PDFium 엔진 오류 — 재시작 예약', error);
    toast('⚠ PDF 엔진 오류 — 자동 재시작합니다', 2500);
  },
});
const getPdfium = () => pdfiumAdapter.get();
const withPdfiumDoc = (bytes, operation) => pdfiumAdapter.withDocument(bytes, operation);

const sources = new Map();    
let srcSeq = 0, docSeq = 0;
const editorStore = createEditorStore();
const windowsAccess = createWindowsAccessPolicy();
let documentViewRevision = 0;
const pageViews = new WeakMap();
function viewsForPage(page) {
  if (!pageViews.has(page)) pageViews.set(page, {});
  return pageViews.get(page);
}
const documentModel = createDocumentModelFeature();
const pageOrganizer = createPageOrganizerFeature({ clonePage });
const mergeFeature = createMergeFeature({ clonePage });
const searchViewFeature = createSearchViewFeature();
const overlayEditorFeature = createOverlayEditorFeature({
  isTextObject: object => isTextObj(object),
  getRotation: objRotation,
  normalizeRotation: normRotation,
});
const imageHandlingFeature = createImageHandlingFeature();
const unlockFeature = createUnlockFeature({
  decrypt: (bytes, password) => pdfiumDecrypt(bytes, password),
  openDocument: data => openPdfDocument(data),
  detectLocked: document => detectPdfLocked(document),
  getSource: sourceId => sources.get(sourceId),
});
const originalSourceEditor = createOriginalSourceEditor({
  openDocument: data => openPdfDocument(data),
  getSource: sourceId => sources.get(sourceId),
  registerSource: source => {
    const sourceId = ++srcSeq;
    sources.set(sourceId, source);
    return sourceId;
  },
  addDocumentSource: (document, sourceId) => {
    if (document && !document.srcIds.includes(sourceId)) document.srcIds.push(sourceId);
  },
});
const recoveryFeature = createRecoveryFeature({
  createDocument: name => newDoc(name),
  remapPage: (page, idMap, trusted) => remapTransferPage(page, idMap, trusted),
  collectSourceRefs: pages => collectSourceRefs(pages),
});
const detachToken = windowTransfer.detachedToken();
const desktopTabToken = desktopViewMode
  ? String(new URLSearchParams(location.search).get('tab') || '').replace(/[^a-f0-9]/gi, '').slice(0, 40)
  : '';
const autosavePrefix = desktopViewMode
  ? 'desktop:' + (desktopTabToken || 'unassigned') + ':'
  : (detachToken ? 'detached:' + detachToken + ':' : '');
const autosaveSessionKey = autosavePrefix + 'session';
const autosaveSrcPrefix = autosavePrefix + 'src:';
let textMode = false;
let fileMode = 'open';        
let clipboard = null;         
let webPageClipboardId = '';
let webObjectClipboardId = '';
const desktopSaveTransfers = new Map();
const desktopClipboardPuts = new Map();
const desktopClipboardGets = new Map();
const clipboardSerializeJobs = new Map();
let clipboardSerializeWorker = null;
let desktopDocumentQueue = Promise.resolve();

const WINDOWS_EDIT_BUTTONS = Object.freeze([
  'btnUndo', 'btnRedo', 'btnRotL', 'btnRotR', 'btnBlank',
  'btnText', 'btnShape', 'btnDraw', 'btnConnectArrow', 'btnOrig', 'btnRegion',
]);
const WINDOWS_EDIT_SHORTCUT_ACTIONS = new Set([
  'undo', 'redo', 'rotL', 'rotR', 'editMode', 'addText', 'draw',
  'shapeCircle', 'shapeRect', 'connectArrow', 'regionCopy', 'multiPick',
]);

function windowsAccessNotice(kind = 'edit') {
  const policy = windowsAccess.current;
  if (policy.message) return policy.message;
  if (kind === 'open') return '연결이 끊기면 새 PDF를 열거나 병합할 수 없습니다. 현재 문서 저장은 가능합니다.';
  return '인터넷 연결을 확인할 수 없습니다. 현재 문서는 저장·내보내기·닫기만 할 수 있습니다.';
}

function requireWindowsNewWork({ throwOnBlocked = false } = {}) {
  if (windowsAccess.current.canOpenNewDocuments) return true;
  const message = windowsAccessNotice('open');
  toast(message, 4200);
  if (throwOnBlocked) throw new Error(message);
  return false;
}

function requireWindowsEdit() {
  if (windowsAccess.current.canEditCurrentDocuments) return true;
  toast(windowsAccessNotice('edit'), 4200);
  return false;
}

function windowsAccessLabel(policy) {
  if (policy.message) return policy.message;
  if (policy.mode === 'reconnecting') return '연결 확인 중 — 현재 열린 문서만 최대 5분 동안 편집할 수 있고 저장은 항상 가능합니다.';
  if (policy.mode === 'offlineGrace') {
    const minutes = Math.max(1, Math.ceil((policy.graceRemainingSeconds || 0) / 60));
    return `연결이 끊겼습니다 — 현재 열린 문서만 편집 가능 · 남은 활성 작업 ${minutes}분 · 저장 가능`;
  }
  return '온라인 확인이 필요합니다 — 현재 문서는 저장·내보내기·닫기만 할 수 있습니다.';
}

function applyWindowsAccessUi() {
  const policy = windowsAccess.current;
  const hasDocument = !!editorStore.activeDocument && editorStore.pages.length > 0;
  const locked = hasDocument && activeDocLocked();
  const showBar = policy.hosted && !['preview', 'online'].includes(policy.mode);
  $('windowsAccessBar').classList.toggle('show', showBar);
  $('windowsAccessBar').classList.toggle('saveOnly', !policy.canEditCurrentDocuments);
  $('windowsAccessMessage').textContent = showBar ? windowsAccessLabel(policy) : '';
  $('btnOpen').disabled = !policy.canOpenNewDocuments;
  $('btnAppend').disabled = locked || !policy.canOpenNewDocuments;
  $('btnPdfLock').disabled = locked || !policy.canEditCurrentDocuments || (!hasDocument && !policy.canOpenNewDocuments);
  $('btnPdfUnlock').disabled = $('btnDocumentTools').disabled = !hasDocument && !policy.canOpenNewDocuments;
  $('btnPdfUnlock').hidden = hasDocument && !(locked || editorStore.activeDocument?.openedWithPassword);
  for (const id of WINDOWS_EDIT_BUTTONS) {
    $(id).disabled = !hasDocument || locked || !policy.canEditCurrentDocuments;
  }
  const canEdit = hasDocument && !locked && policy.canEditCurrentDocuments;
  $('btnUndo').disabled = !canEdit || editorStore.undoStack.length === 0;
  $('btnRedo').disabled = !canEdit || editorStore.redoStack.length === 0;
}

function setWindowsAccessPolicy(input) {
  const wasEditable = windowsAccess.current.canEditCurrentDocuments;
  const next = windowsAccess.setFromHost(input);
  if (wasEditable && !next.canEditCurrentDocuments) resetTransientEditState();
  applyWindowsAccessUi();
  return next;
}

let startupMode = settings.get('startupMode') ||
  (settings.get('autosave') === '0' ? 'blank' : 'resume');
let autosaveEnabled = startupMode === 'resume';
let thumbW = +(settings.get('thumbW') || THUMB_DISPLAY_MAX);
thumbW = Math.min(THUMB_DISPLAY_MAX, Math.max(THUMB_DISPLAY_MIN, thumbW));
document.documentElement.style.setProperty('--thumbw', thumbW + 'px');
const initialThumbW = thumbW;
const documentThumbnailViews = new WeakMap();

const DEFAULT_KEYS = {
  thumbs:   { key: 'F4', ctrl: false, alt: false, shift: false },
  thumb1:   { key: '1',  ctrl: false, alt: false, shift: false },
  thumb2:   { key: '2',  ctrl: false, alt: false, shift: false },
  thumb3:   { key: '3',  ctrl: false, alt: false, shift: false },
  fitWidth: { key: '4',  ctrl: false, alt: false, shift: false },
  actualSize: { key: '5', ctrl: false, alt: false, shift: false },
  save:     { key: 's',  ctrl: true,  alt: false, shift: false },
  saveAs:   { key: 's',  ctrl: true,  alt: false, shift: true },
  print:    { key: 'p',  ctrl: true,  alt: false, shift: false },
  undo:     { key: 'z',  ctrl: true,  alt: false, shift: false },
  redo:     { key: 'y',  ctrl: true,  alt: false, shift: false },
  rotL:     { key: '-',  ctrl: true,  alt: false, shift: false },
  rotR:     { key: '=',  ctrl: true,  alt: false, shift: false },
  closeTab: { key: 'q',  ctrl: true,  alt: false, shift: false },  
  editMode:    { key: 'e', ctrl: false, alt: false, shift: false },
  addText:     { key: 't', ctrl: false, alt: false, shift: false },
  draw:        { key: 'd', ctrl: false, alt: false, shift: false },
  shapeCircle: { key: 'c', ctrl: false, alt: false, shift: false },
  shapeRect:   { key: 'r', ctrl: false, alt: false, shift: false },
  connectArrow:{ key: 'a', ctrl: false, alt: false, shift: false },
  regionCopy:  { key: 'c', ctrl: false, alt: true,  shift: false },  
  multiPick:   { key: 'm', ctrl: false, alt: false, shift: false },  
};
const RESERVED_COMBOS = ['Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+W', 'Ctrl+Shift+T',
  'Ctrl+Shift+N', 'Ctrl+Shift+Q', 'Ctrl+F4', 'F11', 'Alt+F4'];

let { theme, glassEffect } = readThemePreferences(settings);
function applyTheme(notifyHost = true) {
  const effectiveTheme = applyThemePreferences(document.documentElement, { theme, glassEffect });
  if (notifyHost)
    desktopHost.send({ type: 'themeChanged', apiVersion: 4, theme: effectiveTheme });
}
applyTheme();
let keymap = JSON.parse(JSON.stringify(DEFAULT_KEYS));
try {
  const s = settings.get('keymap');
  if (s) {
    const stored = JSON.parse(s);
    for (const act of Object.keys(DEFAULT_KEYS)) if (stored[act]) keymap[act] = stored[act];
  }
  else { const old = settings.get('thumbsKey'); if (old) keymap.thumbs = JSON.parse(old); }
  if (keymap.closeTab && keymap.closeTab.key === 'w' && !keymap.closeTab.shift &&
      (keymap.closeTab.ctrl !== keymap.closeTab.alt))
    keymap.closeTab = { key: 'q', ctrl: true, alt: false, shift: false };
  if (keymap.editMode && (keymap.editMode.alt || keymap.editMode.ctrl) && keymap.editMode.key === 'e')
    keymap.editMode = { key: 'e', ctrl: false, alt: false, shift: false };
} catch {}
const comboStr = c => (c.ctrl ? 'Ctrl+' : '') + (c.alt ? 'Alt+' : '') + (c.shift ? 'Shift+' : '') +
  (c.key === ' ' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key);
function updateBtnTitles() {
  $('btnSave').title = '저장 (' + comboStr(keymap.save) + ')';
  $('btnSaveAs').title = '다른 이름으로 저장 (' + comboStr(keymap.saveAs) + ')';
  $('btnPrint').title = '인쇄 (' + comboStr(keymap.print) + ')';
  $('btnUndo').title = '실행 취소 (' + comboStr(keymap.undo) + ')';
  $('btnRedo').title = '다시 실행 (' + comboStr(keymap.redo) + ')';
  $('btnRotL').title = '왼쪽 회전 (' + comboStr(keymap.rotL) + ')';
  $('btnRotR').title = '오른쪽 회전 (' + comboStr(keymap.rotR) + ')';
  $('btnFit').title = '폭 맞춤 (' + comboStr(keymap.fitWidth) + ')';
  $('zoomInput').title = '확대·축소 배율 입력 · 100%로 보기 (' + comboStr(keymap.actualSize) + ')';
  $('btnOrig').title = '편집 모드 (' + comboStr(keymap.editMode) + ')';
  $('btnText').title = '텍스트 추가 (' + comboStr(keymap.addText) + ')';
  $('btnDraw').title = '그리기 (' + comboStr(keymap.draw) + ')';
  $('btnShape').title = '도형 삽입 (사각형 ' + comboStr(keymap.shapeRect) + ' · 타원 ' + comboStr(keymap.shapeCircle) + ')';
  $('btnConnectArrow').title = '연결 화살표 (' + comboStr(keymap.connectArrow) + ')';
  $('btnSearch').title = '검색 (Ctrl+F)';
}
const comboMatch = (e, c, physicalKey = false) =>
  (e.key.toLowerCase() === c.key.toLowerCase() || (physicalKey && e.code === 'Key' + c.key.toUpperCase())) &&
  e.ctrlKey === c.ctrl && e.altKey === c.alt && e.shiftKey === c.shift;

const domRefs = createDomRefs(document, EDITOR_DOM_IDS);
const $ = id => domRefs.get(id);
const viewer = $('viewer'), sidebar = $('sidebar');
const fontPickerController = createFontPicker({
  catalog: fontCatalog,
  fonts: FONTS,
  controls: [
    { select: $('tbFont'), button: $('tbFontButton'), label: $('tbFontLabel') },
    { select: $('stFont'), button: $('stFontButton'), label: $('stFontLabel') },
  ],
  panel: $('fontPicker'),
  searchInput: $('fontPickerSearch'),
  categorySelect: $('fontPickerCategory'),
  list: $('fontPickerList'),
  count: $('fontPickerCount'),
  closeButton: $('fontPickerClose'),
  languageButtons: [...$('fontPickerTabs').querySelectorAll('[data-font-language]')],
  ensureFont: ensureScreenFont,
  ensureTitleFont,
  getFontRequest: control => {
    const object = selText?.obj;
    const isShapeText = control?.select === $('stFont');
    return {
      characters: isShapeText
        ? (isConnectableShape(object) ? object.text || '' : '')
        : (isTextObj(object) ? object.text || '' : ''),
      bold: isShapeText ? !!object?.bold
        : (isTextObj(object) ? !!object.bold : !!origTextSel &&
          (origTextSel.weight >= 600 || /bold|heavy|black/i.test(origTextSel.fam))),
    };
  },
  documentObject: document,
  windowObject: window,
  storage: localStorage,
  onLoadError: () => toast('글꼴을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', 3500),
});
let desktopCanSaveInPlace = false;
function syncSaveButtons() {
  $('btnSave').hidden = desktopViewMode && !!editorStore.activeDocument && !desktopCanSaveInPlace;
  $('btnSaveAs').hidden = !desktopViewMode;
}
syncSaveButtons();
function handleGlobalCtrlWheel(e) { if (e.ctrlKey) e.preventDefault(); }
let focusArea = 'viewer';
function focusSidebar() { focusArea = 'sidebar'; }
function focusViewer(event) {
  focusArea = 'viewer';
  const focused = document.activeElement;
  if (event?.target instanceof Element && event.target.closest('.obj, .origBox') &&
      focused instanceof HTMLElement && !focused.contains(event.target) &&
      (focused.matches('input, textarea, select') || focused.isContentEditable)) focused.blur();
}
let pendingClipboardCopy = null;
function runClipboardCopy(operation) {
  const previous = pendingClipboardCopy;
  const task = { promise: null };
  pendingClipboardCopy = task;
  try {
    task.promise = Promise.resolve(previous ? previous.promise.catch(() => {}).then(operation) : operation())
      .finally(() => { if (pendingClipboardCopy === task) pendingClipboardCopy = null; });
  } catch (error) {
    pendingClipboardCopy = previous;
    throw error;
  }
  return task.promise;
}
async function waitForClipboardCopy() {
  let succeeded = true;
  while (pendingClipboardCopy) succeeded = (await pendingClipboardCopy.promise) === true;
  return succeeded;
}
function copyCurrentSelection(cut) {
  if (focusArea === 'sidebar') {
    if (editorStore.selectedPages.size) return copyPagesToClip(cut);
    return;
  }
  if (hasMixedSelection()) return origCopyToClip(cut);
  if (selText) return copyObj(cut);
  if (origSels.length) return origCopyToClip(cut);
}

const escHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uiText = value => window.DaydayPDFI18n && window.DaydayPDFI18n.language !== 'ko'
  ? window.DaydayPDFI18n.t(String(value))
  : String(value);
const setUiText = (element, value) => window.DaydayPDFI18n?.setText
  ? window.DaydayPDFI18n.setText(element, value)
  : (element.textContent = uiText(value));
const setUiAttribute = (element, name, value) => window.DaydayPDFI18n?.setAttribute
  ? window.DaydayPDFI18n.setAttribute(element, name, value)
  : element.setAttribute(name, uiText(value));
function toast(msg, ms = 2200) {
  const t = $('toast'); setUiText(t, msg); t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), ms);
}

const mobileButtonTip = document.createElement('div');
mobileButtonTip.id = 'mobileButtonTip';
mobileButtonTip.setAttribute('role', 'tooltip');
document.body.appendChild(mobileButtonTip);
let mobileTipPress = null;
let mobileTipHideTimer = 0;
let mobileTipSuppressButton = null;
let mobileTipSuppressUntil = 0;
const mobileTipEnabled = () => matchMedia('(max-width: 768px)').matches;
function hideMobileButtonTip() {
  clearTimeout(mobileTipHideTimer);
  mobileButtonTip.classList.remove('show');
}
function showMobileButtonTip(button) {
  const label = button.title.trim();
  if (!label) return;
  clearTimeout(mobileTipHideTimer);
  mobileButtonTip.textContent = label;
  mobileButtonTip.classList.add('show');
  const br = button.getBoundingClientRect();
  const tr = mobileButtonTip.getBoundingClientRect();
  const left = Math.max(10, Math.min(innerWidth - tr.width - 10, br.left + (br.width - tr.width) / 2));
  const above = br.top - tr.height - 9;
  mobileButtonTip.style.left = Math.round(left) + 'px';
  mobileButtonTip.style.top = Math.round(above >= 8 ? above : Math.min(innerHeight - tr.height - 8, br.bottom + 9)) + 'px';
}
function handleMobileTipPointerDown(e) {
  if (e.pointerType !== 'touch' || !mobileTipEnabled()) return;
  const button = e.target instanceof Element ? e.target.closest('button[title]') : null;
  if (!button || !button.title.trim()) return;
  if (button.closest('#textBar, #shapeTextBar')) return;
  hideMobileButtonTip();
  const press = { button, x: e.clientX, y: e.clientY, shown: false, timer: 0 };
  press.timer = setTimeout(() => {
    if (mobileTipPress !== press) return;
    press.shown = true;
    mobileTipSuppressButton = button;
    mobileTipSuppressUntil = Date.now() + 1000;
    showMobileButtonTip(button);
    navigator.vibrate?.(12);
  }, 520);
  mobileTipPress = press;
}
function handleMobileTipPointerMove(e) {
  const press = mobileTipPress;
  if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 10) return;
  if (press.shown) return;
  clearTimeout(press.timer);
  mobileTipPress = null;
  hideMobileButtonTip();
}
function handleMobileTipPointerUp() {
  const press = mobileTipPress;
  if (!press) return;
  clearTimeout(press.timer);
  mobileTipPress = null;
  if (press.shown) {
    mobileTipSuppressUntil = Date.now() + 600;
    mobileTipHideTimer = setTimeout(hideMobileButtonTip, 1800);
  }
}
function handleMobileTipPointerCancel() {
  if (mobileTipPress) clearTimeout(mobileTipPress.timer);
  mobileTipPress = null;
  hideMobileButtonTip();
}
function handleMobileTipClick(e) {
  if (!mobileTipSuppressButton || Date.now() > mobileTipSuppressUntil) return;
  if (e.target instanceof Node && mobileTipSuppressButton.contains(e.target)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  mobileTipSuppressButton = null;
}
function handleMobileTipContextMenu(e) {
  const button = e.target instanceof Element ? e.target.closest('button[title]') : null;
  if (button && mobileTipEnabled()) e.preventDefault();
}

const desktopTabTip = document.createElement('div');
desktopTabTip.id = 'desktopTabTip';
desktopTabTip.setAttribute('role', 'tooltip');
document.body.appendChild(desktopTabTip);
const DESKTOP_TAB_TIP_DELAY_MS = 700;
let desktopTabTipTimer = 0;
let desktopTabTipTarget = null;
function documentTabFileName(documentState) {
  const value = String(documentState?.sourceFileName || documentState?.fileHandle?.name ||
    documentState?.name || 'document').trim() || 'document';
  return /\.pdf$/i.test(value) ? value : `${value}.pdf`;
}
function documentTabFilePath(documentState) {
  return typeof documentState?.sourcePath === 'string' ? documentState.sourcePath.trim() : '';
}
function appendDesktopTabTipRow(label, value, muted = false) {
  const row = document.createElement('div');
  row.className = 'desktopTabTipRow';
  const key = document.createElement('span');
  key.className = 'desktopTabTipLabel';
  setUiText(key, label);
  const content = document.createElement('span');
  content.className = 'desktopTabTipValue' + (muted ? ' muted' : '');
  content.textContent = value;
  row.append(key, content);
  desktopTabTip.appendChild(row);
}
function hideDesktopTabTip() {
  clearTimeout(desktopTabTipTimer);
  desktopTabTipTimer = 0;
  desktopTabTipTarget?.removeAttribute('aria-describedby');
  desktopTabTipTarget = null;
  desktopTabTip.classList.remove('show');
}
function showDesktopTabTip(tab, documentState) {
  if (!tab.isConnected || matchMedia('(max-width: 768px)').matches) {
    hideDesktopTabTip();
    return;
  }
  desktopTabTip.replaceChildren();
  appendDesktopTabTipRow('파일명', documentTabFileName(documentState));
  const path = documentTabFilePath(documentState);
  appendDesktopTabTipRow(
    '경로',
    path || uiText('브라우저 보안상 폴더 경로를 확인할 수 없습니다.'),
    !path,
  );
  desktopTabTip.classList.add('show');
  tab.setAttribute('aria-describedby', desktopTabTip.id);
  const tabRect = tab.getBoundingClientRect();
  const tipRect = desktopTabTip.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - tipRect.width - 8, tabRect.left));
  const below = tabRect.bottom + 7;
  const top = below + tipRect.height <= innerHeight - 8
    ? below : Math.max(8, tabRect.top - tipRect.height - 7);
  desktopTabTip.style.left = Math.round(left) + 'px';
  desktopTabTip.style.top = Math.round(top) + 'px';
}
function queueDesktopTabTip(tab, documentState) {
  if (desktopTabTipTarget === tab || matchMedia('(max-width: 768px)').matches) return;
  hideDesktopTabTip();
  desktopTabTipTarget = tab;
  desktopTabTipTimer = setTimeout(() => {
    desktopTabTipTimer = 0;
    if (desktopTabTipTarget === tab) showDesktopTabTip(tab, documentState);
  }, DESKTOP_TAB_TIP_DELAY_MS);
}

const MOBILE_LONG_PRESS_MS = 480;
let mobileContextPress = null;
let mobileContextSuppressTarget = null;
let mobileContextSuppressUntil = 0;
function cancelMobileContextPress() {
  if (mobileContextPress?.fired) { $('objMenu').style.display = 'none'; $('ctxMenu').style.display = 'none'; }
  clearTimeout(mobileContextPress?.timer);
  mobileContextPress = null;
}
function blankContextPage(target) {
  if (!windowsAccess.current.canEditCurrentDocuments || document.body.classList.contains('drawingMode') || shapeDraft || regionMode || stampData || connectorPickMode || spacePan) return null;
  if (!(target instanceof Element) || target.isContentEditable ||
      target.closest('.obj, .origBox, .objHandle, .oh, .origEdit, .pdfLink, input, textarea, button, a, [contenteditable="true"]')) return null;
  const wrap = target.closest('.pageWrap');
  return wrap && viewer.contains(wrap) && editorStore.pages[+wrap.dataset.k] ? wrap : null;
}
function handleMobileContextPointerDown(e) {
  cancelMobileContextPress();
  mobileContextSuppressTarget = null;
  mobileContextSuppressUntil = 0;
  if (!windowsAccess.current.canEditCurrentDocuments || e.pointerType !== 'touch' || !e.isPrimary) return;
  const element = e.target instanceof Element ? e.target : null;
  if (!element || element.isContentEditable || element.closest('.objHandle, .oh, [contenteditable="true"]')) return;
  const target = element.closest('.obj, .origBox') || blankContextPage(element);
  if (!target) return;
  const press = { target, pointerId: e.pointerId, x: e.clientX, y: e.clientY, fired: false, timer: 0,
    document: editorStore.activeDocument };
  press.timer = setTimeout(() => {
    if (mobileContextPress !== press || !target.isConnected || !windowsAccess.current.canEditCurrentDocuments ||
        press.document !== editorStore.activeDocument) return;
    press.fired = true;
    finishObjectDrag?.();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, view: window, clientX: press.x, clientY: press.y,
    }));
    try { navigator.vibrate?.(10); } catch {}
  }, MOBILE_LONG_PRESS_MS);
  mobileContextPress = press;
}
function handleMobileContextPointerMove(e) {
  const press = mobileContextPress;
  if (!press || e.pointerId !== press.pointerId) return;
  if (press.fired) {
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelMobileContextPress();
}
function handleMobileContextPointerEnd(e) {
  const press = mobileContextPress;
  if (!press || e.pointerId !== press.pointerId) return;
  if (press.fired) {
    mobileContextSuppressTarget = press.target;
    mobileContextSuppressUntil = Date.now() + 650;
    if (e.cancelable) e.preventDefault();
  }
  clearTimeout(press.timer);
  mobileContextPress = null;
}
function handleMobileContextClick(e) {
  if (!mobileContextSuppressTarget || Date.now() > mobileContextSuppressUntil) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  mobileContextSuppressTarget = null;
}
function spin(on, msg) {
  $('spinnerMsg').textContent = msg || '처리 중...';
  $('spinner').classList.toggle('show', !!on);
}
function beginClipboardBusy(message, delay = 200) {
  let applied = false, finished = false;
  const previousCursor = document.body.style.cursor;
  const timer = setTimeout(() => {
    if (finished) return;
    applied = true;
    viewer.setAttribute('aria-busy', 'true');
    viewer.dataset.busyMessage = message;
    document.body.style.cursor = 'progress';
  }, delay);
  return () => {
    finished = true;
    clearTimeout(timer);
    if (!applied) return;
    viewer.removeAttribute('aria-busy');
    delete viewer.dataset.busyMessage;
    document.body.style.cursor = previousCursor;
  };
}
function hexToRgb01(hex) {
  return rgb(...hexToRgbComponents(hex));
}
function makeSnap() {
  return {
    pages: editorStore.pages.map(p => {
      const copy = clonePage(p);
      pageViews.set(copy, viewsForPage(p));
      return copy;
    }),
    atSavedState: snapshotSaveCheckpoint(editorStore.activeDocument),
  };
}
function viewerAnchor() {
  const vr = viewer.getBoundingClientRect();
  for (const w of viewer.querySelectorAll('.pageWrap')) {
    if (w.style.display === 'none') continue;
    const r = w.getBoundingClientRect();
    if (r.bottom > vr.top) return { k: +w.dataset.k, off: vr.top - r.top, left: viewer.scrollLeft };
  }
  return null;
}
function restoreViewerAnchor(a) {
  if (!a) return;
  const w = document.getElementById('pg' + a.k);
  if (!w || w.style.display === 'none') return;
  const off = viewer.getBoundingClientRect().top - w.getBoundingClientRect().top;
  viewer.scrollTop += a.off - off;
  viewer.scrollLeft = a.left;
}
function applySnap(s) {
  const anchor = viewerAnchor();
  const mkey = p => (p.src || 'b') + ':' + p.idx + ':' + p.rot + ':' +
    (p.resize ? p.resize.join('x') : '') + ':' + (p.crop ? p.crop.join(',') : '') + ':' +
    (p.blank ? p.blank.join('x') : '');
  const meas = new Map();
  editorStore.pages.forEach(p => { if (p._w1) meas.set(mkey(p), [p._w1, p._h1]); });
  s.pages.forEach(p => {
    if (p._w1) return;
    const m = meas.get(mkey(p));
    if (m) { p._w1 = m[0]; p._h1 = m[1]; }
  });
  editorStore.pages = s.pages;
  const dirtyChanged = restoreSaveCheckpoint(editorStore.activeDocument, s);
  editorStore.selectedPages = new Set([...editorStore.selectedPages].filter(i => i < editorStore.pages.length));
  updateUndoButtons();
  if (typeof origClearSel === 'function') {
    origClearSel();
    if (origMode) { origClearGhosts(); }
  }
  if (selText) deselectText(false);  
  rebuildAll();
  restoreViewerAnchor(anchor);
  requestAnimationFrame(() => restoreViewerAnchor(anchor));
  scheduleAutosave();
  if (dirtyChanged) renderTabs();
  if (origMode) origDecorateVisible();
}
function markActiveDocumentChanged() {
  if (markChanged(editorStore.activeDocument)) renderTabs();
}
function pushSnap(s) {
  const pn = takePendingNudge();
  if (pn) editorStore.undoStack.push(pn.snap);
  markActiveDocumentChanged();
  editorStore.undoStack.push(s);
  if (editorStore.undoStack.length > 50) { editorStore.undoStack.shift(); scheduleSrcSweep(); }
  if (editorStore.redoStack.length) scheduleSrcSweep();
  editorStore.redoStack.length = 0;
  updateUndoButtons();
  scheduleAutosave();
}
function pushUndo() { pushSnap(makeSnap()); }
function undo() {
  if (!requireWindowsEdit()) return;
  const editing = pendingObjectEdits();
  if (editing) {
    const doc = editorStore.activeDocument;
    return editing.then(() => { if (editorStore.activeDocument === doc) undo(); });
  }
  commitPendingNudge();  
  if (!editorStore.undoStack.length) return;
  editorStore.redoStack.push(makeSnap());
  applySnap(editorStore.undoStack.pop());
  toast('실행 취소');
}
function redo() {
  if (!requireWindowsEdit()) return;
  const editing = pendingObjectEdits();
  if (editing) {
    const doc = editorStore.activeDocument;
    return editing.then(() => { if (editorStore.activeDocument === doc) redo(); });
  }
  commitPendingNudge();  
  if (!editorStore.redoStack.length) return;
  editorStore.undoStack.push(makeSnap());
  applySnap(editorStore.redoStack.pop());
  toast('다시 실행');
}
function updateUndoButtons() {
  $('btnUndo').disabled = editorStore.undoStack.length === 0;
  $('btnRedo').disabled = editorStore.redoStack.length === 0;
  applyWindowsAccessUi();
  publishDesktopHistoryState();
}

function newDoc(name) {
  return documentModel.createDocument(++docSeq, name);
}
function resetTransientEditState() {
  stopDrawing();
  try { deselectText(true); } catch {}     
  try { origClearSel(); } catch {}         
  try { origClearGhosts(); } catch {}
  try { cancelRegion(); } catch {}         
  try { commitPendingNudge(); } catch {}
  if (typeof stopShapeDraft === 'function') stopShapeDraft();
  if (typeof stopConnectorPickMode === 'function') stopConnectorPickMode();
  if (typeof multiPickMode !== 'undefined' && multiPickMode) {
    multiPickMode = false;
    document.body.classList.remove('multiPick');
  }
  setTextMode(false);
}
function switchDoc(d) {
  if (d && editorStore.activeDocument === d) { renderTabs(); return; }
  resetTransientEditState();
  updateCurrentPage();
  rememberPageView();
  editorStore.captureActiveScroll(viewer.scrollTop);
  rememberThumbnailView();
  cancelPendingViewFit();
  const revision = ++documentViewRevision;
  editorStore.activeDocument = d;
  if (d) {
    restoreThumbnailView(d);
    if (!d.redoStack) d.redoStack = [];
    $('dropHint').style.display = 'none';
    setButtons(true);
    updateUndoButtons();
    const needsInitialFit = !d.fitDone;
    if (needsInitialFit) editorStore.fitWidth = false;
    rebuildAll();
    if (needsInitialFit) doFitPage(true);
    else if (!restorePageView()) {
      const restoredScrollTop = Math.max(0, +d.scrollTop || 0);
      viewer.scrollTop = restoredScrollTop;
      requestAnimationFrame(() => {
        if (revision === documentViewRevision && editorStore.activeDocument === d)
          viewer.scrollTop = restoredScrollTop;
      });
    }
  } else {
    rebuildAll();
    $('dropHint').style.display = '';
    setButtons(false);
  }
  renderTabs();
  scheduleAutosave();
}
let closeDocResolve = null;
function confirmCloseMessage(message, canSaveInPlace = desktopViewMode ? desktopCanSaveInPlace : !!editorStore.fileHandle) {
  if (closeDocResolve) return Promise.resolve('cancel');
  const pending = new Promise(resolve => { closeDocResolve = resolve; });
  $('closeDocMessage').textContent = message;
  $('closeDocSave').hidden = !canSaveInPlace;
  $('closeDocSaveAs').classList.toggle('primary', !canSaveInPlace);
  $('closeDocOverlay').classList.add('show');
  $(canSaveInPlace ? 'closeDocSave' : 'closeDocSaveAs').focus();
  return pending;
}
function finishCloseDocConfirm(choice) {
  if (!closeDocResolve) return;
  const resolve = closeDocResolve;
  closeDocResolve = null;
  $('closeDocOverlay').classList.remove('show');
  resolve(choice === 'save' && $('closeDocSave').hidden ? 'save-as' : choice);
}
function handleCloseDocKeydown(e) {
  if (!closeDocResolve || e.ctrlKey || e.metaKey || e.altKey) return;
  const choices = { y: 'save', a: 'save-as', n: 'discard', x: 'cancel', escape: 'cancel' };
  const key = e.key.toLowerCase();
  const choice = Object.hasOwn(choices, key) ? choices[key] :
    (/^Key[YANX]$/.test(e.code) ? choices[e.code.slice(3).toLowerCase()] : null);
  if (!choice) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) finishCloseDocConfirm(choice);
}

let safeSaveResolve = null;
function confirmSafeCopySave(fileName) {
  if (safeSaveResolve) return Promise.resolve(false);
  const english = document.documentElement.lang === 'en';
  $('safeSaveTitle').textContent = english ? 'Save a safe copy' : '안전 사본으로 저장';
  $('safeSaveMessage').textContent = english
    ? `The original file could not be saved. It may be open in another program.\n\nA safe copy will be saved as "${fileName}".`
    : `원본 파일에 저장하지 못했습니다.\n파일이 다른 프로그램에서 사용 중이면 저장이 실패할 수 있습니다.\n\n안전하게 "${fileName}"로 저장합니다.`;
  $('safeSaveCancel').textContent = english ? 'Cancel' : '취소';
  $('safeSaveOk').textContent = english ? 'Save safe copy' : '안전하게 저장';
  $('safeSaveOverlay').classList.add('show');
  setTimeout(() => $('safeSaveOk').focus(), 0);
  return new Promise(resolve => { safeSaveResolve = resolve; });
}
function finishSafeCopySave(ok) {
  if (!safeSaveResolve) return;
  const resolve = safeSaveResolve;
  safeSaveResolve = null;
  $('safeSaveOverlay').classList.remove('show');
  resolve(ok);
}
function handleSafeSaveKeydown(e) {
  if (e.key !== 'Escape' && e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  finishSafeCopySave(e.key === 'Enter');
}
let closingEditedDocument = null;
async function closeDoc(d, ev) {
  if (ev) ev.stopPropagation();
  if (d.dirty) {
    if (closeDocResolve || closingEditedDocument || !editorStore.documents.includes(d)) return false;
    closingEditedDocument = d;
    try {
      if (editorStore.activeDocument !== d) switchDoc(d);
      const choice = await confirmCloseMessage('"' + d.name + '"\n' + uiText('변경 사항을 저장하시겠습니까?'));
      if (choice === 'cancel' || editorStore.activeDocument !== d) return false;
      if (choice !== 'discard') {
        const as = choice === 'save-as';
        const saved = desktopViewMode
          ? await new Promise(resolve => saveDesktop(as, { onComplete: resolve }))
          : await saveAs({ forClose: true, useCurrentHandle: !as });
        if (!saved || d.dirty || editorStore.activeDocument !== d) return false;
      }
    } finally { closingEditedDocument = null; }
  }
  const i = editorStore.documents.indexOf(d);
  if (i < 0) return;
  const wasActive = editorStore.activeDocument === d;
  const next = wasActive
    ? (editorStore.documents[i + 1] || editorStore.documents[i - 1] || null) : null;
  if (wasActive) switchDoc(next);
  editorStore.documents.splice(i, 1);
  editorStore.selectedDocuments.delete(d);
  if (editorStore.tabSelectionAnchor === d) editorStore.tabSelectionAnchor = null;
  sweepSources();
  renderTabs();
  scheduleAutosave();
  return true;
}

const detachTransfers = new Map();
function serializeDetachedDoc(d) {
  if (d === editorStore.activeDocument) editorStore.captureActiveScroll(viewer.scrollTop);
  return toDetachedDocumentDto(d);
}
function makeDetachPayload(docList) {
  const list = docList.filter(d => editorStore.documents.includes(d));
  if (!list.length) throw new Error('분리할 문서가 없습니다');
  if (list.includes(editorStore.activeDocument)) editorStore.captureActiveScroll(viewer.scrollTop);
  const used = new Set();
  list.forEach(d => {
    collectSourceRefs(d.pages, used);
    (d.undoStack || []).forEach(s => collectSourceRefs(s.pages || [], used));
    (d.redoStack || []).forEach(s => collectSourceRefs(s.pages || [], used));
  });
  const srcList = [...used].map(id => {
    const s = sources.get(id);
    if (!s || !s.bytes) throw new Error('PDF 원본 데이터를 찾을 수 없습니다');
    return { id, name: s.name, bytes: s.bytes };
  });
  return {
    docs: list.map(serializeDetachedDoc),
    active: Math.max(0, list.indexOf(editorStore.activeDocument)),
    sources: srcList
  };
}
function removeTransferredDocs(docList) {
  const removing = new Set(docList.filter(d => editorStore.documents.includes(d)));
  if (!removing.size) return 0;
  const firstIndex = editorStore.documents.findIndex(d => removing.has(d));
  const activeRemoved = removing.has(editorStore.activeDocument);
  const remaining = editorStore.documents.filter(d => !removing.has(d));
  if (activeRemoved) switchDoc(editorStore.lastViewed(remaining) || remaining[Math.max(0, firstIndex - 1)] || remaining[0] || null);
  for (let i = editorStore.documents.length - 1; i >= 0; i--) if (removing.has(editorStore.documents[i])) editorStore.documents.splice(i, 1);
  removing.forEach(d => editorStore.selectedDocuments.delete(d));
  if (removing.has(editorStore.tabSelectionAnchor)) editorStore.tabSelectionAnchor = null;
  renderTabs();
  sweepSources();
  scheduleAutosave();
  return removing.size;
}
function finishDetachedTransfer(token, ok, reason) {
  const rec = detachTransfers.get(token);
  if (!rec) return false;
  detachTransfers.delete(token);
  clearInterval(rec.watch);
  if (!ok) {
    toast('새 창 분리 실패: ' + String(reason || '문서를 열지 못했습니다').slice(0, 70), 4000);
    return false;
  }
  if (!removeTransferredDocs(rec.docs)) return true;
  const where = matchMedia('(max-width: 768px)').matches ? '새 탭' : '새 창';
  toast(rec.docs.length > 1 ? rec.docs.length + '개 문서를 ' + where + '에서 열었습니다' : where + '으로 분리했습니다');
  return true;
}
windowTransfer.setClaimHandler(token => {
  const rec = detachTransfers.get(String(token));
  if (!rec) return null;
  rec.claimed = true;
  return rec.payload;
});
windowTransfer.setFinishHandler(finishDetachedTransfer);

function detachDocsToWindow(docList, fromDrag = false, dropPoint = null) {
  const list = editorStore.documents.filter(d => docList.includes(d));
  if (!list.length) return false;
  if (list.length >= editorStore.documents.length) {
    toast('현재 창의 마지막 탭은 새 창으로 분리할 수 없습니다', 3500);
    return false;
  }
  if ([...detachTransfers.values()].some(r => r.docs.some(d => list.includes(d)))) return true;
  if (fromDrag && navigator.userActivation && !navigator.userActivation.isActive) {
    toast('새 창이 차단되었습니다 — 탭 우클릭 → 새 창에서 열기를 사용하세요', 4200);
    return false;
  }
  let payload;
  try { payload = makeDetachPayload(list); }
  catch (e) { toast('새 창 분리 실패: ' + (e.message || e), 4000); return false; }
  const token = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const url = new URL(location.href);
  url.searchParams.set('detached', token);
  const areaLeft = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
  const areaTop = Number.isFinite(screen.availTop) ? screen.availTop : 0;
  const width = Math.max(760, Math.min(screen.availWidth, Math.round(window.outerWidth * .88)));
  const height = Math.max(560, Math.min(screen.availHeight, Math.round(window.outerHeight * .88)));
  const wantedLeft = dropPoint && Number.isFinite(dropPoint.screenX)
    ? dropPoint.screenX - Math.min(140, Math.round(width * .16)) : (window.screenX || areaLeft) + 48;
  const wantedTop = dropPoint && Number.isFinite(dropPoint.screenY)
    ? dropPoint.screenY - 18 : (window.screenY || areaTop) + 48;
  const left = Math.max(areaLeft, Math.min(areaLeft + screen.availWidth - width, wantedLeft));
  const top = Math.max(areaTop, Math.min(areaTop + screen.availHeight - height, wantedTop));
  const rec = { docs: list, payload, claimed: false, popup: null, watch: 0 };
  detachTransfers.set(token, rec);
  try {
    const mobile = matchMedia('(max-width: 768px)').matches;
    const windowName = 'pdfEditorDetached_' + token;
    if (mobile && !/^https?:$/.test(location.protocol)) {
      rec.popup = windowTransfer.open('', windowName);
      if (rec.popup) {
        rec.popup.document.open();
        rec.popup.document.write(PDF_EDITOR_BOOT_HTML);
        rec.popup.document.close();
      }
    } else if (mobile) {
      rec.popup = windowTransfer.open(url.href, windowName);
    } else {
      rec.popup = windowTransfer.open(url.href, windowName,
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    }
  } catch (e) {
    detachTransfers.delete(token);
    toast('새 창이 차단되었습니다 — 주소창의 팝업 허용을 확인하세요', 4200);
    return false;
  }
  if (!rec.popup) {
    detachTransfers.delete(token);
    toast('새 창이 차단되었습니다 — 주소창의 팝업 허용을 확인하세요', 4200);
    return false;
  }
  rec.watch = setInterval(() => {
    if (!rec.popup.closed) return;
    clearInterval(rec.watch);
    if (detachTransfers.delete(token)) toast('새 창 분리를 취소했습니다');
  }, 600);
  return true;
}
function detachDocToWindow(d, fromDrag = false, dropPoint = null) {
  const list = editorStore.selectedDocuments.has(d) ? editorStore.documents.filter(x => editorStore.selectedDocuments.has(x)) : [d];
  return detachDocsToWindow(list, fromDrag, dropPoint);
}
let mergeToOpenerBusy = false;
function connectedMergeOpener() {
  return windowTransfer.connectedReceiver();
}
async function mergeDocsToOpener(d) {
  if (mergeToOpenerBusy) return false;
  const parent = connectedMergeOpener();
  if (!detachToken || !parent) {
    toast('원래 편집기 창과 연결되어 있지 않습니다', 3500);
    return false;
  }
  const list = editorStore.selectedDocuments.has(d) ? editorStore.documents.filter(x => editorStore.selectedDocuments.has(x)) : [d];
  if (!list.length) return false;
  let payload;
  try { payload = makeDetachPayload(list); }
  catch (e) { toast('창 합치기 실패: ' + (e.message || e), 4000); return false; }

  mergeToOpenerBusy = true;
  try {
    const ok = await windowTransfer.receiveDocuments(parent, payload);
    if (!ok) throw new Error('원래 창에서 문서를 받지 못했습니다');
    const moved = removeTransferredDocs(list);
    if (!moved) return false;
    if (!editorStore.documents.length) {
      clearTimeout(autosaveTimer);
      autosavePending = false;
      await clearAutosave();
      setTimeout(() => window.close(), 80);
    } else {
      toast(moved > 1 ? moved + '개 문서를 원래 창으로 합쳤습니다' : '문서를 원래 창으로 합쳤습니다');
    }
    try { parent.focus(); } catch {}
    return true;
  } catch (e) {
    console.error(e);
    toast('창 합치기 실패: ' + (e.message || e).toString().slice(0, 70), 4200);
    return false;
  } finally { mergeToOpenerBusy = false; }
}

let moveToPeerBusy = false;
async function moveDocumentListToPeer(docList, targetId, targetIndex = null) {
  if (moveToPeerBusy || !windowPeers.supported) return false;
  const target = windowPeers.peers().find(peer => peer.id === targetId);
  if (!target) {
    toast('대상 PC 창과 연결되어 있지 않습니다', 3500);
    return false;
  }
  const list = editorStore.documents.filter(document => docList.includes(document));
  if (!list.length) return false;
  let payload;
  try { payload = makeDetachPayload(list); }
  catch (e) { toast('창 이동 실패: ' + (e.message || e), 4000); return false; }
  if (Number.isFinite(targetIndex)) payload.targetIndex = Math.max(0, Math.floor(targetIndex));

  moveToPeerBusy = true;
  try {
    await windowPeers.transferDocuments(targetId, payload);
    const moved = removeTransferredDocs(list);
    if (!moved) return false;
    windowPeers.focus(targetId);
    if (!editorStore.documents.length) {
      clearTimeout(autosaveTimer);
      autosavePending = false;
      await clearAutosave();
      setTimeout(() => window.close(), 80);
    } else {
      toast(moved > 1
        ? `${moved}개 문서를 ${target.title}(으)로 옮겼습니다`
        : `문서를 ${target.title}(으)로 옮겼습니다`);
    }
    return true;
  } catch (e) {
    console.error(e);
    toast('창 이동 실패: ' + (e.message || e).toString().slice(0, 70), 4200);
    return false;
  } finally { moveToPeerBusy = false; }
}

async function moveDocsToPeer(d, targetId) {
  const list = editorStore.selectedDocuments.has(d)
    ? editorStore.documents.filter(x => editorStore.selectedDocuments.has(x)) : [d];
  return moveDocumentListToPeer(list, targetId);
}

async function sendDraggedDocsToPeer(documentIds, target) {
  const wanted = new Set((documentIds || []).map(String));
  const list = editorStore.documents.filter(document => wanted.has(String(document.id)));
  if (!list.length) throw new Error('원본 창에서 옮길 탭을 찾지 못했습니다');
  return moveDocumentListToPeer(list, target.id, target.targetIndex);
}

let mgItems = [];
let mgPendingItems = [];
function sweepSources() {
  const used = new Set();
  const collect = list => collectSourceRefs(list, used);  
  editorStore.documents.forEach(d => {
    collect(d.pages);
    (d.undoStack || []).forEach(s => collect(s.pages));
    (d.redoStack || []).forEach(s => collect(s.pages));
  });
  for (const item of [...mgItems, ...mgPendingItems]) if (item.pages) collect(item.pages);
  if (clipboard) collect(clipboard);
  if (stampData?.clip) used.add(stampData.clip.src);
  for (const object of objectClipboardItems(objClip))
    if (object.clipSrc && sources.has(object.clipSrc)) used.add(object.clipSrc);
  for (const id of [...sources.keys()]) {
    if (id < 0 || used.has(id)) continue;
    const s = sources.get(id);
    try { if (s.loading) s.loading.destroy().catch(() => {}); else s.doc?.destroy?.(); } catch {}
    renderCoordinator.invalidateSource(id);
    thumbnailCoordinator.invalidateSource(id);
    displayPainter.invalidateSource(id);
    sources.delete(id); libDocCache.delete(id);
  }
}
let srcSweepTimer = null;
function scheduleSrcSweep() { clearTimeout(srcSweepTimer); srcSweepTimer = setTimeout(sweepSources, 3000); }

function closeTabList() { $('tabList').classList.remove('show'); }
function positionTabList() {
  const menu = $('tabList'), anchor = $('btnTabList').getBoundingClientRect();
  const w = menu.offsetWidth || Math.min(340, window.innerWidth * .92);
  menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, anchor.right - w)) + 'px';
  menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, anchor.bottom + 4) + 'px';
}
function renderTabList() {
  const menu = $('tabList');
  menu.innerHTML = '';
  editorStore.documents.forEach(d => {
    const row = document.createElement('div');
    row.className = 'tabListItem' + (d === editorStore.activeDocument ? ' active' : '');
    row.title = d.name + '.pdf';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = d.name + '.pdf';
    const dirty = d.dirty ? Object.assign(document.createElement('span'), { className: 'dirtyDot' }) : null;
    const x = document.createElement('button');
    x.className = 'close'; x.type = 'button'; x.textContent = '×'; x.title = '문서 닫기';
    x.onclick = ev => { ev.stopPropagation(); closeDoc(d, ev); };
    row.onclick = () => { editorStore.selectedDocuments.clear(); editorStore.tabSelectionAnchor = d; switchDoc(d); closeTabList(); };
    row.append(...(dirty ? [dirty, nm, x] : [nm, x]));
    menu.appendChild(row);
  });
  if (!editorStore.documents.length) closeTabList();
}

function selectDocumentTab(d, ev) {
  if (ev.shiftKey) {
    const anchor = editorStore.documents.includes(editorStore.tabSelectionAnchor) ? editorStore.tabSelectionAnchor : (editorStore.activeDocument || d);
    const a = editorStore.documents.indexOf(anchor), b = editorStore.documents.indexOf(d);
    if (!ev.ctrlKey) editorStore.selectedDocuments.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) editorStore.selectedDocuments.add(editorStore.documents[i]);
    if (!editorStore.tabSelectionAnchor) editorStore.tabSelectionAnchor = anchor;
    renderTabs(false);
    return;
  }
  if (ev.ctrlKey) {
    if (editorStore.selectedDocuments.has(d)) editorStore.selectedDocuments.delete(d); else editorStore.selectedDocuments.add(d);
    editorStore.tabSelectionAnchor = d;
    renderTabs(false);
    return;
  }
  editorStore.selectedDocuments.clear();
  editorStore.tabSelectionAnchor = d;
  switchDoc(d);
}

function tabDragWantsDetach(tabRect, pointerY, gap = 30) {
  return pointerY <= tabRect.top - gap || pointerY >= tabRect.bottom + gap;
}

function publishNativeTabs() {
  const host = window.chrome?.webview;
  if (!host || !window.pdfEditorWindowsContext) return false;
  try {
    host.postMessage({
      type: 'native-tabs-state',
      bridgeVersion: 3,
      activeId: editorStore.activeDocument ? String(editorStore.activeDocument.id) : '',
      tabs: editorStore.documents.map(document => ({
        id: String(document.id),
        title: document.name,
        dirty: !!document.dirty,
      })),
    });
    return true;
  } catch { return false; }
}

function publishDesktopDocumentState() {
  if (!desktopViewMode) return false;
  const active = editorStore.activeDocument;
  const title = active?.name || '새 문서';
  const dirty = !!active?.dirty;
  const hasHistory = !!(active && (active.undoStack?.length || active.redoStack?.length));
  desktopHost.send({ type: 'titleChanged', apiVersion: 4, title });
  desktopHost.send({ type: 'dirtyChanged', apiVersion: 4, dirty, hasHistory });
  return desktopHost.send({
    type: 'document-state',
    apiVersion: 4,
    title,
    dirty,
    hasHistory,
    hasDocument: !!active,
    docPath: active?.docPath || null,
  });
}

function publishDesktopHistoryState() {
  if (!desktopViewMode) return false;
  const active = editorStore.activeDocument;
  return desktopHost.send({
    type: 'historyChanged',
    apiVersion: 4,
    hasHistory: !!(active && (active.undoStack?.length || active.redoStack?.length)),
  });
}

function nativeDocumentById(id) {
  return editorStore.documents.find(document => String(document.id) === String(id)) || null;
}

function activateNativeTab(id) {
  const documentState = nativeDocumentById(id);
  if (!documentState) return false;
  editorStore.selectedDocuments.clear();
  editorStore.tabSelectionAnchor = documentState;
  switchDoc(documentState);
  return true;
}

async function closeNativeTab(id) {
  const documentState = nativeDocumentById(id);
  if (!documentState) return false;
  await closeDoc(documentState);
  return !editorStore.documents.includes(documentState);
}

function moveNativeTab(id, requestedIndex) {
  const documentState = nativeDocumentById(id);
  if (!documentState) return false;
  const from = editorStore.documents.indexOf(documentState);
  let target = Math.max(0, Math.min(editorStore.documents.length, Math.floor(Number(requestedIndex) || 0)));
  editorStore.documents.splice(from, 1);
  if (target > from) target--;
  editorStore.documents.splice(Math.min(target, editorStore.documents.length), 0, documentState);
  renderTabs();
  scheduleAutosave();
  return true;
}

function detachNativeTab(id, screenX, screenY) {
  const documentState = nativeDocumentById(id);
  if (!documentState) return false;
  return detachDocsToWindow([documentState], false, {
    screenX: Number(screenX),
    screenY: Number(screenY),
  });
}

function requestNativeTabTransfer(sourceWindowId, documentIds, targetIndex) {
  if (!windowPeers.supported) return Promise.reject(new Error('PC 창 연결을 사용할 수 없습니다'));
  return windowPeers.requestDraggedDocuments(sourceWindowId, documentIds, targetIndex);
}

const TAB_DRAG_MIME = 'application/x-pdf-editor-tab';
const TAB_DRAG_TEXT_PREFIX = 'pdf-editor-tab-drag:';
let nativeTabDrag = null;

function draggedDocumentList(documentState) {
  return editorStore.selectedDocuments.has(documentState)
    ? editorStore.documents.filter(document => editorStore.selectedDocuments.has(document))
    : [documentState];
}

function parseTabDragData(dataTransfer) {
  if (!dataTransfer) return null;
  let raw = '';
  try { raw = dataTransfer.getData(TAB_DRAG_MIME); } catch {}
  if (!raw) {
    try {
      const text = dataTransfer.getData('text/plain');
      if (text.startsWith(TAB_DRAG_TEXT_PREFIX)) raw = text.slice(TAB_DRAG_TEXT_PREFIX.length);
    } catch {}
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.protocol !== 'pdf-editor-tab-drag' || value.version !== 1 ||
        !/^[a-z0-9-]{8,80}$/i.test(value.sourceWindowId || '') ||
        !Array.isArray(value.documentIds) || !value.documentIds.length) return null;
    return {
      sourceWindowId: value.sourceWindowId,
      documentIds: value.documentIds.slice(0, 100).map(String),
    };
  } catch { return null; }
}

function tabDragTypePresent(dataTransfer) {
  try { return [...(dataTransfer?.types || [])].includes(TAB_DRAG_MIME); }
  catch { return false; }
}

function tabDropIndex(clientX) {
  const tabs = [...$('tabStrip').querySelectorAll('.dtab')];
  let index = 0;
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) break;
    index++;
  }
  return index;
}

function clearTabDropTarget() {
  $('tabStrip').classList.remove('tabPeerDrop', 'tabPeerDropBusy');
  $('tabStrip').style.setProperty('--tab-drop-x', '0px');
}

function handleTabStripDragOver(event) {
  if (!windowPeers.supported || !tabDragTypePresent(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const strip = $('tabStrip');
  const index = tabDropIndex(event.clientX);
  const tabs = [...strip.querySelectorAll('.dtab')];
  const stripRect = strip.getBoundingClientRect();
  const x = index < tabs.length
    ? tabs[index].getBoundingClientRect().left - stripRect.left + strip.scrollLeft
    : (tabs.at(-1)?.getBoundingClientRect().right || stripRect.left) - stripRect.left + strip.scrollLeft;
  strip.style.setProperty('--tab-drop-x', `${Math.max(0, x)}px`);
  strip.classList.add('tabPeerDrop');
}

function handleTabStripDragLeave(event) {
  if (event.relatedTarget instanceof Node && $('tabStrip').contains(event.relatedTarget)) return;
  clearTabDropTarget();
}

async function handleTabStripDrop(event) {
  const transfer = parseTabDragData(event.dataTransfer);
  if (!transfer || !windowPeers.supported) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
  const dropIndex = tabDropIndex(event.clientX);
  const strip = $('tabStrip');
  strip.classList.add('tabPeerDropBusy');
  try {
    if (transfer.sourceWindowId === windowPeers.windowId) {
      const movingIds = new Set(transfer.documentIds);
      const moving = editorStore.documents.filter(document => movingIds.has(String(document.id)));
      if (!moving.length) return;
      const tabsBeforeDrop = [...strip.querySelectorAll('.dtab')];
      const beforeId = tabsBeforeDrop[dropIndex]?.dataset.documentId || null;
      const remaining = editorStore.documents.filter(document => !moving.includes(document));
      const beforeIndex = beforeId
        ? remaining.findIndex(document => String(document.id) === beforeId) : -1;
      const insertAt = beforeIndex >= 0 ? beforeIndex : remaining.length;
      editorStore.documents.splice(0, editorStore.documents.length, ...remaining);
      editorStore.documents.splice(insertAt, 0, ...moving);
      renderTabs();
      scheduleAutosave();
    } else {
      await windowPeers.requestDraggedDocuments(
        transfer.sourceWindowId,
        transfer.documentIds,
        dropIndex,
      );
    }
  } catch (error) {
    console.error(error);
    toast('탭 이동 실패: ' + (error?.message || error).toString().slice(0, 70), 4200);
  } finally { clearTabDropTarget(); }
}

function renderTabs(scrollActive = true) {
  hideDesktopTabTip();
  if (desktopViewMode) {
    publishDesktopDocumentState();
    return;
  }
  $('tabbar').classList.toggle('on', editorStore.documents.length > 0);
  $('tabCount').textContent = editorStore.documents.length > 99 ? '99+' : editorStore.documents.length;
  const tb = $('tabStrip');
  tb.innerHTML = '';
  editorStore.documents.forEach((d, index) => {
    const t = document.createElement('div');
    const beforeActive = editorStore.documents[index + 1] === editorStore.activeDocument;
    t.className = 'dtab' + (d === editorStore.activeDocument ? ' active' : '') +
      (beforeActive ? ' beforeActive' : '') +
      (editorStore.selectedDocuments.has(d) ? ' multiSelected' : '');
  t.dataset.documentId = String(d.id);
    t.setAttribute('aria-label', documentTabFileName(d));
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = d.name;
    const dirty = d.dirty ? Object.assign(document.createElement('span'), { className: 'dirtyDot' }) : null;
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = '×'; x.title = '탭 닫기 (휠클릭)';
    x.onclick = ev => closeDoc(d, ev);
    t.onclick = ev => { if (!t._dragJustEnded) selectDocumentTab(d, ev); };
    t.addEventListener('mousedown', ev => { if (ev.button === 1) ev.preventDefault(); });
    t.addEventListener('auxclick', ev => { if (ev.button === 1) { ev.preventDefault(); closeDoc(d, ev); } });
    if (windowPeers.supported) {
      t.draggable = true;
      t.addEventListener('dragstart', event => {
        const docs = draggedDocumentList(d);
        const descriptor = JSON.stringify({
          protocol: 'pdf-editor-tab-drag',
          version: 1,
          sourceWindowId: windowPeers.windowId,
          documentIds: docs.map(document => String(document.id)),
        });
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(TAB_DRAG_MIME, descriptor);
        event.dataTransfer.setData('text/plain', TAB_DRAG_TEXT_PREFIX + descriptor);
        nativeTabDrag = {
          document: d,
          lastScreenX: event.screenX,
          lastScreenY: event.screenY,
        };
        t.classList.add('nativeDragging');
      });
      t.addEventListener('drag', event => {
        if (!nativeTabDrag || (!event.screenX && !event.screenY)) return;
        nativeTabDrag.lastScreenX = event.screenX;
        nativeTabDrag.lastScreenY = event.screenY;
      });
      t.addEventListener('dragend', event => {
        t.classList.remove('nativeDragging');
        const drag = nativeTabDrag;
        nativeTabDrag = null;
        clearTabDropTarget();
        if (!drag || event.dataTransfer.dropEffect !== 'none') return;
        const screenTop = window.screenY + $('tabbar').getBoundingClientRect().top;
        const screenBottom = window.screenY + $('tabbar').getBoundingClientRect().bottom;
        if (drag.lastScreenY > screenTop - 30 && drag.lastScreenY < screenBottom + 30) return;
        detachDocToWindow(d, true, {
          screenX: drag.lastScreenX,
          screenY: drag.lastScreenY,
        });
      });
    }
    t.addEventListener('pointermove', ev => {
      if (ev.pointerType !== 'mouse') return;
      if (ev.target instanceof Element && ev.target.closest('.x')) hideDesktopTabTip();
      else queueDesktopTabTip(t, d);
    });
    t.addEventListener('pointerleave', hideDesktopTabTip);
    t.addEventListener('pointerdown', hideDesktopTabTip);
    t.addEventListener('mousedown', ev => {
      if (windowPeers.supported) return;
      if (ev.button !== 0 || ev.target.closest('.x')) return;
      const startX = ev.clientX, startY = ev.clientY;
      const from = editorStore.documents.indexOf(d);
      let started = false, target = from, detaching = false, detachArmed = false;
      const siblings = () => [...t.parentElement.children];
      const dragTabs = siblings();
      const baseRects = dragTabs.map(el => el.getBoundingClientRect());
      const grabX = startX - baseRects[from].left, grabY = startY - baseRects[from].top;
      const tabGap = parseFloat(getComputedStyle(t.parentElement).columnGap) || 2;
      const dragSlot = baseRects[from].width + tabGap;
      let ghost = null;
      const mv = e2 => {
        const dx = e2.clientX - startX, dy = e2.clientY - startY;
        if (!started && Math.hypot(dx, dy) < 6) return;
        started = true;
        detachArmed = tabDragWantsDetach(baseRects[from], e2.clientY);
        if (!ghost) {
          ghost = t.cloneNode(true);
          ghost.classList.add('tabDragGhost');
          ghost.style.width = baseRects[from].width + 'px';
          ghost.style.height = baseRects[from].height + 'px';
          document.body.appendChild(ghost);
        }
        ghost.style.left = (e2.clientX - grabX) + 'px';
        ghost.style.top = (e2.clientY - grabY) + 'px';
        ghost.style.opacity = detachArmed ? .62 : .94;
        t.style.opacity = .22; t.style.pointerEvents = 'none';
        target = from;
        for (let i = from - 1; i >= 0; i--)
          if (e2.clientX < baseRects[i].left + baseRects[i].width / 2) target = i;
        for (let i = from + 1; i < baseRects.length; i++)
          if (e2.clientX > baseRects[i].left + baseRects[i].width / 2) target = i;
        dragTabs.forEach((sib, i) => {
          if (sib === t) return;
          let shift = 0;
          if (!detachArmed && target > from && i > from && i <= target) shift = -dragSlot;
          else if (!detachArmed && target < from && i >= target && i < from) shift = dragSlot;
          sib.classList.add('tabShift');
          sib.style.transform = shift ? `translateX(${shift}px)` : '';
        });
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        if (ghost) { ghost.remove(); ghost = null; }
        t.style.transform = ''; t.style.zIndex = ''; t.style.opacity = ''; t.style.pointerEvents = '';
        dragTabs.forEach(s2 => {
          if (s2 !== t) s2.style.transform = '';
          setTimeout(() => s2.classList.remove('tabShift'), 160);
        });
      };
      const up = e2 => {
        const wantsDetach = started && detachArmed;
        cleanup();
        if (wantsDetach) {
          detaching = detachDocToWindow(d, true, { screenX: e2.screenX, screenY: e2.screenY });
        } else if (!detaching && started && target !== from) {
          const [mvd] = editorStore.documents.splice(from, 1);
          editorStore.documents.splice(target, 0, mvd);
          renderTabs();
        }
        if (started) t._dragJustEnded = true;
        setTimeout(() => { t._dragJustEnded = false; }, 0);
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    t.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      if (!editorStore.selectedDocuments.has(d)) {
        editorStore.selectedDocuments.clear(); editorStore.selectedDocuments.add(d); editorStore.tabSelectionAnchor = d;
        renderTabs(false);
      }
      tabMenuTarget = d;
      const m = $('tabMenu');
      const detachItem = m.querySelector('[data-cmd="detach"]');
      const mergeItem = m.querySelector('[data-cmd="merge"]');
      const peerTargets = $('tabMoveTargets');
      const n = editorStore.selectedDocuments.has(d) ? editorStore.selectedDocuments.size : 1;
      const detachWhere = matchMedia('(max-width: 768px)').matches ? '새 탭' : '새 창';
      const canDetach = n < editorStore.documents.length;
      detachItem.classList.toggle('disabled', !canDetach);
      detachItem.setAttribute('aria-disabled', String(!canDetach));
      detachItem.textContent = canDetach
        ? (n > 1 ? `↗ 선택한 ${n}개 문서 ${detachWhere}에서 열기` : `↗ ${detachWhere}에서 열기`)
        : '↗ 마지막 탭은 새 창으로 분리할 수 없음';
      peerTargets.innerHTML = '';
      const peers = windowPeers.peers();
      if (peers.length) {
        const sep = document.createElement('div');
        sep.className = 'msep';
        peerTargets.appendChild(sep);
        for (const peer of peers) {
          const item = document.createElement('div');
          item.className = 'mi';
          item.dataset.cmd = 'move-window';
          item.dataset.windowId = peer.id;
          const count = peer.documentCount ? ` · 탭 ${peer.documentCount}개` : '';
          item.textContent = `→ ${peer.title}${count}`;
          peerTargets.appendChild(item);
        }
      }
      const canMerge = !!detachToken && !!connectedMergeOpener();
      mergeItem.style.display = canMerge && !peers.length ? 'flex' : 'none';
      mergeItem.textContent = n > 1 ? `↙ 선택한 ${n}개 문서 원래 창으로 합치기` : '↙ 원래 창으로 합치기';
      m.style.display = 'block';
      const menuWidth = m.offsetWidth || 220;
      const menuHeight = m.offsetHeight || 190;
      m.style.left = Math.max(8, Math.min(ev.clientX, window.innerWidth - menuWidth - 8)) + 'px';
      m.style.top = Math.max(8, Math.min(ev.clientY, window.innerHeight - menuHeight - 8)) + 'px';
    });
    t.append(...(dirty ? [dirty, nm, x] : [nm, x]));
    tb.appendChild(t);
  });
  renderTabList();
  const activeName = editorStore.activeDocument && editorStore.activeDocument.name;
  windowPeers.updateMetadata({
    title: activeName ? `창 ${windowPeers.windowNumber} · ${activeName}.pdf` : `창 ${windowPeers.windowNumber}`,
    documentCount: editorStore.documents.length,
  });
  publishNativeTabs();
  publishDesktopDocumentState();
  if (scrollActive)
    requestAnimationFrame(() => tb.querySelector('.dtab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

function handleTabStripWheel(e) {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || !$('tabStrip').scrollWidth) return;
  e.preventDefault();
  $('tabStrip').scrollLeft += e.deltaY;
}
function handleTabListButton(e) {
  e.stopPropagation();
  const menu = $('tabList');
  const opening = !menu.classList.contains('show');
  closeTabList();
  if (opening) { renderTabList(); menu.classList.add('show'); positionTabList(); }
}

let tabMenuTarget = null;
function handleTabMenuClick(e) {
  const mi = e.target.closest('.mi');
  if (!mi || !tabMenuTarget) return;
  $('tabMenu').style.display = 'none';
  const d = tabMenuTarget;
  const i = editorStore.documents.indexOf(d);
  if (mi.dataset.cmd === 'detach') {
    if (mi.classList.contains('disabled')) return;
    detachDocToWindow(d);
    return;
  }
  if (mi.dataset.cmd === 'merge') { mergeDocsToOpener(d); return; }
  if (mi.dataset.cmd === 'move-window') { moveDocsToPeer(d, mi.dataset.windowId); return; }
  let targets = [];
  switch (mi.dataset.cmd) {
    case 'close': targets = [d]; break;
    case 'others': targets = editorStore.documents.filter(x => x !== d); break;
    case 'left': targets = editorStore.documents.slice(0, i); break;
    case 'right': targets = editorStore.documents.slice(i + 1); break;
    case 'all': targets = [...editorStore.documents]; break;
  }
  (async () => {
    for (const x of targets) {
      if (x.dirty && editorStore.documents.includes(x) && editorStore.activeDocument !== x) switchDoc(x);
      if (editorStore.documents.includes(x) && !await closeDoc(x)) return;
    }
    if (editorStore.documents.includes(d) && editorStore.activeDocument !== d) switchDoc(d);
  })();
}

function browserVisibleFilePath(file) {
  for (const candidate of [file?._docPath, file?._fullPath, file?.path, file?.webkitRelativePath]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 32768);
  }
  return '';
}
function setDocumentSourceIdentity(documentState, file) {
  if (!documentState || !file) return;
  documentState.sourceFileName = String(file.name || '').trim().slice(0, 1024);
  documentState.sourcePath = browserVisibleFilePath(file);
}
async function loadSource(file, doc) {
  const { bytes, pdoc } = await openPdfBytesInteractive(new Uint8Array(await file.arrayBuffer()), file.name);
  const id = ++srcSeq;
  sources.set(id, { bytes, doc: pdoc, name: file.name, locked: await detectPdfLocked(pdoc) });
  doc.srcIds.push(id);
  return documentModel.createSourcePages(id, pdoc.numPages);
}

function openFailToast(f, e) {
  if (e && e.canceled) { toast(`"${f.name}" — 암호 입력을 취소해 열지 않았습니다`, 2600); return; }
  console.error(f.name, e);
  if (e && (e.name === 'PasswordException' || /password/i.test(e.message || '')))
    toast(`🔒 "${f.name}" — 암호를 확인하지 못해 열 수 없습니다`, 4000);
  else toast(`"${f.name}" 열기 실패: ` + (e.message || e).toString().slice(0, 60), 4000);
}

let moResolve = null;
function askMultiOpen(n) {
  $('moCount').textContent = n;
  $('moOverlay').classList.add('show');
  return new Promise(res => { moResolve = res; });
}
function moDone(v) {
  $('moOverlay').classList.remove('show');
  const r = moResolve; moResolve = null;
  if (r) r(v);
}

async function openFiles(files, append) {
  if (!requireWindowsNewWork()) return false;
  let pdfs = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) { toast('PDF 파일이 아닙니다'); return false; }
  if (desktopViewMode) {
    if (!append && editorStore.documents.length)
      throw new Error('데스크톱 문서 뷰에는 문서를 하나만 열 수 있습니다');
    pdfs = pdfs.slice(0, 1);
  }
  if (!append && pdfs.length > 1) {
    const mode = await askMultiOpen(pdfs.length);
    if (!mode) return false;
    if (mode === 'merge') {
      openMergeDialog();
      mgItems = [];                        
      await addMergeFiles(pdfs);
      return true;
    }
  }
  let openedAny = false;
  displayPainter.warmup();
  spin(true, 'PDF 여는 중...');
  try {
    if (append && editorStore.activeDocument) {
      if (activeDocLocked()) { toast('🔒 편집 제한이 걸린 문서에는 추가할 수 없습니다 — 먼저 암호로 해제하세요', 3200); return; }
      pushUndo();
      const okNames = [];
      for (const f of pdfs) {
        try { editorStore.pages.push(...await loadSource(f, editorStore.activeDocument)); okNames.push(f.name); }
        catch (e) { openFailToast(f, e); }
      }
      if (okNames.length) toast(`${okNames.join(', ')} 병합됨 (총 ${editorStore.pages.length}페이지)`);
      openedAny = okNames.length > 0;
      rebuildAll();
    } else {
      let first = null, openingPage = null, openingRaster = null, restored = 0, opened = 0;
      for (const f of pdfs) {
        let primedId;
        try {
          const visiblePath = browserVisibleFilePath(f);
          const sig = (visiblePath || f.name) + '|' + f.size + '|' + (f.lastModified || 0);
          let dupDoc = editorStore.documents.find(x => x.fileSig === sig) || null;
          if (!dupDoc && f._handle) {
            for (const x of editorStore.documents) {
              if (!x.fileHandle) continue;
              try { if (await x.fileHandle.isSameEntry(f._handle)) { dupDoc = x; break; } } catch {}
            }
          }
          if (dupDoc) {
            openedAny = true;
            if (!first) first = dupDoc;
            toast('이미 열려 있는 파일입니다: ' + f.name);
            continue;
          }
          const id = ++srcSeq;
          const source = { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name };
          let preview;
          if (!first && source.bytes.length >= 2 * 1024 * 1024 && source.bytes.length <= 128 * 1024 * 1024) {
            preview = displayPainter.primeSource(id, source, openingRasterSize);
            primedId = id;
          }
          const openedPdf = await openPdfBytesInteractive(source.bytes, f.name);
          const bytes = openedPdf.bytes, pdoc = openedPdf.pdoc;  
          let d = await tryOpenProject(f, pdoc);
          if (!d) d = await tryOpenMarked(f, pdoc, bytes);  
          if (d) restored++;
          else {
            d = newDoc(f.name.replace(/\.pdf$/i, ''));
            d.fileHandle = f._handle || null;  
            const locked = await detectPdfLocked(pdoc);
            if ((locked || source.bytes !== bytes) && primedId) displayPainter.invalidateSource(id);
            const plainSource = source.bytes === bytes ? source : { bytes, name: f.name };
            Object.assign(plainSource, { doc: pdoc, locked });
            sources.set(id, plainSource);
            d.srcIds.push(id);
            d.pages.push(...documentModel.createSourcePages(id, pdoc.numPages));
            if (!first && !locked && !openedPdf.openedWithPassword && bytes.length >= 2 * 1024 * 1024) {
              openingPage = d.pages[0];
              openingRaster = preview;
            }
          }
          setDocumentSourceIdentity(d, f);
          d.openedWithPassword = openedPdf.openedWithPassword === true;
          d.fileSig = sig;  
          d.docPath = f._docPath || null;
          editorStore.documents.push(d);
          opened++;
          openedAny = true;
          if (!first) first = d;
        } catch (e) { openFailToast(f, e); }
        finally { if (primedId && !sources.has(primedId)) displayPainter.invalidateSource(primedId); }
      }
      if (first) {
        switchDoc(first);
        if (openingPage && first.pages[0] === openingPage) showOpeningPreview(openingPage, openingRaster);
      }
      if (restored) toast('✏️ 이 편집기로 저장한 파일 — 오브젝트를 이어서 편집할 수 있습니다');
      else if (opened > 1) toast(opened + '개 문서를 각각 탭으로 열었습니다');
    }
    renderTabs();
    scheduleAutosave();
    return openedAny;
  } catch (e) {
    console.error(e);
    toast('열기 실패: ' + (e.message || e).toString().slice(0, 80), 4000);
  } finally { spin(false); }
}

function setButtons(on) {
  syncSaveButtons();
  ['btnSave','btnSaveAs','btnPrint','btnZoomIn','btnZoomOut','btnFit','btnFitPage','btnRotL','btnRotR',
   'btnBlank','btnText','btnShape','btnDraw','btnConnectArrow','btnOrig','btnRegion','btnSearch'].forEach(id => $(id).disabled = !on);
  if (!on) { $('btnUndo').disabled = true; $('btnRedo').disabled = true; $('btnPdfUnlock').hidden = false; }
  applyWindowsAccessUi();
}

async function detectPdfLocked(pdoc) {
  try { return (await pdoc.getPermissions()) !== null; } catch { return false; }
}
function activeDocLocked() {
  return documentModel.lockedSourceIds(editorStore.pages, sourceId => sources.get(sourceId)).length > 0;
}
function lockNotice() {
  toast('🔒 편집 제한이 걸린 문서입니다 — 상단 [암호 입력]으로 해제하면 편집·저장할 수 있습니다', 3200);
  if (editorStore.activeDocument) editorStore.activeDocument.lockBarHidden = false;  
  updateLockUi();
}
const LOCK_EDIT_BTNS = ['btnSave', 'btnSaveAs', 'btnPdfLock', 'btnAppend', 'btnRotL', 'btnRotR', 'btnBlank',
                        'btnText', 'btnShape', 'btnDraw', 'btnConnectArrow', 'btnOrig', 'btnRegion'];
function updateLockUi() {
  const locked = !!editorStore.activeDocument && activeDocLocked();
  $('btnPdfUnlock').hidden = !!editorStore.pages.length && !(locked || editorStore.activeDocument?.openedWithPassword);
  $('lockBar').style.display = locked && !editorStore.activeDocument.lockBarHidden ? 'flex' : 'none';
  if (editorStore.activeDocument && editorStore.pages.length) LOCK_EDIT_BTNS.forEach(id => $(id).disabled = locked);
  applyWindowsAccessUi();
}
$('lockBarClose').onclick = () => {
  if (editorStore.activeDocument) editorStore.activeDocument.lockBarHidden = true;
  $('lockBar').style.display = 'none';
};
async function pdfiumDecrypt(bytes, password) {
  return pdfiumAdapter.decrypt(bytes, password);
}
async function openPdfBytesInteractive(bytes, name) {
  try {
    return { bytes, pdoc: await openPdfDocument(bytes.slice()).promise };
  } catch (e) {
    if (!(e && (e.name === 'PasswordException' || /password/i.test(e.message || '')))) throw e;
  }
  for (let attempt = 0; ; attempt++) {
    const pw = prompt(`🔒 "${name}"\n암호가 걸린 PDF입니다. 열람 암호를 입력하세요.` +
                      (attempt ? '\n\n⚠ 암호가 올바르지 않습니다. 다시 입력하세요.' : ''));
    if (pw === null || pw === '') {
      const err = new Error('암호 입력을 취소했습니다');
      err.canceled = true;
      throw err;
    }
    let out;
    try { out = await pdfiumDecrypt(bytes, pw); }
    catch (e) {
      if (/암호가 올바르지/.test(e.message || '')) continue;  
      throw e;  
    }
    return { bytes: out, pdoc: await openPdfDocument(out.slice()).promise, openedWithPassword: true };
  }
}
let unlockBusy = false;
async function unlockActiveDoc() {
  if (unlockBusy || !editorStore.activeDocument) return;
  const lockedIds = documentModel.lockedSourceIds(editorStore.pages, sourceId => sources.get(sourceId));
  if (!lockedIds.length) { updateLockUi(); return; }
  const pw = prompt('편집 제한 암호(소유자 암호)를 입력하세요');
  if (pw === null || pw === '') return;
  unlockBusy = true;
  spin(true, '편집 제한 해제 중...');
  try {
    const swaps = await unlockFeature.prepare(lockedIds, pw);
    const idMap = new Map();
    for (const [oldId, nv] of swaps) {
      const nid = ++srcSeq;
      sources.set(nid, { bytes: nv.bytes, doc: nv.doc, name: nv.name });
      idMap.set(oldId, nid);
    }
    unlockFeature.remapDocuments(editorStore.documents, idMap);
    sweepSources();  
    rebuildAll();    
    renderTabs();
    scheduleAutosave();
    toast('✓ 편집 제한이 해제되었습니다 — 편집과 저장을 사용할 수 있습니다', 3500);
  } catch (e) {
    console.error(e);
    toast('해제 실패: ' + (e.message || e).toString().slice(0, 60), 3500);
  } finally {
    unlockBusy = false;
    spin(false);
    updateLockUi();
  }
}
$('lockBarUnlock').onclick = unlockActiveDoc;

let pageLifecycle = null;
let deferThumbnailsUntil = 0;
function prioritizeReading(delay = 250) { deferThumbnailsUntil = Math.max(deferThumbnailsUntil, performance.now() + delay); }

const renderCoordinator = createRenderCoordinator({
  viewer,
  renderPage: wrap => renderPageCanvas(wrap),
  pageForWrap: wrap => editorStore.pages[+wrap.dataset.k],
  releaseExtraLayers: wrap => {
    wrap.querySelector('.openingPreview')?.remove();
    pageRenderer.releaseTiles(wrap, true);
  },
  cleanupPage: pageModel => pageLifecycle.scheduleCleanup(pageModel),
  createObserver: (callback, options) => new IntersectionObserver(callback, options),
  requestFrame: callback => requestAnimationFrame(callback),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  now: () => performance.now(),
  maxCacheBytes: cacheByteLimit(navigator.deviceMemory, 64, 128),
});
const enqueueRender = renderCoordinator.enqueue;
const scheduleRQ = renderCoordinator.schedule;
const pageObserver = renderCoordinator.observer;
viewer.addEventListener('scroll', () => {
  prioritizeReading();
  viewer.querySelectorAll('.pageWrap').forEach(wrap => { if (wrap._tiles) enqueueRender(wrap); });
  scheduleRQ();
}, { passive: true });

function pdfPageInUse(p) {
  for (let j = 0; j < editorStore.pages.length; j++) {
    const q = editorStore.pages[j];
    if (q.src !== p.src || q.idx !== p.idx) continue;
    const w = document.getElementById('pg' + j);
    if (w && (w.dataset.rendered || w._task || renderCoordinator.has(w))) return true;
    const t = sidebar.querySelector(`.thumb[data-k="${j}"]`);
    if (t && (thumbnailCoordinator.has(t) || thumbnailCoordinator.isRendering(t))) return true;
  }
  return false;
}
pageLifecycle = createPageLifecycle({
  getSource: sourceId => sources.get(sourceId),
  isPageInUse: pdfPageInUse,
  getPages: () => editorStore.pages,
  getViewport: (pageModel, scale) => getViewport(pageModel, scale),
  updateAspectRatio: (index, pageModel) => {
    const thumb = sidebar.querySelector('.thumb[data-k="' + index + '"]');
    const image = thumb && thumb.querySelector('img');
    if (image && !thumb.dataset.rendered && pageModel._w1 && pageModel._h1)
      image.style.aspectRatio = (pageModel._w1 / pageModel._h1).toFixed(4);
  },
  shouldRefit: pageModel => editorStore.fitWidth && viewMode === 'scroll' &&
    fitBasisDoc === editorStore.activeDocument && performance.now() - fitBasisT < 8000 &&
    pageModel._w1 > fitBasisW + .5,
  requestRefit: () => scheduleRefitWidth(),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer),
});
const cancelPageCleanup = pageLifecycle.cancelCleanup;
const cleanupPdfPage = pageLifecycle.scheduleCleanup;

let scrollTick = false, curPageT = 0, curPageTrail = null;
viewer.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    const now = performance.now();
    if (now - curPageT >= 100) { curPageT = now; updateCurrentPage(); }
    clearTimeout(curPageTrail);
    curPageTrail = setTimeout(() => {
      updateCurrentPage();
      if (viewMode === 'scroll') rememberPageView();
    }, 140);
  });
}, { passive: true });
function updateCurrentPage() {
  if (viewMode !== 'scroll') return;  
  const vr = viewer.getBoundingClientRect();
  let best = -1, bestVis = 0;
  for (const w of viewer.querySelectorAll('.pageWrap')) {
    const r = w.getBoundingClientRect();
    if (r.top > vr.bottom) break;  
    const vis = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
    if (vis > bestVis || (vis > 0 && vis === bestVis && +w.dataset.k === editorStore.currentPage)) {
      bestVis = vis; best = +w.dataset.k;
    }
  }
  if (best >= 0 && best !== editorStore.currentPage) {
    editorStore.currentPage = best;
    renderCoordinator.focus(document.getElementById('pg' + best));
    updateStatus();
    markCurrentThumb();
  }
}
function markCurrentThumb() {
  sidebar.querySelectorAll('.thumb').forEach(t => {
    const cur = +t.dataset.k === editorStore.currentPage;
    t.classList.toggle('current', cur);
    if (cur) t.scrollIntoView({ block: 'nearest' });
  });
}

const thumbnailCoordinator = createThumbnailCoordinator({
  sidebar,
  renderThumbnail: (element, cachedOnly) => renderThumbCanvas(element, cachedOnly),
  mainRenderPending: () => printPreparing || rasterPreparing || performance.now() < deferThumbnailsUntil || renderCoordinator.busy || renderCoordinator.size > 0,
  thumbKey,
  pageForWrap: wrap => editorStore.pages[+wrap.dataset.k],
  createBitmap: blob => createImageBitmap(blob),
  createObjectUrl: blob => URL.createObjectURL(blob),
  revokeObjectUrl: url => URL.revokeObjectURL(url),
  createObserver: (callback, options) => new IntersectionObserver(callback, options),
  requestFrame: callback => requestAnimationFrame(callback),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer),
  now: () => performance.now(),
  maxCacheBytes: cacheByteLimit(navigator.deviceMemory, 48, 96),
});
const thumbCacheGet = thumbnailCoordinator.cacheGet;
const clearThumbImage = thumbnailCoordinator.clearImage;
const setThumbImage = thumbnailCoordinator.setImage;
const enqueueThumb = thumbnailCoordinator.enqueue;
const scheduleTQ = thumbnailCoordinator.schedule;
const paintThumbPreview = thumbnailCoordinator.paintPreview;
const thumbObserver = thumbnailCoordinator.observer;
const THUMB_BLANK = thumbnailCoordinator.blankImage;

const pagePainter = createPagePainter({
  getSource: sourceId => sources.get(sourceId),
  createCanvas: () => document.createElement('canvas'),
  getResizedCropGeometry: resizedCropGeometry,
});
const { getViewport, paintPage, paintRegion, blitPagePreview } = pagePainter;
const displayPainter = createDisplayPainter({
  painter: pagePainter, getSource: sourceId => sources.get(sourceId), pdfiumCdn: pdfiumBase,
  getWasmBinary: () => pdfiumAdapter.getWasmBinary(),
  supported: typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined',
  createWorker: () => {
    const url = URL.createObjectURL(new Blob([configureFontWorker('const averageRasterPixels = ' + averageRasterPixels.toString() + ';\n' + DISPLAY_RASTER_WORKER_SOURCE)], { type: 'text/javascript' }));
    try { return new Worker(url, { type: 'module' }); }
    finally { URL.revokeObjectURL(url); }
  },
  warn: (...args) => console.warn(...args),
});
if (new URLSearchParams(location.search).get('opening') === '1') displayPainter.warmup();
const cropResizeFeature = createCropResizeFeature({
  rotateDelta: rotateScreenDelta,
  getRotation: objRotation,
});
const printExportFeature = createPrintExportFeature({ clonePage, parseRange, getViewport });

async function buildLinkLayer(wrap, p) {
  wrap.querySelectorAll('.pdfLink').forEach(a => a.remove());
  if (!p || p.blank || !p.src) return;
  const src = sources.get(p.src);
  if (!src) return;
  let annots, vp1;
  try {
    const page = await src.doc.getPage(p.idx + 1);
    annots = (await page.getAnnotations()).filter(a => a.subtype === 'Link' && (a.dest || a.url));
    if (!annots.length) return;
    vp1 = page.getViewport({ scale: 1, rotation: (page.rotate + p.rot) % 360 });
  } catch { return; }
  const frag = document.createDocumentFragment();
  for (const a of annots) {
    let r;
    try { r = pdfRectToViewport(vp1, a.rect); } catch { continue; }
    let x0 = Math.min(r[0], r[2]) / vp1.width, x1 = Math.max(r[0], r[2]) / vp1.width;
    let y0 = Math.min(r[1], r[3]) / vp1.height, y1 = Math.max(r[1], r[3]) / vp1.height;
    if (p.resize) {  
      const [tw, th] = p.resize;
      const fit = Math.min(tw / vp1.width, th / vp1.height);
      const ox = (tw - vp1.width * fit) / 2, oy = (th - vp1.height * fit) / 2;
      x0 = (x0 * vp1.width * fit + ox) / tw; x1 = (x1 * vp1.width * fit + ox) / tw;
      y0 = (y0 * vp1.height * fit + oy) / th; y1 = (y1 * vp1.height * fit + oy) / th;
    }
    if (p.crop) {    
      x0 = (x0 - p.crop[0]) / p.crop[2]; x1 = (x1 - p.crop[0]) / p.crop[2];
      y0 = (y0 - p.crop[1]) / p.crop[3]; y1 = (y1 - p.crop[1]) / p.crop[3];
      if (x1 < 0 || x0 > 1 || y1 < 0 || y0 > 1) continue;    
    }
    const el = document.createElement('div');
    el.className = 'pdfLink';
    el.style.left = (x0 * 100) + '%';
    el.style.top = (y0 * 100) + '%';
    el.style.width = ((x1 - x0) * 100) + '%';
    el.style.height = ((y1 - y0) * 100) + '%';
    if (a.url) {
      el.title = a.url;
      el.addEventListener('click', ev => { ev.stopPropagation(); openPdfUrl(a.url); });
    } else {
      el.title = '이 문서 안의 다른 위치로 이동';
      el.addEventListener('click', ev => { ev.stopPropagation(); gotoPdfDest(p, a.dest); });
    }
    frag.appendChild(el);
  }
  wrap.appendChild(frag);
}
function openPdfUrl(url) {
  let u;
  try { u = new URL(url, location.href); } catch { toast('잘못된 링크입니다'); return; }
  if (!/^https?:$/.test(u.protocol)) { toast('열 수 없는 링크입니다: ' + u.protocol); return; }
  if (!confirm('이 주소를 새 탭에서 엽니다: ' + u.href)) return;
  window.open(u.href, '_blank', 'noopener,noreferrer');
}
async function gotoPdfDest(p, dest) {
  try {
    const src = sources.get(p.src);
    let d = dest;
    if (typeof d === 'string') d = await src.doc.getDestination(d);
    if (!Array.isArray(d) || !d.length) { toast('링크 대상을 찾지 못했습니다'); return; }
    const idx = await src.doc.getPageIndex(d[0]);           
    const k = editorStore.pages.findIndex(q => q.src === p.src && q.idx === idx);
    if (k < 0) { toast('링크가 가리키는 페이지가 이 문서에 없습니다'); return; }
    gotoPage(k + 1, { restore: false });
  } catch (e) {
    console.warn('링크 이동 실패', e);
    toast('링크를 따라가지 못했습니다');
  }
}

function renderKey(p) {
  return makeRenderKey(p, editorStore.zoom) + ':dpr:' + Math.min(3, window.devicePixelRatio || 1);
}

const pageRenderer = createPageRenderer({
  getPageAt: index => editorStore.pages[index],
  getZoom: () => editorStore.zoom,
  getSource: sourceId => sources.get(sourceId),
  makeKey: renderKey,
  cancelCleanup: cancelPageCleanup,
  onSlowPageVisible: page => {
    if (page !== editorStore.pages[editorStore.currentPage]) return;
    prioritizeReading(3500);
    displayPainter.prepareReadingPage(page, () => page === editorStore.pages[editorStore.currentPage]);
  },
  cacheHas: key => renderCoordinator.cacheHas(key),
  cacheGet: key => renderCoordinator.cacheGetReady(key),
  cacheCanvas: (sourceId, key, canvas, width, height) =>
    renderCoordinator.cacheCanvas(sourceId, key, canvas, width, height),
  getViewport, paintRegion: displayPainter.paintRegion, getViewerRect: () => viewer.getBoundingClientRect(), createTiledRenderer: createTiledPageRenderer,
  usePagePainter: displayPainter.supported, canReuseOverview: displayPainter.usesNative,
  paintThumbPreview,
  createBitmap: blob => createImageBitmap(blob),
  createCanvas: () => document.createElement('canvas'),
  paintPage: displayPainter.paintPage,
  blitPagePreview,
  positionMarks: (wrap, pageModel) => repositionMarks(wrap, pageModel),
  buildLinkLayer: (wrap, pageModel) => buildLinkLayer(wrap, pageModel),
  repositionSearchHits: wrap => repositionSearchHits(wrap),
  enqueue: wrap => enqueueRender(wrap),
  getDevicePixelRatio: () => window.devicePixelRatio,
  reportError: error => console.error(error),
});
async function renderPageCanvas(wrap) {
  if (printPreparing || rasterPreparing) return;
  const previous = wrap.dataset.rendered;
  await pageRenderer.renderPage(wrap);
  if (wrap.dataset.rendered && previous !== wrap.dataset.rendered) prioritizeReading();
  if (wrap.dataset.rendered) wrap.querySelector('.openingPreview')?.remove();
}

function openingRasterSize(width, height) {
  const fit = Math.min((viewer.clientWidth - 24) / width, (viewer.clientHeight - 52) / height);
  const zoom = Math.min(50, Math.max(.25, fit));
  const quality = readingQuality(width, height, zoom, window.devicePixelRatio);
  const scale = fit > 0 && viewMode !== 'double' ? zoom * quality.renderDpr : 512 / Math.max(width, height);
  const bounded = Math.min(scale, 4096 / Math.max(width, height), Math.sqrt(4000000 / (width * height)));
  return { width: Math.max(1, Math.round(width * bounded)), height: Math.max(1, Math.round(height * bounded)) };
}

async function showOpeningPreview(page, raster) {
  const wrap = document.getElementById('pg0'), revision = documentViewRevision;
  const bytes = sources.get(page.src)?.bytes;
  const current = () => wrap?.isConnected && documentViewRevision === revision && editorStore.pages[0] === page &&
    editorStore.currentPage === 0 && sources.get(page.src)?.bytes === bytes && page.idx === 0 &&
    !wrap.dataset.rendered && !page.crop && !page.resize && !page.rot && !printPreparing && !rasterPreparing;
  try {
    if (!current() || !await displayPainter.usesNative(page)) return;
    const [size, bitmap] = await Promise.all([getViewport(page, 1), raster]);
    if (!current()) return;
    const scale = (bitmap ? Math.max(bitmap.width, bitmap.height) : 512) / Math.max(size.width, size.height);
    const canvas = document.createElement('canvas');
    if (bitmap) {
      if (Math.abs(size.width * scale - bitmap.width) > 1 || Math.abs(size.height * scale - bitmap.height) > 1) return;
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
    } else {
      if (raster) return;
      await displayPainter.paintPage(page, canvas, scale, 1, null, { backgroundTask: true });
      if (!current()) return;
    }
    canvas.className = 'openingPreview';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.querySelector('canvas').after(canvas);
    const thumb = sidebar.querySelector('.thumb[data-k="0"]');
    if (thumb && !sidebar.classList.contains('hidden')) { enqueueThumb(thumb); scheduleTQ(0); }
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') console.warn('Page preview:', error);
  }
}
const sizeWrap = pageRenderer.sizeWrap;

function thumbKey(p) {
  return makeThumbKey(p);
}
const overlayRendererOptions = {
  inkGeometryOf: inkGeometry,
  ImageConstructor: Image,
  isTextObject: object => isTextObj(object),
  colorWithAlpha: hexA,
  opacityOf: opOf,
  rotationOf: objRotation,
  shapePolygonOf: shapeUnitPolygon,
  connectorPolylineOf: connectorPolyline,
  arrowBodyPolylineOf: arrowBodyPolyline,
  connectorEndDirectionOf: connectorEndDirection,
  arrowMarkerStrokeWidthOf: arrowMarkerStrokeWidth,
  shapeTextFontFamilyOf: object => (FONTS[object?.font] || FONTS.spoqa).css,
  onImagePending: pageModel => scheduleThumbRefresh(editorStore.pages.indexOf(pageModel)),
};
const fragmentView = createRegionFragmentView({ viewer, paint: paintObjectClip });
const overlayCanvasRenderer = createOverlayCanvasRenderer(overlayRendererOptions);
const outputOverlayRenderer = createOverlayCanvasRenderer({ ...overlayRendererOptions,
  textLayoutOf: createTextOverlayLayout({ document, fontFamilyOf: overlayRendererOptions.shapeTextFontFamilyOf }),
});
const drawObjsOnCanvas = overlayCanvasRenderer.drawObjects;
const rasterOutput = createRasterOutputFeature({
  pdfLib: pdfLib.raw, getViewport, paintPage: displayPainter.paintOutputPage,
  drawObjects: drawOutputObjects,
  prepareImages: async page => {
    outputOverlayRenderer.clearImageCache();
    await outputOverlayRenderer.prepareImages(page);
    for (const object of page.texts || []) if (object.text)
      await ensureScreenFont(object.font || 'spoqa', !!object.bold, { characters: object.text });
  },
  createCanvas: () => document.createElement('canvas'),
});
let printPreparing = false, rasterPreparing = false;
const parallelPrint = createParallelPrintFeature({
  pdfLib: pdfLib.raw, pdfiumCdn: pdfiumBase,
  getWasmBinary: () => pdfiumAdapter.getWasmBinary(),
  getResources: () => desktopOutput.resources(),
  createWorker: () => {
    const url = URL.createObjectURL(new Blob([configureFontWorker(PRINT_RASTER_WORKER_SOURCE)], { type: 'text/javascript' }));
    try { return new Worker(url, { type: 'module' }); }
    finally { URL.revokeObjectURL(url); }
  },
});
const thumbnailRenderer = createThumbnailRenderer({
  getPageAt: index => editorStore.pages[index],
  maxPixelWidth: THUMB_RENDER_MAX,
  getPageRaster: (page, index) => {
    const wrap = document.getElementById('pg' + index);
    if (wrap?.dataset.rendered === renderKey(page) && !wrap._tiles && !wrap.querySelector('.origSprite'))
      return { canvas: wrap.querySelector('canvas'), precise: true };
    const canvas = wrap?.querySelector('.openingPreview');
    return canvas && { canvas, precise: false };
  },
  makeKey: thumbKey,
  cacheGet: thumbCacheGet,
  setImage: setThumbImage,
  cancelCleanup: cancelPageCleanup,
  getViewport,
  isScrolling: () => thumbnailCoordinator.scrolling,
  paintPage: async (page, canvas, scale, dpr, hook) => {
    const index = editorStore.pages.indexOf(page);
    if (index >= 0 && Math.abs(index - editorStore.currentPage) <= 4 &&
        sources.get(page.src)?.bytes?.length >= 2 * 1024 * 1024 && await displayPainter.usesNative(page) &&
        await pageRenderer.paintReadingThumbnail(page, index, canvas, scale, hook)) return;
    return displayPainter.paintThumbnail(page, canvas, scale, dpr, hook);
  },
  trackRender: (task, finished, element, token) =>
    thumbnailCoordinator.trackRender(task, finished, element, token),
  drawObjects: drawObjsOnCanvas,
  createCanvas: () => document.createElement('canvas'),
  cachePut: (sourceId, key, blob, width, height) =>
    thumbnailCoordinator.cachePut(sourceId, key, blob, width, height),
  scheduleCleanup: cleanupPdfPage,
  warn: (...args) => console.warn(...args),
});
const renderThumbCanvas = thumbnailRenderer.renderThumbnail;
function refreshThumb(k) {
  const t = sidebar.querySelector(`.thumb[data-k="${k}"]`);
  if (t && t.dataset.rendered) enqueueThumb(t);
}
const thumbTimers = {};
function scheduleThumbRefresh(k) {
  if (thumbTimers[k]) return;
  thumbTimers[k] = setTimeout(() => { delete thumbTimers[k]; refreshThumb(k); }, 150);
}

const twCanvas = document.createElement('canvas');  
const thumbnailWorkerController = createThumbnailWorkerController({
  workerSource: configureFontWorker(THUMBNAIL_PREPASS_WORKER_SOURCE),
  pdfiumCdn: pdfiumBase,
  getWasmBinary: () => pdfiumAdapter.getWasmBinary(),
  createWorker: source => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { return new Worker(url, { type: 'module' }); }
    finally { URL.revokeObjectURL(url); }
  },
  getSource: sourceId => sources.get(sourceId),
  onPage: async (job, m) => {
  try {
    if (!job) return;
    if (thumbnailCoordinator.cacheHas(job.key)) return;  
    twCanvas.width = m.bmp.width; twCanvas.height = m.bmp.height;
    const ctx = twCanvas.getContext('2d');
    ctx.drawImage(m.bmp, 0, 0);
    if (job.page.texts && job.page.texts.length) drawObjsOnCanvas(job.page, twCanvas, m.pw);
    const outW = twCanvas.width, outH = twCanvas.height;
    const blob = await new Promise(res => twCanvas.toBlob(res, 'image/webp', 0.8));
    if (!blob) return;
    thumbnailCoordinator.cachePut(job.page.src, job.key, blob, outW, outH);
    const t = sidebar.querySelector('.thumb[data-k="' + job.index + '"]');
    if (t && t.dataset.rendered !== job.key) enqueueThumb(t);
  } finally { if (m.bmp && m.bmp.close) m.bmp.close(); }
  },
  warn: (...args) => console.warn(...args),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer),
});
function scheduleDimsSweep() {
  if (!backgroundPreviewPaused) pageLifecycle.scheduleDimensionSweep();
}
let thumbPrepassT = null;
let backgroundPreviewPaused = false;
function scheduleThumbPrepass() {
  clearTimeout(thumbPrepassT);
  thumbPrepassT = setTimeout(runThumbPrepass, 800);
}
function runThumbPrepass() {
  if (backgroundPreviewPaused || displayPainter.supported || printPreparing || rasterPreparing || thumbnailWorkerController.errorCount >= 2 || !editorStore.pages.length) return;
  const px = THUMB_RENDER_MAX;  
  thumbnailWorkerController.cancelMissingSources(new Set(editorStore.pages.map(p => p.src)));
  const items = [];
  editorStore.pages.forEach((p, k) => {
    if (!p.src || p.blank || p.crop || p.resize) return;  
    const key = thumbKey(p);
    if (thumbnailCoordinator.cacheHas(key) || thumbnailWorkerController.hasPending(key)) return;
    items.push({ p, k, key });
  });
  if (!items.length) return;
  items.sort((a, b) => Math.abs(a.k - editorStore.currentPage) - Math.abs(b.k - editorStore.currentPage));  
  const bySrc = new Map();
  for (const it of items) {
    let g = bySrc.get(it.p.src);
    if (!g) bySrc.set(it.p.src, g = []);
    g.push({ index: it.k, page: it.p, key: it.key });
  }
  for (const [src, records] of bySrc)
    thumbnailWorkerController.enqueueSource(src, records, px);
  thumbnailWorkerController.start();
  thumbnailWorkerController.pump();
}

function objLineGeo(t, W, H) {
  const points = connectorPolyline(t).map(([x, y]) => [x * W, y * H]);
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const pad = Math.max(8, (t.type === 'arrow' ? (+t.arrowHeadSize || 10) * editorStore.zoom : 0) + 2);
  const l = Math.min(...xs) - pad, tp = Math.min(...ys) - pad;
  const right = Math.max(...xs) + pad, bottom = Math.max(...ys) + pad;
  return {
    l, tp, w: Math.max(1, right - l), h: Math.max(1, bottom - tp),
    x1: t.x1 * W - l, y1: t.y1 * H - tp, x2: t.x2 * W - l, y2: t.y2 * H - tp,
    points: points.map(([x, y]) => [x - l, y - tp]),
  };
}

function polylineObjectPoints(object) {
  return Array.isArray(object?.points)
    ? object.points.filter(point => Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(+point[0]) && Number.isFinite(+point[1]))
      .map(point => [+point[0], +point[1]])
    : [];
}

function polylineGeo(object, width, height) {
  const pagePoints = polylineObjectPoints(object);
  const points = pagePoints.map(([x, y]) => [x * width, y * height]);
  const pad = Math.max(8, Math.max(.1, +object?.sw || 1) * editorStore.zoom + 6);
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = (xs.length ? Math.min(...xs) : 0) - pad;
  const top = (ys.length ? Math.min(...ys) : 0) - pad;
  const right = (xs.length ? Math.max(...xs) : 1) + pad;
  const bottom = (ys.length ? Math.max(...ys) : 1) + pad;
  return {
    l: left, tp: top,
    w: Math.max(1, right - left), h: Math.max(1, bottom - top),
    pagePoints,
    points: points.map(([x, y]) => [x - left, y - top]),
  };
}

function connectorControlSnapshot(object) {
  return {
    connectorControlX: Number.isFinite(+object?.connectorControlX) ? +object.connectorControlX : null,
    connectorControlY: Number.isFinite(+object?.connectorControlY) ? +object.connectorControlY : null,
    connectorBendX: Number.isFinite(+object?.connectorBendX) ? +object.connectorBendX : null,
    connectorBendY: Number.isFinite(+object?.connectorBendY) ? +object.connectorBendY : null,
  };
}

function setTranslatedConnectorControl(object, start, dx, dy) {
  if (start.connectorControlX !== null) object.connectorControlX = start.connectorControlX + dx;
  if (start.connectorControlY !== null) object.connectorControlY = start.connectorControlY + dy;
  if (start.connectorBendX !== null) object.connectorBendX = start.connectorBendX + dx;
  if (start.connectorBendY !== null) object.connectorBendY = start.connectorBendY + dy;
}

function shiftConnectorControl(object, dx, dy) {
  if (Number.isFinite(+object?.connectorControlX)) object.connectorControlX = +object.connectorControlX + dx;
  if (Number.isFinite(+object?.connectorControlY)) object.connectorControlY = +object.connectorControlY + dy;
  if (Number.isFinite(+object?.connectorBendX)) object.connectorBendX = +object.connectorBendX + dx;
  if (Number.isFinite(+object?.connectorBendY)) object.connectorBendY = +object.connectorBendY + dy;
}

function arrowMarkerSvg(t, markerId, size, color, opacity, angle) {
  const kind = t.arrowEndType || 'arrow-filled';
  if (kind === 'none') return '';
  const common = `id="${markerId}" markerUnits="userSpaceOnUse" markerWidth="${size}" markerHeight="${size}" viewBox="0 0 ${size} ${size}" orient="${angle * 180 / Math.PI + (+t.arrowHeadRotation || 0)}" overflow="visible"`;
  const strokeWidth = arrowMarkerStrokeWidth(t, size, editorStore.zoom);
  if (kind === 'circle-filled')
    return `<marker ${common} refX="${size / 2}" refY="${size / 2}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * .38}" fill="${color}" fill-opacity="${opacity}"/></marker>`;
  if (kind === 'circle-open')
    return `<marker ${common} refX="${size / 2}" refY="${size / 2}"><circle cx="${size / 2}" cy="${size / 2}" r="${size * .34}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}"/></marker>`;
  if (kind === 'square')
    return `<marker ${common} refX="${size / 2}" refY="${size / 2}"><rect x="${size * .15}" y="${size * .15}" width="${size * .7}" height="${size * .7}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}"/></marker>`;
  if (kind === 'arrow-open')
    return `<marker ${common} refX="${size}" refY="${size / 2}"><path d="M1,1 L${size},${size / 2} L1,${size - 1}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linejoin="round"/></marker>`;
  return `<marker ${common} refX="${size}" refY="${size / 2}"><path d="M0,0 L${size},${size / 2} L0,${size} z" fill="${color}" fill-opacity="${opacity}"/></marker>`;
}

function polygonPointsAttribute(type, width, height) {
  return shapeUnitPolygon(type)
    .map(([x, y]) => `${(x + .5) * width},${(y + .5) * height}`)
    .join(' ');
}

function shapeTextStyle(object) {
  return {
    text: String(object?.text || ''),
    size: Number.isFinite(object?.size) ? object.size : 16,
    color: object?.color || '#000000',
    colorOp: object?.colorOp === undefined ? 1 : Math.max(0, Math.min(1, +object.colorOp || 0)),
    font: object?.font || 'spoqa',
    bold: !!object?.bold,
    align: ['left', 'center', 'right'].includes(object?.align) ? object.align : 'center',
    valign: ['top', 'middle', 'bottom'].includes(object?.valign) ? object.valign : 'middle',
  };
}

function renderShapeTextContent(mark, object) {
  let content = mark.querySelector(':scope > .shapeTextContent');
  if (!isConnectableShape(object) || (object.text === undefined && !content?.isContentEditable)) {
    content?.remove();
    mark._shapeTextEditor = null;
    return null;
  }
  if (!content) {
    content = document.createElement('div');
    content.className = 'shapeTextContent';
    mark.appendChild(content);
  }
  const style = shapeTextStyle(object);
  if (!content.isContentEditable) content.textContent = style.text;
  content.style.fontSize = (style.size * editorStore.zoom) + 'px';
  content.style.color = hexA(style.color, style.colorOp);
  content.style.fontFamily = (FONTS[style.font] || FONTS.spoqa).css;
  content.style.fontWeight = style.bold ? '700' : '400';
  content.style.textAlign = style.align;
  content.style.alignItems = 'stretch';
  content.style.justifyContent = style.valign === 'middle' ? 'safe center' :
    style.valign === 'bottom' ? 'safe flex-end' : 'flex-start';
  ensureScreenFont(style.font, style.bold, { characters: style.text });
  mark._shapeTextEditor = content;
  return content;
}

function redrawConnectedArrows(k, wrap) {
  const page = editorStore.pages[k];
  if (!page || !wrap) return;
  const width = wrap.clientWidth, height = wrap.clientHeight;
  syncPageConnectors(page, width, height);
  for (const mark of wrap.querySelectorAll('.obj')) {
    const object = mark._ctx?.obj;
    if (object?.type === 'arrow' && object.attachTo)
      drawShapeEl(mark, object, width, height);
  }
}

function applyObjRotation(m, t) {
  const rot = objRotation(t);
  const originX = +m.dataset.connectorOriginX, originY = +m.dataset.connectorOriginY;
  m.style.transformOrigin = (t.type === 'line' || t.type === 'arrow') &&
    Number.isFinite(originX) && Number.isFinite(originY)
    ? `${originX}px ${originY}px` : 'center center';
  m.style.transform = [rot ? `rotate(${rot}deg)` : '',
    t.flipX || t.flipY ? `scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1})` : ''].filter(Boolean).join(' ');
}

function drawShapeEl(m, t, W, H) {
  const sOp = opOf(t, 'strokeOp'), fOp = opOf(t, 'fillOp');
  m.classList.toggle('connectorMark', t.type === 'line' || t.type === 'arrow' || t.type === 'polyline');
  m.classList.toggle('inkMark', t.type === 'ink');
  if (t.type !== 'line' && t.type !== 'arrow') {
    delete m.dataset.connectorOriginX;
    delete m.dataset.connectorOriginY;
  }
  if (t.type === 'img') {  
    const x = t.fx * W, y = t.fy * H, w = t.fw * W, h = t.fh * H;
    Object.assign(m.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
      border: 'none', background: 'transparent' });
    const dx = x - Math.floor(x), dy = y - Math.floor(y);
    let visual = m.querySelector('svg.imageVisual');
    if (!visual) {
      const ns = 'http://www.w3.org/2000/svg';
      visual = document.createElementNS(ns, 'svg');
      visual.classList.add('imageVisual');
      visual.style.cssText = 'position:absolute;pointer-events:none;overflow:visible';
      const image = document.createElementNS(ns, 'image');
      image.setAttribute('preserveAspectRatio', 'none');
      visual.appendChild(image);
      m.appendChild(visual);
    }
    visual.setAttribute('width', Math.ceil(w + dx));
    visual.setAttribute('height', Math.ceil(h + dy));
    Object.assign(visual.style, { left: -dx + 'px', top: -dy + 'px',
      opacity: fOp, mixBlendMode: t.blend === 'multiply' ? 'multiply' : '' });
    const image = visual.firstElementChild;
    if (image.getAttribute('href') !== t.data) image.setAttribute('href', t.data);
    image.setAttribute('x', dx); image.setAttribute('y', dy);
    image.setAttribute('width', w); image.setAttribute('height', h);
    svgFragmentMark(visual, t);
    applyObjRotation(m, t);
    return;
  }
  if (t.type === 'ink') {
    const w = t.fw * W, h = t.fh * H;
    positionObjectMark(m, t.fx * W, t.fy * H);
    m.style.width = w + 'px'; m.style.height = h + 'px';
    m.style.border = 'none'; m.style.background = 'transparent';
    m.style.mixBlendMode = t.brush === 'highlighter' ? 'multiply' : '';
    let svg = m.querySelector(':scope > svg.inkVisual');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('inkVisual'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')); m.appendChild(svg);
    }
    let hit = svg.querySelector('.inkHit');
    if (!hit) {
      hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.classList.add('inkHit');
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.insertBefore(hit, svg.firstChild);
    }
    const path = svg.lastElementChild;
    const outline = inkSvgPath(inkGeometry(t, w, h));
    hit.setAttribute('d', outline);
    path.setAttribute('d', outline);
    path.setAttribute('fill', t.stroke || '#243d51');
    path.setAttribute('opacity', t.strokeOn === false ? '0' : String(sOp));
    applyObjRotation(m, t); return;
  }
  if (t.type === 'polyline') {
    const g = polylineGeo(t, W, H);
    positionObjectMark(m, g.l, g.tp);
    m.style.width = g.w + 'px'; m.style.height = g.h + 'px';
    m.style.border = 'none'; m.style.background = 'transparent'; m.style.borderRadius = '0';
    const path = g.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ') +
      (t.closed && g.points.length > 2 ? ' Z' : '');
    const strokeWidth = Math.max(.1, (+t.sw || 1) * editorStore.zoom);
    const hitWidth = Math.max(12, strokeWidth + 10);
    const xs = g.points.map(point => point[0]), ys = g.points.map(point => point[1]);
    const boundsX = Math.min(...xs), boundsY = Math.min(...ys);
    const boundsWidth = Math.max(1, Math.max(...xs) - boundsX);
    const boundsHeight = Math.max(1, Math.max(...ys) - boundsY);
    const bounds = `<rect class="connectorBoundsHit" x="${boundsX}" y="${boundsY}" width="${boundsWidth}" height="${boundsHeight}" fill="transparent"/><rect class="connectorBoundsOutline" x="${boundsX}" y="${boundsY}" width="${boundsWidth}" height="${boundsHeight}"/>`;
    m.innerHTML = `<svg width="100%" height="100%" overflow="visible">${bounds}<path class="connectorHit" d="${path}" fill="none" stroke="transparent" stroke-width="${hitWidth}" stroke-linejoin="round" stroke-linecap="round"/><path class="connectorVisual" d="${path}" fill="none" stroke="${t.stroke}" stroke-opacity="${sOp}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    m.querySelector('.connectorHit')?.addEventListener('mousedown', event => {
      if (!event.shiftKey || event.ctrlKey || event.altKey || !toggleObjectMultiSelection(m._ctx?.k, t, m)) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  } else if (t.type === 'line' || t.type === 'arrow') {
    const g = objLineGeo(t, W, H);
    positionObjectMark(m, g.l, g.tp);
    m.style.width = g.w + 'px'; m.style.height = g.h + 'px';
    m.dataset.connectorOriginX = String((t.x1 + t.x2) * W / 2 - g.l);
    m.dataset.connectorOriginY = String((t.y1 + t.y2) * H / 2 - g.tp);
    const markerId = `ah${t._id || 'draft'}`;
    const headSize = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +t.arrowHeadSize || 10)) * editorStore.zoom;
    const head = t.type === 'arrow' ? arrowMarkerSvg(t, markerId, headSize, t.stroke, sOp, connectorEndDirection(g.points).angle) : '';
    const fullPath = g.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');
    const bodyPoints = t.type === 'arrow'
      ? arrowBodyPolyline(t, g.points, headSize) : g.points;
    const bodyPath = bodyPoints.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');
    const strokeWidth = Math.max(0.1, t.sw * editorStore.zoom);
    const hitWidth = Math.max(10, strokeWidth + 8);
    const { end, before } = connectorEndDirection(g.points);
    const markerGuide = `M${before[0]},${before[1]} L${end[0]},${end[1]}`;
    const compactEnd = ['none', 'circle-filled', 'circle-open', 'square'].includes(t.arrowEndType);
    const endHitRadius = (compactEnd ? headSize * .4 : headSize) + 4;
    const endHit = t.type === 'arrow'
      ? `<circle class="connectorEndHit" cx="${end[0]}" cy="${end[1]}" r="${Math.max(6, endHitRadius)}" fill="transparent"/>` : '';
    const marker = t.type === 'arrow' && head
      ? `<path class="connectorMarkerGuide" d="${markerGuide}" fill="none" stroke="transparent" marker-end="url(#${markerId})"/>` : '';
    const lineCap = t.type === 'line' && t.lineCap === 'square' ? 'square' : 'round';
    m.innerHTML = `<svg width="100%" height="100%" overflow="visible">${head ? '<defs>' + head + '</defs>' : ''}<path class="connectorHit" d="${fullPath}" fill="none" stroke="transparent" stroke-width="${hitWidth}" stroke-linejoin="round" stroke-linecap="${lineCap}"/>${endHit}<path class="connectorVisual" d="${bodyPath}" fill="none" stroke="${t.stroke}" stroke-opacity="${sOp}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="${lineCap}"/>${marker}</svg>`;
    m.querySelectorAll('.connectorHit, .connectorEndHit').forEach(hit =>
      hit.addEventListener('mousedown', event => {
        if (!event.shiftKey || event.ctrlKey || event.altKey || !toggleObjectMultiSelection(m._ctx?.k, t, m)) return;
        event.preventDefault();
        event.stopPropagation();
      }, true));
  } else {
    positionObjectMark(m, t.fx * W, t.fy * H);
    m.style.width = (t.fw * W) + 'px'; m.style.height = (t.fh * H) + 'px';
    if (isConnectableShape(t)) {
      const width = t.fw * W, height = t.fh * H;
      const strokeWidth = Math.max(0.1, t.sw * editorStore.zoom);
      const stroke = t.strokeOn === false ? 'none' : t.stroke;
      const fill = t.fill || 'none';
      m.style.border = 'none'; m.style.background = 'transparent'; m.style.borderRadius = '0';
      let visual = m.querySelector(':scope > svg.shapeVisual');
      if (!visual) {
        visual = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        visual.classList.add('shapeVisual');
        m.insertBefore(visual, m.firstChild);
      }
      visual.setAttribute('viewBox', `0 0 ${width || 1} ${height || 1}`);
      visual.setAttribute('preserveAspectRatio', 'none');
      const geometry = t.type === 'rect' ? `rect x="0" y="0" width="${width}" height="${height}"` : t.type === 'ellipse'
        ? `ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"`
        : `polygon points="${polygonPointsAttribute(t.type, width, height)}"`;
      visual.innerHTML = `<${geometry} fill="${fill}" fill-opacity="${fOp}" stroke="${stroke}" stroke-opacity="${sOp}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke"/>`;
    } else {
      m.querySelector(':scope > svg.shapeVisual')?.remove();
      m.style.border = t.strokeOn === false ? 'none' : Math.max(0.1, t.sw * editorStore.zoom) + 'px solid ' + hexA(t.stroke, sOp);
      m.style.background = t.fill ? hexA(t.fill, fOp) : 'transparent';
      m.style.borderRadius = t.type === 'ellipse' ? '50%' : '0';
    }
    renderShapeTextContent(m, t);
  }
  applyObjRotation(m, t);
}

function markPageSize(wrap) {
  return { width: parseFloat(wrap.style.width) || wrap.clientWidth,
    height: parseFloat(wrap.style.height) || wrap.clientHeight };
}
function positionObjectMark(mark, x, y) {
  mark.style.left = x + 'px';
  mark.style.top = y + 'px';
  mark.style.setProperty('--mark-offset-x', (x - Math.floor(x)) + 'px');
  mark.style.setProperty('--mark-offset-y', (y - Math.floor(y)) + 'px');
}
function positionTextMark(mark, object, width, height) {
  positionObjectMark(mark, object.fx * width, object.fy * height);
  mark.style.fontSize = (object.size * editorStore.zoom) + 'px';
  if (object.fw !== undefined) mark.style.width = (object.fw * width) + 'px';
  if (object.fh !== undefined) { mark.style.height = (object.fh * height) + 'px'; mark.style.minHeight = '0'; }
  applyObjRotation(mark, object);
}
function positionMovedMark(mark, object, width, height) {
  if (object.type === 'img') drawShapeEl(mark, object, width, height);
  else positionObjectMark(mark, object.fx * width, object.fy * height);
}
function repositionMarks(wrap, page) {
  const marks = [...wrap.querySelectorAll(':scope > .obj')];
  if (marks.length !== page.texts.length || marks.some((mark, index) =>
      mark._ctx?.obj !== page.texts[index] || mark._ctx.k !== +wrap.dataset.k)) {
    positionMarks(wrap, page);
    return;
  }
  const { width, height } = markPageSize(wrap);
  syncPageConnectors(page, width, height);
  for (const mark of marks) {
    const object = mark._ctx.obj;
    if (isTextObj(object)) positionTextMark(mark, object, width, height);
    else drawShapeEl(mark, object, width, height);
  }
  if (selText?.mark?.parentElement === wrap) refreshSelectedObjectHandles();
}

const FINE_MOVE_SCALE = 0.1;
function trackObjectMoveDelta(startEvent) {
  let previousX = startEvent.clientX, previousY = startEvent.clientY;
  let dx = 0, dy = 0;
  return event => {
    const scale = event.altKey ? FINE_MOVE_SCALE : 1;
    dx += (event.clientX - previousX) * scale;
    dy += (event.clientY - previousY) * scale;
    previousX = event.clientX; previousY = event.clientY;
    return { dx, dy };
  };
}

let objIdSeq = 0;
function positionMarks(wrap, p) {
  if (wrap._movingOverlay === p) return;
  removeMultiSelectionBounds(wrap);
  wrap.querySelectorAll('.obj').forEach(m => m.remove());
  const { width: W, height: H } = markPageSize(wrap);
  const k = +wrap.dataset.k;
  syncPageConnectors(p, W, H);
  p.texts.forEach(t => {
    if (t._id === undefined) t._id = ++objIdSeq;
    const m = document.createElement('div');
    m._ctx = { k, obj: t };
    if (isTextObj(t)) {
      m.className = 'obj textMark';
      m.textContent = t.text;
      positionTextMark(m, t, W, H);
      m.style.color = hexA(t.color, opOf(t, 'colorOp'));
      m.style.fontFamily = (FONTS[t.font || 'spoqa'] || FONTS.spoqa).css;
      m.style.fontWeight = t.bold ? '700' : '400';
      ensureScreenFont(t.font || 'spoqa', !!t.bold, { characters: t.text });
      m.style.textAlign = t.align || 'left';
      if (t.fw) { m.style.width = (t.fw * W) + 'px'; m.style.wordBreak = 'break-all'; }
      if (t.fh) {
        m.style.height = (t.fh * H) + 'px';
        m.style.minHeight = '0';
        m.style.display = 'flex';
        m.style.flexDirection = 'column';
        m.style.justifyContent = t.valign === 'middle' ? 'center' : t.valign === 'bottom' ? 'flex-end' : 'flex-start';
      }
      applyObjRotation(m, t);
      m.addEventListener('dblclick', ev => { ev.stopPropagation(); selectMark(k, t, m); startMarkEdit(m); });
      m.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); commitMarkEdit(m); }
      });
    } else {
      m.className = 'obj shapeMark';
      drawShapeEl(m, t, W, H);
      if (isConnectableShape(t)) m.addEventListener('dblclick', event => {
        event.preventDefault(); event.stopPropagation();
        selectMark(k, t, m);
        startShapeTextEdit(m);
      });
      if (t.type === 'arrow' && t.attachTo)
        m.title = '도형 쪽 끝 이동: 연결 유지 · Shift: 중앙 자석 모드';
    }
    m.addEventListener('mousedown', ev => {
      if (m.isContentEditable || ev.target.closest('[contenteditable="true"]') ||
          spacePan || ev.button !== 0) return;
      ev.stopPropagation(); ev.preventDefault();
      if (mixedOperationPending) return;
      if (ev.shiftKey && !ev.ctrlKey && !ev.altKey && toggleObjectMultiSelection(k, t, m)) return;
      if (hasMixedSelection() && selText.k === k && selectedObjectEntries().some(s => s.obj === t)) {
        origMoveStart(ev);
        return;
      }
      const wasMember = multiSel.some(s => s.obj === t);
      const oldPrimary = selText && selText.k === k ? selText : null;
      if (wasMember) {  
        multiSel = multiSel.filter(s => s.obj !== t);
        keepMultiOnce = true;
        selectMark(k, t, m);
        keepMultiOnce = false;
        if (oldPrimary && oldPrimary.obj !== t) {
          multiSel.push({ obj: oldPrimary.obj, mark: oldPrimary.mark });
          oldPrimary.mark.classList.add('sel');
        }
        refreshSelectedObjectHandles();
      } else {
        selectMark(k, t, m);  
      }
      if (connectorPickMode) {
        if (isConnectableShape(t)) {
          addConnectedArrowToShape(k, t);
          stopConnectorPickMode();
        } else toast('사각형·원·삼각형·별 중 하나를 선택하세요');
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const isLine = t.type === 'line' || t.type === 'arrow';
      const isPointPath = t.type === 'polyline';
      const start = {
        x: ev.clientX, y: ev.clientY, fx: t.fx, fy: t.fy,
        x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
        points: isPointPath ? polylineObjectPoints(t) : null,
        ...connectorControlSnapshot(t),
      };
      const group = multiSel.filter(s => s.obj !== t).map(s => ({
        o: s.obj, m: s.mark, fx: s.obj.fx, fy: s.obj.fy,
        x1: s.obj.x1, y1: s.obj.y1, x2: s.obj.x2, y2: s.obj.y2,
        points: s.obj.type === 'polyline' ? polylineObjectPoints(s.obj) : null,
        ...connectorControlSnapshot(s.obj),
      }));
      const moveGroup = () => {
        const dxA = isLine ? t.x1 - start.x1 : isPointPath
          ? t.points[0][0] - start.points[0][0] : t.fx - start.fx;  
        const dyA = isLine ? t.y1 - start.y1 : isPointPath
          ? t.points[0][1] - start.points[0][1] : t.fy - start.fy;
        for (const g of group) {
          if (g.o.type === 'polyline' && g.points) {
            g.o.points = g.points.map(point => [point[0] + dxA, point[1] + dyA]);
            drawShapeEl(g.m, g.o, rect.width, rect.height);
          } else if (g.o.type === 'line' || g.o.type === 'arrow') {
            g.o.x1 = g.x1 + dxA; g.o.y1 = g.y1 + dyA;
            g.o.x2 = g.x2 + dxA; g.o.y2 = g.y2 + dyA;
            setTranslatedConnectorControl(g.o, g, dxA, dyA);
            drawShapeEl(g.m, g.o, rect.width, rect.height);
          } else {
            g.o.fx = g.fx + dxA; g.o.fy = g.fy + dyA;
            if (isTextObj(g.o)) {
              positionObjectMark(g.m, g.o.fx * rect.width, g.o.fy * rect.height);
            } else drawShapeEl(g.m, g.o, rect.width, rect.height);
          }
        }
      };
      const snap0 = makeSnap();  
      const selected = [t, ...group.map(entry => entry.o)];
      const page = editorStore.pages[k];
      const members = connectedDeletionSet(page.texts, selected);
      const ordered = page.texts.filter(object => members.has(object));
      const originals = ordered.map(object => ({ ...object }));
      const attached = ordered.filter(o => !selected.includes(o)).map(o => ({
        o, start: { ...o, ...connectorControlSnapshot(o) },
      }));
      wrap._movingOverlay = page;
      const ghostTemplates = new Map();
      let wantCopy = ev.ctrlKey, moved = false, ghosts = [], lastMove = null;
      const enableCopy = () => {
        wantCopy = true;
        if (!moved || ghosts.length) return;
        for (const [mark, ghost] of ghostTemplates) {
          mark.before(ghost);
          ghosts.push(ghost);
        }
      };
      const modifier = event => {
        if (event.key === 'Control' && !wantCopy) {
          enableCopy();
          if (lastMove) mv(lastMove);
        }
      };
      const moveDelta = trackObjectMoveDelta(ev);
      const mv = e2 => {
        const delta = moveDelta(e2);
        if (!moved && Math.hypot(e2.clientX - start.x, e2.clientY - start.y) < (e2.altKey ? 1 : 3)) return;
        let dx = delta.dx / rect.width, dy = delta.dy / rect.height;
        if (!moved) {
          for (const mark of wrap.querySelectorAll('.obj')) {
            if (!members.has(mark._ctx?.obj)) continue;
            const ghost = mark.cloneNode(true);
            ghost.classList.remove('sel', 'resizing'); ghost.classList.add('objectCopyGhost');
            ghost.querySelectorAll('.objHandle').forEach(h => h.remove());
            ghostTemplates.set(mark, ghost);
          }
        }
        moved = true; lastMove = e2;
        if (wantCopy || e2.ctrlKey) enableCopy();
        if (e2.shiftKey) {  
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
        }
        if (isPointPath) {
          const xs = start.points.map(point => point[0]);
          const ys = start.points.map(point => point[1]);
          dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
          dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
          t.points = start.points.map(point => [point[0] + dx, point[1] + dy]);
          drawShapeEl(m, t, rect.width, rect.height);
        } else if (isLine) {
          t.x1 = start.x1 + dx; t.y1 = start.y1 + dy;
          t.x2 = start.x2 + dx; t.y2 = start.y2 + dy;
          setTranslatedConnectorControl(t, start, t.x1 - start.x1, t.y1 - start.y1);
          drawShapeEl(m, t, rect.width, rect.height);
        } else {
          t.fx = Math.min(0.99, Math.max(-0.5, start.fx + dx));
          t.fy = Math.min(0.99, Math.max(0, start.fy + dy));
          positionMovedMark(m, t, rect.width, rect.height);
        }
        moveGroup();  
        if (wantCopy && attached.length) {
          const dxA = isLine ? t.x1 - start.x1 : isPointPath ? t.points[0][0] - start.points[0][0] : t.fx - start.fx;
          const dyA = isLine ? t.y1 - start.y1 : isPointPath ? t.points[0][1] - start.points[0][1] : t.fy - start.fy;
          for (const { o, start: origin } of attached) {
            o.x1 = origin.x1 + dxA; o.y1 = origin.y1 + dyA;
            o.x2 = origin.x2 + dxA; o.y2 = origin.y2 + dyA;
            setTranslatedConnectorControl(o, origin, dxA, dyA);
          }
        }
        redrawConnectedArrows(k, wrap);
        positionTextBar();
        placeHandles(m, t);
      };
      const up = event => {
        if (event.ctrlKey && moved && !wantCopy) { enableCopy(); mv(event); }
        delete wrap._movingOverlay;
        window.removeEventListener('blur',up);
        window.removeEventListener('keydown', modifier, true);
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        ghosts.forEach(ghost => ghost.remove());
        if (!moved || editorStore.pages[k] !== page) return;
        let result = selected;
        if (wantCopy) {
          result = copyMixedOverlayObjects(selected, page);
          for (let i = 0; i < ordered.length; i++) page.texts[page.texts.indexOf(ordered[i])] = originals[i];
          page.texts.push(...result);
        }
        pushSnap(snap0);
        positionMarks(wrap, page);
        selectPastedObjectBundle(k, result, wantCopy ? ordered.indexOf(t) : selected.indexOf(t), wrap);
        scheduleThumbRefresh(k);
      };
      window.addEventListener('blur',up);
      window.addEventListener('keydown', modifier, true);
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    bindMobileObjectMove(m, t, k, wrap);
    m.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (selText && selText.k === k && selText.obj !== t && multiSel.some(s => s.obj === t)) {
        const oldPrimary = selText;
        multiSel = multiSel.filter(s => s.obj !== t);
        keepMultiOnce = true;
        selectMark(k, t, m, hasMixedSelection());
        keepMultiOnce = false;
        multiSel.push({ obj: oldPrimary.obj, mark: oldPrimary.mark });
        oldPrimary.mark.classList.add('sel');
        refreshSelectedObjectHandles();
      } else if (!selText || selText.k !== k || selText.obj !== t) {
        selectMark(k, t, m);
      }
      showObjMenu(ev.clientX, ev.clientY, false, polylineContextFromPointer(t, m, ev));
    });
    wrap.appendChild(m);
  });
  refreshThumb(k);  
}

function bindMobileObjectMove(m, t, k, wrap) {
  m.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'touch' || m.isContentEditable || ev.target.closest('[contenteditable="true"]') ||
        spacePan || ev.target.closest('.objHandle')) return;
    ev.stopPropagation(); ev.preventDefault();
    if (connectorPickMode) {
      selectMark(k, t, m);
      if (isConnectableShape(t)) {
        addConnectedArrowToShape(k, t);
        stopConnectorPickMode();
      } else toast('사각형·원·삼각형·별 중 하나를 선택하세요');
      return;
    }
    const active = !!selText && selText.k === k && selText.obj === t && selText.mark === m;
    if (!active) {
      const entries = selText?.k === k ? selectedObjectEntries() : [];
      const index = entries.findIndex(entry => entry.obj === t);
      if (index < 0) { selectMark(k, t, m); return; }
      selectPastedObjectBundle(k, entries.map(entry => entry.obj), index, wrap);
    }

    const rect = wrap.getBoundingClientRect();
    const isLine = t.type === 'line' || t.type === 'arrow';
    const isPointPath = t.type === 'polyline';
    const start = {
      x: ev.clientX, y: ev.clientY,
      fx: t.fx, fy: t.fy, x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
      points: isPointPath ? polylineObjectPoints(t) : null,
      ...connectorControlSnapshot(t),
    };
    const group = multiSel.filter(selection => selection.obj !== t).map(selection => ({
      object: selection.obj, mark: selection.mark,
      fx: selection.obj.fx, fy: selection.obj.fy,
      x1: selection.obj.x1, y1: selection.obj.y1,
      x2: selection.obj.x2, y2: selection.obj.y2,
      points: selection.obj.type === 'polyline' ? polylineObjectPoints(selection.obj) : null,
      ...connectorControlSnapshot(selection.obj),
    }));
    const moveGroup = () => {
      const dx = isLine ? t.x1 - start.x1 : isPointPath
        ? t.points[0][0] - start.points[0][0] : t.fx - start.fx;
      const dy = isLine ? t.y1 - start.y1 : isPointPath
        ? t.points[0][1] - start.points[0][1] : t.fy - start.fy;
      for (const entry of group) {
        const object = entry.object;
        if (object.type === 'polyline' && entry.points) {
          object.points = entry.points.map(point => [point[0] + dx, point[1] + dy]);
          drawShapeEl(entry.mark, object, rect.width, rect.height);
        } else if (object.type === 'line' || object.type === 'arrow') {
          object.x1 = entry.x1 + dx; object.y1 = entry.y1 + dy;
          object.x2 = entry.x2 + dx; object.y2 = entry.y2 + dy;
          setTranslatedConnectorControl(object, entry, dx, dy);
          drawShapeEl(entry.mark, object, rect.width, rect.height);
        } else {
          object.fx = entry.fx + dx; object.fy = entry.fy + dy;
          if (isTextObj(object)) {
            positionObjectMark(entry.mark, object.fx * rect.width, object.fy * rect.height);
          } else drawShapeEl(entry.mark, object, rect.width, rect.height);
        }
      }
    };
    const snap = makeSnap();
    const moveDelta = trackObjectMoveDelta(ev);
    let moved = false;
    const mv = e2 => {
      const delta = moveDelta(e2);
      const dxPx = e2.clientX - start.x, dyPx = e2.clientY - start.y;
      if (!moved && Math.hypot(dxPx, dyPx) < (e2.altKey ? 1 : 4)) return;
      moved = true;
      const dx = delta.dx / rect.width, dy = delta.dy / rect.height;
      if (isPointPath) {
        const xs = start.points.map(point => point[0]);
        const ys = start.points.map(point => point[1]);
        const moveX = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
        const moveY = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
        t.points = start.points.map(point => [point[0] + moveX, point[1] + moveY]);
        drawShapeEl(m, t, rect.width, rect.height);
      } else if (isLine) {
        t.x1 = start.x1 + dx; t.y1 = start.y1 + dy;
        t.x2 = start.x2 + dx; t.y2 = start.y2 + dy;
        setTranslatedConnectorControl(t, start, dx, dy);
        syncAttachedArrow(editorStore.pages[k], t, rect.width, rect.height);
        drawShapeEl(m, t, rect.width, rect.height);
      } else {
        t.fx = Math.min(0.99, Math.max(-0.5, start.fx + dx));
        t.fy = Math.min(0.99, Math.max(0, start.fy + dy));
        if (isTextObj(t)) {
          positionObjectMark(m, t.fx * rect.width, t.fy * rect.height);
        } else drawShapeEl(m, t, rect.width, rect.height);
      }
      moveGroup();
      redrawConnectedArrows(k, wrap);
      positionTextBar();
      placeHandles(m, t);
    };
    const up = () => {
      if (!moved) return;
      pushSnap(snap);
      positionMarks(wrap, editorStore.pages[k]);
      const marks = [...wrap.querySelectorAll('.obj')];
      const nm = marks[editorStore.pages[k].texts.indexOf(t)];
      keepMultiOnce = true;
      if (nm) selectMark(k, t, nm);
      keepMultiOnce = false;
      multiSel = group
        .map(entry => ({
          obj: entry.object,
          mark: marks[editorStore.pages[k].texts.indexOf(entry.object)],
        }))
        .filter(selection => selection.mark);
      multiSel.forEach(selection => selection.mark.classList.add('sel'));
      refreshSelectedObjectHandles();
      scheduleThumbRefresh(k);
    };
    trackObjectHandleDrag(ev, mv, up);
  });
}

function bindObjectHandle(handle, onDown) {
  handle.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.stopPropagation(); ev.preventDefault();
    onDown(ev);
  });
  handle.addEventListener('mousedown', ev => { ev.stopPropagation(); ev.preventDefault(); });
}
let finishObjectDrag = null;
function trackObjectHandleDrag(startEvent, onMove, onEnd) {
  finishObjectDrag?.();
  const pointerId = startEvent.pointerId;
  const move = ev => {
    if (ev.pointerId !== pointerId) return;
    ev.preventDefault();
    onMove(ev);
  };
  const finish = ev => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (finishObjectDrag === complete) finishObjectDrag = null;
    onEnd(ev);
  };
  const complete = () => finish(startEvent);
  finishObjectDrag = complete;
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

function connectorBodyHandleDescriptors(object) {
  if (object?.type !== 'arrow') return [];
  const points = connectorPolyline(object);
  const style = ['straight', 'angled', 'curve', 'step'].includes(object.connectorStyle)
    ? object.connectorStyle : 'straight';
  if (style === 'curve') {
    const hasExit = Number.isFinite(object?._connectorExitX) && points.length > 2 &&
      Math.hypot(points[1][0] - object.x1, points[1][1] - object.y1) > 1e-9;
    const curvePoints = hasExit ? points.slice(1) : points;
    const point = curvePoints[Math.floor(curvePoints.length / 2)];
    return [{ kind: 'curve', point, title: '곡률 조절 · Shift: 축 고정' }];
  }
  if (style === 'angled' && points.length >= 3)
    return [{ kind: 'angled', point: points.at(-2), title: '두 직선 꺾임점 · Shift: 축 고정' }];
  if (style === 'step' && points.length >= 4) return [
    { kind: 'step-1', point: points.at(-3), title: '첫 번째 꺾임 위치 · Shift: 5% 단위' },
    { kind: 'step-2', point: points.at(-2), title: '두 번째 꺾임 위치 · Shift: 5% 단위' },
  ];
  return [{
    kind: 'body',
    point: [(object.x1 + object.x2) / 2, (object.y1 + object.y2) / 2],
    title: '화살표 몸통 이동 · Shift: 축 고정',
  }];
}

function connectorBodyHandleControlKeys(kind) {
  if (kind === 'curve') return ['connectorControlX', 'connectorControlY'];
  if (kind === 'angled') return ['connectorBendX', 'connectorBendY'];
  if (kind === 'step-1' || kind === 'step-2') return ['connectorStep'];
  return [];
}

function connectorBodyHandleIsLocked(object, kind) {
  const keys = connectorBodyHandleControlKeys(kind);
  return keys.length === 0 || keys.some(key => Number.isFinite(+object?.[key]));
}

function unlockConnectorBodyHandle(object, kind) {
  const keys = connectorBodyHandleControlKeys(kind);
  for (const key of keys) delete object[key];
  if (keys.length) {
    delete object.connectorAnchorX;
    delete object.connectorAnchorY;
    delete object.connectorAxis;
  }
  return keys.length > 0;
}

function addConnectorBodyHandles(mark, object, wrap, rect, geometry) {
  const pageIndex = +wrap.dataset.k;
  for (const descriptor of connectorBodyHandleDescriptors(object)) {
    if (descriptor.kind === 'angled') {
      const clearance = matchMedia('(max-width: 768px)').matches ? 28 : 14;
      const overlapsEndpoint = [[object.x1, object.y1], [object.x2, object.y2]]
        .some(([x, y]) => Math.abs((descriptor.point[0] - x) * rect.width) < clearance &&
          Math.abs((descriptor.point[1] - y) * rect.height) < clearance);
      if (overlapsEndpoint) continue;
    }
    const handle = document.createElement('div');
    handle.className = `objHandle connectorBody ${descriptor.kind}`;
    const lockable = connectorBodyHandleControlKeys(descriptor.kind).length > 0;
    const wasLocked = connectorBodyHandleIsLocked(object, descriptor.kind);
    handle.classList.toggle('locked', wasLocked);
    handle.style.left = (descriptor.point[0] * rect.width - geometry.l) + 'px';
    handle.style.top = (descriptor.point[1] * rect.height - geometry.tp) + 'px';
    if (descriptor.kind.startsWith('step'))
      handle.style.cursor = Math.abs(object.x2 - object.x1) >= Math.abs(object.y2 - object.y1)
        ? 'ew-resize' : 'ns-resize';
    handle.title = lockable
      ? `${descriptor.title} · ${wasLocked ? '클릭: 고정 해제' : '이동하면 고정'}`
      : descriptor.title;
    bindObjectHandle(handle, event => {
      mark.classList.add('resizing');
      const start = {
        x: event.clientX, y: event.clientY, rot: objRotation(object),
        x1: object.x1, y1: object.y1, x2: object.x2, y2: object.y2,
        handleX: descriptor.point[0], handleY: descriptor.point[1],
      };
      const snap = makeSnap();
      let moved = false;
      const move = next => {
        let [dxPx, dyPx] = rotateScreenDelta(
          next.clientX - start.x, next.clientY - start.y, -start.rot);
        if (!moved && Math.hypot(dxPx, dyPx) < 2) return;
        moved = true;
        if (next.shiftKey && descriptor.kind !== 'step-1' && descriptor.kind !== 'step-2') {
          if (Math.abs(dxPx) >= Math.abs(dyPx)) dyPx = 0; else dxPx = 0;
        }
        const dx = dxPx / rect.width, dy = dyPx / rect.height;
        if (descriptor.kind === 'body') {
          object.x1 = start.x1 + dx; object.y1 = start.y1 + dy;
          object.x2 = start.x2 + dx; object.y2 = start.y2 + dy;
        } else if (descriptor.kind === 'curve') {
          const middleX = start.handleX + dx, middleY = start.handleY + dy;
          object.connectorControlX = 2 * middleX - (start.x1 + start.x2) / 2;
          object.connectorControlY = 2 * middleY - (start.y1 + start.y2) / 2;
        } else if (descriptor.kind === 'angled') {
          object.connectorBendX = start.handleX + dx;
          object.connectorBendY = start.handleY + dy;
        } else {
          const horizontal = Math.abs(start.x2 - start.x1) >= Math.abs(start.y2 - start.y1);
          const denominator = horizontal ? start.x2 - start.x1 : start.y2 - start.y1;
          const coordinate = horizontal ? start.handleX + dx : start.handleY + dy;
          let ratio = Math.abs(denominator) < 1e-7 ? .5 :
            (coordinate - (horizontal ? start.x1 : start.y1)) / denominator;
          if (next.shiftKey) ratio = Math.round(ratio * 20) / 20;
          object.connectorStep = Math.max(-2, Math.min(3, ratio));
        }
        delete object.connectorAnchorX;
        delete object.connectorAnchorY;
        syncAttachedArrow(editorStore.pages[pageIndex], object, rect.width, rect.height);
        drawShapeEl(mark, object, rect.width, rect.height);
        placeHandles(mark, object);
        positionTextBar();
      };
      const end = finishEvent => {
        mark.classList.remove('resizing');
        if (!moved) {
          if (finishEvent.type !== 'pointerup' || !lockable || !wasLocked ||
              !unlockConnectorBodyHandle(object, descriptor.kind)) return;
          syncAttachedArrow(editorStore.pages[pageIndex], object, rect.width, rect.height);
          drawShapeEl(mark, object, rect.width, rect.height);
          placeHandles(mark, object);
          positionTextBar();
          pushSnap(snap);
          scheduleThumbRefresh(pageIndex);
          return;
        }
        pushSnap(snap);
        scheduleThumbRefresh(pageIndex);
      };
      trackObjectHandleDrag(event, move, end);
    });
    mark.appendChild(handle);
  }
}

function selectedObjectEntries() {
  if (!selText) return [];
  const seen = new Set();
  return [selText, ...multiSel]
    .filter(entry => entry?.obj && entry?.mark &&
      (entry.k === undefined || entry.k === selText.k))
    .filter(entry => {
      if (seen.has(entry.obj)) return false;
      seen.add(entry.obj);
      return true;
    });
}

function removeMultiSelectionBounds(wrap = null) {
  (wrap || viewer).querySelectorAll('.multiSelectionBounds').forEach(element => element.remove());
}

function selectedMarksBounds(entries, wrap) {
  const wrapRect = wrap.getBoundingClientRect();
  const boxes = entries.map(entry => entry.mark.getBoundingClientRect())
    .filter(box => Number.isFinite(box.left) && Number.isFinite(box.top));
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.left)) - wrapRect.left;
  const top = Math.min(...boxes.map(box => box.top)) - wrapRect.top;
  const right = Math.max(...boxes.map(box => box.right)) - wrapRect.left;
  const bottom = Math.max(...boxes.map(box => box.bottom)) - wrapRect.top;
  return { left, top, right, bottom, width: right - left, height: bottom - top, wrapRect };
}

function positionMultiSelectionBounds(element, bounds) {
  if (!element || !bounds) return;
  element.style.left = bounds.left + 'px';
  element.style.top = bounds.top + 'px';
  element.style.width = bounds.width + 'px';
  element.style.height = bounds.height + 'px';
}

function redrawScaledSelection(entries, wrap, pageIndex) {
  const width = wrap.clientWidth, height = wrap.clientHeight;
  const page = editorStore.pages[pageIndex];
  syncPageConnectors(page, width, height);
  for (const { obj, mark } of entries) {
    if (isTextObj(obj)) {
      positionObjectMark(mark, obj.fx * width, obj.fy * height);
      mark.style.width = (obj.fw * width) + 'px';
      mark.style.height = (obj.fh * height) + 'px';
      mark.style.minHeight = '0';
      mark.style.fontSize = (obj.size * editorStore.zoom) + 'px';
      mark.style.wordBreak = 'break-all';
      applyObjRotation(mark, obj);
    } else drawShapeEl(mark, obj, width, height);
  }
  redrawConnectedArrows(pageIndex, wrap);
  positionTextBar();
}

function placeMultiSelectionHandles(wrap) {
  removeMultiSelectionBounds(wrap);
  const entries = selectedObjectEntries().filter(entry => entry.mark.parentElement === wrap);
  if (entries.length < 2) return false;
  const bounds = selectedMarksBounds(entries, wrap);
  if (!bounds) return false;

  const box = document.createElement('div');
  box.className = 'multiSelectionBounds';
  positionMultiSelectionBounds(box, bounds);
  const pageIndex = +wrap.dataset.k;
  for (const dir of ['nw', 'ne', 'se', 'sw']) {
    const handle = document.createElement('div');
    handle.className = 'objHandle dir-' + dir;
    handle.title = '선택한 오브젝트 전체 크기 조절';
    bindObjectHandle(handle, event => {
      const startBounds = selectedMarksBounds(entries, wrap);
      if (!startBounds) return;
      const snapshots = entries.map(entry => ({
        ...entry,
        geometry: objectScaleSnapshot(entry.obj,
          entry.mark.offsetWidth / startBounds.wrapRect.width,
          entry.mark.offsetHeight / startBounds.wrapRect.height),
      }));
      const anchorPxX = dir.includes('e') ? startBounds.left : startBounds.right;
      const anchorPxY = dir.includes('s') ? startBounds.top : startBounds.bottom;
      const cornerPxX = dir.includes('e') ? startBounds.right : startBounds.left;
      const cornerPxY = dir.includes('s') ? startBounds.bottom : startBounds.top;
      const vectorX = cornerPxX - anchorPxX, vectorY = cornerPxY - anchorPxY;
      const denominator = vectorX * vectorX + vectorY * vectorY || 1;
      const anchorX = anchorPxX / startBounds.wrapRect.width;
      const anchorY = anchorPxY / startBounds.wrapRect.height;
      const snap = makeSnap();
      let moved = false;
      entries.forEach(entry => entry.mark.classList.add('resizing'));
      const move = next => {
        const dx = next.clientX - event.clientX, dy = next.clientY - event.clientY;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        const scale = ((vectorX + dx) * vectorX + (vectorY + dy) * vectorY) / denominator;
        for (const entry of snapshots)
          applyObjectScaleSnapshot(entry.obj, entry.geometry, anchorX, anchorY, scale);
        redrawScaledSelection(entries, wrap, pageIndex);
        positionMultiSelectionBounds(box, selectedMarksBounds(entries, wrap));
      };
      const end = () => {
        entries.forEach(entry => entry.mark.classList.remove('resizing'));
        if (moved) {
          pushSnap(snap);
          scheduleThumbRefresh(pageIndex);
        }
        placeMultiSelectionHandles(wrap);
      };
      trackObjectHandleDrag(event, move, end);
    });
    box.appendChild(handle);
  }
  wrap.appendChild(box);
  return true;
}

function addArrowHeadResizeHandles(mark, object, wrap, rect, geometry) {
  const handleGap = isMobileLayout() ? 28 : 9;
  const size = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +object.arrowHeadSize || 10));
  const zoom = editorStore.zoom;
  const { end, angle } = connectorEndDirection(geometry.points);
  const degrees = angle * 180 / Math.PI + (+object.arrowHeadRotation || 0);
  arrowHeadResizeVectors(object).forEach((vector, index) => {
    const handle = document.createElement('div');
    handle.className = 'objHandle arrowHeadResize';
    handle.dataset.arrowHeadCorner = String(index);
    handle.title = '화살표 머리 크기 조절';
    const offset = rotateScreenDelta(vector[0] * size * zoom - handleGap,
      vector[1] * size * zoom + Math.sign(vector[1]) * handleGap, degrees);
    handle.style.left = (end[0] + offset[0]) + 'px';
    handle.style.top = (end[1] + offset[1]) + 'px';
    const direction = normRotation(degrees + objRotation(object) + Math.atan2(vector[1], vector[0]) * 180 / Math.PI);
    handle.style.cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(direction / 45) % 4];
    bindObjectHandle(handle, event => {
      const snap = makeSnap();
      const rotation = objRotation(object);
      let moved = false;
      mark.classList.add('resizing');
      const move = next => {
        const dx = next.clientX - event.clientX, dy = next.clientY - event.clientY;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        const local = rotateScreenDelta(dx, dy, -degrees - rotation);
        object.arrowHeadSize = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX,
          Math.round(size + arrowHeadSizeDelta(vector, local[0], local[1], zoom))));
        drawShapeEl(mark, object, rect.width, rect.height);
        placeHandles(mark, object);
        syncArrowOptionControls(object);
        positionTextBar();
      };
      const finish = () => {
        mark.classList.remove('resizing');
        if (moved) {
          pushSnap(snap);
          lastShapeStyle.arrowHeadSize = object.arrowHeadSize;
          saveLastStyles();
          scheduleThumbRefresh(+wrap.dataset.k);
        }
        placeHandles(mark, object);
      };
      trackObjectHandleDrag(event, move, finish);
    });
    mark.appendChild(handle);
  });
}

function placePolylineHandles(mark, object, wrap) {
  const rect = wrap.getBoundingClientRect();
  const geometry = polylineGeo(object, rect.width, rect.height);
  const points = polylineObjectPoints(object);
  const pageIndex = +wrap.dataset.k;
  const redraw = () => {
    drawShapeEl(mark, object, rect.width, rect.height);
    placeHandles(mark, object);
    positionTextBar();
  };
  const xValues = points.map(point => point[0] * rect.width);
  const yValues = points.map(point => point[1] * rect.height);
  const minX = Math.min(...xValues), maxX = Math.max(...xValues);
  const minY = Math.min(...yValues), maxY = Math.max(...yValues);
  for (const dir of ['nw', 'ne', 'se', 'sw']) {
    const east = dir.includes('e'), south = dir.includes('s');
    const cornerX = east ? maxX : minX, cornerY = south ? maxY : minY;
    const anchorX = east ? minX : maxX, anchorY = south ? minY : maxY;
    const handle = document.createElement('div');
    handle.className = 'objHandle polyBoundsHandle';
    handle.dataset.polyBounds = dir;
    handle.style.left = (cornerX - geometry.l + (east ? 10 : -10)) + 'px';
    handle.style.top = (cornerY - geometry.tp + (south ? 10 : -10)) + 'px';
    handle.style.cursor = (dir === 'nw' || dir === 'se') ? 'nwse-resize' : 'nesw-resize';
    handle.title = '연결선 전체 크기 조절';
    bindObjectHandle(handle, event => {
      const start = polylineObjectPoints(object);
      const startSpanX = cornerX - anchorX;
      const startSpanY = cornerY - anchorY;
      const snap = makeSnap();
      let moved = false;
      mark.classList.add('resizing');
      const move = next => {
        let nextX = cornerX + next.clientX - event.clientX;
        let nextY = cornerY + next.clientY - event.clientY;
        nextX = Math.max(0, Math.min(rect.width, nextX));
        nextY = Math.max(0, Math.min(rect.height, nextY));
        let scaleX = startSpanX ? (nextX - anchorX) / startSpanX : 1;
        let scaleY = startSpanY ? (nextY - anchorY) / startSpanY : 1;
        if (next.shiftKey) {
          const uniform = Math.min(Math.abs(scaleX), Math.abs(scaleY));
          scaleX = Math.sign(scaleX) * uniform; scaleY = Math.sign(scaleY) * uniform;
        }
        if (!moved && Math.hypot(next.clientX - event.clientX,
          next.clientY - event.clientY) < 2) return;
        moved = true;
        object.points = start.map(point => {
          const px = point[0] * rect.width, py = point[1] * rect.height;
          return [
            Math.max(0, Math.min(1, (anchorX + (px - anchorX) * scaleX) / rect.width)),
            Math.max(0, Math.min(1, (anchorY + (py - anchorY) * scaleY) / rect.height)),
          ];
        });
        redraw();
      };
      const end = () => {
        mark.classList.remove('resizing');
        if (moved) {
          pushSnap(snap);
          scheduleThumbRefresh(pageIndex);
        }
        placeHandles(mark, object);
      };
      trackObjectHandleDrag(event, move, end);
    });
    mark.appendChild(handle);
  }
  points.forEach((point, index) => {
    const handle = document.createElement('div');
    handle.className = 'objHandle polyVertex';
    handle.style.left = (point[0] * rect.width - geometry.l) + 'px';
    handle.style.top = (point[1] * rect.height - geometry.tp) + 'px';
    handle.dataset.polyVertexIndex = String(index);
    handle.title = '연결점 이동 · Shift: 수직 맞춤';
    bindObjectHandle(handle, event => {
      const start = polylineObjectPoints(object);
      const snap = makeSnap();
      let moved = false;
      mark.classList.add('resizing');
      const move = next => {
        const dx = (next.clientX - event.clientX) / rect.width;
        const dy = (next.clientY - event.clientY) / rect.height;
        if (!moved && Math.hypot(dx * rect.width, dy * rect.height) < 2) return;
        moved = true;
        object.points = start.map(vertex => [...vertex]);
        object.points[index] = [
          Math.max(0, Math.min(1, start[index][0] + dx)),
          Math.max(0, Math.min(1, start[index][1] + dy)),
        ];
        if (next.shiftKey)
          object.points[index] = constrainPolylineVertex(start, index, object.points[index], object.closed);
        redraw();
      };
      const end = () => {
        mark.classList.remove('resizing');
        if (moved) {
          pushSnap(snap);
          scheduleThumbRefresh(pageIndex);
        }
        placeHandles(mark, object);
      };
      trackObjectHandleDrag(event, move, end);
    });
    mark.appendChild(handle);
  });

  const segmentCount = object.closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < segmentCount; index++) {
    const nextIndex = (index + 1) % points.length;
    const a = points[index], b = points[nextIndex];
    const handle = document.createElement('div');
    handle.className = 'objHandle polySegment';
    handle.dataset.polySegmentIndex = String(index);
    handle.style.left = ((a[0] + b[0]) * rect.width / 2 - geometry.l) + 'px';
    handle.style.top = ((a[1] + b[1]) * rect.height / 2 - geometry.tp) + 'px';
    handle.title = '선분 위치 이동 · Shift: 수직 이동';
    bindObjectHandle(handle, event => {
      const start = polylineObjectPoints(object);
      const snap = makeSnap();
      let moved = false;
      mark.classList.add('resizing');
      const move = pointer => {
        let dx = (pointer.clientX - event.clientX) / rect.width;
        let dy = (pointer.clientY - event.clientY) / rect.height;
        if (!moved && Math.hypot(dx * rect.width, dy * rect.height) < 2) return;
        moved = true;
        if (pointer.shiftKey) dx = 0;
        dx = Math.max(-Math.min(start[index][0], start[nextIndex][0]),
          Math.min(1 - Math.max(start[index][0], start[nextIndex][0]), dx));
        dy = Math.max(-Math.min(start[index][1], start[nextIndex][1]),
          Math.min(1 - Math.max(start[index][1], start[nextIndex][1]), dy));
        object.points = start.map(vertex => [...vertex]);
        object.points[index] = [start[index][0] + dx, start[index][1] + dy];
        object.points[nextIndex] = [start[nextIndex][0] + dx, start[nextIndex][1] + dy];
        redraw();
      };
      const end = () => {
        mark.classList.remove('resizing');
        if (moved) {
          pushSnap(snap);
          scheduleThumbRefresh(pageIndex);
        }
        placeHandles(mark, object);
      };
      trackObjectHandleDrag(event, move, end);
    });
    mark.appendChild(handle);
  }
}

function placeHandles(m, t) {
  m.querySelectorAll('.objHandle').forEach(h => h.remove());
  if (m.isContentEditable || m._shapeTextEditor?.isContentEditable) return;  
  if (!m.classList.contains('sel') && !m.classList.contains('textMark')) return;
  if (!selText || selText.mark !== m || hasMixedSelection()) return;
  const wrap = m.parentElement;
  if (!wrap) return;
  if (multiSel.length && placeMultiSelectionHandles(wrap)) return;
  if (t.type === 'polyline') {
    placePolylineHandles(m, t, wrap);
    addRotationHandle(m, t, wrap);
    return;
  }
  const isLine = t.type === 'line' || t.type === 'arrow';
  if (isLine) {
    const rect = wrap.getBoundingClientRect();
    const g = objLineGeo(t, rect.width, rect.height);
    [['p1', g.x1, g.y1, 'x1', 'y1'], ['p2', g.x2, g.y2, 'x2', 'y2']].forEach(([cls, hx, hy, px, py]) => {
      const h = document.createElement('div');
      h.className = 'objHandle ' + cls;
      h.style.left = hx + 'px'; h.style.top = hy + 'px';
      if (t.type === 'line') setUiAttribute(h, 'title', 'Shift: 수평·수직 맞춤');
      if (px === 'x1' && t.type === 'arrow' && t.attachTo)
        h.title = t.connectorAnchor === 'edge'
          ? '가장자리 연결 유지 · Shift: 면 중앙 맞춤'
          : '면 중앙 연결 유지 · 드래그: 연결할 면 변경';
      bindObjectHandle(h, ev => {
        m.classList.add('resizing');  
        const start = {
          x: ev.clientX, y: ev.clientY, rot: objRotation(t),
          anchor: t.connectorAnchor === 'edge' ? 'edge' : 'side-midpoints',
          x1: t.x1 * rect.width, y1: t.y1 * rect.height,
          x2: t.x2 * rect.width, y2: t.y2 * rect.height
        };
        const scx = (start.x1 + start.x2) / 2, scy = (start.y1 + start.y2) / 2;
        const sv1 = rotateScreenPoint(start.x1, start.y1, scx, scy, start.rot);
        const sv2 = rotateScreenPoint(start.x2, start.y2, scx, scy, start.rot);
        const movingFirst = px === 'x1';
        const snap = makeSnap();
        const initialBend = connectorPolyline(t)[1];
        let moved = false;
        const mv = e2 => {
          const dx = e2.clientX - start.x, dy = e2.clientY - start.y;
          if (!moved && Math.hypot(dx, dy) < 2) return;
          if (!moved && !movingFirst && t.type === 'arrow' && t.connectorStyle === 'angled') {
            t.connectorBendX = initialBend[0]; t.connectorBendY = initialBend[1];
          }
          moved = true;
          const v1 = movingFirst ? [sv1[0] + dx, sv1[1] + dy] : sv1;
          const v2 = movingFirst ? sv2 : [sv2[0] + dx, sv2[1] + dy];
          if (t.type === 'line' && e2.shiftKey) {
            const moving = movingFirst ? v1 : v2;
            const fixed = movingFirst ? v2 : v1;
            if (Math.abs(moving[0] - fixed[0]) >= Math.abs(moving[1] - fixed[1]))
              moving[1] = fixed[1];
            else moving[0] = fixed[0];
          }
          const cx = (v1[0] + v2[0]) / 2, cy = (v1[1] + v2[1]) / 2;
          const u1 = rotateScreenPoint(v1[0], v1[1], cx, cy, -start.rot);
          const u2 = rotateScreenPoint(v2[0], v2[1], cx, cy, -start.rot);
          t.x1 = u1[0] / rect.width; t.y1 = u1[1] / rect.height;
          t.x2 = u2[0] / rect.width; t.y2 = u2[1] / rect.height;
          const page = editorStore.pages[+wrap.dataset.k];
          if (movingFirst && t.attachTo) {
            const shape = page?.texts?.find(object =>
              isConnectableShape(object) && object.linkId === t.attachTo);
            if (shape) {
              let towardX = t.x1, towardY = t.y1;
              const anchor = start.anchor === 'side-midpoints' || e2.shiftKey ? 'side-midpoints' : 'edge';
              if (anchor === 'side-midpoints') {
                const nearest = shapeSideMidpoints(shape, rect.width, rect.height)
                  .map(point => ({ point, distance: Math.hypot(
                    (point[0] - towardX) * rect.width,
                    (point[1] - towardY) * rect.height) }))
                  .sort((a, b) => a.distance - b.distance)[0];
                if (nearest) {
                  [towardX, towardY] = nearest.point;
                }
              }
              const vector = shapeAnchorVector(shape, towardX, towardY, rect.width, rect.height);
              if (vector) {
                t.connectorAnchorX = vector[0];
                t.connectorAnchorY = vector[1];
                t.connectorAnchor = anchor;
                t.attachPoint = 'start';
              }
            }
          }
          syncAttachedArrow(page, t, rect.width, rect.height);
          drawShapeEl(m, t, rect.width, rect.height);
          placeHandles(m, t);
          if (t.type === 'arrow') syncArrowOptionControls(t);
        };
        const up = () => {
          m.classList.remove('resizing');
          if (moved) {
            pushSnap(snap);
            scheduleThumbRefresh(+wrap.dataset.k);
          }
        };
        trackObjectHandleDrag(ev, mv, up);
      });
      m.appendChild(h);
    });
    if (t.type === 'arrow') {
      addConnectorBodyHandles(m, t, wrap, rect, g);
      addArrowHeadResizeHandles(m, t, wrap, rect, g);
    }
    addRotationHandle(m, t, wrap);
    return;
  }
  const isText = isTextObj(t);
  const mobileResize = matchMedia('(max-width: 768px)').matches;
  const small = m.offsetWidth < 110 || m.offsetHeight < 46;
  const allDirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const dirs = mobileResize || !small || t.type === 'rect' ? allDirs : ['nw', 'ne', 'se', 'sw'];
  dirs.forEach(dir => {
    const h = document.createElement('div');
    h.className = 'objHandle dir-' + dir;
    bindObjectHandle(h, ev => {
      m.classList.add('resizing');  
      const rect = wrap.getBoundingClientRect();
      const start = {
        x: ev.clientX, y: ev.clientY, fx: t.fx, fy: t.fy,
        fw: t.fw !== undefined ? t.fw : m.offsetWidth / rect.width,
        fh: t.fh !== undefined ? t.fh : m.offsetHeight / rect.height,
        hadW: t.fw !== undefined, hadH: t.fh !== undefined, rot: objRotation(t),
        flipX: !!t.flipX, flipY: !!t.flipY
      };
      const snap = makeSnap();
      const startBox = { l: start.fx * rect.width, t: start.fy * rect.height,
        w: start.fw * rect.width, h: start.fh * rect.height,
        rot: start.rot, flipX: start.flipX, flipY: start.flipY };
      const applyText = () => {
        m.style.width = (t.fw * rect.width) + 'px';
        m.style.height = (t.fh * rect.height) + 'px';
        m.style.minHeight = '0';
        applyObjRotation(m, t);
        m.style.wordBreak = 'break-all';
        positionObjectMark(m, t.fx * rect.width, t.fy * rect.height);
      };
      let moved = false;
      const mv = e2 => {
        if (!moved && Math.hypot(e2.clientX - start.x, e2.clientY - start.y) < 2) return;
        moved = true;
        const box = resizeObjectBox(startBox, dir, e2.clientX - start.x, e2.clientY - start.y,
          mobileResize || e2.shiftKey);
        t.fw = box.w / rect.width; t.fh = box.h / rect.height;
        t.fx = box.l / rect.width; t.fy = box.t / rect.height;
        t.flipX = box.flipX; t.flipY = box.flipY;
        if (isText) applyText(); else drawShapeEl(m, t, rect.width, rect.height);
        redrawConnectedArrows(+wrap.dataset.k, wrap);
        positionTextBar();
        placeHandles(m, t);
      };
      const up = () => {
        m.classList.remove('resizing');
        if (!moved) { placeHandles(m, t); return; }
        pushSnap(snap);
        placeHandles(m, t);
        scheduleThumbRefresh(+wrap.dataset.k);
      };
      trackObjectHandleDrag(ev, mv, up);
    });
    m.appendChild(h);
  });
  addRotationHandle(m, t, wrap);
}

function addRotationHandle(m, t, wrap) {
  if (t.type === 'arrow' && t.arrowEndType === 'none') return;
  const headOnly = t.type === 'arrow';
  const h = document.createElement('div');
  h.className = 'objHandle rotate';
  h.title = headOnly ? '화살표 머리 회전 · Shift: 90° · Alt: 정밀 회전 · Ctrl: 복제' : t.type === 'arrow' && t.attachTo
    ? '도형 연결 유지 · Shift: 90° · Alt: 정밀 회전 · Ctrl: 복제'
    : 'Shift: 90° · Alt: 정밀 회전 · Ctrl: 복제';
  if (t.type === 'line' || t.type === 'arrow') {
    const geometry = objLineGeo(t, wrap.clientWidth, wrap.clientHeight);
    const middleX = headOnly ? geometry.x2 : (geometry.x1 + geometry.x2) / 2;
    const middleY = headOnly ? geometry.y2 : (geometry.y1 + geometry.y2) / 2;
    const headAngle = connectorEndDirection(geometry.points).angle + (+t.arrowHeadRotation || 0) * Math.PI / 180;
    const dx = headOnly ? Math.cos(headAngle) : geometry.x2 - geometry.x1;
    const dy = headOnly ? Math.sin(headAngle) : geometry.y2 - geometry.y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    let normalX = dy / length, normalY = -dx / length;
    if (!headOnly && (normalY > 0 || (Math.abs(normalY) < .001 && normalX < 0))) {
      normalX *= -1; normalY *= -1;
    }
    const distance = Math.max(isMobileLayout() ? 64 : 48,
      headOnly ? (+t.arrowHeadSize || 10) * editorStore.zoom * .75 + (isMobileLayout() ? 40 : 24) : 0);
    const knobX = middleX + normalX * distance;
    const knobY = middleY + normalY * distance;
    const stemAngle = Math.atan2(middleY - knobY, middleX - knobX) * 180 / Math.PI - 90;
    h.classList.add('lineRotate');
    h.style.left = (knobX - 10) + 'px';
    h.style.top = (knobY - 10) + 'px';
    h.style.setProperty('--rotate-stem-length', (distance - 7) + 'px');
    h.style.setProperty('--rotate-stem-angle', stemAngle + 'deg');
  }
  bindObjectHandle(h, ev => {
    const r = m.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const k = +wrap.dataset.k, page = editorStore.pages[k];
    const attachedShape = t.type === 'arrow' && t.attachTo
      ? page?.texts?.find(object => isConnectableShape(object) && object.linkId === t.attachTo)
      : null;
    const isConnector = t.type === 'line' || t.type === 'arrow';
    const headPivot = headOnly ? rotateScreenPoint(t.x2 * wrapRect.width, t.y2 * wrapRect.height,
      (t.x1 + t.x2) * wrapRect.width / 2, (t.y1 + t.y2) * wrapRect.height / 2, objRotation(t)) : null;
    const cx = headOnly ? wrapRect.left + headPivot[0] : attachedShape
      ? wrapRect.left + t.x1 * wrapRect.width : isConnector
      ? wrapRect.left + (t.x1 + t.x2) * wrapRect.width / 2 : r.left + r.width / 2;
    const cy = headOnly ? wrapRect.top + headPivot[1] : attachedShape
      ? wrapRect.top + t.y1 * wrapRect.height : isConnector
      ? wrapRect.top + (t.y1 + t.y2) * wrapRect.height / 2 : r.top + r.height / 2;
    const startRot = headOnly ? (+t.arrowHeadRotation || 0) : objRotation(t);
    const startPoints = t.type === 'polyline' ? polylineObjectPoints(t) : null;
    const startArrow = t.type === 'arrow' ? {
      x1: +t.x1 || 0, y1: +t.y1 || 0, x2: +t.x2 || 0, y2: +t.y2 || 0,
      rot: startRot, ...connectorControlSnapshot(t),
    } : null;
    const fixedAnchor = attachedShape &&
      (!Number.isFinite(+t.connectorAnchorX) || !Number.isFinite(+t.connectorAnchorY))
      ? shapeAnchorVector(attachedShape, t.x1, t.y1, wrapRect.width, wrapRect.height)
      : null;
    const restoreArrowStart = () => {
      if (!startArrow) return;
      Object.assign(t, {
        x1: startArrow.x1, y1: startArrow.y1, x2: startArrow.x2, y2: startArrow.y2,
        rot: startArrow.rot,
      });
      for (const key of ['connectorControlX', 'connectorControlY', 'connectorBendX', 'connectorBendY']) {
        if (startArrow[key] === null) delete t[key]; else t[key] = startArrow[key];
      }
    };
    const wantCopy = ev.ctrlKey;
    const copyBundle = wantCopy
      ? copyConnectedObjectBundle(editorStore.pages[k], t, createConnectorId)
      : [];
    let lastA = Math.atan2(ev.clientY - cy, ev.clientX - cx), accum = 0, moved = false;
    let ghost = null;
    const readout = rotationReadout();
    const snap = makeSnap();
    m.classList.add('resizing');
    const mv = e2 => {
      const a = Math.atan2(e2.clientY - cy, e2.clientX - cx);
      let da = a - lastA;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      accum += da * (e2.altKey ? .02 : 1); lastA = a;
      if (!moved && Math.hypot(e2.clientX - ev.clientX, e2.clientY - ev.clientY) < 2) return;
      moved = true;
      if (wantCopy && !ghost) {
        ghost = m.cloneNode(true);
        ghost.classList.remove('sel', 'resizing');
        ghost.querySelectorAll('.objHandle').forEach(x => x.remove());
        m.parentElement.insertBefore(ghost, m);
      }
      let deg = startRot + accum * 180 / Math.PI;
      if (e2.shiftKey) deg = Math.round(deg / 90) * 90;
      readout.show(e2,deg);
      if (headOnly) {
        t.arrowHeadRotation = normRotation(deg);
        drawShapeEl(m, t, wrapRect.width, wrapRect.height);
      } else if (startArrow) {
        restoreArrowStart();
        if (fixedAnchor) {
          t.connectorAnchorX = fixedAnchor[0];
          t.connectorAnchorY = fixedAnchor[1];
        }
        rotateConnectorJoints(t, wrapRect.width, wrapRect.height, deg,
          attachedShape ? 'start' : 'center');
        if (attachedShape) syncAttachedArrow(page, t, wrapRect.width, wrapRect.height);
        drawShapeEl(m, t, wrapRect.width, wrapRect.height);
      } else if (startPoints) {
        t.points = rotatePolylinePoints(startPoints, wrapRect.width, wrapRect.height, deg);
        t.rot = 0;
        drawShapeEl(m, t, wrapRect.width, wrapRect.height);
        placeHandles(m, t);
      } else {
        t.rot = normRotation(deg);
        applyObjRotation(m, t);
      }
      redrawConnectedArrows(k, wrap);
      if (startArrow) placeHandles(m, t);
      positionTextBar();
      scheduleThumbRefresh(+wrap.dataset.k);
    };
    const up = () => {
      m.classList.remove('resizing');
      readout.close();
      if (ghost) ghost.remove();
      if (moved) {
        if (wantCopy) {
          const arr = editorStore.pages[k].texts;
          arr.splice(arr.indexOf(t), 0, ...copyBundle);
        }
        pushSnap(snap);
        t.rot = normRotation(objRotation(t));
        if (wantCopy) {
          positionMarks(wrap, editorStore.pages[k]);
          const marks = [...wrap.querySelectorAll('.obj')];
          const nm = marks[editorStore.pages[k].texts.indexOf(t)];
          keepMultiOnce = true;
          if (nm) selectMark(k, t, nm);
          keepMultiOnce = false;
          multiSel = multiSel
            .map(s => ({ obj: s.obj, mark: marks[editorStore.pages[k].texts.indexOf(s.obj)] }))
            .filter(s => s.mark);
          multiSel.forEach(s => s.mark.classList.add('sel'));
          refreshSelectedObjectHandles();
        }
        scheduleThumbRefresh(k);
      }
    };
    trackObjectHandleDrag(ev, mv, up);
  });
  m.appendChild(h);
}

function estimatePageSize() {
  for (const p of editorStore.pages) if (p._w1) return { w: p._w1, h: p._h1 };
  return { w: 595.28, h: 841.89 };
}

function rebuildAll() {
  const documentAtBuild = editorStore.activeDocument;
  const revision = documentViewRevision;
  const isCurrentView = () => documentAtBuild === editorStore.activeDocument && revision === documentViewRevision;
  if (selText) deselectText();
  const wraps = [...viewer.querySelectorAll('.pageWrap')];
  while (wraps.length > editorStore.pages.length) {
    const w = wraps.pop(); pageObserver.unobserve(w); w.remove();
  }
  while (wraps.length < editorStore.pages.length) {
    const wrap = document.createElement('div');
    wrap.className = 'pageWrap';
    wrap.appendChild(document.createElement('canvas'));
    $('pagesBox').appendChild(wrap);
    pageObserver.observe(wrap);
    wraps.push(wrap);
  }
  const est = estimatePageSize();
  wraps.forEach((wrap, k) => {
    const p = editorStore.pages[k];
    wrap.querySelector('.openingPreview')?.remove();
    wrap.dataset.k = k;
    wrap.id = 'pg' + k;
    wrap.classList.toggle('textMode', textMode);
    const w1 = p._w1 || est.w, h1 = p._h1 || est.h;
    sizeWrap(wrap, w1 * editorStore.zoom, h1 * editorStore.zoom);
    const cv = wrap.querySelector('canvas');
    if (cv && wrap.dataset.rendered !== renderKey(p)) {
      cv.style.width = (w1 * editorStore.zoom) + 'px';
      cv.style.height = (h1 * editorStore.zoom) + 'px';
    }
    positionMarks(wrap, p);
    if (wrap.dataset.pageId && wrap.dataset.pageId !== p.src + ':' + p.idx) {
      cv.width = 0; cv.height = 0;
      delete wrap.dataset.pageId;
      if (wrap._task) { try { wrap._task.cancel(); } catch {} wrap._task = null; }
    }
    if (wrap.dataset.rendered !== renderKey(p)) {
      delete wrap.dataset.rendered;
    }
  });
  if (editorStore.pages.length && !editorStore.pages.some(p => p._w1)) {
    getViewport(editorStore.pages[0], 1).then(() => {
      if (!isCurrentView()) return;
      const e2 = estimatePageSize();
      viewer.querySelectorAll('.pageWrap').forEach(w => {
        const p = editorStore.pages[+w.dataset.k];
        if (p && !p._w1) sizeWrap(w, e2.w * editorStore.zoom, e2.h * editorStore.zoom);
      });
      if (editorStore.fitWidth) doFitWidth();
    });
  }
  const primeVisible = () => {
    if (!isCurrentView()) return;
    const vr = viewer.getBoundingClientRect();
    viewer.querySelectorAll('.pageWrap').forEach(w => {
      if (w.style.display === 'none') return;
      const r = w.getBoundingClientRect();
      if (r.bottom > vr.top - 600 && r.top < vr.bottom + 600) {
        if (!w.dataset.pageId) paintThumbPreview(w, editorStore.pages[+w.dataset.k]);
        enqueueRender(w);
      }
    });
  };
  primeVisible();
  requestAnimationFrame(primeVisible);
  const thumbs = [...sidebar.querySelectorAll('.thumb')];
  while (thumbs.length > editorStore.pages.length) {
    const t = thumbs.pop(); thumbObserver.unobserve(t);
    const u = t.querySelector('img')?.dataset.url;
    if (u) URL.revokeObjectURL(u);
    t.remove();
  }
  while (thumbs.length < editorStore.pages.length) {
    const t = document.createElement('div');
    t.className = 'thumb';
    t.draggable = true;
    const im = document.createElement('img');
    im.alt = '';
    im.draggable = false;    
    im.decoding = 'async';
    im.src = THUMB_BLANK;    
    t.appendChild(im);
    const num = document.createElement('div');
    num.className = 'num';
    t.appendChild(num);
    sidebar.appendChild(t);
    thumbObserver.observe(t);
    thumbs.push(t);
  }
  thumbs.forEach((t, k) => {
    const p = editorStore.pages[k];
    t.dataset.k = k;
    t.querySelector('.num').textContent = k + 1;
    t.classList.toggle('selected', editorStore.selectedPages.has(k));
    const im = t.querySelector('img');
    if (t.dataset.preview && t.dataset.preview !== thumbKey(p)) clearThumbImage(t);
    const cur = t.dataset.rendered;
    if (!cur || !cur.startsWith(p.src + ':' + p.idx + ':')) {
      const key = thumbKey(p);
      const hit = thumbCacheGet(key);
      if (hit) { if (cur !== key) setThumbImage(t, key, hit.blob, hit.w, hit.h); }
      else if (cur) clearThumbImage(t);
    }
    if (!t.dataset.rendered) {
      const w1 = p._w1 || est.w, h1 = p._h1 || est.h;
      im.style.aspectRatio = (w1 / h1).toFixed(4);
    }
    if (t.dataset.rendered && t._thumbNear) enqueueThumb(t);  
  });
  updateStatus();
  markCurrentThumb();
  updatePageVisibility();
  clearSearchHits();
  scheduleDimsSweep();     
  scheduleThumbPrepass();  
  updateLockUi();          
  restoreRegionRect();     
}

viewer.addEventListener('click', e => {
  const wrap = e.target.closest('.pageWrap');
  if (!wrap) return;
  if (stampData) {  
    const k = +wrap.dataset.k, r = wrap.getBoundingClientRect();
    const { data, clip, release } = stampData;
    const { fw, fh } = stampSize(wrap);
    const point = release && release.wrap === wrap && e.detail > 0 &&
      Math.abs(release.clientX - e.clientX) < 1 && Math.abs(release.clientY - e.clientY) < 1
      ? release : e;
    const { fx, fy } = stampPlacement(r, point.clientX, point.clientY, fw, fh);
    addObjAndSelect(k, {
      type: 'img', data,
      fx, fy, fw, fh,
      ...(clip ? { clipSrc: clip.src, clipIdx: clip.idx, clipBox: clip.box, clipRotation: clip.rotation, clipOpaque: true, clipFragment: true } : {})
    });
    stampCancel();
    return;
  }
  if (regionMode) return;  
  if (origMode || e.shiftKey || e.ctrlKey) {
    if (!origSquelchClick && !e.target.closest('.origBox') && !e.target.closest('.origEdit')
        && !e.target.closest('.obj'))  
      origClickSelect(e, wrap, +wrap.dataset.k);
    return;
  }
  onPageClick(e, wrap, +wrap.dataset.k);
});
const thumbClearDragCls = t => t.classList.remove('dragover-before', 'dragover-after', 'dragover-left', 'dragover-right');
function sameThumbRow(a, b) {
  if (!a || !b) return false;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return ra.top < rb.bottom && rb.top < ra.bottom;
}
function thumbFlowHoriz(t) {
  return sameThumbRow(t, t.previousElementSibling) || sameThumbRow(t, t.nextElementSibling);
}
function thumbDropBefore(t, ev) {
  const r = t.getBoundingClientRect();
  return thumbFlowHoriz(t) ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2;
}
sidebar.addEventListener('click', e => {
  const t = e.target.closest('.thumb');
  if (!t) return;
  const k = +t.dataset.k;
  if (e.ctrlKey) toggleSelect(k, false);
  else if (e.shiftKey) toggleSelect(k, true);
  else {
    editorStore.selectedPages.clear(); editorStore.selectedPages.add(k); editorStore.lastSelected = k;
    refreshThumbSelection();
    gotoPage(k + 1);
  }
});
sidebar.addEventListener('dragstart', e => {
  const t = e.target.closest('.thumb');
  if (!t) return;
  e.dataTransfer.setData('text/plain', t.dataset.k);
  e.dataTransfer.effectAllowed = 'move';
});
sidebar.addEventListener('dragover', e => {
  if ([...e.dataTransfer.types].includes('Files')) return;  
  const t = e.target.closest('.thumb');
  if (!t) return;
  e.preventDefault();
  const before = thumbDropBefore(t, e), horiz = thumbFlowHoriz(t);
  thumbClearDragCls(t);
  t.classList.add(horiz ? (before ? 'dragover-left' : 'dragover-right')
                        : (before ? 'dragover-before' : 'dragover-after'));
});
sidebar.addEventListener('dragleave', e => {
  const t = e.target.closest('.thumb');
  if (t) thumbClearDragCls(t);
});
let sbScrollV = 0, sbScrollRaf = null;
function sbScrollLoop() {
  if (!sbScrollV) { sbScrollRaf = null; return; }
  sidebar.scrollTop += sbScrollV;
  sbScrollRaf = requestAnimationFrame(sbScrollLoop);
}
sidebar.addEventListener('dragover', e => {
  const r = sidebar.getBoundingClientRect();
  const zone = 70, maxV = 9;
  const dTop = e.clientY - r.top, dBot = r.bottom - e.clientY;
  sbScrollV = dTop < zone ? -Math.min(maxV, ((zone - dTop) / zone) ** 1.5 * maxV)
            : dBot < zone ? Math.min(maxV, ((zone - dBot) / zone) ** 1.5 * maxV) : 0;
  if (sbScrollV && !sbScrollRaf) sbScrollLoop();
});
['drop', 'dragend', 'dragleave'].forEach(ev =>
  sidebar.addEventListener(ev, e => {
    if (ev !== 'dragleave' || !sidebar.contains(e.relatedTarget)) sbScrollV = 0;
  }));
window.addEventListener('dragend', () => { sbScrollV = 0; });
sidebar.addEventListener('drop', e => {
  if ([...e.dataTransfer.types].includes('Files')) return;  
  const t = e.target.closest('.thumb');
  if (!t) return;
  e.preventDefault();
  const from = +e.dataTransfer.getData('text/plain');
  const before = thumbDropBefore(t, e);
  thumbClearDragCls(t);
  if (Number.isInteger(from) && editorStore.pages[from]) movePages(from, +t.dataset.k + (before ? 0 : 1));
});

function refreshThumbSelection() {
  sidebar.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('selected', editorStore.selectedPages.has(+t.dataset.k));
  });
  updateStatus();
}
function toggleSelect(k, shiftRange) {
  if (shiftRange) {
    if (!editorStore.pages[k]) return;
    const anchor = editorStore.pages[editorStore.lastSelected] ? editorStore.lastSelected
      : editorStore.pages[editorStore.currentPage] ? editorStore.currentPage : 0;
    editorStore.lastSelected = anchor;
    editorStore.selectedPages.clear();
    const step = k < anchor ? -1 : 1;
    for (let i = anchor; i !== k; i += step) editorStore.selectedPages.add(i);
    editorStore.selectedPages.add(k);
  } else {
    editorStore.selectedPages.has(k) ? editorStore.selectedPages.delete(k) : editorStore.selectedPages.add(k);
    editorStore.lastSelected = k;
  }
  refreshThumbSelection();
}

function movePages(from, to) {
  if (activeDocLocked()) { lockNotice(); return; }
  pushUndo();
  const result = pageOrganizer.move(editorStore.pages, editorStore.selectedPages, from, to);
  editorStore.pages = result.pages;
  editorStore.selectedPages = result.selectedIndexes;
  rebuildAll();
}

function updateStatus() {
  $('stFile').textContent = editorStore.documentName ? editorStore.documentName + '.pdf' : '파일 없음';
  $('stFile').title = $('stFile').textContent;
  $('stSel').textContent = editorStore.selectedPages.size ? `${editorStore.selectedPages.size}개 선택` : '';
  const zoomInput = $('zoomInput');
  if (document.activeElement !== zoomInput) zoomInput.value = Math.round(editorStore.zoom * 100);
  $('pageTotal').textContent = String(editorStore.pages.length || '-');
  const jump = $('pageJump');
  if (document.activeElement !== jump)
    jump.value = editorStore.pages.length ? Math.min(editorStore.currentPage + 1, editorStore.pages.length) : '';
  const on = editorStore.pages.length > 0;
  ['pgPrev', 'pgNext'].forEach(id => $(id).disabled = !on);
  jump.disabled = !on;
  zoomInput.disabled = !on;
}

function rememberPageView() {
  const index = baseOfCurrent(), page = editorStore.pages[index];
  if (!page || !editorStore.activeDocument?.fitDone) return;
  const center = viewportZoom.capturePageCenter(document.getElementById('pg' + index));
  if (center) viewsForPage(page)[viewMode] = { ...center, fitWidth: editorStore.fitWidth };
}
function restorePageView() {
  const index = baseOfCurrent();
  const saved = pageViews.get(editorStore.pages[index])?.[viewMode];
  const wrap = document.getElementById('pg' + index);
  if (!saved || !wrap) return false;
  cancelPendingViewFit();
  viewportZoom.restorePageCenter(wrap, saved);
  editorStore.fitWidth = saved.fitWidth;
  return true;
}
function gotoPage(n, { restore = true, fromBottom = false } = {}) {
  if (!editorStore.pages.length) return;
  prioritizeReading();
  const k = Math.min(editorStore.pages.length, Math.max(1, n)) - 1;
  updateCurrentPage();
  const sameView = searchViewFeature.basePage(k, viewMode) === baseOfCurrent();
  if (!sameView) rememberPageView();
  editorStore.currentPage = k;
  if (viewMode !== 'scroll') updatePageVisibility();
  if (!restore || (!sameView && !restorePageView())) {
    if (viewMode === 'scroll') document.getElementById('pg' + k)?.scrollIntoView({ block: 'start' });
    else viewportScrollSpace.align(viewer.querySelectorAll('.pageWrap'), fromBottom);
  }
  renderCoordinator.focus(document.getElementById('pg' + k));
  updateStatus(); markCurrentThumb();
}
function handlePageJumpKeydown(e) {
  if (e.key === 'Enter') {
    const n = parseInt(e.target.value, 10);
    if (n >= 1) gotoPage(n); else toast('페이지 번호를 입력하세요');
    e.target.blur();
  }
  e.stopPropagation();
}

let viewFitRevision = 0;
let refitT = null;
function cancelPendingViewFit() {
  ++viewFitRevision;
  clearTimeout(refitT);
  refitT = null;
}
function setZoom(z, initialFit = false) {
  prioritizeReading();
  cancelPendingViewFit();
  editorStore.zoom = Math.min(50, Math.max(0.25, z));  
  editorStore.fitWidth = false;
  if (editorStore.activeDocument && editorStore.pages.length) editorStore.activeDocument.fitDone = true;
  const estZ = estimatePageSize();
  viewer.querySelectorAll('.pageWrap').forEach(w => {
    if (!initialFit || w.dataset.pageId || w._tiles || w._task) pageRenderer.prepareZoom(w, editorStore.zoom);
    w._renderGen = (w._renderGen || 0) + 1;
    try { w._task?.cancel(); } catch {}
    delete w.dataset.rendered;
    const p = editorStore.pages[+w.dataset.k];
    if (!p) return;
    const w1 = p._w1 || estZ.w, h1 = p._h1 || estZ.h;
    sizeWrap(w, w1 * editorStore.zoom, h1 * editorStore.zoom);
    const cv = w.querySelector('canvas');
    if (cv) { cv.style.width = (w1 * editorStore.zoom) + 'px'; cv.style.height = (h1 * editorStore.zoom) + 'px'; }
    repositionMarks(w, p);
    repositionSearchHits(w);
  });
  restoreRegionRect();
  const vr = viewer.getBoundingClientRect();
  viewer.querySelectorAll('.pageWrap').forEach(w => {
    if (w.style.display === 'none') return;
    const r = w.getBoundingClientRect();
    if (r.bottom > vr.top - 400 && r.top < vr.bottom + 400) enqueueRender(w);
  });
  updateStatus();
}

const viewportZoom = createViewportZoom({
  viewer, getZoom: () => editorStore.zoom, getDocument: () => editorStore.activeDocument,
  applyZoom: setZoom,
  settleZoom: () => pageRenderer.finishZoom(),
});

function applyZoomInput() {
  const input = $('zoomInput');
  const n = Number(input.value);
  if (!Number.isFinite(n)) { updateStatus(); return; }
  viewportZoom.to(n / 100);
  input.value = Math.round(editorStore.zoom * 100);
}
function handleZoomInputKeydown(e) {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); applyZoomInput(); e.target.blur(); }
  else if (e.key === 'Escape') { updateStatus(); e.target.blur(); }
}
let fitBasisW = 0, fitBasisDoc = null, fitBasisT = 0;
function scheduleRefitWidth() {
  clearTimeout(refitT);
  const documentAtSchedule = editorStore.activeDocument;
  const revision = viewFitRevision;
  refitT = setTimeout(() => {
    refitT = null;
    if (revision === viewFitRevision && documentAtSchedule === editorStore.activeDocument && editorStore.fitWidth)
      doFitWidth();
  }, 200);
}
async function doFitPage(center = false) {
  if (!editorStore.pages.length) return;
  cancelPendingViewFit();
  const revision = viewFitRevision, doc = editorStore.activeDocument, mode = viewMode;
  const pagesToFit = [...editorStore.pages];
  const k = Math.min(editorStore.currentPage, pagesToFit.length - 1);
  const availW = viewer.clientWidth - 24, availH = viewer.clientHeight - 52;
  let w, h, gap = 0;
  if (mode === 'double') {
    const base = k - (k % 2);
    const v1 = await getViewport(pagesToFit[base], 1);
    const v2 = pagesToFit[base + 1] ? await getViewport(pagesToFit[base + 1], 1) : { width: 0, height: 0 };
    w = v1.width + v2.width;
    gap = pagesToFit[base + 1] ? 16 : 0;
    h = Math.max(v1.height, v2.height || 0);
  } else {
    const vp = await getViewport(pagesToFit[k], 1);
    w = vp.width; h = vp.height;
  }
  if (revision !== viewFitRevision || doc !== editorStore.activeDocument || mode !== viewMode) return;
  if (center && editorStore.currentPage !== k) return;
  setZoom(Math.min((availW - gap) / w, availH / h), !doc?.fitDone);
  editorStore.fitWidth = false;  
  if (center) {
    const base = mode === 'double' ? k - k % 2 : k;
    const rects = [...viewer.querySelectorAll('.pageWrap')]
      .filter(wrap => +wrap.dataset.k === base || (mode === 'double' && +wrap.dataset.k === base + 1))
      .map(wrap => wrap.getBoundingClientRect());
    if (rects.length) {
      const view = viewer.getBoundingClientRect();
      const left = Math.min(...rects.map(rect => rect.left)), right = Math.max(...rects.map(rect => rect.right));
      const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
      viewer.scrollLeft += (left + right) / 2 - view.left - viewer.clientWidth / 2;
      viewer.scrollTop += (top + bottom) / 2 - view.top - viewer.clientHeight / 2;
    }
  }
}
async function doFitWidth() {
  if (!editorStore.pages.length) return;
  updateCurrentPage();
  cancelPendingViewFit();
  const revision = viewFitRevision, doc = editorStore.activeDocument, mode = viewMode;
  const pagesToFit = [...editorStore.pages];
  const k = Math.min(editorStore.currentPage, pagesToFit.length - 1);
  const avail = viewer.clientWidth - 24;    
  let fittedZoom, maxW = 0;
  if (mode === 'scroll') {
    const vp = await getViewport(pagesToFit[k], 1);  
    maxW = vp.width;
    for (const p of pagesToFit) if (p._w1 > maxW) maxW = p._w1;
    fittedZoom = avail / maxW;
  } else if (mode === 'double') {
    const base = k - (k % 2);
    const v1 = await getViewport(pagesToFit[base], 1);
    const v2 = pagesToFit[base + 1] ? await getViewport(pagesToFit[base + 1], 1) : { width: 0 };
    fittedZoom = (avail - 16) / (v1.width + v2.width);
  } else {
    const vp = await getViewport(pagesToFit[k], 1);
    fittedZoom = avail / vp.width;
  }
  if (revision !== viewFitRevision || doc !== editorStore.activeDocument || mode !== viewMode) return;
  viewportZoom.to(fittedZoom);
  editorStore.fitWidth = true;
  if (doc) doc.fitDone = true;
  if (mode === 'scroll') {
    fitBasisW = maxW;
    fitBasisDoc = doc;
    fitBasisT = performance.now();
  }
}

function targetIndices() {
  return pageOrganizer.targetIndexes(editorStore.pages, editorStore.selectedPages, editorStore.currentPage);
}
function rotate(deg) {
  if (!requireWindowsEdit()) return;
  if (activeDocLocked()) { lockNotice(); return; }
  const ts = targetIndices();
  if (!ts.length) return;
  pushUndo();
  pageOrganizer.rotate(editorStore.pages, ts, deg);
  rebuildAll();
}
function deletePages() {
  if (!requireWindowsEdit()) return;
  if (activeDocLocked()) { lockNotice(); return; }
  if (!editorStore.selectedPages.size) { toast('삭제할 페이지를 썸네일에서 선택하세요'); return; }
  if (editorStore.selectedPages.size >= editorStore.pages.length) { toast('모든 페이지를 삭제할 수 없습니다'); return; }
  pushUndo();
  const result = pageOrganizer.remove(editorStore.pages, editorStore.selectedPages);
  editorStore.pages = result.pages;
  editorStore.selectedPages = result.selectedIndexes;
  rebuildAll();
  toast('삭제됨');
}
function addBlank() {
  if (!requireWindowsEdit()) return;
  if (activeDocLocked()) { lockNotice(); return; }
  pushUndo();
  const at = pageOrganizer.insertionIndex(editorStore.pages, editorStore.selectedPages);
  const p = pageOrganizer.createBlankPage();
  const ref = editorStore.pages[at - 1];
  if (ref) {
    getViewport(ref, 1).then(vp => { p.blank = [vp.width, vp.height]; rebuildAll(); });
  }
  pageOrganizer.insert(editorStore.pages, editorStore.selectedPages, [p], at);
  editorStore.selectedPages.clear();
  rebuildAll();
  toast((at + 1) + '번 위치에 빈 페이지 추가');
}

let selText = null;          
let multiSel = [];
const objCategory = t => isTextObj(t) ? 'text' : t.type === 'img' ? 'img' : 'shape';
let keepMultiOnce = false;  
let mixedOperationPending = false;
function hasMixedSelection() {
  return !!selText && origSels.length > 0 && origSels.every(s => s.k === selText.k);
}
function hasMixedOverlayTypes() {
  return new Set(selectedObjectEntries().map(({obj}) =>
    isTextObj(obj) ? 'text' : obj.type === 'img' ? 'img' : 'shape')).size > 1;
}
function syncMixedSelectionUi() {
  const mixed = hasMixedSelection(), bar = $('textBar');
  const commonOnly = mixed || hasMixedOverlayTypes();
  const wasCommon = bar.classList.contains('mixedSelection');
  bar.classList.toggle('mixedSelection', commonOnly);
  if (!commonOnly) {
    if (wasCommon && selText) {
      if (isConnectableShape(selText.obj) && selText.obj.text !== undefined) {
        syncShapeTextControls(selText.obj); showShapeTextBar();
      }
      positionTextBar();
    }
    return;
  }
  origHideTextBar(); origHideAnnotBar(); origHideShapeBar();
  $('shapeTextBar').style.display = 'none';
  if (mixed) {
    removeMultiSelectionBounds();
    selectedObjectEntries().forEach(s => s.mark.querySelectorAll('.objHandle').forEach(h => h.remove()));
    origSelBoxes.forEach(box => box.querySelectorAll('.oh').forEach(h => h.remove()));
  }
  const count = selectedObjectEntries().length + origSels.length;
  const originalLabel = origSelBoxes[0]?.querySelector('.olbl');
  if (originalLabel) originalLabel.textContent = String(count);
  let label = bar.querySelector('.mixedSelectionCount');
  if (!label) {
    label = document.createElement('span'); label.className = 'mixedSelectionCount';
    bar.prepend(label);
  }
  label.textContent = window.DaydayPDFI18n?.language === 'en' ? `${count} selected` : `${count}개 선택`;
  positionTextBar();
}
async function origPickHit(k, hit, additive) {
  if (!additive) return origSelect(k, hit ? [hit] : []);
  if (!hit) return;
  const hits = origSels.filter(s => s.k === k && !!s.isA === !!hit.isA);
  const same = s => hit.isA ? s.a === hit.a : s.i === hit.i;
  const next = hits.some(same) ? hits.filter(s => !same(s)) : [...hits, hit];
  await origSelect(k, next, true);
}
function copyMixedOverlayObjects(objects, page = editorStore.pages[selText.k]) {
  if (!objects.length) return [];
  const selected = connectedDeletionSet(page.texts, objects);
  const copy = {texts: page.texts.filter(o => selected.has(o)).map(o => {
    const clone = JSON.parse(JSON.stringify(o)); delete clone._id; delete clone._w1; return clone;
  })};
  rekeyPageConnections(copy, createConnectorId);
  detachDanglingConnectors(copy.texts);
  return copy.texts;
}
function captureMixedOverlayCommit(delta) {
  if (!hasMixedSelection()) return null;
  const k = selText.k, ctx = editContext(k), page = ctx.page;
  const objects = selectedObjectEntries().map(s => s.obj);
  const valid = () => contextValid(ctx) && objects.every(o => page.texts.includes(o));
  return {valid, apply() {
    deselectText();
    if (!delta) {
      const remove = connectedDeletionSet(page.texts, objects);
      page.texts = page.texts.filter(o => !remove.has(o));
    } else {
      for (const o of objects) {
        if (o.type === 'polyline') o.points = o.points.map(([x,y]) => [x+delta.x,y+delta.y]);
        else if (o.type === 'line' || o.type === 'arrow') {
          o.x1 += delta.x; o.x2 += delta.x; o.y1 += delta.y; o.y2 += delta.y;
          for (const key of ['connectorControlX','connectorBendX'])
            if (Number.isFinite(o[key])) o[key] += delta.x;
          for (const key of ['connectorControlY','connectorBendY'])
            if (Number.isFinite(o[key])) o[key] += delta.y;
        } else { o.fx += delta.x; o.fy += delta.y; }
      }
    }
    const wrap = document.getElementById('pg'+k);
    if (wrap) {
      positionMarks(wrap, page);
      if (delta) selectPastedObjectBundle(k, objects, 0, wrap, true);
    }
  }};
}
async function moveOriginalSelection(k, dx, dy) {
  if (!origSels.length || origSels[0].k !== k || mixedOperationPending) return false;
  const ctx = editContext(k), wrap = document.getElementById('pg'+k);
  const selections = [...origSels], rect = wrap.getBoundingClientRect();
  const commit = captureMixedOverlayCommit({x:dx/rect.width,y:dy/rect.height});
  mixedOperationPending = true;
  try {
    const {view,rT} = await origView(ctx.page);
    if (!contextValid(ctx) || (commit && !commit.valid())) return false;
    const a = dispToPagePt(ctx.page,wrap,view,rT,rect.left,rect.top);
    const b = dispToPagePt(ctx.page,wrap,view,rT,rect.left+dx,rect.top+dy);
    const x = b[0]-a[0], y = b[1]-a[1];
    if (selections[0].isA) return await annotSetRects(k, selections.map(s => ({
      a:s.a, rect:[s.b[0]+x,s.b[1]+y,s.b[2]+x,s.b[3]+y]
    })), '주석 이동', commit);
    return await origTransform(k,selections.map(s => s.i),[1,0,0,1,x,y],'이동',commit);
  } finally { mixedOperationPending = false; }
}
let pendingOriginalMove = null;
function queueOriginalMove(k, dx, dy) {
  if (pendingOriginalMove) {
    if (pendingOriginalMove.matches()) {
      pendingOriginalMove.dx += dx;
      pendingOriginalMove.dy += dy;
      return pendingOriginalMove.done;
    }
    return false;
  }
  if (mixedOperationPending || !origSels.length || origSels[0].k !== k) return false;
  const ctx = editContext(k);
  const originalId = hit => hit.isA ? 'annotation:' + hit.a : 'object:' + hit.i;
  const originals = new Set(origSels.map(originalId));
  const overlays = new Set(selectedObjectEntries().map(entry => entry.obj));
  const matches = () => {
    const current = selectedObjectEntries();
    return contextValid(ctx) && originals.size === origSels.length &&
      origSels.every(hit => hit.k === k && originals.has(originalId(hit))) &&
      overlays.size === current.length && current.every(({ obj }) => overlays.has(obj));
  };
  const batch = pendingOriginalMove = { dx, dy, matches };
  async function applySteps() {
    while ((batch.dx || batch.dy) && matches()) {
      const x = batch.dx, y = batch.dy;
      batch.dx = batch.dy = 0;
      if (!await moveOriginalSelection(k, x, y)) return false;
    }
    return true;
  }
  batch.done = applySteps().catch(error => {
    console.error(error);
    toast('오브젝트 이동 실패: ' + (error.message || error), 3000);
    return false;
  }).finally(() => { pendingOriginalMove = null; });
  return batch.done;
}
function pendingObjectEdits() {
  if (!pendingOriginalMove && !pendingErasures) return null;
  return Promise.all([pendingOriginalMove?.done, eraserQueue]);
}

function toggleObjectMultiSelection(k, object, mark) {
  if (mixedOperationPending) return true;
  if (origSels.length && origSels[0].k === k) {
    if (!selText || selText.k !== k) {
      selectMark(k, object, mark, true);
      syncMixedSelectionUi();
      return true;
    }
    if (selText.obj === object) {
      const rest = multiSel.map(s => s.obj);
      deselectText();
      if (rest.length) selectPastedObjectBundle(k, rest, 0, mark.parentElement, true);
      origSelect(k, [...origSels], true);
      return true;
    }
  }
  if (!selText || selText.k !== k) return false;
  if (selText.obj === object) {
    const remaining = multiSel.map(entry => entry.obj);
    if (!remaining.length) return false;
    deselectText();
    selectPastedObjectBundle(k, remaining, 0, mark.parentElement);
    return true;
  }
  const index = multiSel.findIndex(selection => selection.obj === object);
  if (index >= 0) {
    multiSel[index].mark.classList.remove('sel');
    multiSel.splice(index, 1);
  } else {
    multiSel.push({ obj: object, mark });
    mark.classList.add('sel');
  }
  refreshSelectedObjectHandles();
  return true;
}
function refreshSelectedObjectHandles() {
  removeMultiSelectionBounds();
  if (!selText?.mark) return;
  selectedObjectEntries().forEach(entry =>
    entry.mark.querySelectorAll('.objHandle').forEach(handle => handle.remove()));
  placeHandles(selText.mark, selText.obj);
  syncMixedSelectionUi();
}
function clearMultiSel() {
  removeMultiSelectionBounds();
  multiSel.forEach(s => {
    s.mark.classList.remove('sel');
    s.mark.querySelectorAll('.objHandle').forEach(h => h.remove());
  });
  multiSel = [];
}
let lastTextStyle = { color: '#d32f2f' };
try { Object.assign(lastTextStyle, JSON.parse(settings.get('lastText') || '{}')); } catch {}
let lastShapeTextStyle = {
  size: 16, color: '#000000', colorOp: 1, font: 'spoqa',
  bold: false, align: 'center', valign: 'middle',
};
try { Object.assign(lastShapeTextStyle, JSON.parse(settings.get('lastShapeText') || '{}')); } catch {}
function saveLastStyles() {
  try {
    settings.set('lastText', JSON.stringify(lastTextStyle));
    settings.set('lastShapeText', JSON.stringify(lastShapeTextStyle));
    settings.set('lastShape', JSON.stringify(lastShapeStyle));
  } catch {}
}

function deselectText(commit = true) {
  if (!keepMultiOnce) clearMultiSel();  
  if (!selText) { $('shapeTextBar').style.display = 'none'; return; }
  const { mark } = selText;
  const shapeEditor = mark?._shapeTextEditor;
  if (shapeEditor?.isContentEditable) {
    if (commit) commitShapeTextEdit(mark, true, false);
    else cancelShapeTextEdit(mark);
    mark.classList.remove('sel');
    mark.querySelectorAll('.objHandle').forEach(h => h.remove());
  } else if (mark && mark.isContentEditable) {
    if (commit) commitMarkEdit(mark);
    else {
      mark.contentEditable = 'false';
      mark.classList.remove('sel');
    }
  } else if (mark) {
    mark.classList.remove('sel');
    mark.querySelectorAll('.objHandle').forEach(h => h.remove());
  }
  selText = null;
  if (!barPinned) barManual = null;
  $('textBar').style.display = 'none';
  $('shapeTextBar').style.display = 'none';
}

function syncArrowOptionControls(object = null) {
  $('tbInkBrush').hidden = object?.type !== 'ink';
  if (object?.type === 'ink') $('tbInkBrush').value = object.brush || 'pen';
  const isArrow = object?.type === 'arrow';
  const isPolyline = object?.type === 'polyline';
  const isLine = object?.type === 'line';
  $('tbFillCtl').hidden = object?.type === 'ink' || isArrow || isPolyline;
  $('tbLineCap').hidden = !isLine;
  $('tbArrowCtl').hidden = !isArrow;
  $('tbArrowHeadCtl').hidden = !isArrow;
  if (isLine) $('tbLineCap').value = object.lineCap === 'square' ? 'square' : 'round';
  if (!isArrow) return;
  const style = ['straight', 'angled', 'curve', 'step'].includes(object.connectorStyle)
    ? object.connectorStyle : 'straight';
  const end = object.arrowEndType || 'arrow-filled';
  $('tbArrowHeadCtl').hidden = end === 'none';
  const anchor = object.connectorAnchor || 'side-midpoints';
  document.querySelectorAll('[data-connector-anchor]').forEach(button => {
    const active = button.dataset.connectorAnchor === anchor;
    const label = active
      ? '도형 네 면 중앙 연결 켜짐 · 클릭하면 해제'
      : '도형 네 면 중앙 연결 꺼짐 · 클릭하면 켜기';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    setUiAttribute(button, 'title', label);
    setUiAttribute(button, 'aria-label', label);
  });
  $('tbConnectorStyle').value = style;
  $('tbArrowEnd').value = end;
  $('tbArrowHead').value = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +object.arrowHeadSize || 10));
}

function clearOriginalFontOption() {
  $('tbFont').querySelector('option[data-original-font]')?.remove();
}

function showOriginalFontOption(familyName, ocrFont = null) {
  clearOriginalFontOption();
  const exactName = String(familyName || '').trim();
  if (!exactName && !ocrFont) return;
  const displayName = exactName.replace(/^[A-Z]{6}\+/, '') || exactName;
  const option = document.createElement('option');
  option.value = '__original__';
  option.dataset.originalFont = exactName;
  option.disabled = true;
  option.textContent = `${document.documentElement.lang === 'en' ? 'Original' : '원본'} · ${displayName}`;
  if (ocrFont) option.textContent = `OCR · ${FONTS[ocrFont.key].label} · ${ocrFont.match === 'visual'
    ? (document.documentElement.lang === 'en' ? 'Visual match' : '모양 비교') : '글꼴 분석 중'}`;
  option.title = exactName;
  $('tbFont').prepend(option);
  option.selected = true;
}

function selectMark(k, obj, mark, keepOriginal = false) {
  focusViewer();
  if (origSels.length && (!keepOriginal || origSels[0].k !== k)) origClearSel();
  if (selText && selText.mark !== mark) { deselectText(); if (!barPinned) barManual = null; }
  selText = { k, obj, mark };
  mark.classList.add('sel');
  const isText = isTextObj(obj);
  const isImg = obj.type === 'img';
  $('tbTextCtl').style.display = isText ? 'flex' : 'none';
  $('tbShapeCtl').style.display = isText ? 'none' : 'flex';
  $('textBar').classList.toggle('imgSel', isImg);  
  syncArrowOptionControls(isText || isImg ? null : obj);
  if (isImg) $('tbFillOp').value = Math.round(opOf(obj, 'fillOp') * 100);
  if (isText) {
    clearOriginalFontOption();
    $('tbSize').value = obj.size;
    setCol('tbColor', obj.color);
    $('tbColorOp').value = Math.round(opOf(obj, 'colorOp') * 100);
    $('tbFont').value = obj.font || 'spoqa';
    fontPickerController.syncSelect($('tbFont'));
    $('tbBold').classList.toggle('active', !!obj.bold);
    $('tbAlign').value = obj.align || 'left';
    $('tbValign').value = obj.valign || 'top';
  } else if (!isImg) {
    setCol('tbStroke', obj.stroke);
    $('tbStrokeOp').value = Math.round(opOf(obj, 'strokeOp') * 100);
    $('tbSw').value = clampStrokeWidth(obj.sw);
    $('tbStrokeOn').checked = obj.strokeOn !== false;
    $('tbFillOn').checked = !!obj.fill;
    if (obj.fill) setCol('tbFill', obj.fill);
    $('tbFillOp').value = Math.round(opOf(obj, 'fillOp') * 100);
  }
  positionTextBar();
  if (isConnectableShape(obj) && obj.text !== undefined) {
    syncShapeTextControls(obj);
    showShapeTextBar();
  } else $('shapeTextBar').style.display = 'none';
  placeHandles(mark, obj);
  syncMixedSelectionUi();
}

let barHover = false;  
$('textBar').addEventListener('mouseenter', () => barHover = true);
$('textBar').addEventListener('mouseleave', () => barHover = false);
let barManual = null;  
let barPinned = settings.get('barPin') === '1';
try {
  const bp = JSON.parse(settings.get('barPos') || 'null');
  if (barPinned && bp) barManual = bp;
} catch {}
function currentBarPinAnchor() {
  const r = $('tbPin').getBoundingClientRect();
  return { pinX: r.left + r.width / 2, pinY: r.top + r.height / 2 };
}
function clampBarAxis(pos, size, limit, margin = 8) {
  const edge = size + margin * 2 <= limit ? margin : 0;
  return Math.max(edge, Math.min(pos, Math.max(edge, limit - size - edge)));
}
function applyBarPinAnchor(anchor) {
  const bar = $('textBar'), pin = $('tbPin');
  const br = bar.getBoundingClientRect(), pr = pin.getBoundingClientRect();
  const localX = pr.left - br.left + pr.width / 2;
  const localY = pr.top - br.top + pr.height / 2;
  const desiredX = anchor.pinX - localX, desiredY = anchor.pinY - localY;
  bar.style.left = clampBarAxis(desiredX, br.width, window.innerWidth) + 'px';
  bar.style.top = clampBarAxis(desiredY, br.height, window.innerHeight) + 'px';
}
function positionTextBar(anchorEl) {
  const el = anchorEl || (selText && selText.mark);
  if (!el) return;
  const bar = $('textBar');
  bar.style.display = 'flex';
  if (barManual) {
    if (Number.isFinite(barManual.pinX) && Number.isFinite(barManual.pinY)) {
      applyBarPinAnchor(barManual);
    } else {  
      bar.style.left = (+barManual.x || 0) + 'px';
      bar.style.top = (+barManual.y || 0) + 'px';
      barManual = currentBarPinAnchor();
      if (barPinned) settings.set('barPos', JSON.stringify(barManual));
      applyBarPinAnchor(barManual);
    }
    positionShapeTextBar();
    return;
  }
  const r = el.getBoundingClientRect();
  const bw = bar.offsetWidth || 260, bh = bar.offsetHeight || 40;
  const rotationRoom = hasMixedSelection() ? 0 : (isMobileLayout() ? 70 : 54);
  let x = r.left, y = r.top - bh - 8 - rotationRoom;
  if (y < 44) y = r.bottom + 8;
  if (y + bh > window.innerHeight - 34) y = Math.max(44, window.innerHeight - bh - 40);
  x = Math.max(8, Math.min(x, window.innerWidth - bw - 8));
  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
  positionShapeTextBar();
}
$('textBar').addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('input[type="range"]')) return;
  const bar = $('textBar');
  const start = { x: e.clientX, y: e.clientY, l: bar.offsetLeft, t: bar.offsetTop };
  let started = false;
  const mv = e2 => {
    const dx = e2.clientX - start.x, dy = e2.clientY - start.y;
    if (!started) {
      if (Math.hypot(dx, dy) < 4) return;
      started = true;
      document.body.style.userSelect = 'none';
    }
    e2.preventDefault();
    barManual = {
      x: Math.max(0, Math.min(start.l + dx, window.innerWidth - bar.offsetWidth)),
      y: Math.max(0, Math.min(start.t + dy, window.innerHeight - bar.offsetHeight))
    };
    bar.style.left = barManual.x + 'px';
    bar.style.top = barManual.y + 'px';
    barManual = currentBarPinAnchor();
    positionShapeTextBar();
  };
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
    if (started) {
      bar._dragJustEnded = true;
      setTimeout(() => { bar._dragJustEnded = false; }, 0);
      if (barPinned && barManual) settings.set('barPos', JSON.stringify(barManual));
    }
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
});
$('textBar').addEventListener('click', e => {
  if (!$('textBar')._dragJustEnded) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

const MOBILE_TOOLBAR_LONG_PRESS_MS = 360;
function bindMobileToolbarLongPress(bar, moveBar, finishBar) {
  bindMobileToolbarGesture(bar, { moveBar, finishBar, clamp: clampBarAxis,
    longPressMs: MOBILE_TOOLBAR_LONG_PRESS_MS });
}

bindMobileToolbarLongPress($('textBar'), (left, top) => {
  const bar = $('textBar');
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
  barManual = currentBarPinAnchor();
  positionShapeTextBar();
}, () => {
  if (barPinned && barManual) settings.set('barPos', JSON.stringify(barManual));
});

function updateBarPinUi() {
  const btn = $('tbPin'), icon = $('tbPinIcon');
  btn.classList.toggle('active', barPinned);
  icon.classList.toggle('fa-lock', barPinned);
  icon.classList.toggle('fa-lock-open', !barPinned);
  const label = barPinned ? '툴바 위치 고정 해제' : '툴바 위치 고정';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}
updateBarPinUi();
$('tbPin').onclick = () => {
  barPinned = !barPinned;
  updateBarPinUi();
  settings.set('barPin', barPinned ? '1' : '0');
  if (barPinned) {
    barManual = currentBarPinAnchor();
    settings.set('barPos', JSON.stringify(barManual));
    toast('고정 버튼 위치를 기준으로 툴바 고정됨 — 다시 누르면 해제');
  } else {
    barManual = null;
    positionTextBar();
  }
};

let shapeTextBarPinned = settings.get('shapeTextBarPin') === '1';
let shapeTextBarManual = null;
try {
  const saved = JSON.parse(settings.get('shapeTextBarPos') || 'null');
  if (shapeTextBarPinned && saved) shapeTextBarManual = saved;
} catch {}

function currentShapeTextPinAnchor() {
  const r = $('stPin').getBoundingClientRect();
  return { pinX: r.left + r.width / 2, pinY: r.top + r.height / 2 };
}

function rectsOverlapWithGap(a, b, gap = 7) {
  return a.left < b.right + gap && a.right > b.left - gap &&
    a.top < b.bottom + gap && a.bottom > b.top - gap;
}

function placeShapeTextBarAt(x, y, preferred = null) {
  const bar = $('shapeTextBar');
  const width = bar.offsetWidth || 420, height = bar.offsetHeight || 44;
  const margin = 8, gap = 8;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  const clampX = value => Math.max(margin, Math.min(value, maxX));
  const clampY = value => Math.max(margin, Math.min(value, maxY));
  let next = { x: clampX(x), y: clampY(y) };
  const shapeBar = $('textBar');
  if (shapeBar.style.display !== 'none') {
    const primary = shapeBar.getBoundingClientRect();
    const asRect = point => ({
      left: point.x, top: point.y, right: point.x + width, bottom: point.y + height,
    });
    if (rectsOverlapWithGap(asRect(next), primary, gap)) {
      const candidates = [
        { x: primary.right + gap, y: primary.top },
        { x: primary.left - width - gap, y: primary.top },
        { x: primary.left, y: primary.bottom + gap },
        { x: primary.left, y: primary.top - height - gap },
      ].map(point => ({ x: clampX(point.x), y: clampY(point.y) }))
        .filter(point => !rectsOverlapWithGap(asRect(point), primary, gap));
      if (candidates.length) {
        const origin = preferred || next;
        candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) -
          Math.hypot(b.x - origin.x, b.y - origin.y));
        next = candidates[0];
      }
    }
  }
  bar.style.left = next.x + 'px';
  bar.style.top = next.y + 'px';
}

function applyShapeTextPinAnchor(anchor) {
  const bar = $('shapeTextBar'), pin = $('stPin');
  const br = bar.getBoundingClientRect(), pr = pin.getBoundingClientRect();
  const localX = pr.left - br.left + pr.width / 2;
  const localY = pr.top - br.top + pr.height / 2;
  const desired = { x: anchor.pinX - localX, y: anchor.pinY - localY };
  placeShapeTextBarAt(desired.x, desired.y, desired);
}

function positionShapeTextBar() {
  const bar = $('shapeTextBar');
  if (bar.style.display === 'none' || !selText || !isConnectableShape(selText.obj) ||
      selText.obj.text === undefined) return;
  if (shapeTextBarManual?.pinX !== undefined) {
    applyShapeTextPinAnchor(shapeTextBarManual);
    return;
  }
  const primary = $('textBar').getBoundingClientRect();
  const width = bar.offsetWidth || 420;
  const rightSpace = window.innerWidth - primary.right;
  const leftSpace = primary.left;
  const firstX = rightSpace >= leftSpace ? primary.right + 8 : primary.left - width - 8;
  placeShapeTextBarAt(firstX, primary.top, { x: firstX, y: primary.top });
}

function showShapeTextBar() {
  $('shapeTextBar').style.display = 'flex';
  requestAnimationFrame(positionShapeTextBar);
  positionShapeTextBar();
}

function updateShapeTextPinUi() {
  $('stPin').classList.toggle('active', shapeTextBarPinned);
  $('stPinIcon').classList.toggle('fa-lock', shapeTextBarPinned);
  $('stPinIcon').classList.toggle('fa-lock-open', !shapeTextBarPinned);
  const label = shapeTextBarPinned ? '도형 텍스트 툴바 위치 고정 해제' : '도형 텍스트 툴바 위치 고정';
  $('stPin').title = label;
  $('stPin').setAttribute('aria-label', label);
}
updateShapeTextPinUi();

$('stPin').onclick = event => {
  event.stopPropagation();
  shapeTextBarPinned = !shapeTextBarPinned;
  settings.set('shapeTextBarPin', shapeTextBarPinned ? '1' : '0');
  if (shapeTextBarPinned) {
    shapeTextBarManual = currentShapeTextPinAnchor();
    settings.set('shapeTextBarPos', JSON.stringify(shapeTextBarManual));
  } else shapeTextBarManual = null;
  updateShapeTextPinUi();
  positionShapeTextBar();
};

$('shapeTextBar').addEventListener('mousedown', event => {
  if (event.button !== 0 || event.target.closest('input[type="range"]')) return;
  const bar = $('shapeTextBar');
  const start = { x: event.clientX, y: event.clientY, left: bar.offsetLeft, top: bar.offsetTop };
  let started = false;
  const move = next => {
    const dx = next.clientX - start.x, dy = next.clientY - start.y;
    if (!started && Math.hypot(dx, dy) < 4) return;
    started = true;
    next.preventDefault();
    document.body.style.userSelect = 'none';
    placeShapeTextBarAt(start.left + dx, start.top + dy, { x: start.left + dx, y: start.top + dy });
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
    if (!started) return;
    shapeTextBarManual = currentShapeTextPinAnchor();
    if (shapeTextBarPinned) settings.set('shapeTextBarPos', JSON.stringify(shapeTextBarManual));
    else shapeTextBarManual = null;
    bar._dragJustEnded = true;
    setTimeout(() => { bar._dragJustEnded = false; }, 0);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
$('shapeTextBar').addEventListener('click', event => {
  if (!$('shapeTextBar')._dragJustEnded) return;
  event.preventDefault();
  event.stopPropagation();
}, true);

bindMobileToolbarLongPress($('shapeTextBar'), (left, top) => {
  placeShapeTextBarAt(left, top, { x: left, y: top });
}, () => {
  shapeTextBarManual = currentShapeTextPinAnchor();
  if (shapeTextBarPinned) settings.set('shapeTextBarPos', JSON.stringify(shapeTextBarManual));
  else shapeTextBarManual = null;
});

const SHAPE_TEXT_KEYS = Object.freeze(['text', 'size', 'color', 'colorOp', 'font', 'bold', 'align', 'valign']);
function shapeTextObjectSignature(object, omitEmptyTextStyle = false) {
  return JSON.stringify(Object.keys(object || {})
    .filter(key => key !== '_id' && key !== '_w1')
    .filter(key => !omitEmptyTextStyle || !SHAPE_TEXT_KEYS.includes(key))
    .sort()
    .map(key => [key, object[key]]));
}
function trackShapeTextSessionObjects(mark, objects) {
  mark._shapeTextOriginalObjects ||= new Map();
  for (const object of objects || []) {
    if (!object || mark._shapeTextOriginalObjects.has(object)) continue;
    mark._shapeTextOriginalObjects.set(object, {
      signature: shapeTextObjectSignature(object),
      hadText: object.text !== undefined,
    });
  }
}
function shapeTextSessionChanged(mark) {
  return [...(mark?._shapeTextOriginalObjects || [])]
    .some(([object, original]) => {
      const omitEmptyTextStyle = !original.hadText && !String(object.text || '').trim();
      return shapeTextObjectSignature(object, omitEmptyTextStyle) !== original.signature;
    });
}
function refreshShapeTextLiveState(mark) {
  const changed = shapeTextSessionChanged(mark);
  mark._shapeTextDirty = changed;
  if (changed) markActiveDocumentChanged();
  else {
    const dirtyChanged = restoreSaveCheckpoint(editorStore.activeDocument, mark._shapeTextPreSnap);
    if (dirtyChanged) renderTabs();
  }
  scheduleAutosave();
  return changed;
}
function activeShapeTextMark() {
  const mark = selText?.mark;
  return mark?._shapeTextEditor?.isContentEditable ? mark : null;
}
function syncShapeTextControls(object) {
  const style = shapeTextStyle(object);
  $('stFont').value = style.font;
  fontPickerController.syncSelect($('stFont'));
  $('stSize').value = style.size;
  setCol('stColor', style.color);
  $('stColorOp').value = Math.round(style.colorOp * 100);
  $('stBold').classList.toggle('active', style.bold);
  $('stAlign').value = style.align;
  $('stValign').value = style.valign;
}
function startShapeTextEdit(mark) {
  const { obj } = mark?._ctx || {};
  if (!isConnectableShape(obj)) return;
  if (mark._shapeTextEditor?.isContentEditable) return;
  mark._shapeTextPreSnap = makeSnap();
  mark._shapeTextOriginalObjects = new Map();
  trackShapeTextSessionObjects(mark, [obj, ...multiSel.map(selection => selection.obj)]);
  mark._shapeTextDirty = false;
  if (obj.text === undefined) Object.assign(obj, { ...lastShapeTextStyle, text: '' });
  mark.querySelectorAll('.objHandle').forEach(handle => handle.remove());
  const editor = renderShapeTextContent(mark, obj);
  editor.contentEditable = 'true';
  editor.tabIndex = 0;
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', '도형 텍스트');
  editor.setAttribute('inputmode', 'text');
  editor.setAttribute('enterkeyhint', 'enter');
  editor.setAttribute('spellcheck', 'true');
  editor.oninput = () => {
    obj.text = editor.innerText.replace(/\n$/, '');
    scheduleScreenFont(obj.font || 'spoqa', !!obj.bold, obj.text);
    refreshShapeTextLiveState(mark);
  };
  editor.onkeydown = event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      commitShapeTextEdit(mark, true, true);
    }
  };
  syncShapeTextControls(obj);
  showShapeTextBar();
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  const selection = getSelection(), range = document.createRange();
  range.selectNodeContents(editor); range.collapse(false);
  selection.removeAllRanges(); selection.addRange(range);
}
function cancelShapeTextEdit(mark) {
  const editor = mark?._shapeTextEditor;
  if (editor) editor.contentEditable = 'false';
  mark._shapeTextDirty = false;
  $('shapeTextBar').style.display = 'none';
}
function commitShapeTextEdit(mark, record = true, keepSelected = true) {
  const { obj, k } = mark?._ctx || {};
  const editor = mark?._shapeTextEditor;
  if (!obj || !editor?.isContentEditable) return;
  const text = editor.innerText.replace(/\n$/, '');
  editor.contentEditable = 'false';
  if (text.trim()) obj.text = text;
  else for (const key of SHAPE_TEXT_KEYS) delete obj[key];
  const changed = shapeTextSessionChanged(mark);
  if (record && changed) pushSnap(mark._shapeTextPreSnap);
  else if (!changed) {
    const dirtyChanged = restoreSaveCheckpoint(editorStore.activeDocument, mark._shapeTextPreSnap);
    if (dirtyChanged) renderTabs();
    scheduleAutosave();
  }
  mark._shapeTextDirty = false;
  mark._shapeTextOriginalObjects = null;
  const wrap = mark.parentElement;
  if (wrap) {
    drawShapeEl(mark, obj, wrap.clientWidth, wrap.clientHeight);
    if (keepSelected) placeHandles(mark, obj);
  }
  if (keepSelected && obj.text !== undefined) {
    syncShapeTextControls(obj);
    showShapeTextBar();
  } else $('shapeTextBar').style.display = 'none';
  scheduleThumbRefresh(k);
}

function startMarkEdit(mark) {
  const { obj, k } = mark._ctx;
  mark._orig = obj.text;
  mark._origBold = !!obj.bold;
  mark._preSnap = makeSnap();
  mark.querySelectorAll('.objHandle').forEach(h => h.remove());  
  mark.contentEditable = 'true';
  mark.tabIndex = 0;
  mark.setAttribute('role', 'textbox');
  mark.setAttribute('inputmode', 'text');
  mark.setAttribute('enterkeyhint', 'enter');
  mark.setAttribute('autocapitalize', 'sentences');
  mark.setAttribute('spellcheck', 'true');
  mark.setAttribute('virtualkeyboardpolicy', 'auto');
  mark.oninput = () => {
    obj.text = mark.innerText.replace(/\n$/, '');
    scheduleScreenFont(obj.font || 'spoqa', !!obj.bold, obj.text);
  };  
  try { mark.focus({ preventScroll: true }); } catch { mark.focus(); }
  const sel = getSelection(), rng = document.createRange();
  rng.selectNodeContents(mark); rng.collapse(false);
  sel.removeAllRanges(); sel.addRange(rng);
}
function commitMarkEdit(mark) {
  const { k, obj } = mark._ctx;
  mark.contentEditable = 'false';
  const text = mark.innerText.replace(/\n$/, '');
  const p = editorStore.pages[k];
  if (!text.trim()) {
    const i = p.texts.indexOf(obj);
    if (i >= 0) p.texts.splice(i, 1);
    if (mark._orig && mark._orig.trim()) pushSnap(mark._preSnap);
  } else if (text !== mark._orig || !!obj.bold !== mark._origBold) {
    obj.text = text;
    pushSnap(mark._preSnap);
  }
  selText = null;
  $('textBar').style.display = 'none';
  $('shapeTextBar').style.display = 'none';
  const wrap = document.getElementById('pg' + k);
  if (wrap) positionMarks(wrap, p);
}

function onPageClick(ev, wrap, k) {
  if (!textMode || spacePan || panDrag) return;
  if (ev.target.closest('.textMark')) return;
  deselectText();
  const r = wrap.getBoundingClientRect();
  const pageW = editorStore.pages[k]._w1 || 595;
  const obj = {
    fx: (ev.clientX - r.left) / r.width,
    fy: (ev.clientY - r.top) / r.height,
    text: '',
    size: lastTextStyle.size || Math.max(12, Math.round(pageW / 35)),
    color: lastTextStyle.color,
    font: lastTextStyle.font, bold: lastTextStyle.bold, align: lastTextStyle.align,
    valign: lastTextStyle.valign, colorOp: lastTextStyle.colorOp
  };
  const snap = makeSnap();           
  editorStore.pages[k].texts.push(obj);
  positionMarks(wrap, editorStore.pages[k]);
  const mark = [...wrap.querySelectorAll('.textMark')].pop();
  mark._preSnap = snap;
  mark._orig = '';
  selectMark(k, obj, mark);
  startMarkEdit(mark);
  mark._preSnap = snap;              
  setTextMode(false);                
}

function applyTextStyle(prop, value) {
  if (!selText) {
    if (origTextSel) origApplyTextStyle(prop, value);  
    return;
  }
  const { k, obj, mark } = selText;
  const old = obj[prop];
  if (old === value) return;
  if ((mark && mark.isContentEditable) || palLive) {
    obj[prop] = value;
  } else {
    obj[prop] = old;
    const snap = makeSnap();
    obj[prop] = value;
    pushSnap(snap);
  }
  lastTextStyle[prop] = value;
  saveLastStyles();
  if (mark) {
    if (prop === 'size') mark.style.fontSize = (value * editorStore.zoom) + 'px';
    else if (prop === 'color' || prop === 'colorOp')
      mark.style.color = hexA(obj.color, opOf(obj, 'colorOp'));
    else if (prop === 'align') mark.style.textAlign = value;
    else if (prop === 'bold') mark.style.fontWeight = value ? '700' : '400';
    if (!barHover) positionTextBar();
  }
  for (const s of multiSel) {
    if (!isTextObj(s.obj)) continue;
    s.obj[prop] = value;
    if (!s.mark) continue;
    if (prop === 'size') s.mark.style.fontSize = (value * editorStore.zoom) + 'px';
    else if (prop === 'color' || prop === 'colorOp')
      s.mark.style.color = hexA(s.obj.color, opOf(s.obj, 'colorOp'));
    else if (prop === 'align') s.mark.style.textAlign = value;
    else if (prop === 'bold') s.mark.style.fontWeight = value ? '700' : '400';
    else if (prop === 'font') s.mark.style.fontFamily = (FONTS[value] || FONTS.spoqa).css;
  }
  scheduleThumbRefresh(k);
}
$('tbSize').addEventListener('change', () => {
  const v = Math.min(200, Math.max(6, +$('tbSize').value || 12));
  $('tbSize').value = v;
  applyTextStyle('size', v);
});
$('tbSize').addEventListener('wheel', e => {
  if ((!selText || !isTextObj(selText.obj)) && !origTextSel) return;
  e.preventDefault(); e.stopPropagation();
  const step = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1);
  const v = Math.min(200, Math.max(6, (+$('tbSize').value || 12) + step));
  $('tbSize').value = v;
  applyTextStyle('size', v);
}, { passive: false });
$('tbColor').addEventListener('click', () => openPalette('tbColor', c => applyTextStyle('color', c)));
$('tbColorOp').addEventListener('change', () => applyTextStyle('colorOp', +$('tbColorOp').value / 100));
$('tbAlign').addEventListener('change', () => applyTextStyle('align', $('tbAlign').value));
$('tbValign').addEventListener('change', () => {
  applyTextStyle('valign', $('tbValign').value);
  if (selText) {
    const { k, obj } = selText;
    const wrap = document.getElementById('pg' + k);
    if (wrap) {
      positionMarks(wrap, editorStore.pages[k]);
      const marks = [...wrap.querySelectorAll('.obj')];
      const nm = marks[editorStore.pages[k].texts.indexOf(obj)];
      if (nm) selectMark(k, obj, nm);
    }
  }
});
$('tbFont').addEventListener('change', () => {
  const bold = selText
    ? !!selText.obj?.bold
    : !!origTextSel && (origTextSel.weight >= 600 || /bold|heavy|black/i.test(origTextSel.fam));
  const characters = [selText, ...multiSel]
    .filter(selection => isTextObj(selection?.obj))
    .map(selection => selection.obj.text || '')
    .join('');
  ensureScreenFont($('tbFont').value, bold, { characters });
  if (!selText && !origTextSel) { lastTextStyle.font = $('tbFont').value; saveLastStyles(); }
  applyTextStyle('font', $('tbFont').value);
  if (selText && selText.mark)
    selText.mark.style.fontFamily = (FONTS[selText.obj.font] || FONTS.spoqa).css;
});
$('tbBold').addEventListener('click', () => {
  if (origTextSel) {  
    applyTextStyle('bold', !(origTextSel.weight >= 600));
    return;
  }
  if (!selText || !isTextObj(selText.obj)) return;
  applyTextStyle('bold', !selText.obj.bold);
  $('tbBold').classList.toggle('active', !!selText.obj.bold);
  ensureScreenFont(selText.obj.font || 'spoqa', !!selText.obj.bold, {
    characters: [selText, ...multiSel]
      .filter(selection => isTextObj(selection?.obj))
      .map(selection => selection.obj.text || '')
      .join(''),
  });
});

function applyShapeTextStyle(prop, value) {
  if (!selText || !isConnectableShape(selText.obj) || selText.obj.text === undefined) return;
  const { k, obj, mark } = selText;
  if (obj[prop] === value) return;
  if (mark._shapeTextEditor?.isContentEditable || palLive) {
    obj[prop] = value;
    if (mark._shapeTextEditor?.isContentEditable) refreshShapeTextLiveState(mark);
  } else {
    const snapshot = makeSnap();
    obj[prop] = value;
    pushSnap(snapshot);
  }
  lastShapeTextStyle[prop] = value;
  saveLastStyles();
  if (mark.parentElement)
    renderShapeTextContent(mark, obj);
  syncShapeTextControls(obj);
  positionShapeTextBar();
  scheduleThumbRefresh(k);
}

$('stSize').addEventListener('change', () => {
  const value = Math.max(6, Math.min(200, +$('stSize').value || 16));
  $('stSize').value = value;
  applyShapeTextStyle('size', value);
});
$('stSize').addEventListener('wheel', event => {
  if (!selText || !isConnectableShape(selText.obj) || selText.obj.text === undefined) return;
  event.preventDefault(); event.stopPropagation();
  const step = (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 5 : 1);
  const value = Math.max(6, Math.min(200, (+$('stSize').value || 16) + step));
  $('stSize').value = value;
  applyShapeTextStyle('size', value);
}, { passive: false });
$('stColor').addEventListener('click', () =>
  openPalette('stColor', color => applyShapeTextStyle('color', color)));
$('stColorOp').addEventListener('change', () =>
  applyShapeTextStyle('colorOp', +$('stColorOp').value / 100));
$('stColorOp').addEventListener('wheel', event => {
  if (!selText || !isConnectableShape(selText.obj) || selText.obj.text === undefined) return;
  event.preventDefault(); event.stopPropagation();
  const value = Math.max(10, Math.min(100, (+$('stColorOp').value || 100) +
    (event.deltaY < 0 ? 5 : -5)));
  $('stColorOp').value = value;
  applyShapeTextStyle('colorOp', value / 100);
}, { passive: false });
$('stAlign').addEventListener('change', () => applyShapeTextStyle('align', $('stAlign').value));
$('stValign').addEventListener('change', () => applyShapeTextStyle('valign', $('stValign').value));
$('stFont').addEventListener('change', () => {
  ensureScreenFont($('stFont').value, !!selText?.obj?.bold, {
    characters: isConnectableShape(selText?.obj) ? selText.obj.text || '' : '',
  });
  applyShapeTextStyle('font', $('stFont').value);
});
$('stBold').addEventListener('click', () => {
  if (!selText || !isConnectableShape(selText.obj) || selText.obj.text === undefined) return;
  applyShapeTextStyle('bold', !selText.obj.bold);
  ensureScreenFont(selText.obj.font || 'spoqa', !!selText.obj.bold, { characters: selText.obj.text || '' });
});

function applyShapeStyle(fn) {
  if (typeof origAnnotSel !== 'undefined' && origAnnotSel) { annotStyleFromShapeBar(fn); return; }  
  if (typeof origShapeSel !== 'undefined' && origShapeSel) { origShapeStyleFromBar(fn); return; }   
  if (!selText || isTextObj(selText.obj)) return;
  const { k, obj, mark } = selText;
  const editingShapeText = !!mark._shapeTextEditor?.isContentEditable;
  if (editingShapeText)
    trackShapeTextSessionObjects(mark, [obj, ...multiSel.map(selection => selection.obj)]);
  if (palLive || editingShapeText) {
    fn(obj);  
  } else {
    const before = { ...obj };
    fn(obj);
    const after = { ...obj };
    Object.assign(obj, before);
    const snap = makeSnap();
    Object.assign(obj, after);
    pushSnap(snap);
  }
  if (obj.type !== 'img' && obj.type !== 'ink') {
    Object.assign(lastShapeStyle, {
      stroke: obj.stroke, sw: obj.sw, strokeOn: obj.strokeOn !== false,
      fillOn: !!obj.fill, fill: obj.fill || lastShapeStyle.fill,
      strokeOp: opOf(obj, 'strokeOp'), fillOp: opOf(obj, 'fillOp'),
      connectorStyle: obj.type === 'arrow' ? (obj.connectorStyle || 'straight') : lastShapeStyle.connectorStyle,
      connectorAnchor: obj.type === 'arrow' ? (obj.connectorAnchor || 'side-midpoints') : lastShapeStyle.connectorAnchor,
      arrowEndType: obj.type === 'arrow' ? (obj.arrowEndType || 'arrow-filled') : lastShapeStyle.arrowEndType,
      arrowHeadSize: obj.type === 'arrow' ? (+obj.arrowHeadSize || 10) : lastShapeStyle.arrowHeadSize,
      lineCap: obj.type === 'line' ? (obj.lineCap === 'square' ? 'square' : 'round') : lastShapeStyle.lineCap,
    });
    saveLastStyles();
  }
  const wrap = mark.parentElement;
  drawShapeEl(mark, obj, wrap.clientWidth, wrap.clientHeight);
  placeHandles(mark, obj);
  for (const s of multiSel) {
    if (isTextObj(s.obj)) continue;
    fn(s.obj);
    if (s.mark && s.mark.parentElement)
      drawShapeEl(s.mark, s.obj, s.mark.parentElement.clientWidth, s.mark.parentElement.clientHeight);
  }
  if (editingShapeText) refreshShapeTextLiveState(mark);
  scheduleThumbRefresh(k);
}
function wheelAdjust(id, fn) {
  $(id).addEventListener('wheel', e => {
    if (!selText && !origTextSel && !origShapeSel && !origAnnotSel) return;
    e.preventDefault(); e.stopPropagation();
    fn(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}
wheelAdjust('tbSw', d => {
  const v = clampStrokeWidth((+$('tbSw').value || 0.1) + d * 0.1);
  $('tbSw').value = v;
  applyShapeStyle(o => o.sw = v);
});
const wheelRange = (id, apply) => wheelAdjust(id, d => {
  const v = Math.max(10, Math.min(100, (+$(id).value || 100) + d * 5));
  $(id).value = v;
  apply(v / 100);
});
wheelRange('tbColorOp', v => applyTextStyle('colorOp', v));
wheelRange('tbStrokeOp', v => applyShapeStyle(o => o.strokeOp = v));
wheelRange('tbFillOp', v => applyShapeStyle(o => o.fillOp = v));
wheelAdjust('tbArrowHead', direction => {
  const value = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, (+$('tbArrowHead').value || 10) + direction));
  $('tbArrowHead').value = value;
  applyShapeStyle(object => { if (object.type === 'arrow') object.arrowHeadSize = value; });
});

$('tbStroke').addEventListener('click', () => openPalette('tbStroke', c => applyShapeStyle(o => o.stroke = c)));
$('tbStrokeOp').addEventListener('change', () => applyShapeStyle(o => o.strokeOp = +$('tbStrokeOp').value / 100));
$('tbInkBrush').addEventListener('change', () => applyShapeStyle(object => {
  if (object.type === 'ink') object.brush = $('tbInkBrush').value;
}));
$('tbSw').addEventListener('change', () => {
  const v = clampStrokeWidth($('tbSw').value);
  $('tbSw').value = v;
  applyShapeStyle(o => o.sw = v);
});
$('tbStrokeOn').addEventListener('change', () => applyShapeStyle(o => {
  o.strokeOn = $('tbStrokeOn').checked;
  if (o.strokeOn === false && !o.fill && o.type !== 'line' && o.type !== 'arrow') {
    o.fill = getCol('tbFill'); $('tbFillOn').checked = true;  
  }
}));
$('tbFillOn').addEventListener('change', () => applyShapeStyle(o => {
  o.fill = $('tbFillOn').checked ? getCol('tbFill') : '';
  if (!o.fill && o.strokeOn === false) { o.strokeOn = true; $('tbStrokeOn').checked = true; }
}));
$('tbFill').addEventListener('click', () => openPalette('tbFill', c => applyShapeStyle(o => { o.fill = c; $('tbFillOn').checked = true; })));
$('tbFillOp').addEventListener('change', () => applyShapeStyle(o => o.fillOp = +$('tbFillOp').value / 100));
$('tbLineCap').addEventListener('change', () => {
  const value = $('tbLineCap').value === 'square' ? 'square' : 'round';
  applyShapeStyle(object => { if (object.type === 'line') object.lineCap = value; });
  if (selText) syncArrowOptionControls(selText.obj);
});
$('tbConnectorStyle').addEventListener('change', () => {
  const value = $('tbConnectorStyle').value;
  applyShapeStyle(object => { if (object.type === 'arrow') object.connectorStyle = value; });
  if (selText) syncArrowOptionControls(selText.obj);
});
document.querySelectorAll('[data-connector-anchor]').forEach(button => button.addEventListener('click', () => {
  if (!selText || selText.obj.type !== 'arrow') return;
  const nextAnchor = (selText.obj.connectorAnchor || 'side-midpoints') === 'side-midpoints'
    ? 'edge' : 'side-midpoints';
  applyShapeStyle(object => { if (object.type === 'arrow') object.connectorAnchor = nextAnchor; });
  if (selText) {
    const wrap = selText.mark.parentElement;
    redrawConnectedArrows(selText.k, wrap);
    placeHandles(selText.mark, selText.obj);
    syncArrowOptionControls(selText.obj);
  }
}));
$('tbArrowEnd').addEventListener('change', () => {
  const value = $('tbArrowEnd').value;
  applyShapeStyle(object => { if (object.type === 'arrow') object.arrowEndType = value; });
  if (selText) syncArrowOptionControls(selText.obj);
});
$('tbArrowHead').addEventListener('change', () => {
  const value = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +$('tbArrowHead').value || 10));
  $('tbArrowHead').value = value;
  applyShapeStyle(object => { if (object.type === 'arrow') object.arrowHeadSize = value; });
});

const OBJECT_TOOLBAR_NUMBER_IDS = new Set(['tbSize', 'stSize', 'tbSw', 'tbArrowHead']);
function commitObjectToolbarNumberBeforePointerDown(event) {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !OBJECT_TOOLBAR_NUMBER_IDS.has(active.id) ||
      active === event.target) return;
  active.blur();
}

const getCol = id => $(id).dataset.col;
function setCol(id, c) { $(id).dataset.col = c; $(id).style.background = c; }
['tbColor', 'tbStroke', 'tbFill', 'stColor'].forEach(id => setCol(id, $(id).dataset.col));
let lastShapeStyle = {
  stroke: getCol('tbStroke'), fill: getCol('tbFill'), sw: +$('tbSw').value,
  strokeOn: true, fillOn: $('tbFillOn').checked, strokeOp: 1, fillOp: 1,
  connectorStyle: 'straight', connectorAnchor: 'side-midpoints',
  arrowEndType: 'arrow-filled', arrowHeadSize: 10, lineCap: 'round',
};
try { Object.assign(lastShapeStyle, JSON.parse(settings.get('lastShape') || '{}')); } catch {}
lastShapeStyle.sw = clampStrokeWidth(lastShapeStyle.sw);
lastShapeStyle.lineCap = lastShapeStyle.lineCap === 'square' ? 'square' : 'round';
if (!['straight', 'angled', 'curve', 'step'].includes(lastShapeStyle.connectorStyle))
  lastShapeStyle.connectorStyle = 'straight';
setCol('tbStroke', lastShapeStyle.stroke);
setCol('tbFill', lastShapeStyle.fill);
$('tbSw').value = lastShapeStyle.sw;
$('tbFillOn').checked = !!lastShapeStyle.fillOn;
$('tbStrokeOp').value = Math.round((lastShapeStyle.strokeOp ?? 1) * 100);
$('tbFillOp').value = Math.round((lastShapeStyle.fillOp ?? 1) * 100);
setCol('tbColor', lastTextStyle.color);
if (lastTextStyle.size) $('tbSize').value = lastTextStyle.size;
if (lastTextStyle.font) $('tbFont').value = lastTextStyle.font;
if (lastTextStyle.colorOp !== undefined) $('tbColorOp').value = Math.round(lastTextStyle.colorOp * 100);
setCol('stColor', lastShapeTextStyle.color || '#000000');
$('stSize').value = Math.max(6, Math.min(200, +lastShapeTextStyle.size || 16));
$('stFont').value = lastShapeTextStyle.font || 'spoqa';
fontPickerController.syncAll();
$('stColorOp').value = Math.round((lastShapeTextStyle.colorOp ?? 1) * 100);
$('stBold').classList.toggle('active', !!lastShapeTextStyle.bold);
$('stAlign').value = lastShapeTextStyle.align || 'center';
$('stValign').value = lastShapeTextStyle.valign || 'middle';
const PALETTE = [
  '#000000', '#555555', '#999999', '#cccccc', '#ffffff',
  '#d32f2f', '#e91e63', '#ff5722', '#ff9800', '#ffc107',
  '#ffeb3b', '#8bc34a', '#4caf50', '#009688', '#00bcd4',
  '#2196f3', '#1a56c4', '#673ab7', '#9c27b0', '#795548'
];
$('palGrid').innerHTML = PALETTE.map(c => `<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('');
let palTarget = null;  
let palLive = false;   

let palRecent = [];
try {
  palRecent = (JSON.parse(settings.get('palRecent') || '[]') || [])
    .filter(c => /^#[0-9a-f]{3,8}$/i.test(String(c))).slice(0, 2);  
} catch {}
function renderPalRecent() {
  $('palRecentWrap').style.display = palRecent.length ? 'block' : 'none';
  $('palRecent').innerHTML = palRecent.map(c => `<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('');
}
renderPalRecent();
function addPalRecent(c) {
  c = c.toLowerCase();
  if (PALETTE.includes(c)) return;  
  palRecent = [c, ...palRecent.filter(x => x !== c)].slice(0, 2);
  settings.set('palRecent', JSON.stringify(palRecent));
  renderPalRecent();
}

let palDragged = false;  
function openPalette(btnId, apply, { recordHistory = true } = {}) {
  const pop = $('palettePop');
  if (pop.style.display === 'block' && palTarget && palTarget.btnId === btnId) { closePalette(); return; }  
  palTarget = { btnId, apply, recordHistory };
  palDragged = false;
  pop.style.display = 'block';
  positionPalette();
  if ($('palPicker').style.display !== 'none') syncPicker();  
}
function positionPalette() {
  if (!palTarget) return;
  const pop = $('palettePop');
  pop.style.visibility = 'hidden';
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const r = $(palTarget.btnId).getBoundingClientRect();
  const objR = selText && selText.mark ? selText.mark.getBoundingClientRect() : null;
  const clamp = (x, y) => [Math.max(8, Math.min(x, window.innerWidth - pw - 8)),
                           Math.max(8, Math.min(y, window.innerHeight - ph - 8))];
  const covers = (x, y) => objR && x < objR.right && x + pw > objR.left && y < objR.bottom && y + ph > objR.top;
  const cands = [[r.left, r.bottom + 6], [r.left, r.top - ph - 6]];
  if (objR) cands.push([objR.right + 10, r.top], [objR.left - pw - 10, r.top]);
  let pos = clamp(r.left, r.bottom + 6);
  for (const [cx, cy] of cands) {
    const p = clamp(cx, cy);
    if (!covers(p[0], p[1])) { pos = p; break; }
  }
  pop.style.left = pos[0] + 'px';
  pop.style.top = pos[1] + 'px';
  pop.style.visibility = '';
}
let colorSample = null;
function closePalette() {
  colorSample?.abort();
  $('palettePop').style.display = 'none'; palTarget = null; palPre = null;
}
function applyPaletteColor(color) {
  setCol(palTarget.btnId, color);
  palTarget.apply(color);
  if ($('palPicker').style.display !== 'none') syncPicker();
}
$('palEyedropper').hidden = !desktopHost.native && !window.EyeDropper;
$('palEyedropper').onclick = async event => {
  if (!palTarget || colorSample) return;
  const target = palTarget, doc = editorStore.activeDocument, object = selText?.obj;
  const controller = colorSample = new AbortController();
  $('palettePop').classList.add('sampling');
  try {
    const pointer = event.detail ? { x: event.clientX, y: event.clientY } : null;
    const color = await pickEditorColor($('palSampleSurface'), desktopHost, controller.signal, pointer);
    if (controller.signal.aborted || palTarget !== target || doc !== editorStore.activeDocument || object !== selText?.obj) return;
    applyPaletteColor(color);
    addPalRecent(color);
  } catch (error) {
    if (error.name !== 'AbortError') toast('색상을 읽을 수 없습니다. 다시 시도해 주세요.');
  } finally {
    $('palettePop').classList.remove('sampling');
    colorSample = null;
  }
};
$('palettePop').addEventListener('click', e => {
  const sw = e.target.closest('.sw');
  if (!sw || !palTarget) return;
  applyPaletteColor(sw.dataset.c);
});

let palH = 0, palS = 1, palV = 1;
let palPre = null;  
function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}
function drawSV() {
  const cv = $('palSV'), ctx = cv.getContext('2d');
  ctx.fillStyle = `hsl(${palH},100%,50%)`;
  ctx.fillRect(0, 0, cv.width, cv.height);
  let g = ctx.createLinearGradient(0, 0, cv.width, 0);
  g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  $('palSVDot').style.left = (palS * cv.width) + 'px';
  $('palSVDot').style.top = ((1 - palV) * cv.height) + 'px';
}
function syncPicker() {
  if (!palTarget) return;
  [palH, palS, palV] = hexToHsv(getCol(palTarget.btnId) || '#d32f2f');
  $('palHue').value = Math.round(palH);
  drawSV();
}
function pickApply() {  
  if (!palTarget) return;
  const c = hsvToHex(palH, palS, palV);
  if (palTarget.recordHistory && !palPre) palPre = makeSnap();
  palLive = true;
  setCol(palTarget.btnId, c);
  palTarget.apply(c);
  palLive = false;
}
function pickCommit() {  
  if (!palTarget) return;
  if (palPre) {
    const shapeTextMark = activeShapeTextMark();
    if (!shapeTextMark) pushSnap(palPre);
    palPre = null;
  }
  addPalRecent(hsvToHex(palH, palS, palV));
}
$('palCustom').onclick = () => {
  const pk = $('palPicker');
  const show = pk.style.display === 'none';
  pk.style.display = show ? 'block' : 'none';
  $('palCustom').textContent = show ? '🎨 직접 선택 닫기' : '🎨 직접 선택…';
  if (show) {
    syncPicker();
    if (!palDragged) positionPalette();  
  }
};
$('palSV').addEventListener('pointerdown', e => {
  e.preventDefault();
  const cv = $('palSV');
  cv.setPointerCapture(e.pointerId);
  const upd = ev => {
    const r = cv.getBoundingClientRect();
    palS = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    palV = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
    drawSV(); pickApply();
  };
  upd(e);
  const mv = ev => upd(ev);
  const up = () => {
    cv.removeEventListener('pointermove', mv);
    cv.removeEventListener('pointerup', up);
    pickCommit();
  };
  cv.addEventListener('pointermove', mv);
  cv.addEventListener('pointerup', up);
});
$('palHue').addEventListener('input', () => { palH = +$('palHue').value; drawSV(); pickApply(); });
$('palHue').addEventListener('change', pickCommit);
$('palDrag').addEventListener('mousedown', e => {
  e.preventDefault();
  const pop = $('palettePop');
  const start = { x: e.clientX, y: e.clientY, l: pop.offsetLeft, t: pop.offsetTop };
  const mv = e2 => {
    palDragged = true;
    pop.style.left = Math.max(0, Math.min(start.l + e2.clientX - start.x, window.innerWidth - pop.offsetWidth)) + 'px';
    pop.style.top = Math.max(0, Math.min(start.t + e2.clientY - start.y, window.innerHeight - pop.offsetHeight)) + 'px';
  };
  const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
});
document.addEventListener('mousedown', e => {
  if ($('palettePop').style.display === 'block' &&
      !e.target.closest('#palettePop') && !e.target.closest('.swBtn')) closePalette();
}, true);

let connectorPickMode = false;
let connectorIdSeq = 0;
function createConnectorId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  connectorIdSeq++;
  return `shape-${Date.now().toString(36)}-${connectorIdSeq.toString(36)}`;
}
function stopConnectorPickMode() {
  connectorPickMode = false;
  $('btnConnectArrow').classList.remove('active');
  document.body.classList.remove('connectorMode');
}
function selectOverlayObject(k, object) {
  const wrap = document.getElementById('pg' + k);
  if (!wrap) return;
  positionMarks(wrap, editorStore.pages[k]);
  const mark = [...wrap.querySelectorAll('.obj')][editorStore.pages[k].texts.indexOf(object)];
  if (mark) selectMark(k, object, mark);
}
function addConnectedArrowToShape(k, shape) {
  if (!isConnectableShape(shape) || !editorStore.pages[k]) {
    toast('사각형·원·삼각형·별에만 연결 화살표를 붙일 수 있습니다');
    return false;
  }
  if (!requireWindowsEdit()) return false;
  if (activeDocLocked()) { lockNotice(); return false; }
  const page = editorStore.pages[k];
  const snap = makeSnap();
  shape.linkId ||= createConnectorId();
  const centerY = shape.fy + shape.fh / 2;
  const leftSpace = shape.fx;
  const rightSpace = 1 - (shape.fx + shape.fw);
  const useRight = rightSpace >= leftSpace;
  const reach = Math.max(.12, Math.min(.24, shape.fw * .8));
  const tailX = useRight
    ? Math.min(.98, shape.fx + shape.fw + reach)
    : Math.max(.02, shape.fx - reach);
  const arrow = {
    type: 'arrow', x1: shape.fx, y1: centerY, x2: tailX, y2: centerY,
    stroke: shape.stroke || lastShapeStyle.stroke, sw: clampStrokeWidth(shape.sw || lastShapeStyle.sw),
    strokeOp: opOf(shape, 'strokeOp'), attachTo: shape.linkId, attachPoint: 'start',
    connectorAnchor: lastShapeStyle.connectorAnchor || 'side-midpoints',
    connectorStyle: lastShapeStyle.connectorStyle || 'straight',
    arrowEndType: lastShapeStyle.arrowEndType || 'arrow-filled',
    arrowHeadSize: Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +lastShapeStyle.arrowHeadSize || 10)),
  };
  page.texts.push(arrow);
  const wrap = document.getElementById('pg' + k);
  syncAttachedArrow(page, arrow, wrap?.clientWidth || 1, wrap?.clientHeight || 1);
  pushSnap(snap);
  selectOverlayObject(k, arrow);
  scheduleThumbRefresh(k);
  toast('연결 화살표 추가됨 — 바깥쪽 끝을 끌어 방향을 바꿀 수 있습니다');
  return true;
}
function handleConnectArrowButton() {
  stopDrawing();
  if (!editorStore.pages.length) return;
  if (selText && isConnectableShape(selText.obj)) {
    addConnectedArrowToShape(selText.k, selText.obj);
    stopConnectorPickMode();
    return;
  }
  stopShapeDraft();
  cancelRegion();
  setTextMode(false);
  connectorPickMode = true;
  $('btnConnectArrow').classList.add('active');
  document.body.classList.add('connectorMode');
  toast('연결할 사각형·원·삼각형·별을 클릭하세요 (Esc 취소)');
}

let shapeDraft = null;  
let polylineDraft = null;  

function handleShapeButton(ev) {
  const m = $('shapeMenu');
  const r = ev.currentTarget.getBoundingClientRect();
  const mobile = matchMedia('(max-width: 768px)').matches;
  m.style.display = mobile ? 'grid' : 'block';
  m.style.left = r.left + 'px';
  m.style.top = (mobile ? ev.currentTarget.closest('#toolbar').getBoundingClientRect().bottom : r.bottom + 4) + 'px';
  ev.stopPropagation();
}
function stopShapeDraft() {
  if (polylineDraft) {
    const draft = polylineDraft;
    polylineDraft = null;
    const page = editorStore.pages[draft.k];
    const index = page?.texts?.indexOf(draft.obj) ?? -1;
    if (index >= 0) page.texts.splice(index, 1);
    if (draft.wrap?.isConnected && page) positionMarks(draft.wrap, page);
  }
  shapeDraft = null;
  $('btnShape').classList.remove('active');
  document.body.classList.remove('shapeMode');
}
function startShapeDraft(kind, label) {
  stopDrawing();
  if (!editorStore.pages.length) return;
  if (activeDocLocked()) { lockNotice(); return; }
  stopShapeDraft();
  if (origMode) setOrigMode(false);  
  cancelRegion();                    
  stopConnectorPickMode();
  setTextMode(false);
  shapeDraft = kind;
  $('btnShape').classList.add('active');
  document.body.classList.add('shapeMode');
  if (kind === 'polyline') {
    toast('점을 차례로 클릭해 연결선을 만들고 우클릭하여 닫으세요');
    return;
  }
  toast(matchMedia('(max-width: 768px)').matches
    ? '페이지를 탭하거나 드래그하여 ' + label + ' 추가'
    : '페이지에서 드래그하여 ' + label + ' 그리기');
}
function handleShapeMenuClick(e) {
  const mi = e.target.closest('.mi');
  if (!mi) return;
  if (mi.classList.contains('dim')) return;
  $('shapeMenu').style.display = 'none';
  startShapeDraft(mi.dataset.shape, mi.textContent.trim());
}

function polylineDraftPoint(wrap, clientX, clientY) {
  const bounds = wrap.getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width))),
    Math.max(0, Math.min(1, (clientY - bounds.top) / Math.max(1, bounds.height))),
  ];
}

function updatePolylineDraftPreview(clientX, clientY, target) {
  const draft = polylineDraft;
  if (!draft || !draft.mark?.isConnected || !target?.closest?.('.pageWrap') ||
      target.closest('.pageWrap') !== draft.wrap) return;
  draft.obj.points[draft.confirmedCount] = polylineDraftPoint(draft.wrap, clientX, clientY);
  drawShapeEl(draft.mark, draft.obj, draft.wrap.clientWidth, draft.wrap.clientHeight);
}

function addPolylineDraftPoint(wrap, k, clientX, clientY) {
  const point = polylineDraftPoint(wrap, clientX, clientY);
  if (!polylineDraft) {
    const style = lastShapeStyle;
    const object = {
      type: 'polyline', points: [point, [...point]], closed: false,
      stroke: style.stroke, sw: style.sw, strokeOp: style.strokeOp ?? 1,
      strokeOn: style.strokeOn !== false,
    };
    const snap = makeSnap();
    editorStore.pages[k].texts.push(object);
    positionMarks(wrap, editorStore.pages[k]);
    const mark = [...wrap.querySelectorAll('.obj')].find(element => element._ctx?.obj === object);
    polylineDraft = { wrap, k, obj: object, mark, snap, confirmedCount: 1 };
    return;
  }
  if (polylineDraft.wrap !== wrap || polylineDraft.k !== k) {
    toast('연결선은 한 페이지 안에서 완성하세요');
    return;
  }
  const draft = polylineDraft;
  const previous = draft.obj.points[draft.confirmedCount - 1];
  const bounds = wrap.getBoundingClientRect();
  if (Math.hypot((point[0] - previous[0]) * bounds.width,
    (point[1] - previous[1]) * bounds.height) < 4) return;
  draft.obj.points[draft.confirmedCount] = point;
  draft.confirmedCount += 1;
  draft.obj.points[draft.confirmedCount] = [...point];
  drawShapeEl(draft.mark, draft.obj, wrap.clientWidth, wrap.clientHeight);
}

function finishPolylineDraft() {
  const draft = polylineDraft;
  if (!draft) { stopShapeDraft(); return; }
  if (draft.confirmedCount < 3) {
    toast('닫힌 연결선은 모서리가 3개 이상 필요합니다');
    return;
  }
  draft.obj.points = draft.obj.points.slice(0, draft.confirmedCount).map(point => [...point]);
  draft.obj.closed = true;
  polylineDraft = null;
  pushSnap(draft.snap);
  positionMarks(draft.wrap, editorStore.pages[draft.k]);
  const mark = [...draft.wrap.querySelectorAll('.obj')]
    .find(element => element._ctx?.obj === draft.obj);
  shapeDraft = null;
  $('btnShape').classList.remove('active');
  document.body.classList.remove('shapeMode');
  if (mark) selectMark(draft.k, draft.obj, mark);
  scheduleThumbRefresh(draft.k);
  toast('연결선이 닫혔습니다 — 모서리점과 선분점을 끌어 수정할 수 있습니다');
}

function beginShapeDraw(wrap, k, clientX, clientY) {
  const rect = wrap.getBoundingClientRect();
  const sx = (clientX - rect.left) / rect.width;
  const sy = (clientY - rect.top) / rect.height;
  const kind = shapeDraft;
  const isLine = kind === 'line' || kind === 'arrow';
  const st = lastShapeStyle;
  const strokeOp = st.strokeOp ?? 1, fillOp = st.fillOp ?? 1;
  const obj = isLine
    ? { type: kind, x1: sx, y1: sy, x2: sx, y2: sy, stroke: st.stroke, sw: st.sw, strokeOp,
        ...(kind === 'line' ? { lineCap: st.lineCap === 'square' ? 'square' : 'round' } : {}),
        ...(kind === 'arrow' ? { connectorStyle: st.connectorStyle || 'straight',
          connectorAnchor: st.connectorAnchor || 'side-midpoints',
          arrowEndType: st.arrowEndType || 'arrow-filled', arrowHeadSize: +st.arrowHeadSize || 10 } : {}) }
    : { type: kind, fx: sx, fy: sy, fw: 0.01, fh: 0.01, stroke: st.stroke, sw: st.sw,
        strokeOn: st.strokeOn !== false, fill: st.fillOn ? st.fill : '', strokeOp, fillOp };
  const snap = makeSnap();
  editorStore.pages[k].texts.push(obj);
  positionMarks(wrap, editorStore.pages[k]);
  const mark = [...wrap.querySelectorAll('.obj')].pop();
  return { wrap, k, rect, sx, sy, kind, isLine, obj, snap, mark };
}
function updateShapeDraw(ctx, clientX, clientY, lockRatio = false) {
  const { rect, sx, sy, isLine, obj, mark } = ctx;
  let ex = (clientX - rect.left) / rect.width;
  let ey = (clientY - rect.top) / rect.height;
  if (lockRatio) {
    const dxp = (ex - sx) * rect.width, dyp = (ey - sy) * rect.height;
    if (isLine) {
      const len = Math.hypot(dxp, dyp);
      const ang = Math.round(Math.atan2(dyp, dxp) / (Math.PI / 4)) * (Math.PI / 4);
      ex = sx + len * Math.cos(ang) / rect.width;
      ey = sy + len * Math.sin(ang) / rect.height;
    } else {
      const mpx = Math.max(Math.abs(dxp), Math.abs(dyp));
      ex = sx + Math.sign(dxp || 1) * mpx / rect.width;
      ey = sy + Math.sign(dyp || 1) * mpx / rect.height;
    }
  }
  if (isLine) { obj.x2 = ex; obj.y2 = ey; }
  else {
    obj.fx = Math.min(sx, ex); obj.fy = Math.min(sy, ey);
    obj.fw = Math.max(0.005, Math.abs(ex - sx)); obj.fh = Math.max(0.005, Math.abs(ey - sy));
  }
  drawShapeEl(mark, obj, rect.width, rect.height);
}
function shapeDrawTooSmall(ctx) {
  const { rect, isLine, obj } = ctx;
  return isLine
    ? Math.hypot((obj.x2 - obj.x1) * rect.width, (obj.y2 - obj.y1) * rect.height) < 6
    : obj.fw * rect.width < 6 && obj.fh * rect.height < 6;
}
function setTappedShapeSize(ctx) {
  const { rect, sx, sy, isLine, obj, mark } = ctx;
  if (isLine) {
    const len = Math.min(.32, Math.max(.12, 96 / rect.width));
    obj.x1 = Math.max(0, Math.min(1 - len, sx - len / 2));
    obj.x2 = obj.x1 + len;
    obj.y1 = obj.y2 = Math.max(0, Math.min(1, sy));
  } else {
    const fw = Math.min(.32, Math.max(.10, 96 / rect.width));
    const fh = Math.min(.22, Math.max(.07, 64 / rect.height));
    obj.fx = Math.max(0, Math.min(1 - fw, sx - fw / 2));
    obj.fy = Math.max(0, Math.min(1 - fh, sy - fh / 2));
    obj.fw = fw; obj.fh = fh;
  }
  drawShapeEl(mark, obj, rect.width, rect.height);
}
function commitShapeDraw(ctx) {
  pushSnap(ctx.snap);
  selectMark(ctx.k, ctx.obj, ctx.mark);
  stopShapeDraft();
}
function discardShapeDraw(ctx) {
  const i = editorStore.pages[ctx.k].texts.indexOf(ctx.obj);
  if (i >= 0) editorStore.pages[ctx.k].texts.splice(i, 1);
  positionMarks(ctx.wrap, editorStore.pages[ctx.k]);
  stopShapeDraft();
}

viewer.addEventListener('mousedown', ev => {
  if (!shapeDraft || ev.button !== 0 || spacePan) return;
  const wrap = ev.target.closest('.pageWrap');
  if (!wrap || (shapeDraft !== 'polyline' && ev.target.closest('.obj'))) return;
  ev.preventDefault(); ev.stopPropagation();
  if (shapeDraft === 'polyline') {
    addPolylineDraftPoint(wrap, +wrap.dataset.k, ev.clientX, ev.clientY);
    return;
  }
  const ctx = beginShapeDraw(wrap, +wrap.dataset.k, ev.clientX, ev.clientY);
  const mv = e2 => updateShapeDraw(ctx, e2.clientX, e2.clientY, e2.shiftKey);
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    if (shapeDrawTooSmall(ctx)) discardShapeDraw(ctx);
    else commitShapeDraw(ctx);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}, true);

viewer.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'touch' || !shapeDraft || spacePan) return;
  const wrap = ev.target.closest('.pageWrap');
  if (!wrap || (shapeDraft !== 'polyline' && ev.target.closest('.obj'))) return;
  ev.preventDefault(); ev.stopPropagation();
  if (shapeDraft === 'polyline') {
    addPolylineDraftPoint(wrap, +wrap.dataset.k, ev.clientX, ev.clientY);
    return;
  }
  const pointerId = ev.pointerId;
  const ctx = beginShapeDraw(wrap, +wrap.dataset.k, ev.clientX, ev.clientY);
  let moved = false;
  const mv = e2 => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    if (Math.hypot(e2.clientX - ev.clientX, e2.clientY - ev.clientY) >= 6) moved = true;
    updateShapeDraw(ctx, e2.clientX, e2.clientY);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const up = e2 => {
    if (e2.pointerId !== pointerId) return;
    cleanup();
    if (!moved || shapeDrawTooSmall(ctx)) setTappedShapeSize(ctx);
    commitShapeDraw(ctx);
  };
  const cancel = e2 => {
    if (e2.pointerId !== pointerId) return;
    cleanup();
    discardShapeDraw(ctx);
  };
  window.addEventListener('pointermove', mv, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}, { capture: true, passive: false });

viewer.addEventListener('mousemove', event => {
  if (shapeDraft === 'polyline')
    updatePolylineDraftPreview(event.clientX, event.clientY, event.target);
}, true);

viewer.addEventListener('pointermove', event => {
  if (shapeDraft === 'polyline' && event.pointerType === 'touch')
    updatePolylineDraftPreview(event.clientX, event.clientY, event.target);
}, { capture: true, passive: true });

viewer.addEventListener('contextmenu', event => {
  if (shapeDraft !== 'polyline') return;
  event.preventDefault();
  event.stopPropagation();
  finishPolylineDraft();
}, true);

let objClip = null;
const isObjectBundle = value => value?.kind === 'object-bundle-v1' && Array.isArray(value.objects);
const objectClipboardItems = value => !value ? [] : isObjectBundle(value) ? value.objects : [value];
function makeObjectClipboardValue(page, object, selection = [object]) {
  if (!page || !object) return null;
  const objects = selection.length > 1
    ? copyMixedOverlayObjects(selection) : copyConnectedObjectBundle(page, object, createConnectorId);
  const picked = connectedDeletionSet(page.texts, selection);
  const primaryIndex = selection.length > 1
    ? Math.max(0, page.texts.filter(item => picked.has(item)).indexOf(object)) : 0;
  return objects.length > 1
    ? { kind: 'object-bundle-v1', objects, primaryIndex }
    : objects[0];
}
function removeObjectClipboardSource(object, objects, selection = [object]) {
  const deletion = connectedDeletionSet(objects, selection);
  for (let index = objects.length - 1; index >= 0; index--)
    if (deletion.has(objects[index])) objects.splice(index, 1);
}
let objMenuPage = -1;
let objMenuPasteTarget = null;
function captureObjectPasteTarget(k, point = null) {
  return { document: editorStore.activeDocument, page: editorStore.pages[k], point };
}
function validObjectPasteTarget(k, target) {
  return !(!windowsAccess.current.canEditCurrentDocuments) && target?.document && target.page &&
    target.document === editorStore.activeDocument && target.page === editorStore.pages[k];
}
viewer.addEventListener('contextmenu', event => {
  const wrap = blankContextPage(event.target);
  if (!wrap) return;
  event.preventDefault();
  event.stopPropagation();
  const k = +wrap.dataset.k, rect = wrap.getBoundingClientRect();
  const target = captureObjectPasteTarget(k, {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  });
  deselectText();
  focusViewer();
  showPageContextMenu(k, event.clientX, event.clientY, target);
});
let objMenuOrig = false;  
let objMenuPolylineContext = null;
function pointSegmentProjection(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy;
  const ratio = length2 > 0
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2))
    : 0;
  const projected = [start[0] + dx * ratio, start[1] + dy * ratio];
  return { projected, distance2: (point[0] - projected[0]) ** 2 + (point[1] - projected[1]) ** 2 };
}
function polylineContextFromPointer(object, mark, event) {
  if (object?.type !== 'polyline') return null;
  const vertex = event.target.closest?.('.polyVertex');
  if (vertex) return { kind: 'vertex', index: +vertex.dataset.polyVertexIndex };
  const segment = event.target.closest?.('.polySegment');
  if (segment) {
    const points = polylineObjectPoints(object);
    const index = +segment.dataset.polySegmentIndex;
    const start = points[index], end = points[(index + 1) % points.length];
    if (start && end) return {
      kind: 'segment', index,
      point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    };
  }
  if (!event.target.closest?.('.connectorHit')) return { kind: 'box' };
  const wrap = mark.parentElement;
  const rect = wrap?.getBoundingClientRect();
  const points = polylineObjectPoints(object);
  if (!rect || points.length < 2) return { kind: 'box' };
  const pointer = [
    Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  ];
  const segmentCount = object.closed ? points.length : points.length - 1;
  let best = null;
  for (let index = 0; index < segmentCount; index++) {
    const projection = pointSegmentProjection(pointer, points[index], points[(index + 1) % points.length]);
    if (!best || projection.distance2 < best.distance2) best = { ...projection, index };
  }
  return best ? { kind: 'segment', index: best.index, point: best.projected } : { kind: 'box' };
}
function showObjMenu(x, y, isOrig, polylineContext = null) {
  if (!windowsAccess.current.canEditCurrentDocuments) return;
  const m = $('objMenu');
  objMenuOrig = !!isOrig;
  objMenuPolylineContext = !isOrig && selText?.obj?.type === 'polyline' ? polylineContext : null;
  objMenuPage = selText ? selText.k : -1;
  objMenuPasteTarget = captureObjectPasteTarget(objMenuPage);
  $('ctxMenu').style.display = 'none';
  $('objCropMi').classList.toggle('dim', !!isOrig || selText?.obj?.type !== 'img');
  $('objConnectArrowMi').classList.toggle('dim', !!isOrig || !isConnectableShape(selText?.obj));
  const isPolyline = !isOrig && selText?.obj?.type === 'polyline';
  const addPoint = $('objPolylineAddPointMi');
  const removePoint = $('objPolylineRemovePointMi');
  const closePath = $('objPolylineCloseMi');
  addPoint.hidden = !isPolyline || objMenuPolylineContext?.kind !== 'segment';
  removePoint.hidden = !isPolyline || objMenuPolylineContext?.kind !== 'vertex';
  closePath.hidden = !isPolyline || objMenuPolylineContext?.kind !== 'box';
  removePoint.classList.toggle('dim', !isPolyline || polylineObjectPoints(selText?.obj).length <= 2);
  closePath.classList.toggle('dim', !isPolyline || !!selText?.obj?.closed ||
    polylineObjectPoints(selText?.obj).length < 3);
  m.querySelectorAll('[data-cmd="copy"], [data-cmd="cut"]')
    .forEach(el => el.classList.remove('dim'));
  const mixed = hasMixedSelection() || hasMixedOverlayTypes();
  m.querySelectorAll('[data-cmd="front"], [data-cmd="back"], [data-cmd="rot90"]')
    .forEach(el => el.classList.toggle('dim', mixed));
  if (mixed) {
    $('objCropMi').classList.add('dim');
    $('objConnectArrowMi').classList.add('dim');
    addPoint.hidden = removePoint.hidden = closePath.hidden = true;
  }
  positionContextMenu(m, x, y);
  const k = objMenuPage, target = objMenuPasteTarget;
  contextPasteState.refresh(m, $('objPasteMi'), ['object'], () =>
    !isOrig && !activeDocLocked() && validObjectPasteTarget(k, target));
}
function editSelectedPolyline(mutator) {
  if (!selText || selText.obj?.type !== 'polyline') return;
  const { k, obj, mark } = selText;
  const snap = makeSnap();
  if (mutator(obj) === false) return;
  pushSnap(snap);
  const wrap = mark.parentElement;
  if (wrap) {
    drawShapeEl(mark, obj, wrap.clientWidth, wrap.clientHeight);
    placeHandles(mark, obj);
    positionTextBar();
  }
  scheduleThumbRefresh(k);
}
function objDo(fn) {
  if (!selText) return;
  const { k, obj } = selText;
  const arr = editorStore.pages[k].texts;
  const snap = makeSnap();
  fn(obj, arr, k);
  detachDanglingConnectors(arr);
  pushSnap(snap);
  const wrap = document.getElementById('pg' + k);
  if (wrap) positionMarks(wrap, editorStore.pages[k]);
  deselectText();
}
function overlayZOrder(front) {
  if (!selText) return;
  const { k, obj: primary } = selText;
  const arr = editorStore.pages[k].texts;
  const picked = new Set([primary, ...multiSel.map(s => s.obj)]);
  const moving = arr.filter(o => picked.has(o));
  if (!moving.length) return;
  const ordered = overlayEditorFeature.reorderWithinCategories(arr, o => picked.has(o), objCategory, front);
  if (ordered.every((o, i) => o === arr[i])) return;

  const snap = makeSnap();
  arr.splice(0, arr.length, ...ordered);
  pushSnap(snap);

  selText = null;
  multiSel = [];
  const wrap = document.getElementById('pg' + k);
  if (wrap) {
    positionMarks(wrap, editorStore.pages[k]);
    const marks = [...wrap.querySelectorAll('.obj')];
    const primaryMark = marks[arr.indexOf(primary)];
    if (primaryMark) {
      selectMark(k, primary, primaryMark);
      multiSel = moving
        .filter(o => o !== primary)
        .map(o => ({ obj: o, mark: marks[arr.indexOf(o)] }))
        .filter(s => s.mark);
      multiSel.forEach(s => s.mark.classList.add('sel'));
      refreshSelectedObjectHandles();
    }
  }
  scheduleThumbRefresh(k);
}
function rotateObj90(t) {
  if ((t?.type === 'polyline' && Array.isArray(t.points) && t.points.length) || t?.type === 'arrow') {
    const wrap = selText?.mark?.parentElement;
    const width = Math.max(1, wrap?.clientWidth || 1);
    const height = Math.max(1, wrap?.clientHeight || 1);
    if (t.type === 'polyline') {
      t.points = rotatePolylinePoints(polylineObjectPoints(t), width, height, objRotation(t) + 90);
      t.rot = 0;
    } else {
      const page = editorStore.pages[selText?.k];
      const shape = t.attachTo
        ? page?.texts?.find(object => isConnectableShape(object) && object.linkId === t.attachTo)
        : null;
      if (shape && (!Number.isFinite(+t.connectorAnchorX) || !Number.isFinite(+t.connectorAnchorY))) {
        const vector = shapeAnchorVector(shape, t.x1, t.y1, width, height);
        if (vector) [t.connectorAnchorX, t.connectorAnchorY] = vector;
      }
      rotateConnectorJoints(t, width, height, objRotation(t) + 90, shape ? 'start' : 'center');
      if (shape) syncAttachedArrow(page, t, width, height);
    }
    return;
  }
  overlayEditorFeature.rotateQuarterTurn(t);
}
async function copyObj(cut) {
  if (hasMixedSelection()) return origCopyToClip(cut);
  if (!selText) return;
  const selected = selText;
  const sourceSelection = selectedObjectEntries().map(entry => entry.obj);
  const candidate = makeObjectClipboardValue(editorStore.pages[selected.k], selected.obj, sourceSelection);
  const sourceDocument = editorStore.documentName;
  return runClipboardCopy(async () => {
  if (desktopViewMode) {
    const finishBusy = beginClipboardBusy(cut ? '오브젝트 잘라내기 준비 중...' : '오브젝트 복사 준비 중...');
    try {
      const markerWrite = syncClipMarker(CLIP_OBJ);
      const packet = await serializeObjectForWebClipboard(candidate);
      await markerWrite;
      await putShellClipboard(packet, {
        kind: 'object-v1', count: objectClipboardItems(candidate).length,
        operation: cut ? 'cut' : 'copy', sourceTab: desktopTabToken,
        sourceDocument,
      });
      objClip = candidate;
      if (cut && selText === selected) objDo((object, objects) => removeObjectClipboardSource(object, objects, sourceSelection));
      toast('오브젝트 ' + (cut ? '잘라내기' : '복사') + '됨 — 다른 창에도 붙여넣을 수 있습니다');
      return true;
    } catch (error) {
      console.error(error);
      toast('오브젝트 ' + (cut ? '잘라내기' : '복사') + ' 실패: ' +
        String(error?.message || error).slice(0, 80), 4200);
    } finally { finishBusy(); }
    return;
  }
  const finishBusy = beginClipboardBusy(cut ? '오브젝트 잘라내기 준비 중...' : '오브젝트 복사 준비 중...');
  try {
    await commitWebObjectClipboard(candidate, {
      operation: cut ? 'cut' : 'copy', sourceDocument,
    });
    objClip = candidate;
    if (cut && selText === selected) objDo((object, objects) => removeObjectClipboardSource(object, objects, sourceSelection));
    toast('오브젝트 ' + (cut ? '잘라내기' : '복사') + '됨 — 다른 웹 창에도 붙여넣을 수 있습니다');
    return true;
  } catch (error) {
    console.error(error);
    toast('오브젝트 ' + (cut ? '잘라내기' : '복사') + ' 실패: ' +
      String(error?.message || error).slice(0, 80), 4200);
  } finally { finishBusy(); }
  });
}
function selectPastedObjectBundle(k, objects, primaryIndex, wrap, keepOriginal = false) {
  if (!wrap || !objects.length) return;
  const page = editorStore.pages[k];
  const marks = [...wrap.querySelectorAll('.obj')];
  const entries = objects.map(obj => ({ obj, mark: marks[page.texts.indexOf(obj)] }))
    .filter(entry => entry.mark);
  if (!entries.length) return;
  const primaryObject = objects[primaryIndex] || objects[0];
  const primary = entries.find(entry => entry.obj === primaryObject) || entries[0];
  selectMark(k, primary.obj, primary.mark, keepOriginal);
  multiSel = entries
    .filter(entry => entry.obj !== primary.obj)
    .map(entry => ({ obj: entry.obj, mark: entry.mark }));
  multiSel.forEach(entry => entry.mark.classList.add('sel'));
  refreshSelectedObjectHandles();
}
function movePastedObjectsToPoint(objects, primaryIndex, point) {
  const primary = objects[primaryIndex];
  let x = +primary.fx || 0, y = +primary.fy || 0;
  if (primary.type === 'polyline' && primary.points?.length) {
    x = Math.min(...primary.points.map(p => p[0]));
    y = Math.min(...primary.points.map(p => p[1]));
  } else if (primary.type === 'line' || primary.type === 'arrow') {
    x = Math.min(primary.x1, primary.x2);
    y = Math.min(primary.y1, primary.y2);
  }
  translateObjectBundle(objects, primaryIndex, point.x - x, point.y - y,
    Math.max(0, 1 - (+primary.fw || .02)), Math.max(0, 1 - (+primary.fh || .02)));
}
function pasteObj(k, target = captureObjectPasteTarget(k)) {
  if (!objClip || !validObjectPasteTarget(k, target)) return false;
  if (activeDocLocked()) { lockNotice(); return; }
  const transferPage = {
    texts: isObjectBundle(objClip)
      ? objClip.objects.map(object => ({ ...object, _id: undefined, _w1: undefined }))
      : [detachedObjectCopy(objClip)],
  };
  rekeyPageConnections(transferPage, createConnectorId);
  const primaryIndex = Math.max(0, Math.min(transferPage.texts.length - 1, objClip.primaryIndex || 0));
  if (target.point) movePastedObjectsToPoint(transferPage.texts, primaryIndex, target.point);
  else translateObjectBundle(transferPage.texts, primaryIndex, .03, .03);
  const snap = makeSnap();
  editorStore.pages[k].texts.push(...transferPage.texts);
  const wrap = document.getElementById('pg' + k);
  syncPageConnectors(editorStore.pages[k], wrap?.clientWidth || 1, wrap?.clientHeight || 1);
  pushSnap(snap);
  if (wrap) {
    positionMarks(wrap, editorStore.pages[k]);
    selectPastedObjectBundle(k, transferPage.texts, primaryIndex, wrap);
  }
  return true;
}
async function origCopyAsObject(k, sel, p = editorStore.pages[k]) {
  const { view, rT } = await origView(p);
  const rr = pageRectToDispRect(p, view, rT, sel.b);
  if (sel.isA || sel.type === undefined) return null;
  if (sel.type === 1) {                        
    const text = await origReadTextContent(p, sel.i);
    if (!text) return null;
    const st = await origReadTextStyle(p, sel.i);
    return {
      fx: rr.l, fy: rr.t, text,
      size: Math.max(6, Math.round(st.size || (sel.b[3] - sel.b[1]))),
      color: /^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#000000',
      colorOp: st.alpha !== undefined && st.alpha < 1 ? st.alpha : undefined,
      font: inferSupportedFontKey(st.fam, text),
      bold: st.weight >= 600 || undefined
    };
  }
  return null;                                  
}

async function origCopyToClip(cut) {
  if (!origSels.length) return;
  const source = editorStore.activeDocument;
  const selections = [...origSels];
  const overlays = hasMixedSelection() ? selectedObjectEntries().map(s => s.obj) : [];
  const overlayCopies = copyMixedOverlayObjects(overlays);
  const sourceDocument = editorStore.documentName;
  const k = selections[0].k, p = editorStore.pages[k];
  const canCut = () => cut && source === editorStore.activeDocument &&
    selections.length === origSels.length && selections.every((item, i) => item === origSels[i]) &&
    overlays.length === (hasMixedSelection() ? selectedObjectEntries().length : 0) &&
    overlays.every(o => selectedObjectEntries().some(s => s.obj === o));
  const desktopMarkerWrite = desktopViewMode ? syncClipMarker(CLIP_OBJ) : null;
  return runClipboardCopy(async () => {
  const webReservation = desktopViewMode ? null : {
    id: webClipboardBroker.createId(),
  };
  if (webReservation) webReservation.markerWrite = syncClipMarker(CLIP_OBJ, webReservation.id);
  if (!overlays.length && selections.length === 1) {
    try {
      const obj = await origCopyAsObject(k, selections[0], p);
      if (obj) {
        if (!desktopViewMode) await commitWebObjectClipboard(obj, {
          operation: cut ? 'cut' : 'copy', sourceDocument,
        }, webReservation);
        objClip = obj;
        if (desktopViewMode) await commitDesktopObjectClipboard(obj, cut, sourceDocument, desktopMarkerWrite);
        toast('텍스트로 복사됨 — Ctrl+V로 붙여넣으면 바로 편집할 수 있습니다', 3000);
        if (canCut()) await origDeleteSel();
        return true;
      }
    } catch (e) { console.warn('오브젝트 복사 실패 — 영역 복사로 대체', e); }
  }
  const x0 = Math.min(...selections.map(s => s.b[0])), y0 = Math.min(...selections.map(s => s.b[1]));
  const x1 = Math.max(...selections.map(s => s.b[2])), y1 = Math.max(...selections.map(s => s.b[3]));
  document.body.style.cursor = 'progress';
  try {
    const { view, rT } = await origView(p);
    const rr = pageRectToDispRect(p, view, rT, [x0, y0, x1, y1]);
    const sc = regionCaptureScale(p, rr.w, rr.h);
    if (selections.some(s => s.isA)) {
      const isHi = selections.some(s => s.sub === 9);
      const onlyBytes = await origAnnotOnlyBytes(p, new Set(selections.map(s => s.a)));
      const pdoc = await openPdfDocument(onlyBytes.slice()).promise;
      const tmpId = -(++srcSeq);
      sources.set(tmpId, { bytes: onlyBytes, doc: pdoc, name: '주석 복사' });
      let rc;
      try { rc = await renderPageRegion({ ...p, src: tmpId }, rr.l, rr.t, rr.w, rr.h, sc, !isHi); }
      finally { sources.delete(tmpId); try { pdoc.destroy(); } catch {} }
      objClip = { type: 'img', data: rc.toDataURL('image/png'),
                  fx: rr.l, fy: rr.t, fw: rr.w, fh: rr.h,
                  ...(isHi ? { blend: 'multiply' } : {}) };
    } else {
      const selIdx = new Set(selections.map(s => s.i));
      const onlyBytes = await origFilteredBytes(p, i => selIdx.has(i), true);
      const pdoc = await openPdfDocument(onlyBytes.slice()).promise;
      const nid = ++srcSeq;
      sources.set(nid, { bytes: onlyBytes, doc: pdoc, name: '오브젝트 복사' });
      const rc = await renderPageRegion({ ...p, src: nid }, rr.l, rr.t, rr.w, rr.h, sc, true);
      objClip = {
        type: 'img', data: rc.toDataURL('image/png'),
        fx: rr.l, fy: rr.t, fw: rr.w, fh: rr.h,
        clipSrc: nid, clipIdx: p.idx, clipBox: [x0, y0, x1, y1], clipRotation: (rT + 360) % 360
      };
    }
    if (overlayCopies.length) objClip = {kind:'object-bundle-v1', objects:[objClip, ...overlayCopies], primaryIndex:0};
    if (!desktopViewMode) await commitWebObjectClipboard(objClip, {
      operation: cut ? 'cut' : 'copy', sourceDocument,
    }, webReservation);
    else await commitDesktopObjectClipboard(objClip, cut, sourceDocument, desktopMarkerWrite);
    toast('원본 오브젝트 ' + (cut ? '잘라내기' : '복사') + '됨 — Ctrl+V로 붙여넣기');
    if (canCut()) await origDeleteSel();
    return true;
  } catch (e) {
    console.error(e);
    toast('원본 복사 실패: ' + (e.message || e).toString().slice(0, 60), 2500);
  } finally { document.body.style.cursor = ''; }
  });
}

async function origZOrder(front) {
  if (!origSels.length) return;
  const k = origSels[0].k;
  const picked = new Set(origSels.map(s => s.i));
  await origApply(k, (F, M, pg) => {
    if (typeof F.FPDFPage_InsertObject !== 'function') throw new Error('이 엔진 빌드는 순서 변경 미지원');
    const count = F.FPDFPage_CountObjects(pg);
    const all = [];
    for (let i = 0; i < count; i++) {
      const obj = F.FPDFPage_GetObject(pg, i);
      if (!obj) throw new Error('오브젝트를 찾지 못했습니다');
      all.push({ i, obj, type: F.FPDFPageObj_GetType(obj) });
    }
    const categoryOf = v => v.type === 1 ? 'text' : v.type === 3 ? 'img' : 'shape';
    const ordered = zOrderWithinCategories(all, v => picked.has(v.i), categoryOf, front);
    if (ordered.every((v, i) => v === all[i])) return;

    for (const v of all) {
      if (!F.FPDFPage_RemoveObject(pg, v.obj)) throw new Error('오브젝트 제거 실패');
    }
    for (const v of ordered) {
      if (F.FPDFPage_InsertObject(pg, v.obj) === false) throw new Error('오브젝트 삽입 실패');
    }
  }, '순서 변경');
}
async function origRotate90() {
  if (!origSels.length) return;
  const k = origSels[0].k, sel = origSels[0];
  const cx = (sel.b[0] + sel.b[2]) / 2, cy = (sel.b[1] + sel.b[3]) / 2;
  await origTransform(k, origSels.map(s => s.i), [0, -1, 1, 0, cx - cy, cy + cx], '회전');
}
$('objMenu').addEventListener('click', e => {
  const mi = e.target.closest('.mi');
  if (!mi) return;
  $('objMenu').style.display = 'none';
  if (mi.dataset.cmd === 'erasePart') {
    const target = objMenuOrig ? origSels[0] : selText;
    objMenuOrig = false;
    if (!target || activeDocLocked()) return;
    const pick = { page:editorStore.pages[target.k], ...(target.obj ? {obj:target.obj} : {i:target.i, a:target.a, isA:target.isA}) };
    if (!drawingController.active) drawingController.toggle();
    const select = $('drawingBar').querySelector('[data-ink-brush]');
    select.value = 'eraser'; select.dispatchEvent(new Event('change'));
    eraserTarget = pick; focusViewer(); return;
  }
  if (objMenuOrig) {  
    objMenuOrig = false;
    const isA = origSels.length && origSels[0].isA;
    switch (mi.dataset.cmd) {
      case 'front': isA ? toast('주석은 순서 변경을 지원하지 않습니다') : origZOrder(true); break;
      case 'back':  isA ? toast('주석은 순서 변경을 지원하지 않습니다') : origZOrder(false); break;
      case 'rot90': isA ? toast('주석은 회전을 지원하지 않습니다') : origRotate90(); break;
      case 'copy':  origCopyToClip(false); break;
      case 'cut':   origCopyToClip(true); break;
      case 'del':   origDeleteSel(); break;
    }
    return;
  }
  switch (mi.dataset.cmd) {
    case 'front': overlayZOrder(true); break;
    case 'back':  overlayZOrder(false); break;
    case 'rot90': objDo(o => rotateObj90(o)); break;
    case 'connectArrow': if (selText) addConnectedArrowToShape(selText.k, selText.obj); break;
    case 'cropImg': openImageCropDialog(); break;
    case 'polyAddPoint': {
      const context = objMenuPolylineContext;
      editSelectedPolyline(object => {
        if (context?.kind !== 'segment' || !Array.isArray(context.point)) return false;
        const points = polylineObjectPoints(object);
        points.splice(Math.max(0, Math.min(points.length, context.index + 1)), 0, [...context.point]);
        object.points = points;
      });
      break;
    }
    case 'polyRemovePoint': {
      const context = objMenuPolylineContext;
      editSelectedPolyline(object => {
        const points = polylineObjectPoints(object);
        if (context?.kind !== 'vertex' || points.length <= 2 ||
            context.index < 0 || context.index >= points.length) return false;
        points.splice(context.index, 1);
        object.points = points;
        if (object.closed && points.length < 3) object.closed = false;
      });
      break;
    }
    case 'polyClose':
      editSelectedPolyline(object => {
        if (object.closed || polylineObjectPoints(object).length < 3) return false;
        object.closed = true;
      });
      break;
    case 'copy':  copyObj(false); break;
    case 'cut':   copyObj(true); break;
    case 'paste': pasteObjectFromAvailable(objMenuPage, objMenuPasteTarget); break;
    case 'del':   deleteSelText(); break;
  }
});
let nudgeState = null;
function takePendingNudge() {
  if (!nudgeState) return null;
  const st = nudgeState;
  nudgeState = null;
  clearTimeout(st.timer);
  return st;
}
function commitPendingNudge() {
  const st = takePendingNudge();
  if (st) { pushSnap(st.snap); refreshThumb(st.k); }
}
function nudgeSelText(dxPx, dyPx) {
  if (!selText || !selText.mark) return;
  const { k, obj, mark } = selText;
  const wrap = mark.parentElement;
  if (!wrap) return;
  const { width, height } = wrap.getBoundingClientRect();
  const dx = dxPx / width, dy = dyPx / height;
  if (!nudgeState) {
    nudgeState = { snap: makeSnap(), k, timer: 0 };
    markActiveDocumentChanged();
  }
  nudgeState.k = k;
  clearTimeout(nudgeState.timer);
  for (const { obj, mark } of selectedObjectEntries()) {
    if (obj.type === 'polyline') {
      obj.points = polylineObjectPoints(obj).map(point => [point[0] + dx, point[1] + dy]);
      drawShapeEl(mark, obj, width, height);
    } else if (obj.type === 'line' || obj.type === 'arrow') {
      obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy;
      shiftConnectorControl(obj, dx, dy);
      drawShapeEl(mark, obj, width, height);
    } else {
      obj.fx += dx; obj.fy += dy;
      positionMovedMark(mark, obj, width, height);
    }
  }
  redrawConnectedArrows(k, wrap);
  positionTextBar();
  placeHandles(mark, obj);
  nudgeState.timer = setTimeout(() => {
    const st = takePendingNudge();
    if (!st) return;  
    pushSnap(st.snap);
    refreshThumb(st.k);
  }, 800);
}

function deleteSelText() {
  if (hasMixedSelection()) return origDeleteSel();
  if (!selText) return;
  const { k, obj } = selText;
  const p = editorStore.pages[k];
  const del = connectedDeletionSet(p.texts, [obj, ...multiSel.map(s => s.obj)]);
  if (p.texts.some(t => del.has(t))) {
    const snap = makeSnap();
    p.texts = p.texts.filter(t => !del.has(t));
    pushSnap(snap);
  }
  clearMultiSel();
  selText = null;
  $('textBar').style.display = 'none';
  $('shapeTextBar').style.display = 'none';
  const wrap = document.getElementById('pg' + k);
  if (wrap) positionMarks(wrap, p);
  scheduleThumbRefresh(k);
}

document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !selText) return;
  if (e.target.closest('#btnMultiPick') || e.target.closest('#textBar') || e.target.closest('#shapeTextBar') ||
      e.target.closest('#fontPicker') || e.target.closest('#palettePop') || e.target.closest('#objMenu') ||
      e.target.closest('.obj') || e.target.closest('.objHandle')) return;
  deselectText();
}, true);
document.addEventListener('mousedown', e => {
  if (!selText) return;
  if (e.target.closest('#fontPicker') || e.target.closest('.origBox,.obj,.objHandle,#btnMultiPick,#textBar,#shapeTextBar,#palettePop,#objMenu')) return;
  if ((e.shiftKey || e.ctrlKey) && e.target.closest('.pageWrap')) return;
  deselectText();
}, true);

const libDocCache = new Map();
async function getLibDoc(srcId) {
  if (!libDocCache.has(srcId)) {
    const s = sources.get(srcId);
    libDocCache.set(srcId, await PDFDocument.load(s.bytes, { ignoreEncryption: true }));
  }
  return libDocCache.get(srcId);
}

const hasNonAscii = s => /[^\x00-\xFF]/.test(s);
const isTextObj = t => !!t && (!t.type || t.type === 'text');

async function cropPdfBox(p) {
  const pj = await sources.get(p.src).doc.getPage(p.idx + 1);
  const vp1 = pj.getViewport({ scale: 1, rotation: (pj.rotate + p.rot) % 360 });
  const [start, end] = cropToViewportPoints(p.crop, vp1.width, vp1.height);
  return pdfPointBounds(vp1.convertToPdfPoint(...start), vp1.convertToPdfPoint(...end));
}

function collectSourceRefs(pageList, into) {
  return collectPageSourceRefs(pageList, into, id => sources.has(id));
}

function sanitizeTextObj(t) {
  return sanitizeTextObject(t, {
    isKnownFont: font => !!FONTS[font],
    clampStrokeWidth,
  });
}

async function tryOpenProject(f, pdoc) {
  let atts = null;
  try { atts = await pdoc.getAttachments(); } catch {}
  if (!atts || !atts['sol_project.json']) return null;
  try {
    const meta = JSON.parse(new TextDecoder().decode(atts['sol_project.json'].content));
    if (meta.pages.some(p => p.texts?.some(t => typeof t.font === 'string' && t.font.startsWith('pc:') && !FONTS[t.font]))) return null;
    const d = newDoc(f.name.replace(/\.pdf$/i, ''));
    d.fileHandle = f._handle || null;
    const idMap = [];
    for (let i = 0; ; i++) {
      const a = atts['sol_src_' + i + '.pdf'];
      if (!a) break;
      const b = new Uint8Array(a.content);
      const pd = await openPdfDocument(b.slice()).promise;
      const id = ++srcSeq;
      sources.set(id, { bytes: b, doc: pd, name: (meta.srcs && meta.srcs[i]) || ('원본' + i),
                        locked: await detectPdfLocked(pd) });
      d.srcIds.push(id);
      idMap[i] = id;
    }
    d.pages = meta.pages.map(p => ({
      src: p.s >= 0 ? idMap[p.s] : null, idx: p.idx, rot: p.rot || 0,
      blank: p.blank || undefined, resize: p.resize || undefined, crop: p.crop || undefined,
      texts: (p.texts || []).map(sanitizeTextObj).filter(Boolean).map(o => {
        if (typeof o.clipSrc === 'string' && o.clipSrc.startsWith('i')) {  
          const id = idMap[+o.clipSrc.slice(1)];
          if (id) o.clipSrc = id; else { delete o.clipSrc; delete o.clipIdx; delete o.clipBox; delete o.clipRotation; delete o.clipOpaque; delete o.clipFragment; delete o.clipAlpha; delete o.clipErasures; }
        } else if (o.clipSrc !== undefined) { delete o.clipSrc; delete o.clipIdx; delete o.clipBox; delete o.clipRotation; delete o.clipOpaque; delete o.clipFragment; delete o.clipAlpha; delete o.clipErasures; }
        return o;
      })
    }));
    try { pdoc.destroy(); } catch {}
    return d;
  } catch (e) { console.warn('프로젝트 복원 실패', e); return null; }
}

async function tryOpenMarked(f, pdoc, bytes) {
  try {
    const md = await pdoc.getMetadata().catch(() => null);
    const keywords = String(md?.info?.Keywords || '');
    if (!/sol-marked/.test(keywords)) return null;
    if ((keywords.match(/pc:[^\s,;]+\./g) || []).some(key => !FONTS[key])) return null;
  } catch { return null; }
  try {
    const {candidates, restored} = await prepareMarkedRestoration(bytes, pdfLib.raw, sanitizeTextObj, { expectedPages: pdoc.numPages });
    if (candidates && !candidates.size) return null;
    const pageTexts = restored?.pageTexts || [];
    const cleanBytes = restored?.bytes || await withPdfiumDoc(bytes, async (F, M, doc) => {
      const np = F.FPDF_GetPageCount(doc);
      const ob = M.wasmExports.malloc(4);
      const readLen = () => new Uint32Array(M.HEAPU8.buffer, ob, 1)[0];
      const readWide = (fn) => {  
        if (!fn(0, 0)) return null;
        const need = readLen();
        if (!need) return null;
        const b = M.wasmExports.malloc(need);
        fn(b, need);
        const s = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(b, b + need)).replace(/\0+$/, '');
        M.wasmExports.free(b);
        return s;
      };
      let changed = false;
      for (let pi = 0; pi < np; pi++) {
        if (candidates && !candidates.has(pi)) continue;
        const pg = F.FPDF_LoadPage(doc, pi);
        if (!pg) continue;
        try {
          const texts = [], seen = new Set(), del = [];
          const n = F.FPDFPage_CountObjects(pg);
          for (let i = 0; i < n; i++) {
            const o = F.FPDFPage_GetObject(pg, i);
            if (!o) continue;
            const nm = F.FPDFPageObj_CountMarks(o);
            let mine = false;
            for (let mi = 0; mi < nm; mi++) {
              const mk = F.FPDFPageObj_GetMark(o, mi);
              if (!mk) continue;
              const name = readWide((b, l) => F.FPDFPageObjMark_GetName(mk, b, l, ob));
              if (name !== 'SolTx' && name !== 'SolInk') continue;
              mine = true;
              const js = readWide((b, l) => F.FPDFPageObjMark_GetParamStringValue(mk, 'T', b, l, ob));
              if (js && !seen.has(js)) {  
                seen.add(js);
                try {
                  const t = JSON.parse(js); delete t._m;
                  const s = sanitizeTextObj(t);  
                  if (s) texts.push(s);
                } catch {}
              }
            }
            if (mine) del.push(i);
          }
          if (del.length) {
            for (let j = del.length - 1; j >= 0; j--) {
              const o = F.FPDFPage_GetObject(pg, del[j]);
              if (o && F.FPDFPage_RemoveObject(pg, o)) F.FPDFPageObj_Destroy(o);
            }
            if (!F.FPDFPage_GenerateContent(pg)) throw new Error('콘텐츠 재생성 실패');
            changed = true;
          }
          pageTexts[pi] = texts;
        } finally { F.FPDF_ClosePage(pg); }
      }
      M.wasmExports.free(ob);
      if (!changed) return null;  
      const wr = F.PDFiumExt_OpenFileWriter();
      try {
        if (!F.PDFiumExt_SaveAsCopy(doc, wr)) throw new Error('저장 실패');
        const size = F.PDFiumExt_GetFileWriterSize(wr);
        const op = M.wasmExports.malloc(size);
        F.PDFiumExt_GetFileWriterData(wr, op, size);
        const out = M.HEAPU8.slice(op, op + size);
        M.wasmExports.free(op);
        return out;
      } finally { F.PDFiumExt_CloseFileWriter(wr); }
    });
    if (!cleanBytes) return null;
    const pd = await openPdfDocument(cleanBytes.slice()).promise;
    const d = newDoc(f.name.replace(/\.pdf$/i, ''));
    d.fileHandle = f._handle || null;
    const id = ++srcSeq;
    sources.set(id, { bytes: cleanBytes, doc: pd, name: f.name });
    d.srcIds.push(id);
    for (let i = 0; i < pd.numPages; i++)
      d.pages.push({ src: id, idx: i, rot: 0, texts: pageTexts[i] || [] });
    try { pdoc.destroy(); } catch {}
    return d;
  } catch (e) { console.warn('이름표 복원 실패', e); return null; }
}

async function buildPdf(pageList, printTitle) {
  const editing = pendingObjectEdits();
  if (editing) await editing;
  const out = await PDFDocument.create();
  if (printTitle) out.setTitle(printTitle);
  out.registerFontkit(pdfFontkit);
  let markSeq = 0, anyMarked = false;  

  const usedCharacters = new Map();
  const pdfFontKeyForCharacter = (selectedKey, character) => {
    const key = FONTS[selectedKey] ? selectedKey : 'spoqa';
    if (FONTS[key]?.source === 'installed')
      return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u.test(character) && !FONTS[key].supportsKo ? 'notosanskr' : key;
    return hasNonAscii(character) && !FONTS[key]?.supportsKo ? 'notosanskr' : key;
  };
  pageList.forEach(p => p.texts.forEach(t => {
    if (!isTextObj(t) && !(isConnectableShape(t) && t.text !== undefined)) return;
    const text = String(t.text || '');
    if (!text.trim()) return;
    const selectedKey = t.font || 'spoqa';
    for (const character of text) {
      if (character.codePointAt(0) < 0x20) continue;
      const key = pdfFontKeyForCharacter(selectedKey, character);
      const cacheKey = key + (t.bold ? '_b' : '');
      usedCharacters.set(cacheKey, `${usedCharacters.get(cacheKey) || ''}${character}`);
    }
  }));
  const embedded = {};
  const embeddedRecords = {};
  for (const [ck, characters] of usedCharacters) {
    const bold = ck.endsWith('_b');
    const key = bold ? ck.slice(0, -2) : ck;
    const fontRecord = await fetchPdfFontRecord(key, bold, characters);
    if (!fontRecord?.bytes) {
      throw new Error(`PDF 저장용 글꼴을 불러오지 못했습니다: ${FONTS[key]?.label || key}`);
    }
    try {
      out.registerFontkit(createAlignedSubsetFontkit(fontkit, { weight: fontRecord.weight }));
      const pdfFont = await out.embedFont(fontRecord.bytes, {
        subset: fontRecord.embedSubset,
        customName: fontRecord.customName,
      });
      pdfFont.encodeText(String(characters));
      embedded[ck] = pdfFont;
      embeddedRecords[ck] = fontRecord;
    } catch (error) {
      console.error('폰트 임베드 실패', ck, error);
      throw new Error(`PDF에 글꼴을 정확히 포함하지 못했습니다: ${FONTS[key]?.label || key}`);
    }
  }
  const fontRunsFor = (t, value) => {
    const selectedKey = t.font || 'spoqa';
    const runs = [];
    for (const character of String(value || '')) {
      const key = pdfFontKeyForCharacter(selectedKey, character);
      const cacheKey = key + (t.bold ? '_b' : '');
      const font = embedded[cacheKey];
      if (!font) throw new Error(`저장할 글꼴 정보가 없습니다: ${FONTS[key]?.label || key}`);
      const previous = runs.at(-1);
      if (previous?.cacheKey === cacheKey) previous.text += character;
      else runs.push({ cacheKey, text: character, font, record: embeddedRecords[cacheKey] });
    }
    return runs;
  };
  const textWidth = (t, value, size) => fontRunsFor(t, value).reduce((width, run) => {
    try { return width + run.font.widthOfTextAtSize(run.text, size); }
    catch { throw new Error(`글꼴 폭 정보를 읽지 못했습니다: ${FONTS[run.record?.key]?.label || run.record?.key}`); }
  }, 0);
  const drawTextRuns = (outPage, t, value, options, axisX = 1, axisY = 0) => {
    let advance = 0;
    for (const run of fontRunsFor(t, value)) {
      const runOptions = {
        ...options,
        x: options.x + advance * axisX,
        y: options.y + advance * axisY,
        font: run.font,
      };
      if (run.record?.syntheticBold) {
        runOptions.borderColor = options.color;
        runOptions.borderOpacity = options.opacity;
        runOptions.borderWidth = Math.max(.12, options.size * .018);
      }
      outPage.drawText(run.text, runOptions);
      advance += run.font.widthOfTextAtSize(run.text, options.size);
    }
  };
  const blCache = {};
  const baselineOf = t => {
    const key = (t.font || 'spoqa') + (t.bold ? '_b' : '');
    if (blCache[key] !== undefined) return blCache[key];
    let f = 0.95;
    try {
      const mc = document.createElement('canvas').getContext('2d');
      mc.font = (t.bold ? '700 ' : '') + '100px ' + (FONTS[t.font || 'spoqa'] || FONTS.spoqa).css;
      const m = mc.measureText('Ag한글');
      const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
      if (asc > 0) f = ((120 - (asc + desc)) / 2 + asc) / 100;
    } catch {}
    blCache[key] = f;
    return f;
  };
  const wrapLine = (str, textObject, size, maxW) => {
    if (!str) return [''];
    const outLines = [];
    let cur = '';
    for (const ch of str) {
      const cand = cur + ch;
      const w = textWidth(textObject, cand, size);
      if (w > maxW && cur) {
        const sp = cur.lastIndexOf(' ');
        if (sp > 0 && ch !== ' ') { outLines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
        else { outLines.push(cur); cur = ch === ' ' ? '' : ch; }
      } else cur = cand;
    }
    outLines.push(cur);
    return outLines;
  };
  const safe = (s, textObject) => {
    try {
      fontRunsFor(textObject, s).forEach(run => run.font.encodeText(run.text));
      return s;
    } catch {
      throw new Error('선택한 글꼴에 저장할 수 없는 문자가 포함되어 있습니다.');
    }
  };

  const copiedPages = await copyOutputPages(out, pageList, getLibDoc);
  const resizedPages = await embedResizedOutputPages(out, pageList, getLibDoc);
  for (const [outputIndex, p] of pageList.entries()) {
    let outPage;
    if (p.blank) {
      outPage = out.addPage([p.blank[0], p.blank[1]]);
    } else if (p.resize) {
      const lib = await getLibDoc(p.src);
      const srcPage = lib.getPage(p.idx);
      const emb = resizedPages.get(outputIndex);
      const geometry = resizedCropGeometry(p.resize, p.crop);
      const tw = geometry.fullWidth, th = geometry.fullHeight;
      outPage = out.addPage([geometry.width, geometry.height]);
      const theta = (((srcPage.getRotation().angle || 0) + p.rot) % 360 + 360) % 360;  
      const ew = emb.width, eh = emb.height;
      const dispW = theta % 180 ? eh : ew, dispH = theta % 180 ? ew : eh;
      const f = Math.min(tw / dispW, th / dispH);
      const cx = (tw - dispW * f) / 2, cy = (th - dispH * f) / 2;
      let x = cx, y = cy;
      if (theta === 90) y = cy + dispH * f;
      else if (theta === 180) { x = cx + dispW * f; y = cy + dispH * f; }
      else if (theta === 270) x = cx + dispW * f;
      x -= geometry.left;
      y -= geometry.bottom;
      outPage.drawPage(emb, { x, y, xScale: f, yScale: f, rotate: degrees(-theta) });
    } else {
      const copied = copiedPages.get(outputIndex);
      const base = copied.getRotation().angle || 0;
      copied.setRotation(degrees(((base + p.rot) % 360 + 360) % 360));
      if (p.crop) {
        const box = await cropPdfBox(p);
        copied.setCropBox(box.x, box.y, box.w, box.h);
        copied.setMediaBox(box.x, box.y, box.w, box.h);
      }
      outPage = out.addPage(copied);
    }

    if (p.texts.length) {
      let vp1 = null;
      if (!p.blank && !p.resize) {
        const pjPage = await sources.get(p.src).doc.getPage(p.idx + 1);
        vp1 = pjPage.getViewport({ scale: 1, rotation: (pjPage.rotate + p.rot) % 360 });
      }
      const crop = (vp1 && p.crop) ? p.crop : null;  
      const resizedGeometry = p.resize ? resizedCropGeometry(p.resize, p.crop) : null;
      const toPdf = (fx, fy) => {
        if (crop) { fx = crop[0] + fx * crop[2]; fy = crop[1] + fy * crop[3]; }
        if (vp1) return vp1.convertToPdfPoint(fx * vp1.width, fy * vp1.height);
        const [w, h] = resizedGeometry ? [resizedGeometry.width, resizedGeometry.height] : p.blank;
        return [fx * w, h - fy * h];
      };
      const dispW = vp1 ? vp1.width / (vp1.userUnit || 1) * (crop ? crop[2] : 1) :
        (resizedGeometry ? resizedGeometry.width : p.blank[0]);
      const dispH = vp1 ? vp1.height / (vp1.userUnit || 1) * (crop ? crop[3] : 1) :
        (resizedGeometry ? resizedGeometry.height : p.blank[1]);
      syncPageConnectors(p, dispW, dispH);
      const rotAngle = (p.blank || p.resize) ? 0 : (outPage.getRotation().angle % 360 + 360) % 360;
      const boxPlacement = (fx, fy, w, h, objRot) => {
        const total = normRotation(rotAngle - (objRot || 0));
        const rad = total * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        const [cx, cy] = toPdf(fx + w / dispW / 2, fy + h / dispH / 2);
        return {
          total, rad, c, s, cx, cy,
          x: cx - w * c / 2 + h * s / 2,
          y: cy - w * s / 2 - h * c / 2,
          topX: cx - w * c / 2 - h * s / 2,
          topY: cy - w * s / 2 + h * c / 2
        };
      };
      const drawShapeTextToPdf = t => {
        if (!isConnectableShape(t) || t.text === undefined || !String(t.text).trim()) return;
        const size = Number.isFinite(t.size) ? t.size : 16;
        const boxW = t.fw * dispW * .84, boxH = t.fh * dispH * .84;
        const fx = t.fx + t.fw * .08, fy = t.fy + t.fh * .08;
        let lines = [];
        safe(String(t.text), t).split('\n').forEach(raw =>
          lines.push(...wrapLine(raw, t, size, boxW)));
        const lineHeight = size * 1.2;
        lines = lines.slice(0, Math.max(1, Math.floor(boxH / lineHeight)));
        const blockHeight = lines.length * lineHeight;
        const placement = boxPlacement(fx, fy, boxW, boxH, objRotation(t));
        const alignFactor = t.align === 'left' ? 0 : t.align === 'right' ? 1 : .5;
        const verticalFactor = t.valign === 'top' ? 0 : t.valign === 'bottom' ? 1 : .5;
        const verticalOffset = Math.max(0, boxH - blockHeight) * verticalFactor;
        const baseline = baselineOf(t);
        const axisX = [placement.c, placement.s];
        const axisDown = [placement.s, -placement.c];
        const topLeft = [placement.topX, placement.topY];
        const topRight = [topLeft[0] + boxW * axisX[0], topLeft[1] + boxW * axisX[1]];
        const bottomRight = [topRight[0] + boxH * axisDown[0], topRight[1] + boxH * axisDown[1]];
        const bottomLeft = [topLeft[0] + boxH * axisDown[0], topLeft[1] + boxH * axisDown[1]];
        const raw = pdfLib.raw;
        outPage.pushOperators(
          raw.pushGraphicsState(),
          raw.moveTo(topLeft[0], topLeft[1]),
          raw.lineTo(topRight[0], topRight[1]),
          raw.lineTo(bottomRight[0], bottomRight[1]),
          raw.lineTo(bottomLeft[0], bottomLeft[1]),
          raw.closePath(), raw.clip(), raw.endPath(),
        );
        try {
          lines.forEach((line, index) => {
            const lineWidth = textWidth(t, line, size);
            const dx = Math.max(0, boxW - lineWidth) * alignFactor;
            const dy = verticalOffset + size * baseline + index * lineHeight;
            const options = {
              x: placement.topX + dy * placement.s + dx * placement.c,
              y: placement.topY - dy * placement.c + dx * placement.s,
              size, color: hexToRgb01(t.color || '#000000'),
              opacity: t.colorOp === undefined ? 1 : t.colorOp,
            };
            if (placement.total) options.rotate = degrees(placement.total);
            drawTextRuns(outPage, t, line, options, placement.c, placement.s);
          });
        } finally {
          outPage.pushOperators(raw.popGraphicsState());
        }
      };

      for (const t of p.texts) {
        let marked = false;
        if (t.type !== 'img' && pdfLib.raw.PDFOperator) {
          try {
            const meta = { ...t, _m: ++markSeq };  
            delete meta._id; delete meta._w1;
            delete meta.clipSrc; delete meta.clipIdx; delete meta.clipBox;
            const ascii = JSON.stringify(meta).replace(/[\u007f-\uffff]/g,
              c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
            const hex = [...new TextEncoder().encode(ascii)]
              .map(b => b.toString(16).padStart(2, '0')).join('');
            outPage.pushOperators(pdfLib.raw.PDFOperator.of('BDC', [
              pdfLib.raw.PDFName.of(t.type === 'ink' ? 'SolInk' : 'SolTx'),
              out.context.obj({ T: pdfLib.raw.PDFHexString.of(hex) })
            ]));
            marked = true; anyMarked = true;
          } catch (e) { console.warn('이름표 기록 실패', e); }
        }
        let reflected = false;
        try {
        if (t.fw === 0 || t.fh === 0) continue;
        if ((t.flipX || t.flipY) && t.fw !== undefined && t.fh !== undefined) {
          const [cx, cy] = toPdf(t.fx + t.fw / 2, t.fy + t.fh / 2);
          const matrix = objectReflectionMatrix(cx, cy, rotAngle - objRotation(t), t.flipX, t.flipY);
          outPage.pushOperators(pdfLib.raw.pushGraphicsState(), pdfLib.raw.concatTransformationMatrix(...matrix));
          reflected = true;
        }
        if (isTextObj(t)) {
          if (!String(t.text || '').trim()) continue;
          const boxW = t.fw ? t.fw * dispW : 0;
          let lines = [];
          safe(t.text, t).split('\n').forEach(raw =>
            lines.push(...(boxW ? wrapLine(raw, t, t.size, boxW) : [raw])));
          const lineW = ln => textWidth(t, ln, t.size);
          const blockW = boxW || Math.max(...lines.map(lineW), 0);
          const blockH = Math.max(t.size * 1.2, lines.length * t.size * 1.2);
          const boxH = t.fh ? t.fh * dispH : blockH;
          const plc = boxPlacement(t.fx, t.fy, blockW, boxH, objRotation(t));
          const alignF = t.align === 'center' ? 0.5 : t.align === 'right' ? 1 : 0;
          let vOff = 0;
          if (t.fh) {
            const vF = t.valign === 'middle' ? 0.5 : t.valign === 'bottom' ? 1 : 0;
            vOff = Math.max(0, (boxH - blockH) * vF);
          }
          const blF = baselineOf(t);  
          lines.forEach((ln, li) => {
            const dy = vOff + t.size * blF + li * t.size * 1.2;
            const off = alignF ? (blockW - lineW(ln)) * alignF : 0;
            const opts = {
              x: plc.topX + dy * plc.s + off * plc.c,
              y: plc.topY - dy * plc.c + off * plc.s,
              size: t.size, color: hexToRgb01(t.color), opacity: opOf(t, 'colorOp')
            };
            if (plc.total) opts.rotate = degrees(plc.total);
            drawTextRuns(outPage, t, ln, opts, plc.c, plc.s);
          });
        } else if (t.type === 'img') {
          try {
            const w = t.fw * dispW, h = t.fh * dispH;
            const plc = boxPlacement(t.fx, t.fy, w, h, objRotation(t));
            let drawn = false;
            const masked = t.clipErasures?.length > 0;
            if (t.clipSrc && sources.has(t.clipSrc) && (t.clipFragment || masked || ((!t.clipOpaque || opOf(t, 'fillOp') === 1) && !t.blend))) {
              try {
                let angle = t.clipRotation || 0, bounds = t.clipBox;
                let input;
                if (t.clipOpaque) {
                  if (wholeVisibleFragment(t)) {
                    input = (await getLibDoc(t.clipSrc)).getPage(0);
                  } else {
                    const isolated = await visibleFragmentPdf(t);
                    input = (await PDFDocument.load(isolated.bytes)).getPage(0);
                    angle = 0;
                    bounds = [0,0,input.getWidth(),input.getHeight()];
                  }
                } else {
                  input = (await getLibDoc(t.clipSrc)).getPage(t.clipIdx);
                }
                const emb = await embedRegion(out,input,bounds,angle);
                if (t.clipFragment) {
                  out.context.lookup(emb.ref).dict.set(pdfLib.raw.PDFName.of('Group'),
                    out.context.obj({ S: 'Transparency', I: true, CS: 'DeviceRGB' }));
                }
                if (masked && !t.clipOpaque) maskEmbeddedFragment(out, emb, angle % 180 ? emb.height : emb.width,
                  angle % 180 ? emb.width : emb.height, t.clipErasures, t.clipOpaque && !t.clipFragment);
                const o3 = { x: plc.x, y: plc.y, rotate: degrees(plc.total), opacity: opOf(t, 'fillOp'),
                  xScale: w / (angle % 180 ? emb.height : emb.width),
                  yScale: h / (angle % 180 ? emb.width : emb.height) };
                if (t.blend === 'multiply') o3.blendMode = pdfLib.raw.BlendMode.Multiply;
                if (t.clipOpaque && !t.clipFragment && !masked) outPage.drawRectangle({ x: plc.x, y: plc.y, width: w, height: h,
                  rotate: degrees(plc.total), color: rgb(1, 1, 1), borderWidth: 0 });
                outPage.drawPage(emb, o3);
                drawn = true;
              } catch (e2) { if (t.clipFragment || masked) throw e2; console.warn('벡터 클립 실패 — 래스터로 대체', e2); }
            }
            if (!drawn) {
              const bin = Uint8Array.from(atob(t.data.slice(t.data.indexOf(',') + 1)), c => c.charCodeAt(0));
              const im = /^data:image\/png/i.test(t.data) ? await out.embedPng(bin) : await out.embedJpg(bin);
              const o2 = { x: plc.x, y: plc.y, width: w, height: h, opacity: opOf(t, 'fillOp') };
              if (plc.total) o2.rotate = degrees(plc.total);
              if (t.blend === 'multiply' && pdfLib.raw.BlendMode) o2.blendMode = pdfLib.raw.BlendMode.Multiply;  
              outPage.drawImage(im, o2);
            }
          } catch (e) { if (t.clipFragment || t.clipErasures?.length) throw e; console.error('이미지 오브젝트 삽입 실패', e); }
        } else if (t.type === 'ink') {
          if (t.strokeOn !== false) {
            const w = t.fw * dispW, h = t.fh * dispH;
            const plc = boxPlacement(t.fx, t.fy, w, h, objRotation(t));
            outPage.drawSvgPath(inkSvgPath(inkGeometry(t, w, h)), {
              x: plc.topX, y: plc.topY, rotate: degrees(plc.total),
              color: hexToRgb01(t.stroke), opacity: opOf(t, 'strokeOp'),
              ...(t.brush === 'highlighter' && pdfLib.raw.BlendMode
                ? { blendMode: pdfLib.raw.BlendMode.Multiply } : {}),
            });
          }
        } else if (t.type === 'polyline') {
          const points = polylineObjectPoints(t).map(point => toPdf(point[0], point[1]));
          if (t.closed && points.length > 2) points.push([...points[0]]);
          const color = hexToRgb01(t.stroke);
          const opacity = opOf(t, 'strokeOp');
          for (let index = 1; index < points.length; index++) {
            outPage.drawLine({
              start: { x: points[index - 1][0], y: points[index - 1][1] },
              end: { x: points[index][0], y: points[index][1] },
              thickness: t.sw, color, opacity,
            });
          }
          const joints = t.closed ? points.slice(0, -1) : points;
          for (const [x, y] of joints)
            outPage.drawCircle({ x, y, size: Math.max(.05, t.sw / 2), color, opacity });
        } else if (t.type === 'line' || t.type === 'arrow') {
          const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
          const points = connectorPolyline(t).map(([x, y]) => {
            const [rx, ry] = rotateScreenPoint(x, y, cx, cy, objRotation(t));
            return toPdf(rx, ry);
          });
          const col = hexToRgb01(t.stroke);
          const op = opOf(t, 'strokeOp');
          const hl = t.type === 'arrow'
            ? Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +t.arrowHeadSize || 10)) : 0;
          const bodyPoints = t.type === 'arrow'
            ? arrowBodyPolyline(t, points, hl, -(+t.arrowHeadRotation || 0)) : points;
          for (let index = 1; index < bodyPoints.length; index++) {
            outPage.drawLine({
              start: { x: bodyPoints[index - 1][0], y: bodyPoints[index - 1][1] },
              end: { x: bodyPoints[index][0], y: bodyPoints[index][1] },
              thickness: t.sw, color: col, opacity: op,
            });
          }
          if (t.type === 'line' && t.lineCap !== 'square') {
            for (const [x, y] of [bodyPoints[0], bodyPoints[bodyPoints.length - 1]])
              outPage.drawCircle({ x, y, size: Math.max(.05, t.sw / 2), color: col, opacity: op });
          }
          if (t.type === 'arrow') {
            const { end: [x2, y2], angle: direction } = connectorEndDirection(points);
            const ang = direction - (+t.arrowHeadRotation || 0) * Math.PI / 180;
            const kind = t.arrowEndType || 'arrow-filled';
            const markerStroke = arrowMarkerStrokeWidth(t, hl);
            if (kind === 'circle-filled') {
              outPage.drawCircle({ x: x2, y: y2, size: hl * .38, color: col, opacity: op });
            } else if (kind === 'circle-open') {
              outPage.drawCircle({ x: x2, y: y2, size: hl * .34,
                borderColor: col, borderWidth: markerStroke, borderOpacity: op });
            } else if (kind === 'square') {
              const half = hl * .35;
              outPage.drawSvgPath(`M ${-half} ${-half} L ${half} ${-half} L ${half} ${half} L ${-half} ${half} Z`, {
                x: x2, y: y2, rotate: degrees(ang * 180 / Math.PI),
                borderColor: col, borderWidth: markerStroke, borderOpacity: op });
            } else if (kind === 'arrow-filled') {
              outPage.drawSvgPath(`M 0 0 L ${-hl} ${-hl * .5} L ${-hl} ${hl * .5} Z`, {
                x: x2, y: y2, rotate: degrees(ang * 180 / Math.PI), color: col, opacity: op,
              });
            } else if (kind === 'arrow-open') for (const da of [Math.PI * 5 / 6, -Math.PI * 5 / 6]) {
              outPage.drawLine({
                start: { x: x2, y: y2 },
                end: { x: x2 + hl * Math.cos(ang + da), y: y2 + hl * Math.sin(ang + da) },
                thickness: markerStroke, color: col, opacity: op
              });
            }
          }
        } else {  
          const w = t.fw * dispW, h = t.fh * dispH;
          const plc = boxPlacement(t.fx, t.fy, w, h, objRotation(t));
          const opts = {
            color: t.fill ? hexToRgb01(t.fill) : undefined,
            opacity: opOf(t, 'fillOp'), borderOpacity: opOf(t, 'strokeOp')
          };
          if (t.strokeOn !== false) {
            opts.borderColor = hexToRgb01(t.stroke);
            opts.borderWidth = t.sw;
          }
          if (t.type === 'ellipse')
            outPage.drawEllipse({ x: plc.cx, y: plc.cy, xScale: w / 2, yScale: h / 2,
                                  rotate: degrees(plc.total), ...opts });
          else if (t.type === 'triangle' || t.type === 'star') {
            const path = shapeUnitPolygon(t.type)
              .map(([x, y], index) => `${index ? 'L' : 'M'} ${(x + .5) * w} ${(y + .5) * h}`)
              .join(' ') + ' Z';
            if (t.fill || t.strokeOn !== false) {
              outPage.drawSvgPath(path, {
                x: plc.topX, y: plc.topY, rotate: degrees(plc.total),
                color: t.fill ? hexToRgb01(t.fill) : undefined,
                opacity: opOf(t, 'fillOp'),
                borderColor: t.strokeOn !== false ? hexToRgb01(t.stroke) : undefined,
                borderWidth: t.strokeOn !== false ? t.sw : 0,
                borderOpacity: opOf(t, 'strokeOp'),
              });
            }
          }
          else
            outPage.drawRectangle({ x: plc.x, y: plc.y, width: w, height: h,
                                    rotate: degrees(plc.total), ...opts });
          drawShapeTextToPdf(t);
        }
        } finally {
          if (reflected) outPage.pushOperators(pdfLib.raw.popGraphicsState());
          if (marked) try { outPage.pushOperators(pdfLib.raw.PDFOperator.of('EMC', [])); } catch {}
        }
      }
    }
  }
  for (const [key, record] of Object.entries(embeddedRecords)) {
    if (FONTS[record.key]?.source === 'installed')
      await retainPcFontMetadata(out, embedded[key], record, pdfLib.raw);
  }
  if (anyMarked) {
    const pcKeys = new Set(pageList.flatMap(p => p.texts.map(t => t.font).filter(key => key?.startsWith('pc:'))));
    out.setKeywords(['sol-marked', ...pcKeys]);
  }  
  return out.save();
}

function download(bytes, name) {
  browserFiles.downloadPdf(bytes, name);
}

const FS_OK = browserFiles.supportsFileSystemAccess;
async function saveDesktop(forceSaveAs = false, { onComplete = null } = {}) {
  if (!editorStore.pages.length || desktopSaveTransfers.size) { onComplete?.(false); return; }
  if (activeDocLocked()) { lockNotice(); onComplete?.(false); return; }
  spin(true, 'PDF 저장 중...');
  try {
    const bytes = await buildPdf(editorStore.pages);
    const requestId = crypto.randomUUID ? crypto.randomUUID() :
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    const name = (editorStore.documentName || '문서').replace(/\.pdf$/i, '') + '.pdf';
    desktopSaveTransfers.set(requestId, { bytes, name, forceSaveAs, onComplete });
    if (!desktopHost.send({
      type: 'save-put', apiVersion: 4, requestId,
      size: bytes.byteLength, name, saveAs: forceSaveAs,
    })) {
      desktopSaveTransfers.delete(requestId);
      throw new Error('Windows 저장 채널을 사용할 수 없습니다');
    }
  } catch (error) {
    spin(false);
    saveFailAlert(error);
    onComplete?.(false);
    if (!forceSaveAs && !onComplete) setTimeout(() => saveDesktop(true), 0);
  }
}
async function saveWeb() {
  return saveAs();
}
async function saveAll() { return desktopViewMode ? saveDesktop(!desktopCanSaveInPlace) : saveWeb(); }
async function saveAsAll() { return desktopViewMode ? saveDesktop(true) : saveAs(); }
function getPrintIdxs() {
  return printExportFeature.pageIndexes(
    $('prRange').value,
    editorStore.pages,
    editorStore.selectedPages,
    $('prCustom').value,
  );
}

async function orientedList(idxs, orient) {
  const editing = pendingObjectEdits();
  if (editing) await editing;
  return printExportFeature.orient(editorStore.pages, idxs, orient);
}

const printDialog = createPrintDialogController({
  printPaperSizes,
  getElement: id => domRefs.has(id) ? $(id) : null, readPreferences: () => settings.get('printOptions'),
  writePreferences: value => settings.set('printOptions', value),
  getDocument: () => editorStore.activeDocument, getIndexes: getPrintIdxs,
  hasSelection: () => editorStore.selectedPages.size > 0, isLocked: activeDocLocked,
  notify: toast, text: uiText,
  getPrinters: desktopViewMode ? () => desktopOutput.printers() : null,
  renderPreview: async ({ pageIndex, orientation, canvas, box, zoom }) => {
    const [page] = await orientedList([pageIndex], orientation);
    const viewport = await getViewport(page, 1), style = getComputedStyle(box);
    const availableWidth = Math.max(1, box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const availableHeight = Math.max(1, box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const paperOrientation = orientation === 'auto' ? (viewport.width > viewport.height ? 'landscape' : 'portrait') : orientation;
    const [sheetWidth, sheetHeight] = (desktopViewMode && printPaperSize($('prPaper').value, paperOrientation)) || [viewport.width, viewport.height];
    const fit = Math.min(sheetWidth / viewport.width, sheetHeight / viewport.height);
    const scale = Math.min(availableWidth / sheetWidth, availableHeight / sheetHeight) * zoom;
    const dpr = Math.min(2, window.devicePixelRatio || 1, 6000 / (Math.max(sheetWidth, sheetHeight) * scale));
    const content = desktopViewMode && $('prPaper').value !== 'auto' ? document.createElement('canvas') : canvas;
    try {
      await displayPainter.paintPage(page, content, scale * fit, dpr);
      await outputOverlayRenderer.prepareImages(page);
      await drawOutputObjects(page, content, viewport.width);
      if (desktopViewMode && $('prColor').value === 'mono') grayscaleCanvas(content);
      if (content !== canvas) {
        canvas.width = Math.max(1, Math.round(sheetWidth * scale * dpr));
        canvas.height = Math.max(1, Math.round(sheetHeight * scale * dpr));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(content, (canvas.width - content.width) / 2, (canvas.height - content.height) / 2);
      }
      return { width: sheetWidth * scale, height: sheetHeight * scale };
    } finally { if (content !== canvas) content.width = content.height = 0; }
  },
});
async function buildPrintPdf(list, name) {
  const original = originalPrintBytes(list, id => sources.get(id));
  if (!original) return buildPdf(list, name);
  if (!name) return original;
  const metadata = await sources.get(list[0].src).doc.getMetadata().catch(() => null);
  if (metadata?.info && (metadata.info.Title === name ||
      (!metadata.info.Title && !metadata.metadata?.get('dc:title')))) return original;
  return withPrintTitle(PDFLib, original, name);
}
function openPrintDialog(forceSelected) { return printDialog.open(forceSelected); }
function updatePrintPreview() { return printDialog.update(); }

async function renderImages(list, scale, type = 'image/jpeg', q = 0.9, monochrome = false) {
  const items = [];
  try {
    await rasterOutput.render(list, {
      scale, maxEdge: 6000, maxPixels: 16000000,
      transformCanvas: monochrome ? grayscaleCanvas : null,
      onProgress: (done, total) => spin(true, uiText('인쇄 준비 중...') + ' ' + done + ' / ' + total),
    }, async (canvas, viewport) => {
      const blob = await canvasImageBlob(canvas, type, q);
      items.push({ url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height,
        paperWidth: viewport.width, paperHeight: viewport.height });
    });
    return items;
  } catch (error) { items.forEach(item => URL.revokeObjectURL(item.url)); throw error; }
}

async function printImagesInFrame(frame, items, orient) {
  const releaseImages = () => items.forEach(item => URL.revokeObjectURL(item.url));
  try {
    const size = orient === 'portrait' ? '@page{size:portrait;margin:0}'
               : orient === 'landscape' ? '@page{size:landscape;margin:0}' : '@page{margin:0}';
    const imgs = items.map(it => `<div class="pg"><img src="${it.url}"></div>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>인쇄 - ${escHtml(editorStore.documentName)}</title><style>
      ${size}
      html,body{margin:0;background:#fff}
      .pg{display:flex;justify-content:center;align-items:center;page-break-after:always;margin:0}
      .pg:last-child{page-break-after:auto}
      .pg img{display:block;width:100%;max-width:100%}
    </style></head><body>${imgs}</body></html>`;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('인쇄 페이지를 준비하지 못했습니다.')), 15000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      frame.srcdoc = html;
    });
    const frameDocument = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error('인쇄 프레임에 접근할 수 없습니다.');
    await Promise.all([...frameDocument.images].map(image => image.complete
      ? Promise.resolve()
      : new Promise(resolve => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        })));
    frameWindow.addEventListener('afterprint', () => {
      setTimeout(() => { frame.srcdoc = '<!doctype html><html><body></body></html>'; releaseImages(); }, 0);
    }, { once: true });
    frameWindow.focus();
    frameWindow.print();
  } catch (error) { releaseImages(); throw error; }
}

$('prOk').onclick = async () => {
  if (printPreparing || rasterPreparing) return;
  const idxs = getPrintIdxs();
  if (!idxs || !idxs.length) { toast('인쇄 범위를 확인하세요'); return; }
  if (desktopViewMode && !$('prCopies').reportValidity()) return;
  const paper = $('prPaper').value, mode = $('prMode').value;
  const orient = desktopViewMode && paper === 'auto' ? 'auto' : $('prOrient').value;
  const name = (editorStore.documentName || '문서').replace(/\.pdf$/i, '') + '.pdf';
  if (mode === 'pdf' && activeDocLocked()) { toast('편집 제한 문서는 이미지 방식으로만 인쇄할 수 있습니다'); return; }
  printDialog.save();
  $('prOverlay').classList.remove('show');
  const preparing = uiText('인쇄 준비 중 · Esc로 취소');
  spin(true, preparing);
  printPreparing = true;
  clearTimeout(thumbPrepassT); thumbnailWorkerController.shutdown(); displayPainter.shutdown();
  const abort = new AbortController(); let preparationLease = false;
  let canCancel = true;
  const cancelPreparation = event => {
    if (desktopViewMode && canCancel && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); abort.abort(); spin(true, uiText('인쇄 취소 중…')); }
  };
  window.addEventListener('keydown', cancelPreparation, true);
  try {
    if (desktopViewMode) { await desktopOutput.resources('begin'); preparationLease = true; abort.signal.throwIfAborted(); }
    let list = await orientedList(idxs, orient);
    if (desktopViewMode) {
      const copies = Number($('prCopies').value);
      const pdfPrinter = $('prPrinter').selectedOptions[0]?.dataset.pdf === 'true';
      const monochromePdf = pdfPrinter && $('prColor').value === 'mono';
      const pageSizes = [];
      let mediaRuns = [];
      const collectSizes = ((paper === 'auto' || orient === 'auto') && !pdfPrinter) || mode === 'image' || monochromePdf;
      for (const page of collectSizes ? list : list.slice(0, 1)) {
        abort.signal.throwIfAborted();
        const { width, height } = await getViewport(page, 1);
        pageSizes.push({ width, height });
        if (!pdfPrinter && (paper === 'auto' || orient === 'auto')) {
          const sheet = printPaperSize(paper, width > height ? 'landscape' : 'portrait') || [width, height];
          addPrintMediaRun(mediaRuns, pageSizes.length, ...sheet);
        }
      }
      const firstViewport = pageSizes[0];
      const orientation = orient === 'auto' ? (firstViewport.width > firstViewport.height ? 'landscape' : 'portrait') : orient;
      const fitWithin = printPaperSize(paper, orientation);
      if (!mediaRuns.length && fitWithin) mediaRuns.push({ first: 1, last: list.length, width: fitWithin[0], height: fitWithin[1] });
      let bytes;
      const raster = mode === 'image' || monochromePdf;
      if (raster) {
        const onProgress = (done, total) => spin(true, preparing + ' · ' + done + ' / ' + total);
        let workerCompatible = typeof Worker === 'function' && typeof OffscreenCanvas === 'function';
        for (const sourceId of new Set(list.filter(p => !p.blank).map(p => p.src))) {
          const source = sources.get(sourceId);
          if (source.locked || source.doc.isPureXfa || await source.doc.getFieldObjects()) workerCompatible = false;
        }
        if (workerCompatible) {
          const prepared = await buildPrintPdf(list);
          const result = await parallelPrint.buildPdf(prepared, pageSizes, {
            fitWithin, autoRotateFit: orient === 'auto', name, monochrome: monochromePdf, onProgress, signal: abort.signal,
          });
          bytes = result.bytes;
          console.info('[DaydayPDF print]', JSON.stringify(result.stats));
        } else {
          ({ bytes } = await rasterOutput.buildPdf(list, {
            scale: 300 / 72, type: 'image/jpeg', quality: .9, fitWithin, autoRotateFit: orient === 'auto', signal: abort.signal, name,
            maxEdge: 6000, maxPixels: 16000000,
            transformCanvas: monochromePdf ? grayscaleCanvas : null,
            onProgress: (done, total) => { if (abort.signal.aborted) throw new DOMException('인쇄 준비를 취소했습니다.', 'AbortError'); onProgress(done, total); },
          }));
        }
      } else bytes = await buildPrintPdf(list, pdfPrinter ? null : name);
      if (abort.signal.aborted) throw new DOMException('인쇄 준비를 취소했습니다.', 'AbortError');
      if (pdfPrinter && !(raster && paper === 'auto' && copies === 1))
        bytes = await makePdfPrintCopy(PDFLib, bytes, { copies, orientation: orient, paper, signal: abort.signal, name });
      abort.signal.throwIfAborted();
      if (!pdfPrinter && orient === 'auto') {
        ({ bytes, mediaRuns } = await alignPrinterMedia(PDFLib, bytes, mediaRuns, abort.signal));
        abort.signal.throwIfAborted();
      }
      const result = await desktopOutput.print(bytes, {
        printer: $('prPrinter').value, copies: pdfPrinter ? 1 : copies, name,
        color: $('prColor').value, duplex: $('prDuplex').value, mediaRuns, pageCount: list.length, paper,
      }, { signal: abort.signal, onProgress: status => {
        if (abort.signal.aborted) return;
        canCancel = status.canCancel;
        spin(true, uiText(status.message));
      } });
      if (result.canceled) { toast(result.submitted ? '남은 인쇄를 취소했습니다. 전송된 작업은 대기열에서 확인하세요.' : '인쇄를 취소했습니다.'); return; }
      if (result.ok) toast(result.openedPdf ? '인쇄한 PDF를 새 탭으로 열었습니다.' : result.savedPdf ? 'PDF를 저장했습니다.' : '프린터로 보냈습니다.');
      return;
    }
    const fr = $('printFrame');
    if (mode === 'image') {
      await printImagesInFrame(fr, await renderImages(list, 2), orient);
    } else {
      const bytes = await buildPrintPdf(list);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      fr.removeAttribute('srcdoc');
      fr.onload = () => setTimeout(() => {
        try { fr.contentWindow.focus(); fr.contentWindow.print(); }
        catch { toast('인쇄창을 열지 못했습니다. 다시 시도하세요', 3500); }
        finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
      }, 300);
      fr.src = url;
    }
  } catch (e) {
    if (e.name === 'AbortError') toast('인쇄를 취소했습니다.');
    else { console.error(e); toast('인쇄 실패: ' + (e.message || e).toString().slice(0, 80), 4000); }
  }
  finally {
    window.removeEventListener('keydown', cancelPreparation, true);
    if (preparationLease) await desktopOutput.resources('end').catch(() => {});
    printPreparing = false; scheduleThumbPrepass();
    viewer.querySelectorAll('.pageWrap').forEach(enqueueRender); scheduleTQ(); spin(false);
  }
};

function clipboardReferenceKey(sourceId, pageIndex) {
  return String(sourceId) + ':' + String(pageIndex);
}

function clipboardPageDto(page, references) {
  const dto = clonePage(page);
  delete dto._w1;
  delete dto._h1;
  if (dto.src) {
    dto.__sourceRef = clipboardReferenceKey(dto.src, dto.idx);
    references.set(dto.__sourceRef, { key: dto.__sourceRef, sourceKey: String(dto.src), pageIndex: dto.idx });
    dto.src = null;
    dto.idx = 0;
  }
  dto.texts = (dto.texts || []).map(object => {
    const clone = { ...object };
    delete clone._id;
    delete clone._w1;
    if (clone.clipSrc !== undefined && clone.clipIdx !== undefined) {
      clone.__clipSourceRef = clipboardReferenceKey(clone.clipSrc, clone.clipIdx);
      references.set(clone.__clipSourceRef, {
        key: clone.__clipSourceRef,
        sourceKey: String(clone.clipSrc),
        pageIndex: clone.clipIdx,
      });
      delete clone.clipSrc;
      delete clone.clipIdx;
    }
    return clone;
  });
  return dto;
}

function ensureClipboardSerializeWorker() {
  if (clipboardSerializeWorker) return clipboardSerializeWorker;
  const workerUrl = URL.createObjectURL(new Blob(
    [CLIPBOARD_SERIALIZE_WORKER_SOURCE], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);
  worker.onmessage = event => {
    const message = event.data;
    if (!message || !message.requestId || message.type === 'progress') return;
    const job = clipboardSerializeJobs.get(message.requestId);
    if (!job) return;
    clipboardSerializeJobs.delete(message.requestId);
    if (message.type === 'serialized') job.resolve(new Uint8Array(message.packet));
    else job.reject(new Error(message.error || '페이지 직렬화에 실패했습니다'));
  };
  worker.onerror = event => {
    const error = new Error(event.message || '페이지 직렬화 Worker 오류');
    for (const job of clipboardSerializeJobs.values()) job.reject(error);
    clipboardSerializeJobs.clear();
    try { worker.terminate(); } catch {}
    clipboardSerializeWorker = null;
  };
  clipboardSerializeWorker = worker;
  return worker;
}

async function serializePageListForClipboard(pageList) {
  const references = new Map(), isolated = new Map(), pages = [];
  for (const page of pageList) {
    const texts = [];
    for (const object of page.texts || []) {
      if (!object.clipOpaque || !sources.has(object.clipSrc) || wholeVisibleFragment(object)) {
        texts.push(object);
        continue;
      }
      const {bytes,preview,width,height} = await visibleFragmentPdf(object,true);
      const id = -(++srcSeq);
      isolated.set(id,bytes);
      const image = {...object, data:preview, clipSrc:id, clipIdx:0, clipRotation:0,
        clipBox:[0,0,width,height], clipFragment:true, clipAlpha:true};
      delete image.clipErasures;
      texts.push(image);
    }
    pages.push(clipboardPageDto({...page,texts},references));
  }
  const sourceIds = new Set([...references.values()].map(reference => +reference.sourceKey));
  const transfer = [];
  const sourceList = [];
  for (const sourceId of sourceIds) {
    const source = isolated.get(sourceId) || sources.get(sourceId)?.bytes;
    if (!source) throw new Error('복사할 PDF 원본을 찾을 수 없습니다');
    const bytes = source.slice();
    sourceList.push({ key: String(sourceId), bytes: bytes.buffer });
    transfer.push(bytes.buffer);
  }
  const requestId = crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    clipboardSerializeJobs.set(requestId, { resolve, reject });
    ensureClipboardSerializeWorker().postMessage({
      type: 'serialize', requestId, pages,
      references: [...references.values()],
      sources: sourceList,
      pdfLibUrl: desktopViewMode
        ? new URL('assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js', document.baseURI).href
        : 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    }, transfer);
  });
}

function serializePagesForClipboard(idxs) {
  return serializePageListForClipboard(idxs.map(index => editorStore.pages[index]));
}

function serializeObjectForWebClipboard(object) {
  return serializePageListForClipboard([{
    src: null, idx: 0, rot: 0, blank: [595, 842],
    texts: objectClipboardItems(object).map(item => ({ ...item, _id: undefined, _w1: undefined })),
  }]);
}

async function commitWebObjectClipboard(object, meta = {}, reservation = null) {
  const id = reservation?.id || webClipboardBroker.createId();
  const markerWrite = reservation?.markerWrite || syncClipMarker(CLIP_OBJ, id);
  const packet = await serializeObjectForWebClipboard(object);
  const committed = await webClipboardBroker.put('object', packet, meta, { id });
  webObjectClipboardId = committed.id;
  await markerWrite;
  return committed;
}

async function commitDesktopObjectClipboard(object, cut, sourceDocument, markerWrite = syncClipMarker(CLIP_OBJ)) {
  const packet = await serializeObjectForWebClipboard(object);
  await markerWrite;
  await putShellClipboard(packet, {
    kind: 'object-v1', count: objectClipboardItems(object).length,
    operation: cut ? 'cut' : 'copy', sourceTab: desktopTabToken, sourceDocument,
  });
}

function putShellClipboard(packet, meta) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    desktopClipboardPuts.set(requestId, { packet, resolve, reject });
    if (!desktopHost.send({
      type: 'clipboard-put', apiVersion: 4, requestId,
      size: packet.byteLength, meta,
    })) {
      desktopClipboardPuts.delete(requestId);
      reject(new Error('Windows 클립보드 채널을 사용할 수 없습니다'));
    }
  });
}

function requestShellClipboard({ withMetadata = false, metadataOnly = false } = {}) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    desktopClipboardGets.set(requestId, { resolve, reject, withMetadata });
    if (!desktopHost.send({ type: 'clipboard-get', apiVersion: 4, requestId, metadataOnly })) {
      desktopClipboardGets.delete(requestId);
      reject(new Error('Windows 클립보드 채널을 사용할 수 없습니다'));
    }
  });
}

async function copyPagesToClip(cut) {
  if (cut && activeDocLocked()) { lockNotice(); return; }  
  if (!editorStore.selectedPages.size) { toast((cut ? '잘라낼' : '복사할') + ' 페이지를 썸네일에서 선택하세요'); return; }
  if (cut && editorStore.selectedPages.size >= editorStore.pages.length) { toast('모든 페이지를 잘라낼 수 없습니다'); return; }
  const idxs = [...editorStore.selectedPages].sort((a, b) => a - b);
  const source = editorStore.activeDocument;
  const selectedPageRefs = idxs.map(index => editorStore.pages[index]);
  const copiedPages = pageOrganizer.copy(editorStore.pages, idxs);
  const sourceDocument = editorStore.documentName;
  return runClipboardCopy(async () => {
  if (desktopViewMode) {
    spin(true, cut ? '페이지 잘라내기 준비 중...' : '페이지 복사 준비 중...');
    try {
      const markerWrite = syncClipMarker(CLIP_PAGES);
      const packet = await serializePageListForClipboard(copiedPages);
      await markerWrite;
      await putShellClipboard(packet, {
        kind: 'pages-v1', count: idxs.length,
        operation: cut ? 'cut' : 'copy',
        sourceTab: desktopTabToken,
        sourceDocument,
      });
      clipboard = copiedPages;
      if (cut && source === editorStore.activeDocument &&
        idxs.every((index, i) => editorStore.pages[index] === selectedPageRefs[i])) {
        pushUndo();
        const result = pageOrganizer.remove(editorStore.pages, new Set(idxs));
        editorStore.pages = result.pages;
        editorStore.selectedPages = result.selectedIndexes;
        rebuildAll();
      }
      toast(idxs.length + '페이지 ' + (cut ? '잘라내기' : '복사') + ' — 다른 창에도 붙여넣을 수 있습니다');
      return true;
    } catch (error) {
      console.error(error);
      toast('페이지 ' + (cut ? '잘라내기' : '복사') + ' 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    } finally { spin(false); }
    return;
  }
  spin(true, cut ? '페이지 잘라내기 준비 중...' : '페이지 복사 준비 중...');
  try {
    const id = webClipboardBroker.createId();
    const markerWrite = syncClipMarker(CLIP_PAGES, id);
    const packet = await serializePageListForClipboard(copiedPages);
    const committed = await webClipboardBroker.put('pages', packet, {
      count: idxs.length, operation: cut ? 'cut' : 'copy',
      sourceDocument,
    }, { id });
    clipboard = copiedPages;
    webPageClipboardId = committed.id;
    await markerWrite;
    if (cut && source === editorStore.activeDocument &&
        idxs.every((index, i) => editorStore.pages[index] === selectedPageRefs[i])) {
      pushUndo();
      const result = pageOrganizer.remove(editorStore.pages, new Set(idxs));
      editorStore.pages = result.pages;
      editorStore.selectedPages = result.selectedIndexes;
      rebuildAll();
    }
    toast(idxs.length + '페이지 ' + (cut ? '잘라내기' : '복사') + ' — 다른 웹 창에도 붙여넣을 수 있습니다');
    return true;
  } catch (error) {
    console.error(error);
    toast('페이지 ' + (cut ? '잘라내기' : '복사') + ' 실패: ' + String(error?.message || error).slice(0, 80), 4200);
  } finally { spin(false); }
  });
}

async function materializeClipboardPacket(packet) {
  const decoded = unpackShellClipboardPayload(packet);
  let sourceId = null;
  if (Object.keys(decoded.mapping).length) {
    const pdoc = await openPdfDocument(decoded.pdfBytes.slice()).promise;
    sourceId = ++srcSeq;
    sources.set(sourceId, {
      bytes: decoded.pdfBytes,
      doc: pdoc,
      name: '웹 창 클립보드.pdf',
      locked: false,
    });
  }
  const pages = decoded.pages.map(page => {
    const item = clonePage(page);
    if (item.__sourceRef !== undefined) {
      const mapped = decoded.mapping[item.__sourceRef];
      if (sourceId === null || !Number.isInteger(mapped)) throw new Error('복사 페이지 원본 매핑이 없습니다');
      item.src = sourceId;
      item.idx = mapped;
      delete item.__sourceRef;
    }
    item.texts = (item.texts || []).map(object => {
      const clone = { ...object };
      if (clone.__clipSourceRef !== undefined) {
        const mapped = decoded.mapping[clone.__clipSourceRef];
        if (sourceId === null || !Number.isInteger(mapped))
          throw new Error('복사 오브젝트 원본 매핑이 없습니다');
        clone.clipSrc = sourceId;
        clone.clipIdx = mapped;
        delete clone.__clipSourceRef;
      }
      return clone;
    });
    return item;
  });
  return { pages, sourceId };
}

async function insertClipboardPages(packet, { createDocument = false, name = '새 문서' } = {}) {
  if (!editorStore.activeDocument && createDocument) {
    const documentState = newDoc(name);
    editorStore.documents.push(documentState);
    switchDoc(documentState);
  }
  if (!editorStore.activeDocument) return false;
  const destination = editorStore.activeDocument;
  const { pages, sourceId } = await materializeClipboardPacket(packet);
  if (destination !== editorStore.activeDocument || activeDocLocked()) return false;
  pages.forEach(page => rekeyPageConnections(page, createConnectorId));
  if (sourceId !== null && !editorStore.activeDocument.srcIds.includes(sourceId))
    editorStore.activeDocument.srcIds.push(sourceId);
  pushUndo();
  const at = pageOrganizer.insertionIndex(editorStore.pages, editorStore.selectedPages);
  const result = pageOrganizer.insert(editorStore.pages, editorStore.selectedPages, pages, at);
  editorStore.pages = result.pages;
  editorStore.selectedPages = result.selectedIndexes;
  rebuildAll();
  toast(pages.length + '페이지를 ' + (at + 1) + '번 위치에 붙여넣음');
  return true;
}

async function pastePagesFromShellClipboard(options = {}) {
  if (!await waitForClipboardCopy()) return false;
  const record = await requestShellClipboard({ withMetadata: true });
  if (!record || record.meta.kind !== 'pages-v1') return false;
  return insertClipboardPages(record.packet, options);
}

async function pastePagesFromWebClipboard(id = null) {
  const record = await webClipboardBroker.get({ id: id || null, kind: 'pages' });
  if (!record) { toast('다른 웹 창의 페이지 클립보드를 찾지 못했습니다', 3200); return false; }
  webPageClipboardId = record.id;
  return insertClipboardPages(record.packet);
}

async function pasteObjectFromWebClipboard(pageIndex, id = null, record = null,
  target = captureObjectPasteTarget(pageIndex)) {
  if (!validObjectPasteTarget(pageIndex, target)) return false;
  const stored = record || await webClipboardBroker.get({ id: id || null, kind: 'object' });
  if (!stored) { toast('다른 웹 창의 오브젝트 클립보드를 찾지 못했습니다', 3200); return false; }
  const { pages, sourceId } = await materializeClipboardPacket(stored.packet);
  if (!validObjectPasteTarget(pageIndex, target)) return false;
  const objects = pages[0]?.texts || [];
  if (!objects.length) throw new Error('붙여넣을 오브젝트 데이터가 없습니다');
  if (sourceId !== null && !editorStore.activeDocument.srcIds.includes(sourceId))
    editorStore.activeDocument.srcIds.push(sourceId);
  objClip = objects.length > 1
    ? { kind: 'object-bundle-v1', objects: objects.map(object => ({ ...object, _id: undefined })), primaryIndex: 0 }
    : { ...objects[0], _id: undefined };
  webObjectClipboardId = stored.id;
  return pasteObj(pageIndex, target);
}

async function pasteObjectFromShellClipboard(pageIndex, target = captureObjectPasteTarget(pageIndex), record = null) {
  if (!validObjectPasteTarget(pageIndex, target)) return false;
  const stored = record || await requestShellClipboard({ withMetadata: true });
  if (!stored || stored.meta.kind !== 'object-v1') return false;
  const packet = stored.packet;
  const { pages, sourceId } = await materializeClipboardPacket(packet);
  if (!validObjectPasteTarget(pageIndex, target)) return false;
  const objects = pages[0]?.texts || [];
  if (!objects.length) throw new Error('붙여넣을 오브젝트 데이터가 없습니다');
  if (sourceId !== null && !editorStore.activeDocument.srcIds.includes(sourceId))
    editorStore.activeDocument.srcIds.push(sourceId);
  objClip = objects.length > 1
    ? { kind: 'object-bundle-v1', objects: objects.map(object => ({ ...object, _id: undefined })), primaryIndex: 0 }
    : { ...objects[0], _id: undefined };
  return pasteObj(pageIndex, target);
}

async function pasteLatestShellClipboard(pageIndex, target) {
  const record = await requestShellClipboard({ withMetadata: true });
  if (!record || !validObjectPasteTarget(pageIndex, target)) return false;
  if (record.meta.kind === 'object-v1') return pasteObjectFromShellClipboard(pageIndex, target, record);
  if (record.meta.kind === 'pages-v1') return insertClipboardPages(record.packet);
  return false;
}

async function pasteLatestWebClipboard(pageIndex, target = captureObjectPasteTarget(pageIndex)) {
  const record = await webClipboardBroker.get();
  if (!record) return false;
  if (!validObjectPasteTarget(pageIndex, target)) return false;
  if (record.kind === 'object') return pasteObjectFromWebClipboard(pageIndex, record.id, record, target);
  webPageClipboardId = record.id;
  return insertClipboardPages(record.packet);
}

async function pasteObjectFromAvailable(pageIndex, target = captureObjectPasteTarget(pageIndex)) {
  if (!await waitForClipboardCopy()) return false;
  if (!validObjectPasteTarget(pageIndex, target)) return;
  if (activeDocLocked()) { lockNotice(); return; }
  if (desktopViewMode) {
    const finishBusy = beginClipboardBusy('오브젝트 붙여넣는 중...');
    try {
      const pasted = await pasteObjectFromShellClipboard(pageIndex, target);
      if (!pasted && objClip) pasteObj(pageIndex, target);
    } catch (error) {
      console.error(error);
      toast('오브젝트 붙여넣기 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    } finally { finishBusy(); }
    return;
  }
  const finishBusy = beginClipboardBusy('오브젝트 붙여넣는 중...');
  try { await pasteObjectFromWebClipboard(pageIndex, null, null, target); }
  catch (error) {
    console.error(error);
    toast('오브젝트 붙여넣기 실패: ' + String(error?.message || error).slice(0, 80), 4200);
  } finally { finishBusy(); }
}

async function pastePagesFromAvailable() {
  if (!await waitForClipboardCopy()) return false;
  if (desktopViewMode) { await pastePagesFromShellClipboard(); return; }
  spin(true, '페이지 붙여넣는 중...');
  try { await pastePagesFromWebClipboard(); }
  catch (error) {
    console.error(error);
    toast('페이지 붙여넣기 실패: ' + String(error?.message || error).slice(0, 80), 4200);
  } finally { spin(false); }
}

function pastePagesFromClip() {
  if (!requireWindowsEdit()) return;
  if (activeDocLocked()) { lockNotice(); return; }
  if (!clipboard || !clipboard.length) { toast('클립보드가 비어 있습니다 (Ctrl+C로 페이지 복사)'); return; }
  if (!editorStore.activeDocument) return;
  pushUndo();
  const at = pageOrganizer.insertionIndex(editorStore.pages, editorStore.selectedPages);
  const items = pageOrganizer.cloneItems(clipboard);
  items.forEach(page => rekeyPageConnections(page, createConnectorId));
  const result = pageOrganizer.insert(editorStore.pages, editorStore.selectedPages, items, at);
  editorStore.pages = result.pages;
  editorStore.selectedPages = result.selectedIndexes;
  rebuildAll();
  toast(items.length + '페이지를 ' + (at + 1) + '번 위치에 붙여넣음');
}

function snapshotMergeDocument(documentState) {
  if (!documentState?.pages.length) throw new Error('열린 문서를 찾을 수 없습니다.');
  if (documentState === editorStore.activeDocument) commitPendingNudge();
  const pages = documentState.pages.map(clonePage);
  return { kind: 'pages', name: documentState.name, pages, count: pages.length,
    sourceIds: [...collectSourceRefs(pages)] };
}
function openMergeDialog() {
  if (!requireWindowsNewWork()) return false;
  mergeOpenDocuments.close();
  mgItems.forEach(item => { if (item.kind === 'file') { try { item.pdoc.destroy(); } catch {} } });
  mgItems = editorStore.pages.length ? [snapshotMergeDocument(editorStore.activeDocument)] : [];
  scheduleSrcSweep();
  renderMgList();
  $('mgOverlay').classList.add('show');
  return true;
}
function renderMgList() {
  $('mgOk').disabled = mgItems.length < 2;
  const box = $('mgList');
  box.innerHTML = mgItems.length ? '' :
    '<div style="color:var(--dim); text-align:center; padding:18px 0">[파일 추가]로 병합할 PDF를 선택하세요</div>';
  mgItems.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'mgRow';
    row.draggable = true;
    row.innerHTML = `<span class="h">☰</span><span class="nm"></span><span class="ct">${it.count}p</span><span class="x" title="목록에서 제거">×</span>`;
    row.querySelector('.nm').textContent = (i + 1) + '. ' + it.name;
    row.title = it.name + ' (' + it.count + '페이지)';
    row.querySelector('.x').onclick = () => {
      if (it.kind === 'file') { try { it.pdoc.destroy(); } catch {} }
      mgItems.splice(i, 1); renderMgList(); scheduleSrcSweep();
    };
    row.addEventListener('dragstart', ev => ev.dataTransfer.setData('text/plain', i));
    row.addEventListener('dragover', ev => {
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const before = ev.clientY < r.top + r.height / 2;
      row.classList.toggle('dragover-before', before);
      row.classList.toggle('dragover-after', !before);
    });
    row.addEventListener('dragleave', () => row.classList.remove('dragover-before', 'dragover-after'));
    row.addEventListener('drop', ev => {
      ev.preventDefault();
      const from = +ev.dataTransfer.getData('text/plain');
      const r = row.getBoundingClientRect();
      const to = i + (ev.clientY < r.top + r.height / 2 ? 0 : 1);
      mgItems = mergeFeature.reorder(mgItems, from, to);
      renderMgList();
    });
    box.appendChild(row);
  });
}
async function addMergeFiles(fileList) {
  if (!requireWindowsNewWork()) return false;
  const files = [...fileList].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { toast('PDF 파일이 아닙니다'); return; }
  spin(true, 'PDF 읽는 중...');
  try {
    for (const f of files) {
      try {  
        const { bytes, pdoc } = await openPdfBytesInteractive(new Uint8Array(await f.arrayBuffer()), f.name);
        mgItems.push({ kind: 'file', name: f.name.replace(/\.pdf$/i, ''), bytes, pdoc,
                       count: pdoc.numPages, locked: await detectPdfLocked(pdoc) });
      } catch (err) { openFailToast(f, err); }
    }
    renderMgList();
  } finally { spin(false); }
}
const desktopMerge = desktopViewMode ? createDesktopMergeAdapter({
  windowObject: window, host: desktopHost,
  exportSnapshot: () => serializePageListForClipboard(snapshotMergeDocument(editorStore.activeDocument).pages),
}) : null;
const mergeOpenDocuments = createMergeOpenDocumentsController({
  documentObject: document,
  listDocuments: () => desktopMerge ? desktopMerge.list() : editorStore.documents
    .filter(d => d.pages.length).map(d => ({ id: String(d.id), name: d.name, count: d.pages.length })),
  async addDocuments(ids) {
    if (!requireWindowsNewWork()) return;
    const added = [];
    const targetItems = mgItems;
    mgPendingItems = added;
    spin(true, '열린 문서를 추가하는 중…');
    try {
      const documents = desktopMerge ? await desktopMerge.list() : [];
      for (const id of ids) {
        if (desktopMerge) {
          const packet = await desktopMerge.snapshot(id);
          const { pages, sourceId } = await materializeClipboardPacket(packet);
          added.push({ kind: 'pages', name: documents.find(d => d.id === id)?.name || '문서',
            pages, count: pages.length, sourceIds: sourceId === null ? [] : [sourceId] });
        } else {
          const documentState = editorStore.documents.find(d => String(d.id) === id);
          added.push(snapshotMergeDocument(documentState));
        }
      }
      if (mgItems === targetItems && $('mgOverlay').classList.contains('show')) {
        mgItems.push(...added); renderMgList();
      }
    } finally { mgPendingItems = []; spin(false); scheduleSrcSweep(); }
  },
  reportError: error => toast(String(error?.message || error), 4000),
});
$('mgAdd').onclick = () => $('mgFile').click();
$('mgFile').onchange = e => { addMergeFiles(e.target.files); e.target.value = ''; };
['mgDrop', 'mgDialog'].forEach(id => {
  const el = $(id);
  el.addEventListener('dragover', ev => {
    if (![...ev.dataTransfer.types].includes('Files')) return;
    ev.preventDefault(); ev.stopPropagation();
    $('mgDrop').classList.add('over');
  });
  el.addEventListener('dragleave', ev => { if (ev.target === el) $('mgDrop').classList.remove('over'); });
  el.addEventListener('drop', ev => {
    if (!ev.dataTransfer.files.length) return;
    ev.preventDefault(); ev.stopPropagation();
    $('mgDrop').classList.remove('over');
    try {
      if (desktopViewMode && desktopHost.sendWithAdditionalObjects({
        type: 'drop-files', apiVersion: 4, target: 'merge',
      }, [...ev.dataTransfer.files])) return;
    } catch {   }
    addMergeFiles(ev.dataTransfer.files);
  });
});
$('mgCancel').onclick = () => {
  mergeOpenDocuments.close();
  scheduleSrcSweep();
  mgItems.forEach(it => { if (it.kind === 'file') { try { it.pdoc.destroy(); } catch {} } });
  mgItems = [];
  $('mgOverlay').classList.remove('show');
};
$('mgOk').onclick = async () => {
  if (!requireWindowsNewWork()) return;
  if (!mgItems.length) { toast('병합할 PDF를 추가하세요'); return; }
  if (mgItems.length < 2) { toast('두 개 이상이어야 병합할 수 있습니다'); return; }
  const d = newDoc('병합');
  const merged = mergeFeature.materialize(mgItems, editorStore.pages, it => {
      const id = ++srcSeq;
      sources.set(id, { bytes: it.bytes, doc: it.pdoc, name: it.name, locked: !!it.locked });
      return id;
    });
  d.pages = merged.pages;
  d.pages.forEach(page => rekeyPageConnections(page, createConnectorId));
  d.srcIds.push(...new Set(merged.sourceIds));
  markChanged(d);
  if (desktopViewMode) {
    spin(true, '병합 결과를 새 탭으로 여는 중...');
    try {
      const packet = await serializePageListForClipboard(d.pages);
      await syncClipMarker(CLIP_PAGES);
      await putShellClipboard(packet, {
        kind: 'pages-v1', count: d.pages.length, operation: 'copy',
        purpose: 'open-native-document', sourceTab: desktopTabToken,
        sourceDocument: '병합',
      });
      const replaceEmptyHost = !editorStore.activeDocument;
      mgItems = [];
      $('mgOverlay').classList.remove('show');
      desktopHost.send({
        type: 'request-new-from-clipboard', apiVersion: 4,
        title: '병합', replaceEmptyHost,
      });
      toast('병합 완료 — 새 탭 (' + d.pages.length + '페이지), 저장하려면 💾');
    } catch (error) {
      console.error(error);
      toast('병합 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    } finally {
      scheduleSrcSweep();
      spin(false);
    }
    return;
  }
  mgItems = [];
  $('mgOverlay').classList.remove('show');
  editorStore.documents.push(d);
  switchDoc(d);
  renderTabs();
  toast('병합 완료 — 새 탭 (' + d.pages.length + '페이지), 저장하려면 💾');
};

async function handleOpenButton() {
  if (!requireWindowsNewWork()) return;
  if (desktopViewMode && desktopHost.send({ type: 'request-open', apiVersion: 4 })) return;
  if (FS_OK) {
    let files;
    try {
      files = await browserFiles.pickOpenPdfFiles();
    } catch { return; }  
    openFiles(files, false);
  } else {
    fileMode = 'open';
    $('fileInput').click();
  }
}
function handleFileInputChange(e) {
  if (e.target.files.length) openFiles(e.target.files, fileMode === 'append');
  e.target.value = '';
}

$('szPreset').addEventListener('change', () => {
  $('szCustomRow').style.display = $('szPreset').value === 'custom' ? '' : 'none';
});
function openSizeDialog() {
  const ts = targetIndices();
  if (!ts.length) { toast('크기를 변경할 페이지를 선택하세요'); return; }
  $('szCount').textContent = '— ' + ts.length + '개 페이지';
  $('szOverlay').classList.add('show');
}
$('szReset').onclick = () => {
  const ts = targetIndices();
  pushUndo();
  cropResizeFeature.resetResize(editorStore.pages, ts);
  $('szOverlay').classList.remove('show');
  rebuildAll();
  toast('원본 크기로 되돌림');
};
$('szOk').onclick = async () => {
  const ts = targetIndices();
  let w, h;
  if ($('szPreset').value === 'custom') {
    w = parseFloat($('szW').value) * 72 / 25.4;
    h = parseFloat($('szH').value) * 72 / 25.4;
    if (!(w > 0) || !(h > 0)) { toast('크기를 올바르게 입력하세요 (mm)'); return; }
  } else [w, h] = $('szPreset').value.split(',').map(Number);
  const orient = $('szOrient').value;
  pushUndo();
  await cropResizeFeature.resize(editorStore.pages, ts, w, h, orient, getViewport);
  $('szOverlay').classList.remove('show');
  rebuildAll();
  toast(ts.length + '개 페이지 크기 변경됨 (저장 시 반영)');
};

let crCtx = null;  
const CR_PAD = 14;  
function setCrRect(x, y, w, h) {
  const r = $('crRect');
  r.style.left = (x + CR_PAD) + 'px'; r.style.top = (y + CR_PAD) + 'px';
  r.style.width = w + 'px'; r.style.height = h + 'px';
}
function getCrRect() {
  const r = $('crRect');
  return { x: r.offsetLeft - CR_PAD, y: r.offsetTop - CR_PAD, w: r.offsetWidth, h: r.offsetHeight };
}
async function crRedraw(keepRect) {
  const p = crCtx.p;
  let frac = null;
  if (keepRect && crCtx.W) {
    const g = getCrRect();
    frac = [g.x / crCtx.W, g.y / crCtx.H, g.w / crCtx.W, g.h / crCtx.H];
  }
  await paintPage(p.crop ? { ...p, crop: undefined } : p,
    $('crCanvas'), crCtx.fit * crCtx.zoom, 1);
  crCtx.W = $('crCanvas').width;
  crCtx.H = $('crCanvas').height;
  $('crCanvas').style.width = crCtx.W + 'px';
  $('crCanvas').style.height = crCtx.H + 'px';
  const c = frac || p.crop || [0, 0, 1, 1];  
  setCrRect(c[0] * crCtx.W, c[1] * crCtx.H, c[2] * crCtx.W, c[3] * crCtx.H);
}
async function openCropDialog() {
  const ts = targetIndices().filter(i => !editorStore.pages[i].blank);
  if (!ts.length) { toast('자를 수 있는 페이지가 없습니다 (빈 페이지 제외)'); return; }
  const k = ts.includes(editorStore.currentPage) ? editorStore.currentPage : ts[0];
  const p = editorStore.pages[k];
  spin(true, '미리보기 준비 중...');
  try {
    const fullViewport = await getViewport(p.crop ? { ...p, crop: undefined } : p, 1);
    crCtx = {
      idxs: ts, p,
      fit: Math.min(660 / fullViewport.width, 500 / fullViewport.height),
      zoom: 1, W: 0, H: 0, hasCustomSelection: !!p.crop,
    };
    await crRedraw(false);
    $('crInfo').textContent = '— ' + ts.length + '개 페이지에 적용 · 탭/드래그로 범위 선택';
    $('crOverlay').classList.add('show');
  } catch (e) { console.error(e); toast('미리보기 실패'); }
  finally { spin(false); }
}
let crWheelBusy = false;
$('crScroll').addEventListener('wheel', async e => {
  if (!e.ctrlKey || !crCtx) return;
  e.preventDefault();
  if (crWheelBusy) return;
  crWheelBusy = true;
  try {
    crCtx.zoom = Math.min(3, Math.max(0.5, crCtx.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    await crRedraw(true);
  } finally { crWheelBusy = false; }
}, { passive: false });
function cropPointerAllowed(e) {
  return crCtx && e.isPrimary !== false && (e.pointerType !== 'mouse' || e.button === 0);
}
function cropPointFromClient(clientX, clientY) {
  const bounds = $('crCanvas').getBoundingClientRect();
  return [
    Math.max(0, Math.min(crCtx.W, clientX - bounds.left)),
    Math.max(0, Math.min(crCtx.H, clientY - bounds.top)),
  ];
}
$('crStage').addEventListener('pointerdown', e => {
  if (!cropPointerAllowed(e) || e.target.closest('.crH')) return;
  const onSelectedRect = !!e.target.closest('#crRect');
  if (onSelectedRect && crCtx.hasCustomSelection) return;
  e.preventDefault(); e.stopPropagation();
  const pointerId = e.pointerId;
  const start = cropPointFromClient(e.clientX, e.clientY);
  const previous = getCrRect();
  const previouslyCustom = crCtx.hasCustomSelection;
  let moved = false;
  crCtx.hasCustomSelection = true;
  setCrRect(start[0], start[1], 1, 1);
  const mv = e2 => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    if (Math.hypot(e2.clientX - e.clientX, e2.clientY - e.clientY) >= 6) moved = true;
    const end = cropPointFromClient(e2.clientX, e2.clientY);
    const g = cropSelectionRectFromPoints(start, end, crCtx.W, crCtx.H);
    setCrRect(g.x, g.y, Math.max(1, g.w), Math.max(1, g.h));
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const up = e2 => {
    if (e2.pointerId !== pointerId) return;
    if (moved) mv(e2);
    cleanup();
    const current = getCrRect();
    if (!moved || current.w < 24 || current.h < 24) {
      const g = tappedCropSelectionRect(start, crCtx.W, crCtx.H);
      setCrRect(g.x, g.y, g.w, g.h);
    }
  };
  const cancel = e2 => {
    if (e2.pointerId !== pointerId) return;
    cleanup();
    crCtx.hasCustomSelection = previouslyCustom;
    setCrRect(previous.x, previous.y, previous.w, previous.h);
  };
  window.addEventListener('pointermove', mv, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}, { capture: true, passive: false });
$('crRect').addEventListener('pointerdown', e => {
  if (!cropPointerAllowed(e) || e.target.classList.contains('crH')) return;
  e.preventDefault();
  e.stopPropagation();
  const pointerId = e.pointerId;
  const g = getCrRect(), sx = e.clientX, sy = e.clientY;
  const mv = e2 => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    const nx = Math.max(0, Math.min(g.x + e2.clientX - sx, crCtx.W - g.w));
    const ny = Math.max(0, Math.min(g.y + e2.clientY - sy, crCtx.H - g.h));
    setCrRect(nx, ny, g.w, g.h);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const up = e2 => { if (e2.pointerId === pointerId) cleanup(); };
  const cancel = e2 => { if (e2.pointerId === pointerId) cleanup(); };
  window.addEventListener('pointermove', mv, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
});
document.querySelectorAll('.crH').forEach(hd => hd.addEventListener('pointerdown', e => {
  if (!cropPointerAllowed(e)) return;
  e.preventDefault(); e.stopPropagation();
  const pointerId = e.pointerId;
  const cls = [...hd.classList].find(c => ['nw', 'ne', 'se', 'sw'].includes(c));
  const g = getCrRect(), sx = e.clientX, sy = e.clientY;
  const mv = e2 => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    const dx = e2.clientX - sx, dy = e2.clientY - sy;
    let { x, y, w, h } = g;
    if (cls.includes('e')) w = Math.max(24, Math.min(g.w + dx, crCtx.W - g.x));
    if (cls.includes('s')) h = Math.max(24, Math.min(g.h + dy, crCtx.H - g.y));
    if (cls.includes('w')) { const nw2 = Math.max(24, Math.min(g.w - dx, g.x + g.w)); x = g.x + (g.w - nw2); w = nw2; }
    if (cls.includes('n')) { const nh2 = Math.max(24, Math.min(g.h - dy, g.y + g.h)); y = g.y + (g.h - nh2); h = nh2; }
    setCrRect(x, y, w, h);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const up = e2 => { if (e2.pointerId === pointerId) cleanup(); };
  const cancel = e2 => { if (e2.pointerId === pointerId) cleanup(); };
  window.addEventListener('pointermove', mv, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}));
$('crReset').onclick = () => {
  if (!crCtx) return;
  pushUndo();
  cropResizeFeature.resetCrop(editorStore.pages, crCtx.idxs);
  $('crOverlay').classList.remove('show');
  rebuildAll();
  toast('자르기 해제됨');
};
$('crOk').onclick = () => {
  if (!crCtx) return;
  const g = getCrRect();
  const frac = [g.x / crCtx.W, g.y / crCtx.H, g.w / crCtx.W, g.h / crCtx.H];
  const full = frac[0] <= 0.002 && frac[1] <= 0.002 && frac[2] >= 0.996 && frac[3] >= 0.996;
  pushUndo();
  if (full) cropResizeFeature.resetCrop(editorStore.pages, crCtx.idxs);
  else cropResizeFeature.applyCrop(editorStore.pages, crCtx.idxs, frac);
  $('crOverlay').classList.remove('show');
  rebuildAll();
  toast(full ? '전체 영역이 선택되어 자르지 않았습니다'
             : crCtx.idxs.length + '개 페이지 잘림 (저장 시 실제 반영)');
};

let imgCrCtx = null;  
function clampImgCrRect(x, y, w, h) {
  const { W, H } = imgCrCtx;
  const minW = Math.min(16, W), minH = Math.min(16, H);
  w = Math.max(minW, Math.min(Number.isFinite(w) ? w : W, W));
  h = Math.max(minH, Math.min(Number.isFinite(h) ? h : H, H));
  x = Math.max(0, Math.min(Number.isFinite(x) ? x : 0, W - w));
  y = Math.max(0, Math.min(Number.isFinite(y) ? y : 0, H - h));
  return { x, y, w, h };
}
function setImgCrRect(x, y, w, h) {
  if (!imgCrCtx) return;
  const g = clampImgCrRect(x, y, w, h);
  imgCrCtx.crop = [g.x / imgCrCtx.W, g.y / imgCrCtx.H, g.w / imgCrCtx.W, g.h / imgCrCtx.H];
  const r = $('imgCrRect');
  r.style.left = g.x + 'px'; r.style.top = g.y + 'px';
  r.style.width = g.w + 'px'; r.style.height = g.h + 'px';
}
function getImgCrRect() {
  if (!imgCrCtx) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = imgCrCtx.crop;
  return { x: x * imgCrCtx.W, y: y * imgCrCtx.H, w: w * imgCrCtx.W, h: h * imgCrCtx.H };
}
function closeImageCropDialog() {
  $('imgCrOverlay').classList.remove('show');
  imgCrCtx = null;
}
async function openImageCropDialog() {
  if (!selText || selText.obj.type !== 'img') { toast('자를 이미지 오브젝트를 선택하세요'); return; }
  const { k, obj } = selText, page = editorStore.pages[k];
  if (!page || !page.texts.includes(obj)) { toast('선택한 이미지를 찾을 수 없습니다'); return; }
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'));
      image.src = obj.data;
    });
  } catch (e) { toast(e.message); return; }
  if (!image.naturalWidth || !image.naturalHeight) { toast('이미지 크기를 확인할 수 없습니다'); return; }
  const fit = Math.min(660 / image.naturalWidth, 500 / image.naturalHeight, 2);
  const W = Math.max(1, Math.round(image.naturalWidth * fit));
  const H = Math.max(1, Math.round(image.naturalHeight * fit));
  imgCrCtx = {
    doc: editorStore.activeDocument, page, k, obj, objIndex: page.texts.indexOf(obj), dataAtOpen: obj.data,
    image, W, H, crop: [0, 0, 1, 1]
  };
  $('imgCrImage').src = obj.data;
  $('imgCrImage').style.width = W + 'px'; $('imgCrImage').style.height = H + 'px';
  $('imgCrStage').style.width = W + 'px'; $('imgCrStage').style.height = H + 'px';
  setImgCrRect(0, 0, W, H);
  $('imgCrOverlay').classList.add('show');
}
$('tbImgCrop').onclick = openImageCropDialog;
$('imgCrRect').addEventListener('mousedown', e => {
  if (e.target.classList.contains('imgCrH') || !imgCrCtx) return;
  e.preventDefault();
  const g = getImgCrRect(), sx = e.clientX, sy = e.clientY;
  const mv = e2 => setImgCrRect(g.x + e2.clientX - sx, g.y + e2.clientY - sy, g.w, g.h);
  const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
});
document.querySelectorAll('.imgCrH').forEach(hd => hd.addEventListener('mousedown', e => {
  if (!imgCrCtx) return;
  e.preventDefault(); e.stopPropagation();
  const cls = [...hd.classList].find(c => ['nw', 'ne', 'se', 'sw'].includes(c));
  const g = getImgCrRect(), sx = e.clientX, sy = e.clientY;
  const mv = e2 => {
    const dx = e2.clientX - sx, dy = e2.clientY - sy;
    let { x, y, w, h } = g;
    if (cls.includes('e')) w = Math.max(Math.min(16, imgCrCtx.W), Math.min(g.w + dx, imgCrCtx.W - g.x));
    if (cls.includes('s')) h = Math.max(Math.min(16, imgCrCtx.H), Math.min(g.h + dy, imgCrCtx.H - g.y));
    if (cls.includes('w')) { x = g.x + dx; w = g.w - dx; }
    if (cls.includes('n')) { y = g.y + dy; h = g.h - dy; }
    if (cls.includes('w')) {
      const right = g.x + g.w, minW = Math.min(16, imgCrCtx.W);
      x = Math.max(0, Math.min(x, right - minW)); w = right - x;
    }
    if (cls.includes('n')) {
      const bottom = g.y + g.h, minH = Math.min(16, imgCrCtx.H);
      y = Math.max(0, Math.min(y, bottom - minH)); h = bottom - y;
    }
    setImgCrRect(x, y, w, h);
  };
  const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}));
function canvasToLosslessDataUrl(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('자른 이미지를 만들 수 없습니다')); return; }
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result));
    rd.onerror = () => reject(new Error('자른 이미지를 읽을 수 없습니다'));
    rd.readAsDataURL(blob);
  }, 'image/png'));
}
$('imgCrOk').onclick = async () => {
  const ctx = imgCrCtx;
  if (!ctx) return;
  const { k, obj, image } = ctx;
  if (editorStore.activeDocument !== ctx.doc || editorStore.pages[k] !== ctx.page || ctx.page.texts[ctx.objIndex] !== obj || obj.data !== ctx.dataAtOpen) {
    closeImageCropDialog(); toast('문서 상태가 변경되어 자르기를 취소했습니다', 3500); return;
  }
  const g = getImgCrRect(), nw = image.naturalWidth, nh = image.naturalHeight;
  const x1 = Math.max(0, Math.min(nw - 1, Math.floor(g.x / ctx.W * nw)));
  const y1 = Math.max(0, Math.min(nh - 1, Math.floor(g.y / ctx.H * nh)));
  const x2 = Math.max(x1 + 1, Math.min(nw, Math.ceil((g.x + g.w) / ctx.W * nw)));
  const y2 = Math.max(y1 + 1, Math.min(nh, Math.ceil((g.y + g.h) / ctx.H * nh)));
  if (x1 === 0 && y1 === 0 && x2 === nw && y2 === nh) {
    closeImageCropDialog(); toast('전체 이미지가 선택되어 변경하지 않았습니다'); return;
  }
  const sw = x2 - x1, sh = y2 - y1;
  const crop = [x1 / nw, y1 / nh, sw / nw, sh / nh];  
  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = sh;
  const c2 = canvas.getContext('2d');
  if (!c2) { toast('이미지 처리 기능을 사용할 수 없습니다'); return; }
  c2.drawImage(image, x1, y1, sw, sh, 0, 0, sw, sh);
  const ok = $('imgCrOk'); ok.disabled = true;
  let croppedData;
  try { croppedData = await canvasToLosslessDataUrl(canvas); }
  catch (e) { toast(e.message || String(e), 4000); return; }
  finally { ok.disabled = false; }
  if (imgCrCtx !== ctx || editorStore.activeDocument !== ctx.doc || editorStore.pages[k] !== ctx.page ||
      ctx.page.texts[ctx.objIndex] !== obj || obj.data !== ctx.dataAtOpen) return;
  const wrap = document.getElementById('pg' + k);
  if (!wrap || !wrap.clientWidth || !wrap.clientHeight) {
    closeImageCropDialog(); toast('페이지 표시 상태가 변경되어 자르기를 취소했습니다', 3500); return;
  }
  const snap = makeSnap(), oldData = obj.data;
  obj.data = croppedData;  
  const pageW = wrap.clientWidth, pageH = wrap.clientHeight;
  cropResizeFeature.cropImageObject(obj, crop, pageW, pageH);
  if (obj.clipBox?.length === 4) {
    obj.clipBox = regionPdfBounds({}, obj.clipBox, obj.clipRotation || 0, ...crop);
    if (obj.clipErasures) obj.clipErasures = cropFragmentStrokes(obj.clipErasures, crop);
  }
  imgElCache.delete(oldData);  
  pushSnap(snap);
  closeImageCropDialog();
  if (wrap) {
    positionMarks(wrap, editorStore.pages[k]);
    const mark = [...wrap.querySelectorAll('.obj')][editorStore.pages[k].texts.indexOf(obj)];
    if (mark) selectMark(k, obj, mark);
  }
  scheduleThumbRefresh(k);
  toast('이미지 자르기 적용됨 (Ctrl+Z로 복구 가능)');
};

const ctxMenu = $('ctxMenu');
let pageMenuContext = null;
async function readClipboardMenuKind() {
  if (!await waitForClipboardCopy()) return null;
  if (desktopViewMode) {
    const record = await requestShellClipboard({ withMetadata: true, metadataOnly: true });
    return record?.meta?.kind === 'pages-v1' ? 'pages' : record?.meta?.kind === 'object-v1' ? 'object' : null;
  }
  return (webClipboardBroker.latest() || await webClipboardBroker.get())?.kind || null;
}
const contextPasteState = createContextPasteState({ readKind: readClipboardMenuKind });
function showPageContextMenu(k, clientX, clientY, target = null) {
  if (!editorStore.pages[k]) return;
  if (target || !editorStore.selectedPages.has(k)) {
    editorStore.selectedPages.clear();
    editorStore.selectedPages.add(k);
    editorStore.lastSelected = k;
    refreshThumbSelection();
  }
  const context = { k, target, document: editorStore.activeDocument, page: editorStore.pages[k] };
  pageMenuContext = context;
  $('objMenu').style.display = 'none';
  positionContextMenu(ctxMenu, clientX, clientY);
  contextPasteState.refresh(ctxMenu, ctxMenu.querySelector('[data-cmd="paste"]'),
    target ? ['object', 'pages'] : ['pages'], () =>
      pageMenuContext === context && context.document === editorStore.activeDocument &&
      context.page === editorStore.pages[k] && !activeDocLocked());
}
function showThumbContextMenu(t, clientX, clientY) {
  showPageContextMenu(+t.dataset.k, clientX, clientY);
}
sidebar.addEventListener('contextmenu', e => {
  const t = e.target.closest('.thumb');
  if (!t) return;
  e.preventDefault();
  showThumbContextMenu(t, e.clientX, e.clientY);
});
async function pasteFromPageContext(context) {
  if (!context?.target || !await waitForClipboardCopy() ||
      !validObjectPasteTarget(context.k, context.target) || activeDocLocked()) return false;
  const finishBusy = beginClipboardBusy('클립보드 붙여넣는 중...');
  try {
    if (desktopViewMode) return await pasteLatestShellClipboard(context.k, context.target);
    return await pasteLatestWebClipboard(context.k, context.target);
  } catch (error) {
    console.error(error);
    toast('붙여넣기 실패: ' + String(error?.message || error).slice(0, 80), 4200);
  } finally { finishBusy(); }
}
window.addEventListener('click', () => {
  ['ctxMenu', 'tabMenu', 'shapeMenu', 'objMenu'].forEach(id => $(id).style.display = 'none');
  closeTabList();
});
window.addEventListener('blur', () => {
  ['ctxMenu', 'tabMenu', 'shapeMenu', 'objMenu'].forEach(id => $(id).style.display = 'none');
  closeTabList();
});
ctxMenu.addEventListener('click', e => {
  const mi = e.target.closest('.mi');
  if (!mi || mi.classList.contains('dim')) return;
  if (!pageMenuContext || pageMenuContext.document !== editorStore.activeDocument ||
      pageMenuContext.page !== editorStore.pages[pageMenuContext.k]) return;
  ctxMenu.style.display = 'none';
  if (activeDocLocked() && !['copy', 'printSel'].includes(mi.dataset.cmd)) {
    lockNotice();
    return;
  }
  const idxs = [...editorStore.selectedPages].sort((a, b) => a - b);
  switch (mi.dataset.cmd) {
    case 'rotL': rotate(-90); break;
    case 'rotR': rotate(90); break;
    case 'resize': openSizeDialog(); break;
    case 'crop': openCropDialog(); break;
    case 'exportDlg': openExportDialog(); break;
    case 'dupImg': duplicateAsImage(idxs); break;
    case 'printSel': openPrintDialog(true); break;
    case 'copy': copyPagesToClip(false); break;
    case 'cut': copyPagesToClip(true); break;
    case 'paste': pageMenuContext.target ? pasteFromPageContext(pageMenuContext) : pastePagesFromAvailable(); break;
    case 'blank': addBlank(); break;
    case 'del': deletePages(); break;
  }
});

const editorDocumentTools = createEditorDocumentTools({
  hasCurrentFile: () => editorStore.pages.length > 0,
  prepareSelectedFile(file) { requireWindowsNewWork({ throwOnBlocked: true }); return file; },
  async getCurrentFile() {
    if (!editorStore.pages.length) return null;
    commitPendingNudge();
    const name = (editorStore.documentName || 'document').replace(/\.pdf$/i, '') + '.pdf';
    let bytes;
    if (activeDocLocked()) {
      const raster = await makeRasterSource(editorStore.pages.map((_, index) => index));
      bytes = raster.bytes; await raster.doc.loadingTask.destroy();
    } else bytes = await buildPdf(editorStore.pages.map(clonePage));
    return new File([bytes], name, { type: 'application/pdf' });
  },
  async save(bytes, type, name) {
    if (desktopViewMode) return desktopOutput.save(bytes, name);
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  },
  async openPdf(file, saved) {
    if (desktopViewMode) return desktopOutput.openSaved(saved.requestId);
    const existing = new Set(editorStore.documents);
    await openFiles([file], false);
    return editorStore.documents.some(document => !existing.has(document));
  },
  notify: message => toast(message, 4000),
  loadRuntime: () => import('/assets/editor-tools/runtime.js?v=' + encodeURIComponent(document.querySelector('meta[name="pdf-editor-version"]')?.content || 'dev')),
});
$('btnDocumentTools').onclick = () => editorDocumentTools.open();
const editorSecurity = createEditorSecurity({
  hasCurrentFile: () => editorStore.pages.length > 0,
  prepareSelectedFile(file) { requireWindowsNewWork({ throwOnBlocked: true }); return file; },
  async getCurrentFile(mode) {
    if (!editorStore.pages.length) return null;
    if (activeDocLocked()) {
      if (mode !== 'unlock') throw new Error('기존 암호를 먼저 해제하세요.');
      const ids = new Set(editorStore.pages.map(page => page.src).filter(Boolean));
      if (ids.size !== 1) throw new Error('암호가 걸린 원본 PDF를 별도 탭에서 열어 해제하세요.');
      const source = sources.get([...ids][0]);
      return new File([source.bytes], source.name || 'document.pdf', { type: 'application/pdf' });
    }
    commitPendingNudge();
    return new File([await buildPdf(editorStore.pages.map(clonePage))], (editorStore.documentName || 'document') + '.pdf', { type: 'application/pdf' });
  },
  save: (bytes, name) => desktopOutput.save(bytes, name),
  loadRuntime: () => import('/assets/editor-tools/security.js?v=' + encodeURIComponent(document.querySelector('meta[name="pdf-editor-version"]')?.content || 'dev')),
});
$('btnPdfLock').onclick = () => editorSecurity.open('lock');
$('btnPdfUnlock').onclick = () => editorSecurity.open('unlock');

function openExportDialog() {
  if (!editorStore.selectedPages.size) { toast('내보낼 페이지를 썸네일에서 선택하세요'); return; }
  $('exDel').checked = false;
  $('exCount').textContent = '— ' + editorStore.selectedPages.size + '개 페이지';
  $('exOverlay').classList.add('show');
}
async function exportSelectedPages(fmt) {
  if (fmt !== 'img' && fmt !== 'pdf') return;
  const idxs = [...editorStore.selectedPages].sort((a, b) => a - b);
  if (!idxs.length) { $('exOverlay').classList.remove('show'); return; }
  const del = $('exDel').checked;
  $('exOverlay').classList.remove('show');
  if (desktopViewMode) {
    spin(true, '새 탭 준비 중...');
    try {
      let packet;
      if (fmt === 'img') {
        const targetDoc = editorStore.activeDocument, targetPages = editorStore.pages;
        const rs = await makeRasterSource(idxs, { openDocument: false });
        if (editorStore.activeDocument !== targetDoc || editorStore.pages !== targetPages) {
          throw new Error('작업 중 문서가 변경되어 결과를 적용하지 않았습니다');
        }
        const mapping = {};
        const pages = imageHandlingFeature.rasterPages(null, idxs.length).map((page, index) => {
          const key = 'raster:' + index; mapping[key] = index;
          return { ...page, __sourceRef: key };
        });
        packet = packShellClipboardPayload({ pages, mapping, pdfBytes: rs.bytes });
      } else {
        packet = await serializePageListForClipboard(idxs.map(index => editorStore.pages[index]));
      }
      await syncClipMarker(CLIP_PAGES);
      await putShellClipboard(packet, {
        kind: 'pages-v1', count: idxs.length, operation: 'copy',
        purpose: 'open-native-document', sourceTab: desktopTabToken,
        sourceDocument: editorStore.documentName,
      });
      if (del) {
        if (idxs.length >= editorStore.pages.length) {
          toast('모든 페이지를 삭제할 수는 없어 삭제는 생략했습니다', 3000);
        } else {
          pushUndo();
          const result = pageOrganizer.remove(editorStore.pages, editorStore.selectedPages);
          editorStore.pages = result.pages;
          editorStore.selectedPages = result.selectedIndexes;
          rebuildAll();
        }
      }
      desktopHost.send({
        type: 'request-new-from-clipboard', apiVersion: 4,
        title: editorStore.documentName + (fmt === 'img' ? '_이미지' : '_추출'),
      });
      scheduleSrcSweep();
    } catch (error) {
      console.error(error);
      toast('새 탭 준비 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    } finally { spin(false); }
    return;
  }
  let newTab = null;
  if (fmt === 'img') {
    const targetDoc = editorStore.activeDocument, targetPages = editorStore.pages;
    spin(true, '이미지 형식으로 내보내는 중...');
    try {
      const rs = await makeRasterSource(idxs);
      if (editorStore.activeDocument !== targetDoc || editorStore.pages !== targetPages) {
        try { rs.doc.destroy(); } catch {}
        throw new Error('작업 중 문서가 변경되어 결과를 적용하지 않았습니다');
      }
      const sourceId = ++srcSeq;
      sources.set(sourceId, { bytes: rs.bytes, doc: rs.doc, name: editorStore.documentName + '_이미지.pdf' });
      newTab = newDoc(editorStore.documentName + '_이미지');
      newTab.srcIds.push(sourceId);
      newTab.pages = imageHandlingFeature.rasterPages(sourceId, idxs.length);
      markChanged(newTab);
      editorStore.documents.push(newTab);
    } catch (e) {
      console.error(e);
      toast('내보내기 실패: ' + (e.message || e).toString().slice(0, 60), 3500);
      return;
    } finally { spin(false); }
  } else {
    newTab = newDoc(editorStore.documentName + '_추출');
    newTab.pages = pageOrganizer.copy(editorStore.pages, idxs)
      .map(page => rekeyPageConnections(page, createConnectorId));
    markChanged(newTab);
    editorStore.documents.push(newTab);
  }
  if (del) {
    if (idxs.length >= editorStore.pages.length) toast('모든 페이지를 삭제할 수는 없어 삭제는 생략했습니다', 3000);
    else {
      pushUndo();
      const result = pageOrganizer.remove(editorStore.pages, editorStore.selectedPages);
      editorStore.pages = result.pages;
      editorStore.selectedPages = result.selectedIndexes;
      rebuildAll();
    }
  }
  if (newTab) {
    switchDoc(newTab);    
    renderTabs();
  }
}
$('exImage').onclick = () => exportSelectedPages('img');
$('exPdf').onclick = () => exportSelectedPages('pdf');

function toggleThumbs() { sidebar.classList.toggle('hidden'); }
function updateThumbsTooltip() { $('btnThumbs').title = '썸네일 (' + comboStr(keymap.thumbs) + ')'; }
updateThumbsTooltip();
updateBtnTitles();

let panelW = +(settings.get('panelW') || 236);
const panelMin = () => isMobileLayout() ? 120 : 96;
const panelMax = () => isMobileLayout()
  ? Math.min(360, Math.round(window.innerWidth * .84)) : Math.round(window.innerWidth * .7);
const sideGrip = $('sideGrip');
function syncPanelWidth(width) {
  panelW = Math.min(panelMax(), Math.max(panelMin(), width));
  document.documentElement.style.setProperty('--panelw', panelW + 'px');
  sideGrip.setAttribute('aria-valuemin', panelMin());
  sideGrip.setAttribute('aria-valuemax', panelMax());
  sideGrip.setAttribute('aria-valuenow', Math.round(panelW));
}
function finishPanelResize() {
  settings.set('panelW', panelW);
  if (!isMobileLayout() && editorStore.fitWidth) doFitWidth();
}
syncPanelWidth(panelW);
let gripDrag = null;
sideGrip.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || gripDrag) return;
  event.preventDefault();
  gripDrag = { id: event.pointerId, x: event.clientX, w: sidebar.getBoundingClientRect().width };
  sideGrip.classList.add('dragging');
  sideGrip.setPointerCapture(event.pointerId);
});
sideGrip.addEventListener('pointermove', event => {
  if (!gripDrag || event.pointerId !== gripDrag.id) return;
  event.preventDefault();
  syncPanelWidth(gripDrag.w + event.clientX - gripDrag.x);
});
const endPanelResize = event => {
  if (!gripDrag || event.pointerId !== gripDrag.id) return;
  gripDrag = null;
  sideGrip.classList.remove('dragging');
  if (sideGrip.hasPointerCapture(event.pointerId)) sideGrip.releasePointerCapture(event.pointerId);
  finishPanelResize();
};
sideGrip.addEventListener('pointerup', endPanelResize);
sideGrip.addEventListener('pointercancel', endPanelResize);
sideGrip.addEventListener('lostpointercapture', endPanelResize);
sideGrip.addEventListener('focus', () => syncPanelWidth(panelW));
sideGrip.addEventListener('keydown', event => {
  const widths = { ArrowLeft: panelW - 12, ArrowRight: panelW + 12, Home: panelMin(), End: panelMax() };
  if (!(event.key in widths)) return;
  event.preventDefault(); event.stopPropagation();
  syncPanelWidth(widths[event.key]); finishPanelResize();
});

function setThumbWidth(value) {
  thumbW = Math.min(THUMB_DISPLAY_MAX, Math.max(THUMB_DISPLAY_MIN, Math.round(value)));
  document.documentElement.style.setProperty('--thumbw', thumbW + 'px');
  settings.set('thumbW', thumbW);
}
function thumbnailPanelWidth(columns, width = thumbW) {
  const padding = 16, columnGap = 8, scrollbarRoom = columns === 1 ? 8 : 24;
  const wanted = columns * width + Math.max(0, columns - 1) * columnGap + padding + scrollbarRoom;
  return Math.min(panelMax(), Math.max(96, Math.ceil(wanted)));
}
function rememberThumbnailView() {
  if (!isMobileLayout() && editorStore.activeDocument)
    documentThumbnailViews.set(editorStore.activeDocument, { thumbW, panelW });
}
function restoreThumbnailView(doc) {
  if (isMobileLayout()) return;
  const saved = documentThumbnailViews.get(doc);
  thumbW = saved?.thumbW ?? initialThumbW;
  panelW = saved ? Math.min(panelMax(), Math.max(96, saved.panelW)) : thumbnailPanelWidth(1, thumbW);
  document.documentElement.style.setProperty('--thumbw', thumbW + 'px');
  document.documentElement.style.setProperty('--panelw', panelW + 'px');
}
function setThumbnailColumns(columns) {
  panelW = thumbnailPanelWidth(columns);
  document.documentElement.style.setProperty('--panelw', panelW + 'px');
  settings.set('panelW', panelW);
  if (editorStore.fitWidth) doFitWidth();
}

sidebar.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setThumbWidth(thumbW + (e.deltaY < 0 ? 12 : -12));  
}, { passive: false });

let pendingKeys = {};
const KEY_LABELS = {
  thumbs: '썸네일 패널', thumb1: '썸네일 1열', thumb2: '썸네일 2열', thumb3: '썸네일 3열',
  fitWidth: '폭 맞춤',
  actualSize: '100%로 보기',
  save: '저장', saveAs: '다른 이름으로 저장', print: '인쇄', undo: '실행 취소', redo: '다시 실행',
  rotL: '왼쪽 회전', rotR: '오른쪽 회전', closeTab: '탭 닫기', editMode: '편집 모드',
  addText: '텍스트 추가', draw: '그리기', shapeCircle: '타원 그리기', shapeRect: '사각형 그리기',
  connectArrow: '연결 화살표', regionCopy: '범위 복사', multiPick: '다중 선택'
};
function fillKeycaps(map) {
  document.querySelectorAll('.keycap').forEach(inp => {
    const combo = map[inp.dataset.act];
    inp.value = combo ? comboStr(combo) : '';
  });
}
function keyConflictGroups(map) {
  const grouped = new Map();
  for (const [act, combo] of Object.entries(map)) {
    if (!KEY_LABELS[act] || !combo) continue;
    const key = comboStr(combo);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(act);
  }
  return [...grouped.entries()].filter(([, acts]) => acts.length > 1);
}
function updateKeyConflicts() {
  document.querySelectorAll('.shortcutItem').forEach(item => {
    item.classList.remove('conflict');
    const msg = item.querySelector('.keyConflict');
    if (msg) msg.textContent = '';
  });
  const groups = keyConflictGroups(pendingKeys);
  for (const [combo, acts] of groups) {
    for (const act of acts) {
      const item = document.querySelector(`.shortcutItem[data-act="${act}"]`);
      if (!item) continue;
      item.classList.add('conflict');
      const others = acts.filter(a => a !== act).map(a => KEY_LABELS[a]);
      item.querySelector('.keyConflict').textContent = `${combo} — ${others.join(', ')}과 중복`;
    }
  }
  $('setKeyConflictSummary').textContent = groups.map(([combo, acts]) =>
    `⚠ ${combo}: ${acts.map(a => KEY_LABELS[a]).join(' ↔ ')}`).join('\n');
  $('setSave').disabled = groups.length > 0;
  return groups;
}
function switchSettingsPane(name) {
  document.querySelectorAll('.setNavBtn[data-set-pane]').forEach(b => b.classList.toggle('active', b.dataset.setPane === name));
  document.querySelectorAll('.setPane').forEach(p => p.classList.toggle('active', p.dataset.setPane === name));
  const shortcuts = name === 'shortcuts';
  const licenses = name === 'licenses';
  $('setReset').hidden = !shortcuts;
  $('setSave').hidden = licenses;
  $('setCancel').textContent = shortcuts ? '취소' : '닫기';
}
document.querySelectorAll('.setNavBtn[data-set-pane]').forEach(b => b.onclick = () => switchSettingsPane(b.dataset.setPane));
function syncThemeOpts() {
  $('setGlassEffect').checked = glassEffect;
  document.querySelectorAll('.themeOpt').forEach(o => {
    const selected = o.dataset.theme === theme;
    o.classList.toggle('sel', selected);
    o.setAttribute('aria-pressed', String(selected));
  });
}
document.querySelectorAll('.themeOpt').forEach(o => {
  o.onclick = () => {
    theme = o.dataset.theme;
    settings.set('theme', theme);
    applyTheme();
    syncThemeOpts();
  };
});
$('setGlassEffect').addEventListener('change', () => {
  glassEffect = $('setGlassEffect').checked;
  settings.set('glassEffect', glassEffect ? '1' : '0');
  applyTheme();
});
const DEFAULT_DUP_Q = '4.1667|image/png|1';  
const LEGACY_DUP_Q = '2|image/jpeg|0.92';
let savedDupQ = settings.get('dupQ');
if (!savedDupQ || savedDupQ === LEGACY_DUP_Q) {
  savedDupQ = DEFAULT_DUP_Q;
  settings.set('dupQ', savedDupQ);
}
$('setDupQ').value = savedDupQ;
if (!$('setDupQ').value) $('setDupQ').value = DEFAULT_DUP_Q;  
$('setDupQ').addEventListener('change', () =>
  settings.set('dupQ', $('setDupQ').value));
async function refreshRecoveryInfo() {
  const el = $('setRecInfo');
  if (!el) return;
  try {
    const keys = await idbKeys();
    if (!keys.length) { el.textContent = '저장된 복구 데이터 없음'; return; }
    let bytes = 0, docCount = 0, when = 0;
    for (const k of keys) {
      if (String(k) !== autosaveSessionKey && !String(k).startsWith(autosaveSrcPrefix)) continue;
      const v = await idbGet(k);
      if (!v) continue;
      if (String(k) === autosaveSessionKey) {
        docCount = (v.docs || []).length;
        when = v.t || 0;
      } else if (v.bytes) bytes += v.bytes.byteLength || v.bytes.length || 0;
    }
    const mb = bytes / 1048576;
    const size = mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
    const t = when ? new Date(when).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    el.textContent = `${docCount}개 문서 · ${size}${t ? ' · ' + t : ''}`;
  } catch { el.textContent = '확인 실패'; }
}
function formatCacheBytes(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
async function refreshFontCacheInfo() {
  const el = $('setFontCacheInfo');
  if (!el) return;
  const english = document.documentElement.lang === 'en';
  try {
    const info = await fontRegistry.persistentStats();
    if (!info.count) {
      el.textContent = english ? 'No saved document fonts' : '저장된 문서 글꼴 없음';
      return;
    }
    const persistent = navigator.storage?.persisted
      ? await navigator.storage.persisted().catch(() => false)
      : false;
    el.textContent = english
      ? `${info.count} fonts · ${formatCacheBytes(info.bytes)}${persistent ? ' · protected storage' : ''}`
      : `${info.count}개 글꼴 · ${formatCacheBytes(info.bytes)}${persistent ? ' · 보호 저장소' : ''}`;
  } catch {
    el.textContent = english ? 'Could not check font cache' : '글꼴 캐시 확인 실패';
  }
}
$('setRecDel').onclick = async () => {
  const open = editorStore.documents.length;
  if (!confirm(open
    ? `저장된 복구 데이터를 삭제합니다.\n열려 있는 문서 ${open}개는 그대로 유지되지만,\n지금 브라우저가 닫히면 복구할 수 없습니다.\n\n삭제할까요?`
    : '저장된 복구 데이터를 삭제할까요?')) return;
  try {
    await clearAutosave();
    autosavePending = false;
    await refreshRecoveryInfo();
    toast('복구 데이터를 삭제했습니다');
  } catch (e) {
    console.error(e);
    toast('삭제 실패: ' + (e.message || e).toString().slice(0, 60), 3500);
  }
};
$('setFontCacheDel').onclick = async () => {
  const english = document.documentElement.lang === 'en';
  if (!confirm(english
    ? 'Delete saved document fonts from this device? Fonts already in use stay available until the app closes and will be downloaded again when needed.'
    : '이 기기에 저장된 문서 글꼴 캐시를 삭제할까요?\n현재 사용 중인 글꼴은 앱을 닫을 때까지 유지되며, 다음에 필요할 때 다시 다운로드합니다.')) return;
  try {
    await fontRegistry.clearPersistentCache();
    await refreshFontCacheInfo();
    toast(english ? 'Font cache deleted' : '글꼴 캐시를 삭제했습니다');
  } catch (error) {
    console.error(error);
    toast(english ? 'Could not delete font cache' : '글꼴 캐시를 삭제하지 못했습니다', 3500);
  }
};
$('setRecOpen').hidden = !desktopViewMode;
$('setRecOpen').onclick = () => {
  if (!desktopViewMode || !desktopHost.send({
    type: 'open-recovery-folder', apiVersion: 4,
  })) toast('임시저장 폴더는 Windows 버전에서 열 수 있습니다', 3200);
};
$('setStartupMode').value = startupMode;
$('setStartupMode').addEventListener('change', async () => {
  startupMode = $('setStartupMode').value;
  autosaveEnabled = startupMode === 'resume';
  settings.set('startupMode', startupMode);
  settings.set('autosave', autosaveEnabled ? '1' : '0');
  desktopHost.send({ type: 'recovery-policy', apiVersion: 4, enabled: autosaveEnabled });
  if (startupMode === 'blank') {
    clearTimeout(autosaveTimer);
    autosavePending = false;
    await clearAutosave();
    await refreshRecoveryInfo();
    toast('전부 닫기 — 작업물을 임시 저장하지 않으며, 저장된 복구 데이터도 삭제했습니다', 4000);
  } else {
    scheduleAutosave();
    toast('다음 실행 때 열려 있는 PDF를 모두 자동으로 엽니다', 3500);
  }
});

$('setUpdateGroup').hidden = !desktopViewMode;
$('setAutoUpdate').onchange = () => {
  $('setAutoUpdate').disabled = true;
  desktopHost.send({ type: 'update-toggle', apiVersion: 4, enabled: $('setAutoUpdate').checked });
};
$('setUpdateCheck').onclick = () => desktopHost.send({ type: 'update-check', apiVersion: 4 });
function showUpdateState(state) {
  const messages = { off: '꺼짐', checking: '새 버전 확인 중…', downloading: '설치 파일 다운로드 중…',
    current: '사용 가능한 새 버전이 없습니다.', ready: '다운로드 완료 · 앱을 닫으면 설치합니다.',
    failed: '업데이트를 확인하지 못했습니다. 다시 시도하세요.' };
  $('setAutoUpdate').disabled = !state.available;
  $('setAutoUpdate').checked = state.enabled === true;
  $('setUpdateCheck').hidden = !state.enabled;
  $('setUpdateCheck').disabled = ['checking', 'downloading'].includes(state.status);
  $('setUpdateStatus').textContent = (state.status === 'ready' ? state.version + ' · ' : '') + uiText(
    state.available ? messages[state.status] || '' : '설치본에서 사용할 수 있습니다.');
}
function openSettingsDialog() {
  if (desktopViewMode) desktopHost.send({ type: 'update-state', apiVersion: 4 });
  pendingKeys = JSON.parse(JSON.stringify(keymap));
  fillKeycaps(pendingKeys);
  updateKeyConflicts();
  syncThemeOpts();
  $('setStartupMode').value = startupMode;
  refreshRecoveryInfo();
  refreshFontCacheInfo();
  switchSettingsPane('general');
  $('setOverlay').classList.add('show');
}
document.querySelectorAll('.keycap').forEach(inp => {
  inp.addEventListener('keydown', e => {
    e.preventDefault(); e.stopPropagation();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') { e.target.blur(); return; }
    const combo = { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
    if (RESERVED_COMBOS.includes(comboStr(combo))) {
      toast('⚠ ' + comboStr(combo) + ' 은(는) 브라우저 전용 단축키라 사용할 수 없습니다', 3200);
      return;
    }
    pendingKeys[inp.dataset.act] = combo;
    inp.value = comboStr(combo);
    updateKeyConflicts();
  });
});
$('setReset').onclick = () => {
  pendingKeys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  fillKeycaps(pendingKeys);
  updateKeyConflicts();
};
$('setSave').onclick = () => {
  const pane = document.querySelector('.setNavBtn.active')?.dataset.setPane || 'general';
  if (pane !== 'shortcuts') {
    $('setOverlay').classList.remove('show');
    toast('설정 저장됨');
    return;
  }
  const conflicts = updateKeyConflicts();
  if (conflicts.length) { switchSettingsPane('shortcuts'); toast('⚠ 표시된 중복 단축키를 먼저 변경하세요'); return; }
  keymap = pendingKeys;
  settings.set('keymap', JSON.stringify(keymap));
  updateThumbsTooltip();
  updateBtnTitles();  
  $('setOverlay').classList.remove('show');
  toast('단축키 저장됨');
};
function setTextMode(on) {
  if (on) stopDrawing();
  if (on && activeDocLocked()) { lockNotice(); return; }
  if (on && origMode) setOrigMode(false);
  if (on && typeof cancelRegion === 'function') cancelRegion();  
  if (on) stopConnectorPickMode();
  textMode = on;
  $('btnText').classList.toggle('active', on);
  viewer.querySelectorAll('.pageWrap').forEach(w => w.classList.toggle('textMode', on));
}
function toggleTextModeFromButton() {
  setTextMode(!textMode);
  if (textMode) toast('원하는 위치를 클릭해 텍스트를 추가하세요 (한 번 추가 후 자동 해제)');
}

function addObjAndSelect(k, obj) {
  const snap = makeSnap();
  editorStore.pages[k].texts.push(obj);
  pushSnap(snap);
  const wrap = document.getElementById('pg' + k);
  if (wrap) {
    positionMarks(wrap, editorStore.pages[k]);
    const m = [...wrap.querySelectorAll('.obj')].pop();
    if (m) selectMark(k, obj, m);
  }
  scheduleThumbRefresh(k);
}
function addImageObject(k, data, nw, nh, at) {
  const p = editorStore.pages[k];
  const pw = p._w1 || 595, ph = p._h1 || 842;
  const placement = imageHandlingFeature.fitObject(nw, nh, pw, ph, at);
  addObjAndSelect(k, {
    type: 'img', data,
    ...placement,
  });
}
let pasteAt = null;  
viewer.addEventListener('mousemove', e => {
  const wrap = e.target.closest('.pageWrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  pasteAt = {
    k: +wrap.dataset.k,
    fx: (e.clientX - r.left) / r.width,
    fy: (e.clientY - r.top) / r.height
  };
});
const CLIP_OBJ = '⁣pdfobj⁣', CLIP_PAGES = '⁣pdfpages⁣';
function syncClipMarker(marker, id = '') {
  const value = id ? marker + ':' + id : marker;
  try { return navigator.clipboard.writeText(value).catch(() => {}); }
  catch { return Promise.resolve(); }
}
function clipMarkerId(value, marker) {
  if (!value.startsWith(marker)) return null;
  const id = value.slice(marker.length).replace(/^:/, '');
  return /^[a-z0-9-]{8,100}$/i.test(id) ? id : '';
}
async function handleClipboardPaste(e) {
  if (!editorStore.pages.length) return;  
  const tg = e.target;
  if (tg instanceof Element && (tg.matches('input, textarea, select') || tg.isContentEditable)) return;
  if (!requireWindowsEdit()) { e.preventDefault(); return; }
  if (activeDocLocked()) { lockNotice(); return; }  
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  const imgIt = items.find(it => it.type.startsWith('image/'));
  const txt0 = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  const at = pasteAt && pasteAt.k < editorStore.pages.length ? pasteAt : null;
  const k = at ? at.k : Math.max(0, Math.min(editorStore.currentPage, editorStore.pages.length - 1));
  if (!imgIt && (!txt0 || txt0.startsWith(CLIP_OBJ) || txt0.startsWith(CLIP_PAGES))) {
    e.preventDefault();
    const target = captureObjectPasteTarget(k);
    const finishBusy = beginClipboardBusy('클립보드 붙여넣는 중...');
    try {
      if (!await waitForClipboardCopy()) return false;
      if (!validObjectPasteTarget(k, target)) return;
      if (desktopViewMode) await pasteLatestShellClipboard(k, target);
      else await pasteLatestWebClipboard(k, target);
    } catch (error) {
      console.error(error);
      toast('붙여넣기 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    } finally { finishBusy(); }
    return;
  }
  if (imgIt) {
    e.preventDefault();
    const blob = imgIt.getAsFile();
    if (!blob) return;
    const data = await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
    const [nw, nh] = await new Promise(res => {
      const im = new Image();
      im.onload = () => res([im.naturalWidth, im.naturalHeight]);
      im.onerror = () => res([300, 200]);
      im.src = data;
    });
    addImageObject(k, data, nw, nh, at);
    return;
  }
  const txt = txt0;
  if (txt && !txt.startsWith(CLIP_OBJ) && !txt.startsWith(CLIP_PAGES)) {  
    e.preventDefault();
    const p = editorStore.pages[k];
    const pageW = p._w1 || 595;
    addObjAndSelect(k, {
      fx: at ? Math.min(0.9, at.fx) : 0.3, fy: at ? Math.min(0.95, at.fy) : 0.42, text: txt,
      size: lastTextStyle.size || Math.max(12, Math.round(pageW / 35)),
      color: lastTextStyle.color, font: lastTextStyle.font, bold: lastTextStyle.bold,
      align: lastTextStyle.align, valign: lastTextStyle.valign, colorOp: lastTextStyle.colorOp
    });
  }
}

async function renderPageRegion(p, fx, fy, fw, fh, sc, transparent = false) {
  const size = await getViewport(p, 1), canvas = document.createElement('canvas');
  sc = Math.min(sc, 12000 / Math.max(1, fw * size.width), 12000 / Math.max(1, fh * size.height));
  if (!transparent) {
    const w = Math.max(1, Math.round(size.width * sc)), h = Math.max(1, Math.round(size.height * sc));
    const x = fx * w, y = fy * h, width = fw * w, height = fh * h;
    const left = Math.floor(x), top = Math.floor(y);
    const tile = document.createElement('canvas');
    try {
      await displayPainter.paintRegion(p, tile, sc, 1, { x: left / sc, y: top / sc,
        width: (Math.ceil(x + width) - left) / sc, height: (Math.ceil(y + height) - top) / sc });
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      canvas.getContext('2d').drawImage(tile, x - left, y - top, width, height, 0, 0, canvas.width, canvas.height);
    } finally { tile.width = tile.height = 0; }
    return canvas;
  }
  await paintRegion(p, canvas, sc, 1, { x: fx * size.width, y: fy * size.height,
    width: fw * size.width, height: fh * size.height }, null,
    { background: 'rgba(0,0,0,0)' });
  return canvas;
}

function regionCaptureScale(p, fw, fh) {
  const w1 = p._w1 || 595, h1 = p._h1 || 842;
  const regionLongEdge = Math.max(1, fw * w1, fh * h1);
  const adaptive = 1800 / regionLongEdge;
  return Math.min(8, Math.max(4, adaptive, editorStore.zoom * Math.min(window.devicePixelRatio || 1, 2)));
}

let multiPickMode = false;
function toggleMultiPick() {
  stopDrawing();
  if (!editorStore.pages.length) return;
  if (!multiPickMode && activeDocLocked()) { lockNotice(); return; }
  if (!multiPickMode) {  
    if (origMode) setOrigMode(false);
    cancelRegion();
    setTextMode(false);
    stopShapeDraft();
  }
  multiPickMode = !multiPickMode;
  document.body.classList.toggle('multiPick', multiPickMode);
  if (multiPickMode) toast('다중 선택 — 드래그로 오브젝트들을 묶어 선택하세요 (선택 후 자동 종료 · Esc 취소)');
}
viewer.addEventListener('mousedown', ev => {
  const additive = ev.shiftKey && !origMode && !shapeDraft && !regionMode && !stampData && !textMode &&
    !ev.target.closest('.obj,.objHandle,.origBox') && windowsAccess.current.canEditCurrentDocuments && !activeDocLocked();
  if ((!multiPickMode && !additive) || ev.button !== 0 || spacePan) return;
  const selectionDocument = editorStore.activeDocument;
  const previous = additive ? selectedObjectEntries().map(entry => entry.obj) : [];
  startPageMarquee({
    windowObject: window, viewer, event: ev,
    isActive: () => (multiPickMode || additive) && !spacePan && !activeDocLocked() &&
      editorStore.activeDocument === selectionDocument,
    onClick(wrap) {
      if (!additive) deselectText();
    },
    onSelect(wrap, { left: x0, right: x1, top: y0, bottom: y1 }) {
      const hits = wrap ? [...wrap.querySelectorAll('.obj')].filter(mark => {
        const r = mark.getBoundingClientRect();
        return mark._ctx?.obj && r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0;
      }) : [];
      origSquelchClick = true;
      setTimeout(() => origSquelchClick = false, 0);
      const picked = [...new Set([...previous.filter(o => wrap && editorStore.pages[+wrap.dataset.k].texts.includes(o)), ...hits.map(mark => mark._ctx.obj)])];
      deselectText();
      if (picked.length) {
        selectPastedObjectBundle(+wrap.dataset.k, picked, 0, wrap);
        toast(picked.length + '개 선택됨');
      } else toast('영역 안에 오브젝트가 없습니다');
      multiPickMode = false;  
      document.body.classList.remove('multiPick');
    },
  });
}, true);

let regionMode = false, regionBox = null, regionK = -1, regionPage = null, regionSelection = null;
let regionBarFrame = 0;
function syncRegionUi() {
  document.body.classList.toggle('regionMode', regionMode || !!stampData);
  $('btnRegion').classList.toggle('active', regionMode || !!regionBox || !!stampData);
}
function hideRegionBar() {
  const bar = $('regionBar');
  bar.style.display = 'none';
  $('regionCopyCommit').disabled = false;
}
function positionRegionBar() {
  regionBarFrame = 0;
  if (!regionBox?.isConnected) { hideRegionBar(); return; }
  const bar = $('regionBar');
  bar.style.display = 'flex';
  const r = regionBox.getBoundingClientRect();
  const bw = bar.offsetWidth || 148, bh = bar.offsetHeight || 42;
  let x = r.left + (r.width - bw) / 2;
  let y = r.top - bh - 8;
  if (y < 44) y = r.bottom + 8;
  if (y + bh > window.innerHeight - 34) y = Math.max(44, window.innerHeight - bh - 40);
  x = Math.max(8, Math.min(x, window.innerWidth - bw - 8));
  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
}
function scheduleRegionBarPosition() {
  if (!regionBarFrame) regionBarFrame = requestAnimationFrame(positionRegionBar);
}
function rememberRegionRect(box, wrap) {
  const { width, height } = wrap.getBoundingClientRect();
  if (!width || !height) return;
  regionSelection = {
    fx: parseFloat(box.style.left) / width, fy: parseFloat(box.style.top) / height,
    fw: parseFloat(box.style.width) / width, fh: parseFloat(box.style.height) / height,
  };
}
function restoreRegionRect() {
  if (!regionBox || !regionSelection || !regionPage) return;
  const nextK = editorStore.pages.indexOf(regionPage);
  const wrap = nextK >= 0 ? document.getElementById('pg' + nextK) : null;
  if (!wrap) { discardRegionSelection(); return; }
  regionK = nextK;
  if (regionBox.parentElement !== wrap) wrap.appendChild(regionBox);
  const { width, height } = wrap.getBoundingClientRect();
  setRegionRect(regionBox, {
    x: regionSelection.fx * width,
    y: regionSelection.fy * height,
    w: regionSelection.fw * width,
    h: regionSelection.fh * height,
  });
  scheduleRegionBarPosition();
}
function discardRegionSelection() {
  regionMode = false;
  if (regionBox) regionBox.remove();
  regionBox = null;
  regionK = -1;
  regionPage = null;
  regionSelection = null;
  hideRegionBar();
  syncRegionUi();
}
function startRegionSelect() {
  stopDrawing();
  if (!editorStore.pages.length) return;
  if (activeDocLocked()) { lockNotice(); return; }
  cancelRegion();
  setTextMode(false);
  stopShapeDraft();
  stopConnectorPickMode();
  if (origMode) setOrigMode(false);
  deselectText();
  regionMode = true;
  syncRegionUi();
  toast(isMobileLayout()
    ? '화면을 눌러 선택 상자를 만든 뒤 크기를 조절하세요'
    : '복사할 범위를 드래그하세요 (Esc 취소)');
}
function cancelRegion() {
  discardRegionSelection();
  stampCancel();
  syncRegionUi();
}
function regionPointerAllowed(ev) {
  return regionMode && !spacePan && ev.isPrimary !== false &&
    (ev.pointerType !== 'mouse' || ev.button === 0);
}
function regionPointFromClient(bounds, clientX, clientY) {
  return [
    Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
    Math.max(0, Math.min(bounds.height, clientY - bounds.top)),
  ];
}
function setRegionRect(box, rect) {
  box.style.left = rect.x + 'px';
  box.style.top = rect.y + 'px';
  box.style.width = rect.w + 'px';
  box.style.height = rect.h + 'px';
}
viewer.addEventListener('pointerdown', ev => {
  if (!regionPointerAllowed(ev)) return;
  const wrap = ev.target.closest('.pageWrap');
  if (!wrap || ev.target.closest('.regionBox')) return;
  ev.preventDefault(); ev.stopPropagation();
  if (regionBox) { regionBox.remove(); regionBox = null; }
  regionK = +wrap.dataset.k;
  const r = wrap.getBoundingClientRect();
  const pointerId = ev.pointerId;
  const start = regionPointFromClient(r, ev.clientX, ev.clientY);
  const box = document.createElement('div');
  box.className = 'regionBox';
  wrap.appendChild(box);
  setRegionRect(box, { x: start[0], y: start[1], w: 1, h: 1 });
  let moved = false;
  const mv = e2 => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    if (Math.hypot(e2.clientX - ev.clientX, e2.clientY - ev.clientY) >= 6) moved = true;
    const end = regionPointFromClient(r, e2.clientX, e2.clientY);
    setRegionRect(box, cropSelectionRectFromPoints(start, end, r.width, r.height));
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const up = e2 => {
    if (e2.pointerId !== pointerId) return;
    if (moved) mv(e2);
    cleanup();
    const tapCreatesBox = ev.pointerType !== 'mouse' || isMobileLayout();
    if (!moved || box.offsetWidth < 8 || box.offsetHeight < 8) {
      if (!tapCreatesBox) { box.remove(); return; }
      setRegionRect(box, tappedCropSelectionRect(start, r.width, r.height));
    }
    regionBox = box;
    regionPage = editorStore.pages[regionK];
    regionMode = false;
    rememberRegionRect(box, wrap);
    regionDecorate(box, wrap);
    syncRegionUi();
    positionRegionBar();
    toast('범위를 조절한 뒤 [복사]를 누르세요');
  };
  const cancel = e2 => {
    if (e2.pointerId !== pointerId) return;
    cleanup();
    box.remove();
  };
  window.addEventListener('pointermove', mv, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}, { capture: true, passive: false });
function regionDecorate(box, wrap) {
  box.addEventListener('pointerdown', ev => {  
    if (ev.target.closest('.rh')) return;
    if (ev.isPrimary === false || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.preventDefault(); ev.stopPropagation();
    const pointerId = ev.pointerId;
    const bounds = wrap.getBoundingClientRect();
    const s = { x: ev.clientX, y: ev.clientY, l: parseFloat(box.style.left), t: parseFloat(box.style.top) };
    const mv = e2 => {
      if (e2.pointerId !== pointerId) return;
      e2.preventDefault();
      box.style.left = Math.max(0, Math.min(bounds.width - parseFloat(box.style.width), s.l + e2.clientX - s.x)) + 'px';
      box.style.top = Math.max(0, Math.min(bounds.height - parseFloat(box.style.height), s.t + e2.clientY - s.y)) + 'px';
      rememberRegionRect(box, wrap);
      scheduleRegionBarPosition();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const up = e2 => {
      if (e2.pointerId !== pointerId) return;
      rememberRegionRect(box, wrap);
      scheduleRegionBarPosition();
      cleanup();
    };
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, { passive: false });
  ['nw', 'ne', 'se', 'sw'].forEach(dir => {  
    const h = document.createElement('div');
    h.className = 'rh ' + dir;
    h.addEventListener('pointerdown', ev => {
      if (ev.isPrimary === false || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault(); ev.stopPropagation();
      const pointerId = ev.pointerId;
      const bounds = wrap.getBoundingClientRect();
      const s = { x: ev.clientX, y: ev.clientY, l: parseFloat(box.style.left), t: parseFloat(box.style.top), w: parseFloat(box.style.width), h: parseFloat(box.style.height) };
      const mv = e2 => {
        if (e2.pointerId !== pointerId) return;
        e2.preventDefault();
        const dx = e2.clientX - s.x, dy = e2.clientY - s.y;
        let l = s.l, t = s.t, w = s.w, hh = s.h;
        if (dir.includes('e')) w = Math.max(10, Math.min(bounds.width - s.l, s.w + dx));
        if (dir.includes('s')) hh = Math.max(10, Math.min(bounds.height - s.t, s.h + dy));
        if (dir.includes('w')) {
          l = Math.max(0, Math.min(s.l + s.w - 10, s.l + dx));
          w = s.l + s.w - l;
        }
        if (dir.includes('n')) {
          t = Math.max(0, Math.min(s.t + s.h - 10, s.t + dy));
          hh = s.t + s.h - t;
        }
        box.style.left = l + 'px'; box.style.top = t + 'px';
        box.style.width = w + 'px'; box.style.height = hh + 'px';
        rememberRegionRect(box, wrap);
        scheduleRegionBarPosition();
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      const up = e2 => {
        if (e2.pointerId !== pointerId) return;
        rememberRegionRect(box, wrap);
        scheduleRegionBarPosition();
        cleanup();
      };
      window.addEventListener('pointermove', mv, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }, { passive: false });
    box.appendChild(h);
  });
}
viewer.addEventListener('scroll', scheduleRegionBarPosition, { passive: true });
function svgFragmentMark(svg, object) {
  if (object.clipOpaque && sources.has(object.clipSrc)) {
    svg.dataset.pdfFragment = '';
    fragmentView.update(svg,object);
  } else {
    delete svg.dataset.pdfFragment;
    svg.firstElementChild.style.clipPath = '';
    svg.querySelector('foreignObject')?.remove();
  }
}

async function paintObjectClip(object, pixelsW, pixelsH, region = [0,0,1,1]) {
  const page = await sources.get(object.clipSrc).doc.getPage(object.clipIdx + 1);
  const angle = object.clipRotation || 0, vp = page.getViewport({ scale:1, rotation:angle });
  const box = pageRectToDispRect({}, page.view, angle, object.clipBox);
  const width = vp.width * box.w * region[2], height = vp.height * box.h * region[3];
  const scale = Math.min(Math.max(pixelsW/width, pixelsH/height), 16000/Math.max(width,height),
    Math.sqrt(32000000/(width*height)));
  const canvas = document.createElement('canvas');
  const painter = object.clipAlpha ? pagePainter : displayPainter;
  await painter.paintRegion({ src:object.clipSrc, idx:object.clipIdx, rot:angle-page.rotate, texts:[] },
    canvas, scale, 1, { x:(box.l+box.w*region[0])*vp.width, y:(box.t+box.h*region[1])*vp.height, width,height },
    null, object.clipAlpha ? {background:'rgba(0,0,0,0)'} : {});
  if (object.clipErasures) applyFragmentStrokes(canvas, object.clipErasures, region);
  return canvas;
}

async function drawOutputObjects(page, canvas, pageWidth) {
  const isClip = object => object.clipOpaque && sources.has(object.clipSrc) && object.fw && object.fh;
  if (!page.texts.some(isClip)) {
    outputOverlayRenderer.drawObjects(page, canvas, pageWidth);
    return;
  }
  for (const object of page.texts) {
    const layer = { texts: [object] };
    if (!isClip(object)) {
      outputOverlayRenderer.drawObjects(layer, canvas, pageWidth);
      continue;
    }
    const image = await paintObjectClip(object, canvas.width * object.fw, canvas.height * object.fh);
    try { outputOverlayRenderer.drawObjects(layer, canvas, pageWidth, { image }); }
    finally { image.width = image.height = 0; }
  }
}

function wholeVisibleFragment(object) {
  const size = sources.get(object.clipSrc)?.visibleSize;
  const [left,bottom,right,top] = object.clipBox;
  return size && !object.clipIdx && !object.clipRotation && !object.clipErasures?.length &&
    left === 0 && bottom === 0 && right === size[0] && top === size[1];
}

async function visibleFragmentPdf(object, makePreview = false) {
  const [left,bottom,right,top] = object.clipBox, sideways = object.clipRotation % 180;
  const width = sideways ? top-bottom : right-left, height = sideways ? right-left : top-bottom;
  const scale = Math.min(20, Math.sqrt(32000000 / (width * height)), 16000 / Math.max(width,height));
  const canvas = await paintObjectClip(object, width * scale, height * scale);
  try {
    const doc = await PDFDocument.create(), page = doc.addPage([width,height]);
    if (object.clipAlpha || object.clipErasures?.length || !await drawCanvasRgb(doc, page, canvas, pdfLib.raw)) {
      const blob = await canvasImageBlob(canvas,'image/png',1);
      const image = await doc.embedPng(await blob.arrayBuffer());
      page.drawImage(image,{x:0,y:0,width,height});
    }
    let preview;
    if (makePreview) {
      const small = document.createElement('canvas');
      const ratio = Math.min(1,4/scale,2048/Math.max(canvas.width,canvas.height),
        Math.sqrt(2500000/(canvas.width*canvas.height)));
      try {
        small.width = Math.max(1,Math.round(canvas.width*ratio));
        small.height = Math.max(1,Math.round(canvas.height*ratio));
        small.getContext('2d').drawImage(canvas,0,0,small.width,small.height);
        preview = small.toDataURL('image/png');
      } finally { small.width = small.height = 0; }
    }
    return {bytes:await doc.save(),preview,width,height};
  } finally { canvas.width = canvas.height = 0; }
}

async function embedRegion(out, page, [left, bottom, right, top], angle) {
  const matrix = angle === 90 ? [0, -1, 1, 0, -bottom, right] :
    angle === 180 ? [-1, 0, 0, -1, right, top] :
    angle === 270 ? [0, 1, -1, 0, top, -left] : [1, 0, 0, 1, -left, -bottom];
  const form = await out.embedPage(page, { left, bottom, right, top }, matrix);
  await form.embed();
  return form;
}

async function withRegionSource(bytes, callback) {
  const loading = openPdfDocument(bytes.slice());
  const doc = await loading.promise, id = -(++srcSeq);
  sources.set(id, { bytes, doc, name: '부분 복사' });
  try { return await callback(id, doc); }
  finally {
    displayPainter.invalidateSource(id);
    sources.delete(id); libDocCache.delete(id);
    await loading.destroy();
  }
}

async function flattenRegionAnnotations(bytes, synthesize) {
  return withPdfiumDoc(bytes, (F, M, doc) => {
    const page = F.FPDF_LoadPage(doc, 0), appearances = [];
    try {
      if (!page) throw new Error('주석 페이지를 열 수 없습니다');
      if (synthesize) {
        const bitmap = F.FPDFBitmap_Create(64, 64, 0), rect = M.wasmExports.malloc(16);
        try {
          if (bitmap) F.FPDF_RenderPageBitmap(bitmap, page, 0, 0, 64, 64, 0, 0x11);
          for (let i = 0; i < F.FPDFPage_GetAnnotCount(page); i++) {
            const a = F.FPDFPage_GetAnnot(page, i);
            if (!a) continue;
            try {
              if (rect && F.FPDFAnnot_GetAP(a, 0, 0, 0) > 2 && F.FPDFAnnot_GetRect(a, rect)) {
                const [l,t,r,b] = new Float32Array(M.HEAPU8.buffer, rect, 4);
                appearances.push([Math.min(l,r),Math.min(b,t),Math.max(l,r),Math.max(b,t)]);
              }
            } finally { F.FPDFPage_CloseAnnot(a); }
          }
        } finally { if (bitmap) F.FPDFBitmap_Destroy(bitmap); if (rect) M.wasmExports.free(rect); }
      }
      if (!F.FPDFPage_Flatten(page, 0)) throw new Error('주석 표시를 고정할 수 없습니다');
    } finally { if (page) F.FPDF_ClosePage(page); }
    const writer = F.PDFiumExt_OpenFileWriter();
    let ptr = 0;
    try {
      if (!F.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('주석 복사 실패');
      const size = F.PDFiumExt_GetFileWriterSize(writer);
      ptr = M.wasmExports.malloc(size);
      F.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return { bytes:M.HEAPU8.slice(ptr, ptr + size), appearances };
    } finally { if (ptr) M.wasmExports.free(ptr); F.PDFiumExt_CloseFileWriter(writer); }
  });
}

async function regionPageWithAnnotations(model, original, annotations) {
  const isolated = await PDFDocument.create();
  const [base] = await isolated.copyPages(await getLibDoc(model.src), [model.idx]);
  isolated.addPage(base);
  const raw = await isolated.save(), native = await displayPainter.usesNative(model);
  const missing = [];
  if (!native) {
    const name = pdfLib.raw.PDFName.of;
    for (const ref of base.node.Annots()?.asArray() || []) {
      const annotation = isolated.context.lookup(ref);
      if (!annotation?.lookup || annotation.lookup(name('AP'))?.lookup?.(name('N'))) continue;
      const rect = annotation.lookup(name('Rect'))?.asRectangle?.();
      if (rect) missing.push([rect.x,rect.y,rect.x+rect.width,rect.y+rect.height]);
    }
  }
  const matches = (rect, other) => other?.every((v,i) => Math.abs(rect[i]-v) < .001);
  let flattened, patches;
  try {
    const result = await flattenRegionAnnotations(raw, annotations.some(a => !a.hasAppearance));
    flattened = await PDFDocument.load(result.bytes);
    patches = annotations.filter(a => a.subtype === 'Widget' || missing.some(rect => matches(rect,a.rect)) ||
      (!a.hasAppearance && !result.appearances.some(rect => matches(rect,a.rect))));
  } catch {
    base.node.delete(pdfLib.raw.PDFName.of('Annots'));
    flattened = isolated;
    patches = annotations;
  }
  const page = flattened.getPage(0), view = original.view;
  const unrotated = { src: model.src, idx: model.idx, rot: -original.rotate, texts: [] };
  for (const annotation of patches) {
    if (!annotation.rect) continue;
    const [x1,y1,x2,y2] = annotation.rect;
    const x = Math.max(view[0], Math.min(x1,x2)), y = Math.max(view[1], Math.min(y1,y2));
    const w = Math.min(view[2], Math.max(x1,x2)) - x, h = Math.min(view[3], Math.max(y1,y2)) - y;
    if (w <= 0 || h <= 0) continue;
    const region = pageRectToDispRect({}, view, 0, [x,y,x+w,y+h]);
    const unit = original.userUnit || 1;
    const scale = Math.min(8, 8192/(Math.max(w,h)*unit), Math.sqrt(8000000/(w*h))/unit);
    const canvas = document.createElement('canvas');
    try {
      const painter = native ? displayPainter : pagePainter;
      await painter.paintRegion(unrotated, canvas, scale, 1, {
        x:region.l*(view[2]-view[0])*unit, y:region.t*(view[3]-view[1])*unit,
        width:w*unit, height:h*unit
      });
      const png = await flattened.embedPng(await (await canvasImageBlob(canvas, 'image/png', 1)).arrayBuffer());
      page.drawImage(png, { x, y, width:w, height:h });
    } finally { canvas.width = canvas.height = 0; }
  }
  return flattened.save();
}

async function composedPageBytes(model, original, annotations) {
  if (!annotations.length) return buildPdf([model]);
  const bytes = await regionPageWithAnnotations(model, original, annotations);
  return withRegionSource(bytes, id => buildPdf([{ ...model, src:id, idx:0 }]));
}

async function freezeRegion(model, { fx, fy, fw, fh }) {
  const size = await getViewport(model, 1), width = fw * size.width, height = fh * size.height;
  const out = await PDFDocument.create(), piece = out.addPage([width, height]);
  piece.drawRectangle({ x:0, y:0, width, height, color:rgb(1,1,1), borderWidth:0 });
  const original = model.src && !model.blank ? await sources.get(model.src).doc.getPage(model.idx + 1) : null;
  const annotations = original ? await original.getAnnotations({ intent:'display' }) : [];
  let input, view, rotation;
  if (original && !annotations.length && !model.texts.length && !model.resize) {
    input = (await getLibDoc(model.src)).getPage(model.idx);
    view = original.view; rotation = ((original.rotate + model.rot) % 360 + 360) % 360;
  } else {
    const bytes = await composedPageBytes(model, original, annotations);
    input = (await PDFDocument.load(bytes)).getPage(0);
    const bounds = await withRegionSource(bytes, async (_, doc) => {
      const p = await doc.getPage(1); return { view:p.view, rotation:p.rotate };
    });
    view = bounds.view; rotation = bounds.rotation;
    model = {};  
  }
  if (input.node.Contents()) {
    const box = regionPdfBounds(model, view, rotation, fx, fy, fw, fh);
    const form = await embedRegion(out, input, box, rotation);
    piece.drawPage(form, { x:0, y:0, xScale:width/(rotation%180 ? form.height : form.width),
      yScale:height/(rotation%180 ? form.width : form.height) });
  }
  const {bytes,preview} = await withRegionSource(await out.save(), id => visibleFragmentPdf({
    clipSrc:id, clipIdx:0, clipBox:[0,0,width,height]
  },true));
  const loading = openPdfDocument(bytes.slice());
  return { bytes, loading, doc:await loading.promise, width, height, preview };
}

async function regionCommit() {
  const wrap = document.getElementById('pg' + regionK);
  if (!wrap || !regionBox || !editorStore.pages[regionK]) return;
  const p = editorStore.pages[regionK];
  if (!regionSelection) return;
  const selectionAtCopy = regionSelection;
  const { fx, fy, fw, fh } = selectionAtCopy;
  const bounds = wrap.getBoundingClientRect();
  const previewWidth = fw * bounds.width, previewHeight = fh * bounds.height;
  const copyButton = $('regionCopyCommit');
  copyButton.disabled = true;
  document.body.style.cursor = 'progress';
  let copied = false;
  try {
    const editing = pendingObjectEdits();
    if (editing) await editing;
    if (regionSelection !== selectionAtCopy || regionPage !== p || editorStore.pages[regionK] !== p) return;
    const fragment = await freezeRegion(clonePage(p), { fx, fy, fw, fh });
    if (regionSelection !== selectionAtCopy || regionPage !== p || editorStore.pages[regionK] !== p) {
      await fragment.loading.destroy();
      return;
    }
    const id = ++srcSeq;
    sources.set(id, { bytes: fragment.bytes, doc: fragment.doc, loading: fragment.loading, visibleSize:[fragment.width,fragment.height], name: '부분 복사.pdf' });
    const clip = { src: id, idx: 0, box: [0, 0, fragment.width, fragment.height], rotation: 0 };
    stampStart(fragment.preview, fw, fh, clip, previewWidth, previewHeight);
    copied = true;
  } catch (e) {
    console.error(e);
    toast('범위 복사 실패: ' + (e.message || e).toString().slice(0, 60), 3000);
  } finally {
    document.body.style.cursor = '';
    copyButton.disabled = false;
    if (copied) discardRegionSelection();
  }
}
let stampData = null, stampEl = null;
function stampSize(wrap) {
  const box = stampData.clip?.box;
  if (!box) return stampData;
  const bounds = wrap.getBoundingClientRect();
  return { fw: (box[2] - box[0]) * editorStore.zoom / bounds.width,
    fh: (box[3] - box[1]) * editorStore.zoom / bounds.height };
}
function stampPlacement(bounds, x, y, fw, fh) {
  return { fx: Math.max(0, Math.min(1 - fw, (x - bounds.left) / bounds.width - fw / 2)),
    fy: Math.max(0, Math.min(1 - fh, (y - bounds.top) / bounds.height - fh / 2)) };
}
function stampStart(data, fw, fh, clip, previewWidth = 1, previewHeight = 1) {
  stampCancel();
  stampData = { data, fw, fh, clip: clip || null };
  stampEl = document.createElement('img');
  stampEl.id = 'stampGhost';
  stampEl.style.width = Math.max(1, previewWidth) + 'px';
  stampEl.style.height = Math.max(1, previewHeight) + 'px';
  stampEl.src = data;
  document.body.appendChild(stampEl);
  syncRegionUi();  
  toast('붙여넣을 위치를 클릭하세요 (Esc 취소)');
}
function stampCancel() {
  if (stampData?.clip) scheduleSrcSweep();
  stampData = null;
  if (stampEl) { stampEl.remove(); stampEl = null; }
  syncRegionUi();
}
viewer.addEventListener('pointerup', e => {
  if (stampData && e.isPrimary && e.button === 0) {
    stampData.release = { wrap: e.target.closest?.('.pageWrap'), clientX: e.clientX, clientY: e.clientY };
  }
}, true);
window.addEventListener('pointermove', e => {
  if (!stampEl || !stampData || !e.isPrimary) return;
  const wrap = e.target instanceof Element ? e.target.closest('.pageWrap') : null;
  if (wrap) {
    const r = wrap.getBoundingClientRect(), { fw, fh } = stampSize(wrap);
    const { fx, fy } = stampPlacement(r, e.clientX, e.clientY, fw, fh);
    stampEl.style.width = fw * r.width + 'px';
    stampEl.style.height = fh * r.height + 'px';
    stampEl.style.left = r.left + fx * r.width + 'px';
    stampEl.style.top = r.top + fy * r.height + 'px';
  } else {
    stampEl.style.left = (e.clientX - parseFloat(stampEl.style.width) / 2) + 'px';
    stampEl.style.top = (e.clientY - parseFloat(stampEl.style.height) / 2) + 'px';
  }
});

async function withImageDuplicatePage(page, paint) {
  if (!page.texts.some(object => object.type === 'img')) return paint(page);
  const original = page.src && !page.blank ? await sources.get(page.src).doc.getPage(page.idx + 1) : null;
  const annotations = original ? await original.getAnnotations({ intent:'display' }) : [];
  const bytes = await composedPageBytes(page, original, annotations);
  return withRegionSource(bytes, src => paint({ src, idx:0, rot:0, texts:[] }));
}

async function makeRasterSource(idxs, { openDocument = true } = {}) {
  const editing = pendingObjectEdits();
  if (editing) await editing;
  if (rasterPreparing || printPreparing) throw new Error('다른 출력 작업이 진행 중입니다');
  rasterPreparing = true;
  clearTimeout(thumbPrepassT); thumbnailWorkerController.shutdown();
  const abort = new AbortController();
  const cancel = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation();
    abort.abort(); displayPainter.shutdown(); } };
  window.addEventListener('keydown', cancel, true);
  try {
    const [dupSc, dupMime, dupQ] = ($('setDupQ').value || DEFAULT_DUP_Q).split('|');
    const requestedScale = Math.max(1, +dupSc || 4.1667);
    const list = idxs.map(index => clonePage(editorStore.pages[index]));
    const { bytes, limited } = await rasterOutput.buildPdf(list, {
      scale: requestedScale, type: dupMime, quality: +dupQ, signal: abort.signal,
      supersample: true, withPage: withImageDuplicatePage,
      onProgress: (done, total) => spin(true, uiText('이미지 형식으로 내보내는 중...') + ' ' + done + ' / ' + total),
    });
    if (abort.signal.aborted) throw new DOMException('이미지 변환을 취소했습니다.', 'AbortError');
    const doc = openDocument ? await openPdfDocument(bytes.slice()).promise : null;
    if (abort.signal.aborted) { await doc?.destroy(); throw new DOMException('이미지 변환을 취소했습니다.', 'AbortError'); }
    return { bytes, doc, limited,
      qualityLabel: Math.round(requestedScale * 72) + ' DPI ' + (dupMime === 'image/png' ? 'PNG' : 'JPG') };
  } finally {
    window.removeEventListener('keydown', cancel, true);
    displayPainter.shutdown(); outputOverlayRenderer.clearImageCache(); rasterPreparing = false;
    scheduleThumbPrepass();
    viewer.querySelectorAll('.pageWrap').forEach(wrap => enqueueRender(wrap));
  }
}

async function duplicateAsImage(idxs) {
  if (!idxs.length) return;
  spin(true, '이미지 형식으로 복제 중...');
  try {
    const targetDoc = editorStore.activeDocument, targetPages = editorStore.pages;
    const snap = makeSnap();
    const rs = await makeRasterSource(idxs);
    if (editorStore.activeDocument !== targetDoc || editorStore.pages !== targetPages) {
      try { rs.doc.destroy(); } catch {}
      throw new Error('작업 중 문서가 변경되어 결과를 적용하지 않았습니다');
    }
    const sourceId = ++srcSeq;
    sources.set(sourceId, { bytes: rs.bytes, doc: rs.doc, name: editorStore.documentName + '_이미지복제.pdf' });
    if (!editorStore.activeDocument.srcIds.includes(sourceId)) editorStore.activeDocument.srcIds.push(sourceId);
    const newPages = imageHandlingFeature.rasterPages(sourceId, idxs.length);
    editorStore.pages.splice(Math.max(...idxs) + 1, 0, ...newPages);
    pushSnap(snap);
    rebuildAll();
    toast(rs.limited ? '이미지 형식으로 복제됨 — 대형 페이지는 브라우저 한도에 맞춰 해상도를 조정했습니다' :
                       '이미지 형식으로 복제됨 — ' + rs.qualityLabel);
  } catch (e) { console.error(e); toast('이미지 형식 복제 실패: ' + (e.message || e).toString().slice(0, 60), 3000); }
  finally { spin(false); }
}

let dragCnt = 0;
window.addEventListener('dragenter', e => {
  if ([...e.dataTransfer.types].includes('Files')) { dragCnt++; document.body.classList.add('dragging'); }
});
window.addEventListener('dragleave', () => { if (--dragCnt <= 0) { dragCnt = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault(); dragCnt = 0; document.body.classList.remove('dragging');
  if ($('mgOverlay').classList.contains('show')) return;  
  const append = !!editorStore.activeDocument && e.ctrlKey;
  const droppedFiles = [...e.dataTransfer.files]
    .filter(file => file.name?.toLowerCase().endsWith('.pdf'));
  if (desktopViewMode && desktopHost.sendWithAdditionalObjects({
    type: 'drop-files', apiVersion: 4, append,
  }, droppedFiles)) return;
  const entries = browserFiles.captureDroppedFiles(e.dataTransfer.items);
  (async () => {
    const files = await browserFiles.resolveDroppedFiles(entries);
    openFiles(files, append);
  })();
});

function zoomAtPoint(factor, clientX, clientY) {
  viewportZoom.atPoint(factor, clientX, clientY);
}
function handleViewerZoomWheel(e) {
  if (!e.ctrlKey || !editorStore.pages.length) return;
  e.preventDefault();
  zoomAtPoint(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
}

function handleTextStyleShortcut(e) {
  if (e.defaultPrevented || e.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey ||
      (e.code !== 'KeyB' && e.key.toLowerCase() !== 'b')) return;
  if (!windowsAccess.current.canEditCurrentDocuments || activeDocLocked() ||
      document.querySelector('.overlay.show, dialog[open]')) return;
  const target = e.target;
  if (target instanceof Element &&
      (target.matches('input, textarea, select') || target.isContentEditable) &&
      !target.closest('#textBar, #shapeTextBar') && !selText?.mark?.contains(target)) return;
  const button = [$('stBold'), $('tbBold')].find(button => !button.disabled &&
    button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden');
  if (!button) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (!e.repeat) button.click();
}

function handleEditorShortcut(e) {
  if (e.target instanceof Element &&
      (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
  if (e.key !== 'Escape' && document.querySelector('.overlay.show, dialog[open]')) return;
  if (focusArea === 'sidebar' && editorStore.pages.length && isSelectAllShortcut(e)) {
    e.preventDefault(); selectAll(); return;
  }
  for (const [act, c] of Object.entries(keymap)) {
    if (act === 'draw' && (e.defaultPrevented || e.isComposing || e.metaKey ||
        document.querySelector('dialog[open]'))) continue;
    if (comboMatch(e, c, act === 'draw' || act === 'shapeRect')) {
      const thumbnailColumns = { thumb1: 1, thumb2: 2, thumb3: 3 }[act];
      if (thumbnailColumns && sidebar.classList.contains('hidden')) continue;
      e.preventDefault();
      if (WINDOWS_EDIT_SHORTCUT_ACTIONS.has(act) && !requireWindowsEdit()) return;
      if (act === 'thumbs') toggleThumbs();
      else if (thumbnailColumns) {
        setThumbnailColumns(thumbnailColumns);
        toast('썸네일 한 줄 ' + thumbnailColumns + '장');
      }
      else if (act === 'fitWidth') doFitWidth();
      else if (act === 'actualSize') viewportZoom.to(1);
      else if (act === 'save') saveAll();
      else if (act === 'saveAs') saveAsAll();
      else if (act === 'print') openPrintDialog(false);
      else if (act === 'undo') undo();
      else if (act === 'redo') redo();
      else if (act === 'rotL') rotate(-90);
      else if (act === 'rotR') rotate(90);
      else if (act === 'closeTab') {
        if (desktopViewMode) desktopHost.send({ type: 'requestClose', apiVersion: 4 });
        else if (editorStore.activeDocument) closeDoc(editorStore.activeDocument);
      }
      else if (act === 'editMode') { if (editorStore.pages.length) setOrigMode(!origMode); }
      else if (act === 'addText') { if (editorStore.pages.length) toggleTextModeFromButton(); }
      else if (act === 'draw') { if (!e.repeat) $('btnDraw').click(); }
      else if (act === 'shapeCircle') startShapeDraft('ellipse', '타원');
      else if (act === 'shapeRect' && !e.repeat) {
        if (shapeDraft === 'rect') stopShapeDraft(); else startShapeDraft('rect', '사각형');
      }
      else if (act === 'connectArrow') handleConnectArrowButton();
      else if (act === 'regionCopy') startRegionSelect();
      else if (act === 'multiPick') toggleMultiPick();
      return;
    }
  }
  const moveSelected = (selText || (origSels.length && focusArea !== 'sidebar')) &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
  if (!windowsAccess.current.canEditCurrentDocuments &&
      ((e.ctrlKey && e.key.toLowerCase() === 'x') || e.key === 'Delete' || moveSelected)) {
    e.preventDefault();
    requireWindowsEdit();
    return;
  }
  const copyKey = e.code === 'KeyC' ? 'c' : e.code === 'KeyX' ? 'x' : e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (copyKey === 'c' || copyKey === 'x')) {
    e.preventDefault();
    copyCurrentSelection(copyKey === 'x');
  }
  else if (isSelectAllShortcut(e)) { if (editorStore.pages.length) { e.preventDefault(); selectAll(); } }
  else if (e.key === 'Delete') {
    if (focusArea === 'sidebar' && editorStore.selectedPages.size) deletePages();
    else if (origSels.length) origDeleteSel();
    else if (selText) deleteSelText();
    else if (!origMode) deletePages();  
  }
  else if (moveSelected) {
    e.preventDefault();
    const step = e.altKey ? FINE_MOVE_SCALE : e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (origSels.length) queueOriginalMove(origSels[0].k, dx, dy);
    else nudgeSelText(dx, dy);
  }
  else if (focusArea === 'sidebar' && editorStore.pages.length &&
           ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const selected = [...editorStore.selectedPages];
    let base = editorStore.currentPage;
    if (selected.length) {
      base = editorStore.selectedPages.has(editorStore.lastSelected) ? editorStore.lastSelected : Math.max(...selected);
      if (e.shiftKey && selected[0] === editorStore.lastSelected) base = selected.at(-1);
    }
    const step = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
    const k = e.key === 'Home' ? 0
            : e.key === 'End' ? editorStore.pages.length - 1
            : Math.min(editorStore.pages.length - 1, Math.max(0, base + step));
    if (!e.ctrlKey) {
      if (e.shiftKey) toggleSelect(k, true);
      else {
        editorStore.selectedPages = new Set([k]);
        editorStore.lastSelected = k;
        refreshThumbSelection();
      }
    }
    gotoPage(k + 1);                                   
    sidebar.querySelector('.thumb[data-k="' + k + '"]')?.scrollIntoView({ block: 'nearest' });
  }
  else if (e.key === ' ' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (!e.repeat && editorStore.pages.length) {
      spacePan = true;
      document.body.classList.add('spacePan');  
      if (!panDrag) viewer.style.cursor = 'grab';
    }
  }
  else if (e.key === 'Escape') {
    deselectText();
    origClearSel();  
    cancelRegion();  
    stopShapeDraft();
    stopConnectorPickMode();
    if (multiPickMode) { multiPickMode = false; document.body.classList.remove('multiPick'); }
    if (moResolve) moDone(null);    
    ['mgOverlay', 'setOverlay', 'prOverlay', 'szOverlay', 'imgCrOverlay', 'crOverlay'].forEach(id => $(id).classList.remove('show'));
    imgCrCtx = null;
    closePalette();
    ctxMenu.style.display = 'none';
    $('tabMenu').style.display = 'none';
    closeTabList();
  }
}

const pageTextCache = new Map();  
let searchMatches = [], searchIdx = -1;
async function pageTextItems(p) {
  if (p.blank || !p.src) return [];
  const key = p.src + ':' + p.idx;
  if (!pageTextCache.has(key)) {
    try {
      const page = await sources.get(p.src).doc.getPage(p.idx + 1);
      pageTextCache.set(key, (await page.getTextContent()).items);
    } catch { pageTextCache.set(key, []); }
  }
  return pageTextCache.get(key);
}
function clearSearchHits() { viewer.querySelectorAll('.searchHit').forEach(h => h.remove()); }
function repositionSearchHits(wrap) {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  wrap.querySelectorAll('.searchHit').forEach(el => {
    const d = el.dataset;
    el.style.left = (d.x1 * W) + 'px';
    el.style.top = (d.y1 * H) + 'px';
    el.style.width = ((d.x2 - d.x1) * W) + 'px';
    el.style.height = ((d.y2 - d.y1) * H) + 'px';
  });
}
function updateSearchCount() {
  $('sfCount').textContent = searchMatches.length ? (searchIdx + 1) + ' / ' + searchMatches.length : '0 / 0';
}
async function runSearch() {
  searchMatches = []; searchIdx = -1;
  clearSearchHits();
  searchMatches = await searchViewFeature.find(editorStore.pages, $('sfInput').value, pageTextItems);
  if (searchMatches.length) { searchIdx = 0; await gotoMatch(); }
  updateSearchCount();
}
async function gotoMatch() {
  clearSearchHits();
  if (searchIdx < 0 || !searchMatches.length) return;
  const cur = searchMatches[searchIdx];
  gotoPage(cur.k + 1, { restore: false });
  const p = editorStore.pages[cur.k];
  const wrap = document.getElementById('pg' + cur.k);
  if (!wrap) return;
  const items = await pageTextItems(p);
  const page = await sources.get(p.src).doc.getPage(p.idx + 1);
  const rot = (page.rotate + p.rot) % 360;
  const vp1 = page.getViewport({ scale: 1, rotation: rot });
  let sc = 1, ox = 0, oy = 0, bw = vp1.width, bh = vp1.height;
  if (p.resize) {
    const [tw, th] = p.resize;
    sc = Math.min(tw / vp1.width, th / vp1.height);
    ox = (tw - vp1.width * sc) / 2; oy = (th - vp1.height * sc) / 2;
    bw = tw; bh = th;
    if (p.crop) {
      const [ccx, ccy, ccw, cch] = p.crop;
      ox -= ccx * tw; oy -= ccy * th;
      bw = tw * ccw; bh = th * cch;
    }
  } else if (p.crop) {
    const [ccx, ccy, ccw, cch] = p.crop;
    ox = -ccx * vp1.width; oy = -ccy * vp1.height;
    bw = vp1.width * ccw; bh = vp1.height * cch;
  }
  const W = wrap.clientWidth, H = wrap.clientHeight;
  let curEl = null;
  searchMatches.forEach(mt => {
    if (mt.k !== cur.k) return;
    const it = items[mt.ii];
    const h = Math.hypot(it.transform[1], it.transform[3]) || 10;
    const r = pdfRectToViewport(vp1, [it.transform[4], it.transform[5],
                                     it.transform[4] + it.width, it.transform[5] + h]);
    const x1 = (Math.min(r[0], r[2]) * sc + ox) / bw, y1 = (Math.min(r[1], r[3]) * sc + oy) / bh;
    const x2 = (Math.max(r[0], r[2]) * sc + ox) / bw, y2 = (Math.max(r[1], r[3]) * sc + oy) / bh;
    const el = document.createElement('div');
    el.className = 'searchHit' + (mt === cur ? ' cur' : '');
    el.dataset.x1 = x1; el.dataset.y1 = y1; el.dataset.x2 = x2; el.dataset.y2 = y2;
    el.style.left = (x1 * W) + 'px'; el.style.top = (y1 * H) + 'px';
    el.style.width = ((x2 - x1) * W) + 'px'; el.style.height = ((y2 - y1) * H) + 'px';
    wrap.appendChild(el);
    if (mt === cur) curEl = el;
  });
  if (curEl && viewMode === 'scroll') curEl.scrollIntoView({ block: 'center' });
  updateSearchCount();
}
function openSearch() {
  if (!editorStore.pages.length) return;
  $('searchBar').style.display = 'flex';
  $('sfInput').focus(); $('sfInput').select();
}
function closeSearch() {
  $('searchBar').style.display = 'none';
  clearSearchHits();
}
let sfTimer = null;
function handleSearchInput() { clearTimeout(sfTimer); sfTimer = setTimeout(runSearch, 300); }
function handleSearchInputKeydown(e) {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') closeSearch();
}
function stepMatch(d) {
  if (!searchMatches.length) return;
  searchIdx = searchViewFeature.step(searchIdx, searchMatches.length, d);
  gotoMatch();
}
function handleSearchShortcut(e) {
  if (tutorialController.active) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();  
    if (!document.querySelector('.overlay.show')) openSearch();  
  }
}

const viewportScrollSpace = createViewportScrollSpace({ viewer, windowObject: window });
let viewMode = settings.get('viewMode') || 'scroll';
function setViewMode(m) {
  if (m !== viewMode) cancelPendingViewFit();
  viewMode = m;
  settings.set('viewMode', m);
  viewer.classList.toggle('m-double', m === 'double');
  document.querySelectorAll('.sbtn.vm').forEach(b => b.classList.toggle('active', b.dataset.vm === m));
  updatePageVisibility();
  if (m !== 'scroll') viewportScrollSpace.align(viewer.querySelectorAll('.pageWrap'));
}
function baseOfCurrent() { return searchViewFeature.basePage(editorStore.currentPage, viewMode); }
function updatePageVisibility() {
  const wraps = viewer.querySelectorAll('.pageWrap');
  if (viewMode === 'scroll') { wraps.forEach(w => w.style.display = ''); return; }
  const base = baseOfCurrent();
  wraps.forEach(w => {
    const k = +w.dataset.k;
    const show = k === base || (viewMode === 'double' && k === base + 1);
    w.style.display = show ? '' : 'none';
    if (show) enqueueRender(w);
  });
}
function flipPage(dir) {
  if (!editorStore.pages.length || viewMode === 'scroll') return;
  const nk = searchViewFeature.flip(editorStore.currentPage, editorStore.pages.length, viewMode, dir);
  if (nk === baseOfCurrent()) return;
  gotoPage(nk + 1, { fromBottom: dir < 0 });
}

let wheelArm = { dir: 0, last: 0 }, lastFlipT = 0;
function viewerFits() {
  return $('pagesBox').getBoundingClientRect().height + 48 <= viewer.clientHeight + 2 &&
         viewer.scrollWidth <= viewer.clientWidth + 2;
}
function handleViewModeWheel(e) {
  if (e.ctrlKey || viewMode === 'scroll' || !editorStore.pages.length) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const now = performance.now();
  if (now - lastFlipT < 400) { e.preventDefault(); return; }
  const atEdge = dir > 0
    ? viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2
    : viewer.scrollTop <= 2;
  if (!atEdge) { wheelArm.dir = 0; return; }
  e.preventDefault();
  if (wheelArm.dir !== dir) { wheelArm = { dir, last: now }; return; }   
  if (now - wheelArm.last > 50) { flipPage(dir); wheelArm.dir = 0; lastFlipT = now; }
  else wheelArm.last = now;
}

function handleViewModeMouseDown(e) {
  if (viewMode === 'scroll' || e.button !== 0 || spacePan || shapeDraft) return;
  if (e.target.closest('.obj') || e.target.closest('#textBar') ||
      e.target.closest('#shapeTextBar') || textMode) return;
  const fits = viewerFits();
  const start = { x: e.clientX, y: e.clientY, l: viewer.scrollLeft, t: viewer.scrollTop };
  let net = { x: 0, y: 0 };
  const mv = e2 => {
    net = { x: e2.clientX - start.x, y: e2.clientY - start.y };
    if (!fits) viewer.scrollLeft = start.l - net.x;
    viewer.scrollTop = start.t - net.y;  
  };
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    if (fits && Math.abs(net.x) > 60 && Math.abs(net.x) > Math.abs(net.y))
      flipPage(net.x < 0 ? 1 : -1);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}

let saveErrorOpen = false;
function saveFailAlert(err) {
  console.error(err);
  const msg = (err && (err.message || err) || err).toString().slice(0, 120);
  spin(false);
  const english = document.documentElement.lang === 'en';
  $('saveErrorTitle').textContent = english ? 'Save failed' : '저장 실패';
  $('saveErrorMessage').textContent = english
    ? `${msg}\n\nThe file was not saved. Please choose a different name or location and try again.`
    : `${msg}\n\n파일이 저장되지 않았습니다. 다른 이름이나 위치를 선택해 다시 시도하세요.`;
  $('saveErrorOk').textContent = english ? 'OK' : '확인';
  $('saveErrorOverlay').classList.add('show');
  saveErrorOpen = true;
  setTimeout(() => $('saveErrorOk').focus(), 0);
}
function closeSaveFailDialog() {
  saveErrorOpen = false;
  $('saveErrorOverlay').classList.remove('show');
}
function handleSaveErrorKeydown(e) {
  if (e.key !== 'Escape' && e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  closeSaveFailDialog();
}
function applySavedName(name, handle) {
  editorStore.documentName = name;
  if (editorStore.activeDocument) {
    markSaved(editorStore.activeDocument);
    editorStore.activeDocument.openedWithPassword = false;
    if (handle) editorStore.fileHandle = handle;
    editorStore.activeDocument.sourceFileName = String(handle?.name || `${name}.pdf`);
    editorStore.activeDocument.sourcePath = '';
    renderTabs();
  }
  updateLockUi();
  updateStatus();
  scheduleAutosave();
}
function safeCopyPdfName(sourceName) {
  const base = String(sourceName || editorStore.documentName || 'document')
    .replace(/\.pdf$/i, '')
    .replace(/^_+/, '')
    .trim() || 'document';
  return `_${base}.pdf`;
}
async function pickSaveHandle(options, startIn = null) {
  try {
    return await browserFiles.pickSavePdfHandle(startIn ? { ...options, startIn } : options);
  } catch (error) {
    if (error?.name === 'AbortError' || !startIn) throw error;
    return browserFiles.pickSavePdfHandle(options);
  }
}
async function saveSafeCopy({ sourceName, pickerOpts, startIn = null, bytes = null }) {
  const fallbackName = safeCopyPdfName(sourceName);
  const english = document.documentElement.lang === 'en';
  if (!await confirmSafeCopySave(fallbackName)) return false;

  const safePickerOpts = { ...pickerOpts, id: 'pdfEditorSafeSave', suggestedName: fallbackName };
  let safeHandle = null;
  try {
    safeHandle = await pickSaveHandle(safePickerOpts, startIn);
  } catch (error) {
    if (error?.name === 'AbortError') {
      toast(english ? 'Safe-copy save was cancelled.' : '안전 사본 저장이 취소되었습니다.', 10000);
    } else saveFailAlert(error);
    return false;
  }

  spin(true, english ? 'Saving safe copy...' : '안전 사본 저장 중...');
  try {
    const outputBytes = bytes ?? await buildPdf(editorStore.pages);
    await browserFiles.writeFile(safeHandle, outputBytes);
    applySavedName(safeHandle.name.replace(/\.pdf$/i, ''), safeHandle);
    toast((english ? 'Saved: ' : '저장됨: ') + safeHandle.name, 10000);
    return true;
  } catch (error) {
    saveFailAlert(error);
    return false;
  } finally {
    spin(false);
  }
}
async function saveAs({ forClose = false, useCurrentHandle = false } = {}) {
  if (!editorStore.pages.length) return;
  if (activeDocLocked()) { lockNotice(); return; }  
  const editSuffix = document.documentElement.lang === 'en' ? '_edited' : '_편집본';
  if (FS_OK) {
    const pickerOpts = {
      suggestedName: editorStore.documentName + '.pdf',
      id: 'pdfEditorSave',
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
    };
    let h = null;
    try {
      h = (useCurrentHandle && editorStore.fileHandle) || await pickSaveHandle(pickerOpts, editorStore.fileHandle);
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (forClose) return false;
        return await saveSafeCopy({
          sourceName: editorStore.documentName,
          pickerOpts,
          startIn: editorStore.fileHandle,
        });
      } else saveFailAlert(e);
      return;
    }
    spin(true, 'PDF 저장 중...');
    let bytes = null;
    let saveError = null;
    try {
      bytes = await buildPdf(editorStore.pages);
      await browserFiles.writeFile(h, bytes);
    } catch (err) {
      saveError = err;
    } finally {
      spin(false);
    }

    if (saveError) {
      if (!bytes) { saveFailAlert(saveError); return; }
      console.error('선택한 파일에 쓰기 실패', saveError);
      return await saveSafeCopy({
        sourceName: h.name || editorStore.documentName,
        pickerOpts,
        startIn: h,
        bytes,
      });
    }

    applySavedName(h.name.replace(/\.pdf$/i, ''), h);  
    toast('저장됨: ' + h.name);
    return true;
  }
  const name = prompt('저장할 파일 이름을 입력하세요', editorStore.documentName + editSuffix);
  if (name === null) return;
  spin(true, 'PDF 저장 중...');
  try {
    const bytes = await buildPdf(editorStore.pages);
    const finalName = (name.trim() || editorStore.documentName + editSuffix).replace(/\.pdf$/i, '');
    download(bytes, finalName + '.pdf');
    applySavedName(finalName, null);  
    toast('저장 완료');
    return true;
  } catch (err) { saveFailAlert(err); }
  finally { spin(false); }
}

function selectAll() {
  editorStore.pages.forEach((_, i) => editorStore.selectedPages.add(i));
  refreshThumbSelection();
}

let origMode = false;
let origSels = [];      
let origSelBoxes = [];  
const ORIG_TYPES = { 1: '텍스트', 2: '도형', 3: '이미지', 4: '음영', 5: '폼' };
const origCache = new Map();   
const annotCache = new Map();  
const ANNOT_NAMES = { 1: '메모', 3: '텍스트 주석', 4: '선', 5: '사각형', 6: '원', 7: '다각형',
                      8: '폴리라인', 9: '형광펜', 10: '밑줄', 11: '물결 밑줄', 12: '취소선',
                      13: '스탬프', 15: '잉크' };  
async function origScanBatch(src, idxs) {
  const need = idxs.filter(i => !origCache.has(src + ':' + i) || !annotCache.has(src + ':' + i));
  if (!need.length) return;
  await withPdfiumDoc(sources.get(src).bytes, async (F, M, doc) => {
    const buf = M.wasmExports.malloc(24);
    try {
      for (const idx of need) {
        const pg = F.FPDF_LoadPage(doc, idx);
        if (!pg) continue;
        try {
          const objs = [];
          let textPage = null;
          const n = F.FPDFPage_CountObjects(pg);
          try {
          for (let i = 0; i < n; i++) {
            const o = F.FPDFPage_GetObject(pg, i);
            const type = F.FPDFPageObj_GetType(o);
            const bounds = pdfObjectBounds(F, M, o, type, buf);
            if (bounds) {
              const obj = { i, type, b: bounds };
              if (type === 1 && typeof F.FPDFTextObj_GetTextRenderMode === 'function') {
                const renderMode = F.FPDFTextObj_GetTextRenderMode(o);
                let alpha = 1;
                if (F.FPDFPageObj_GetFillColor(o, buf, buf + 4, buf + 8, buf + 12))
                  alpha = new Uint32Array(M.HEAPU8.buffer, buf, 4)[3] / 255;
                obj.invisible = isInvisiblePdfText({ renderMode, alpha });
                if (obj.invisible && !textPage) textPage = F.FPDFText_LoadPage(pg);
                if (obj.invisible && textPage) {
                  const length = F.FPDFTextObj_GetText(o, textPage, 0, 0);
                  const ptr = M.wasmExports.malloc(length);
                  try {
                    if (length > 0) {
                      F.FPDFTextObj_GetText(o, textPage, ptr, length);
                      obj.text = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(ptr, ptr + length)).replace(/\0+$/, '');
                    }
                  } finally { M.wasmExports.free(ptr); }
                }
              }
              objs.push(obj);
            }
          }
          } finally { if (textPage) F.FPDFText_ClosePage(textPage); }
          if (objs.some(obj => obj.invisible)) {
            const content = await (await sources.get(src).doc.getPage(idx + 1)).getTextContent();
            const remaining = content.items.filter(item => item.str);
            for (const obj of objs.filter(obj => obj.invisible)) {
              const candidates = remaining.filter(item => item.str.replace(/\s/g, '') === String(obj.text || '').replace(/\s/g, ''));
              candidates.sort((a, b) => Math.hypot(a.transform[4] - obj.b[0], a.transform[5] - obj.b[1])
                - Math.hypot(b.transform[4] - obj.b[0], b.transform[5] - obj.b[1]));
              const item = candidates[0];
              if (item) {
                obj.b = ocrPdfItemBounds(item, content.styles[item.fontName]) || obj.b;
                obj.ocrItem = item;
                obj.ocrStyle = content.styles[item.fontName];
                remaining.splice(remaining.indexOf(item), 1);
              }
            }
          }
          const annots = [];
          const an = F.FPDFPage_GetAnnotCount(pg);
          for (let i = 0; i < an; i++) {
            const a = F.FPDFPage_GetAnnot(pg, i);
            if (!a) continue;
            const sub = F.FPDFAnnot_GetSubtype(a);
            if (ANNOT_NAMES[sub] && F.FPDFAnnot_GetRect(a, buf)) {
              const f = new Float32Array(M.HEAPU8.buffer, buf, 4);  
              annots.push({ a: i, sub, isA: true,
                b: [Math.min(f[0], f[2]), Math.min(f[1], f[3]), Math.max(f[0], f[2]), Math.max(f[1], f[3])] });
            }
            F.FPDFPage_CloseAnnot(a);
          }
          origCache.set(src + ':' + idx, objs);
          annotCache.set(src + ':' + idx, annots);
        } finally { F.FPDF_ClosePage(pg); }
      }
    } finally { M.wasmExports.free(buf); }
  });
}
async function origScanPage(p) {
  const key = p.src + ':' + p.idx;
  if (!origCache.has(key) || !annotCache.has(key)) await origScanBatch(p.src, [p.idx]);
  return { objs: origCache.get(key) || [], annots: annotCache.get(key) || [] };
}
async function origObjects(p) { return (await origScanPage(p)).objs; }
async function origAnnots(p) { return (await origScanPage(p)).annots; }
async function annotApply(k, mutator, msg, keepSel, skipSnap, commit = null) {
  mutator.noGen = true;
  return origApply(k, mutator, msg, keepSel, skipSnap, commit);
}
async function annotDeleteSel(commit = null) {
  if (!origSels.length || !origSels[0].isA) return;
  const k = origSels[0].k;
  const idxs = origSels.map(s => s.a);
  await annotApply(k, (F, M, pg) => {
    const del = new Set(idxs);
    for (const i of idxs) {
      const a = F.FPDFPage_GetAnnot(pg, i);
      if (!a) continue;
      try {
        const lp = F.FPDFAnnot_GetLinkedAnnot(a, 'Popup');
        if (lp) {
          const li = F.FPDFPage_GetAnnotIndex(pg, lp);
          if (li >= 0) del.add(li);
          F.FPDFPage_CloseAnnot(lp);
        }
      } catch {}
      F.FPDFPage_CloseAnnot(a);
    }
    for (const i of [...del].sort((x, y) => y - x))
      if (!F.FPDFPage_RemoveAnnot(pg, i)) throw new Error('주석 제거 실패');
  }, '주석 삭제', false, false, commit);
}
async function annotSetRects(k, moves, msg, commit = null) {
  const ok = await annotApply(k, (F, M, pg) => {
    const rb = M.wasmExports.malloc(16);
    try {
      for (const mv of moves) {
        const a = F.FPDFPage_GetAnnot(pg, mv.a);
        if (!a) throw new Error('주석을 찾지 못했습니다');
        const f = new Float32Array(M.HEAPU8.buffer, rb, 4);
        f[0] = mv.rect[0]; f[1] = mv.rect[3]; f[2] = mv.rect[2]; f[3] = mv.rect[1];  
        const done = F.FPDFAnnot_SetRect(a, rb);
        F.FPDFPage_CloseAnnot(a);
        if (!done) throw new Error('주석 위치 변경 실패');
      }
    } finally { M.wasmExports.free(rb); }
  }, msg, true, false, commit);
  if (!ok) return false;
  try {  
    const list = await origAnnots(editorStore.pages[k]);
    await origSelect(k, list.filter(x => moves.some(m => m.a === x.a)), !!commit);
  } catch { origClearSel(); }
  return true;
}
let origAnnotSel = null;  
let annotStyleBusy = false, annotStylePend = false;
function annotStyleFromShapeBar(fn) {
  if (!origAnnotSel) return;
  fn(origAnnotSel.style);
  if (annotStyleBusy) { annotStylePend = true; return; }
  annotStyleApplyNow();
}
async function annotStyleApplyNow() {
  if (!origAnnotSel) return;
  annotStyleBusy = true;
  try {
    const { k, a, style } = origAnnotSel;
    const sc = parseInt((style.stroke || '#d32f2f').slice(1), 16);
    const sa = style.strokeOn === false ? 0 : Math.round((style.strokeOp ?? 1) * 255);
    const fc = style.fill ? parseInt(style.fill.slice(1), 16) : null;
    const fa = Math.round((style.fillOp ?? 1) * 255);
    await annotApply(k, (F, M, pg) => {
      const an = F.FPDFPage_GetAnnot(pg, a);
      if (!an) throw new Error('주석을 찾지 못했습니다');
      try {
        if (!F.FPDFAnnot_SetColor(an, 0, (sc >> 16) & 255, (sc >> 8) & 255, sc & 255, sa)) {
          F.FPDFAnnot_SetAP(an, 0, 0);
          if (!F.FPDFAnnot_SetColor(an, 0, (sc >> 16) & 255, (sc >> 8) & 255, sc & 255, sa))
            throw new Error('색 변경을 지원하지 않는 주석');
        }
        if (fc !== null) F.FPDFAnnot_SetColor(an, 1, (fc >> 16) & 255, (fc >> 8) & 255, fc & 255, fa);
        else F.FPDFAnnot_SetColor(an, 1, 255, 255, 255, 0);  
        if (style.sw && typeof F.FPDFAnnot_SetBorder === 'function')
          F.FPDFAnnot_SetBorder(an, 0, 0, style.sw);
      } finally { F.FPDFPage_CloseAnnot(an); }
    }, '주석 스타일', true, palLive);  
  } finally {
    annotStyleBusy = false;
    if (annotStylePend) { annotStylePend = false; annotStyleApplyNow(); }
  }
}
async function origShowAnnotBar(k, hit) {
  try {
    const p = editorStore.pages[k];
    const st = { stroke: '#d32f2f', fill: '', strokeOp: 1, fillOp: 1, sw: 2, strokeOn: true };
    try {  
      await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
        const pg = F.FPDF_LoadPage(doc, p.idx);
        if (!pg) return;
        try {
          const an = F.FPDFPage_GetAnnot(pg, hit.a);
          if (!an) return;
          const cb = M.wasmExports.malloc(16);
          const hex = u => '#' + [u[0], u[1], u[2]].map(v => (v & 255).toString(16).padStart(2, '0')).join('');
          if (F.FPDFAnnot_GetColor(an, 0, cb, cb + 4, cb + 8, cb + 12)) {
            const u = new Uint32Array(M.HEAPU8.buffer, cb, 4);
            st.stroke = hex(u); st.strokeOp = (u[3] & 255) / 255;
          }
          if (F.FPDFAnnot_GetColor(an, 1, cb, cb + 4, cb + 8, cb + 12)) {
            const u = new Uint32Array(M.HEAPU8.buffer, cb, 4);
            st.fill = hex(u); st.fillOp = (u[3] & 255) / 255;
          }
          M.wasmExports.free(cb);
          F.FPDFPage_CloseAnnot(an);
        } finally { F.FPDF_ClosePage(pg); }
      });
    } catch {}
    if (!origSels.length || !origSels[0].isA || origSels[0].a !== hit.a) return;  
    origAnnotSel = { k, a: hit.a, sub: hit.sub, style: st };
    $('tbTextCtl').style.display = 'none';
    $('tbShapeCtl').style.display = 'flex';
    syncArrowOptionControls(null);
    $('textBar').classList.add('origText');
    $('textBar').classList.remove('imgSel');
    setCol('tbStroke', st.stroke);
    $('tbStrokeOp').value = Math.round(st.strokeOp * 100);
    $('tbStrokeOn').checked = true;
    if (st.fill) setCol('tbFill', st.fill);
    $('tbFillOn').checked = !!st.fill;
    $('tbFillOp').value = Math.round(st.fillOp * 100);
    if (barPinned || !barHover) positionTextBar(origSelBoxes[0]);
    else $('textBar').style.display = 'flex';
  } catch {}
}
function origHideAnnotBar() {
  if (!origAnnotSel) return;
  origAnnotSel = null;
  $('textBar').classList.remove('origText');
  if (!selText) $('textBar').style.display = 'none';
}

let origShapeSel = null;  
let origShapeBusy = false, origShapePend = false;
async function origShowShapeBar(k, hit) {
  try {
    const p = editorStore.pages[k];
    const st = { stroke: '#d32f2f', fill: '', strokeOp: 1, fillOp: 1, sw: 1, strokeOn: true };
    let fillMode = 0;
    await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
      const pg = F.FPDF_LoadPage(doc, p.idx);
      if (!pg) return;
      try {
        const o = F.FPDFPage_GetObject(pg, hit.i);
        if (!o) return;
        const b = M.wasmExports.malloc(16);
        const hex = u => '#' + [u[0], u[1], u[2]].map(v => (v & 255).toString(16).padStart(2, '0')).join('');
        if (F.FPDFPageObj_GetStrokeColor(o, b, b + 4, b + 8, b + 12)) {
          const u = new Uint32Array(M.HEAPU8.buffer, b, 4);
          st.stroke = hex(u); st.strokeOp = (u[3] & 255) / 255;
        }
        if (F.FPDFPageObj_GetFillColor(o, b, b + 4, b + 8, b + 12)) {
          const u = new Uint32Array(M.HEAPU8.buffer, b, 4);
          st.fill = hex(u); st.fillOp = (u[3] & 255) / 255;
        }
        if (F.FPDFPageObj_GetStrokeWidth(o, b)) {
          st.sw = Math.max(1, Math.round(new Float32Array(M.HEAPU8.buffer, b, 1)[0]));
        }
        if (F.FPDFPath_GetDrawMode(o, b, b + 4)) {
          const u = new Int32Array(M.HEAPU8.buffer, b, 2);
          fillMode = u[0];                     
          st.strokeOn = !!u[1];
          if (!u[0]) st.fill = '';             
        }
        M.wasmExports.free(b);
      } finally { F.FPDF_ClosePage(pg); }
    });
    if (!origSels.length || origSels[0].isA || origSels[0].i !== hit.i) return;  
    origShapeSel = { k, i: hit.i, style: st, fillMode };
    $('tbTextCtl').style.display = 'none';
    $('tbShapeCtl').style.display = 'flex';
    syncArrowOptionControls(null);
    $('textBar').classList.add('origText');
    $('textBar').classList.remove('imgSel');
    setCol('tbStroke', st.stroke);
    $('tbStrokeOp').value = Math.round(st.strokeOp * 100);
    $('tbStrokeOn').checked = st.strokeOn;
    $('tbSw').value = String(clampStrokeWidth(st.sw));
    if (st.fill) setCol('tbFill', st.fill);
    $('tbFillOn').checked = !!st.fill;
    $('tbFillOp').value = Math.round(st.fillOp * 100);
    if (barPinned || !barHover) positionTextBar(origSelBoxes[0]);
    else $('textBar').style.display = 'flex';
  } catch {}
}
function origHideShapeBar() {
  if (!origShapeSel) return;
  origShapeSel = null;
  $('textBar').classList.remove('origText');
  if (!selText) $('textBar').style.display = 'none';
}
function origShapeStyleFromBar(fn) {
  if (!origShapeSel) return;
  fn(origShapeSel.style);
  if (origShapeBusy) { origShapePend = true; return; }
  origShapeStyleApply();
}
async function origShapeStyleApply() {
  if (!origShapeSel) return;
  origShapeBusy = true;
  try {
    const { k, i, style, fillMode } = origShapeSel;
    const sc = parseInt((style.stroke || '#d32f2f').slice(1), 16);
    const sa = Math.round((style.strokeOp ?? 1) * 255);
    const fc = style.fill ? parseInt(style.fill.slice(1), 16) : null;
    const fa = Math.round((style.fillOp ?? 1) * 255);
    await origApply(k, (F, M, pg) => {
      const o = F.FPDFPage_GetObject(pg, i);
      if (!o) throw new Error('오브젝트를 찾지 못했습니다');
      F.FPDFPageObj_SetStrokeColor(o, (sc >> 16) & 255, (sc >> 8) & 255, sc & 255, sa);
      if (fc !== null) F.FPDFPageObj_SetFillColor(o, (fc >> 16) & 255, (fc >> 8) & 255, fc & 255, fa);
      if (style.sw) F.FPDFPageObj_SetStrokeWidth(o, style.sw);
      F.FPDFPath_SetDrawMode(o, fc !== null ? (fillMode || 2) : 0, style.strokeOn !== false ? 1 : 0);
    }, '도형 스타일', true, palLive);
  } finally {
    origShapeBusy = false;
    if (origShapePend) { origShapePend = false; origShapeStyleApply(); }
  }
}

function dispToPagePt(p, wrap, view, rT, clientX, clientY) {
  const r = wrap.getBoundingClientRect();
  return pageFracToPt(p, view, rT, (clientX - r.left) / r.width, (clientY - r.top) / r.height);
}
async function origView(p) {
  const page = await sources.get(p.src).doc.getPage(p.idx + 1);
  return { view: page.view, rT: (page.rotate + p.rot) % 360 };
}
function origPageOk(p, quiet) {
  if (!p || p.blank || !p.src) { if (!quiet) toast('빈 페이지에는 원본 오브젝트가 없습니다'); return false; }
  return true;
}

let origDecT = null;
async function origDecorate(wrap) {
  const k = +wrap.dataset.k, p = editorStore.pages[k];
  if (!origPageOk(p, true)) return;
  const key = p.src + ':' + p.idx;
  if (wrap.dataset.origGhosts === key) return;
  wrap.dataset.origGhosts = key;
  try {
    const objs = await origObjects(p);
    const annots = await origAnnots(p).catch(() => []);
    if (!origMode || wrap.dataset.origGhosts !== key) return;
    const { view, rT } = await origView(p);
    wrap._origView = { view, rT };  
    const frag = document.createDocumentFragment();
    const mk = (o, cls, key2) => {
      const rr = pageRectToDispRect(p, view, rT, o.b);
      const g = document.createElement('div');
      g.className = cls;
      g.dataset[key2] = key2 === 'a' ? o.a : o.i;
      g.style.left = (rr.l * 100) + '%'; g.style.top = (rr.t * 100) + '%';
      g.style.width = (rr.w * 100) + '%'; g.style.height = (rr.h * 100) + '%';
      frag.appendChild(g);
    };
    for (const o of objs) mk(o, 'origGhost', 'i');
    for (const o of annots) mk(o, 'origGhost ann', 'a');
    wrap.querySelectorAll('.origGhost').forEach(g => g.remove());
    origHovG = null;
    wrap.appendChild(frag);
  } catch {}
}
let origHovG = null;
viewer.addEventListener('mousemove', e => {
  if (!origMode || spacePan || panDrag) return;
  const wrap = e.target.closest('.pageWrap');
  const p0 = wrap && editorStore.pages[+wrap.dataset.k];
  const skey = p0 && (p0.src + ':' + p0.idx);
  const cached = skey && origCache.get(skey);
  const cachedA = skey && annotCache.get(skey);
  let hit = null;
  if ((cached || cachedA) && wrap._origView) {
    const p = editorStore.pages[+wrap.dataset.k];
    const [px, py] = dispToPagePt(p, wrap, wrap._origView.view, wrap._origView.rT, e.clientX, e.clientY);
    const inB = b => px >= b[0] - 2 && px <= b[2] + 2 && py >= b[1] - 2 && py <= b[3] + 2;
    if (cachedA) for (let i = cachedA.length - 1; i >= 0; i--)  
      if (inB(cachedA[i].b)) { hit = cachedA[i]; break; }
    if (!hit && cached) for (let i = cached.length - 1; i >= 0; i--)
      if (inB(cached[i].b)) { hit = cached[i]; break; }
  }
  const g = hit ? wrap.querySelector(hit.isA
    ? `.origGhost.ann[data-a="${hit.a}"]` : `.origGhost[data-i="${hit.i}"]`) : null;
  if (g === origHovG) return;
  if (origHovG) origHovG.classList.remove('hov');
  origHovG = g;
  if (g) g.classList.add('hov');
});
function origDecorateVisible() {
  if (!origMode) return;
  const vr = viewer.getBoundingClientRect();
  const vis = [...viewer.querySelectorAll('.pageWrap')].filter(w => {
    const r = w.getBoundingClientRect();
    return r.bottom > vr.top - 200 && r.top < vr.bottom + 200;
  });
  const bySrc = new Map();
  for (const w of vis) {
    const p = editorStore.pages[+w.dataset.k];
    if (!origPageOk(p, true)) continue;
    if (origCache.has(p.src + ':' + p.idx) && annotCache.has(p.src + ':' + p.idx)) continue;
    if (!bySrc.has(p.src)) bySrc.set(p.src, new Set());
    bySrc.get(p.src).add(p.idx);
  }
  (async () => {
    for (const [src, idxs] of bySrc) {
      try { await origScanBatch(src, [...idxs]); }
      catch (e) { console.warn('원본 일괄 스캔 실패', e); }
    }
    vis.forEach(origDecorate);  
  })();
}
function origClearGhosts() {
  viewer.querySelectorAll('.origGhost').forEach(g => g.remove());
  viewer.querySelectorAll('.pageWrap').forEach(w => delete w.dataset.origGhosts);
  origHovG = null;
}
viewer.addEventListener('scroll', () => {
  if (!origMode) return;
  clearTimeout(origDecT);
  origDecT = setTimeout(origDecorateVisible, 150);
});

function overlayMarkAt(wrap, x, y) {
  const ms = [...wrap.querySelectorAll('.obj')];
  for (let i = ms.length - 1; i >= 0; i--) {
    const r = ms[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return ms[i];
  }
  return null;
}

async function origHitTest(k, clientX, clientY) {
  const p = editorStore.pages[k], wrap = document.getElementById('pg' + k);
  const objs = await origObjects(p);
  const annots = await origAnnots(p).catch(() => []);
  const { view, rT } = await origView(p);
  const [px, py] = dispToPagePt(p, wrap, view, rT, clientX, clientY);
  const pad = 2;
  const inB = b => px >= b[0] - pad && px <= b[2] + pad && py >= b[1] - pad && py <= b[3] + pad;
  for (let i = annots.length - 1; i >= 0; i--) if (inB(annots[i].b)) return annots[i];
  for (let i = objs.length - 1; i >= 0; i--) if (objs[i].invisible && inB(objs[i].b)) return objs[i];
  for (let i = objs.length - 1; i >= 0; i--) if (inB(objs[i].b)) return objs[i];  
  return null;
}

let origSelectionSerial = 0;
function origClearSel() {
  origSelectionSerial++;
  origSelBoxes.forEach(b => b.remove());
  origSelBoxes = [];
  origSels = [];
  $('textBar').classList.remove('mixedSelection');
  origHideTextBar();
  origHideAnnotBar();
  origHideShapeBar();
}
async function origSelect(k, hits, keepOverlay = false) {
  focusViewer();
  origClearSel();
  if (!keepOverlay || selText?.k !== k) deselectText();
  if (!hits.length) { refreshSelectedObjectHandles(); return; }
  const serial = origSelectionSerial, ctx = editContext(k);
  const p = editorStore.pages[k], wrap = document.getElementById('pg' + k);
  if (!wrap) return;
  origSels = hits.map(h => ({...h, k}));
  const { view, rT } = await origView(p);
  if (serial !== origSelectionSerial || !contextValid(ctx)) return;
  origSels = hits.map(h => ({ k, i: h.i, a: h.a, isA: !!h.isA, sub: h.sub, type: h.type, b: h.b, invisible: h.invisible, ocrItem: h.ocrItem, ocrStyle: h.ocrStyle }));
  hits.forEach((h, idx) => {
    const rr = pageRectToDispRect(p, view, rT, h.b);
    const box = document.createElement('div');
    box.className = h.isA ? 'origBox ann' : 'origBox';
    if (h.type === 3) box.style.background = 'transparent';  
    box.style.left = (rr.l * 100) + '%'; box.style.top = (rr.t * 100) + '%';
    box.style.width = (rr.w * 100) + '%'; box.style.height = (rr.h * 100) + '%';
    if (idx === 0) {
      const lbl = hits.length !== 1 ? hits.length + '개'
        : h.isA ? '주석 · ' + (ANNOT_NAMES[h.sub] || '기타')
        : (ORIG_TYPES[h.type] || '오브젝트');
      box.innerHTML = `<div class="olbl">${lbl}</div>`;
    }
    if (hits.length === 1) ['nw', 'ne', 'se', 'sw'].forEach(dir => {
      const hd = document.createElement('div');
      hd.className = 'oh ' + dir;
      hd.addEventListener('mousedown', ev => origResizeStart(ev, box, dir));
      box.appendChild(hd);
    });
    if (hits.length === 1 && !h.isA) {
      const rh = document.createElement('div');
      rh.className = 'oh rotate';
      rh.title = 'Shift: 90° · Alt: 정밀 회전 · Ctrl: 복제';
      rh.addEventListener('mousedown', ev => origRotateStart(ev, box));
      box.appendChild(rh);
    }
    box.addEventListener('mousedown', origMoveStart);
    box.addEventListener('contextmenu', ev => {  
      ev.preventDefault(); ev.stopPropagation();
      showObjMenu(ev.clientX, ev.clientY, true);
    });
    wrap.appendChild(box);
    origSelBoxes.push(box);
  });
  origHideTextBar(); origHideAnnotBar(); origHideShapeBar();
  if (!hasMixedSelection() && hits.length === 1 && hits[0].isA) origShowAnnotBar(k, hits[0]);
  else if (!hasMixedSelection() && hits.length === 1 && hits[0].type === 1) origShowTextBar(k, hits[0]);
  else if (!hasMixedSelection() && hits.length === 1 && hits[0].type === 2) origShowShapeBar(k, hits[0]);
  syncMixedSelectionUi();
}

let origTextSel = null;   
async function origReadTextStyle(p, i) {
  const st = { size: 0, color: '#000000', alpha: 1, fam: '', weight: 0, renderMode: 0 };
  await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      const o = F.FPDFPage_GetObject(pg, i);
      if (typeof F.FPDFTextObj_GetTextRenderMode === 'function') st.renderMode = F.FPDFTextObj_GetTextRenderMode(o);
      if (typeof F.FPDFTextObj_GetFontSize === 'function') {
        const fb = M.wasmExports.malloc(4);
        if (F.FPDFTextObj_GetFontSize(o, fb)) st.size = new Float32Array(M.HEAPU8.buffer, fb, 1)[0];
        M.wasmExports.free(fb);
      }
      if (st.size && typeof F.FPDFPageObj_GetMatrix === 'function') {
        const mb = M.wasmExports.malloc(24);  
        if (F.FPDFPageObj_GetMatrix(o, mb)) {
          const m = new Float32Array(M.HEAPU8.buffer, mb, 6);
          const vs = Math.hypot(m[2], m[3]);
          if (vs > 0) st.size *= vs;
        }
        M.wasmExports.free(mb);
      }
      if (typeof F.FPDFPageObj_GetFillColor === 'function') {
        const cb = M.wasmExports.malloc(16);
        if (F.FPDFPageObj_GetFillColor(o, cb, cb + 4, cb + 8, cb + 12)) {
          const u = new Uint32Array(M.HEAPU8.buffer, cb, 4);
          st.color = '#' + [u[0], u[1], u[2]].map(v => (v & 255).toString(16).padStart(2, '0')).join('');
          st.alpha = (u[3] & 255) / 255;
        }
        M.wasmExports.free(cb);
      }
      if (typeof F.FPDFTextObj_GetFont === 'function') {
        try {
          const fh = F.FPDFTextObj_GetFont(o);
          st.fam = readPdfiumFontName(F, M, fh);
          if (typeof F.FPDFFont_GetWeight === 'function') st.weight = F.FPDFFont_GetWeight(fh) || 0;
        } catch {}
      }
    } finally { F.FPDF_ClosePage(pg); }
  });
  return st;
}
async function origReadTextContent(p, i) {
  let text = '';
  await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      const o = F.FPDFPage_GetObject(pg, i);
      const tp = F.FPDFText_LoadPage(pg);
      const len = F.FPDFTextObj_GetText(o, tp, 0, 0);
      if (len > 0) {
        const buf = M.wasmExports.malloc(len);
        F.FPDFTextObj_GetText(o, tp, buf, len);
        text = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(buf, buf + len)).replace(/\0+$/, '');
        M.wasmExports.free(buf);
      }
      if (typeof F.FPDFText_ClosePage === 'function') F.FPDFText_ClosePage(tp);
    } finally { F.FPDF_ClosePage(pg); }
  });
  return text;
}
async function origShowTextBar(k, hit) {
  try {
    const ctx = editContext(k);
    const st = await origReadTextStyle(ctx.page, hit.i);
    const text = await origReadTextContent(ctx.page, hit.i);
    if (!contextValid(ctx) || !origSels.length || origSels[0].k !== k || origSels[0].i !== hit.i) return;
    const invisible = isInvisiblePdfText(st);
    let match = resolveEditablePdfFont(st.fam, text, { invisible });
    let font = match.key;
    if (invisible) {
      const model = await origPrepareOcrEdit(k, hit, st, text);
      if (!contextValid(ctx) || ctx.page.src !== model.source || origSels[0]?.k !== k || origSels[0]?.i !== hit.i) return;
      match = model.match; font = match.key;
      const color = model.glyphs.find(g => !g.blank)?.color || [0, 0, 0];
      st.color = '#' + color.map(n => n.toString(16).padStart(2, '0')).join('');
      st.alpha = 1; st.size = model.size / model.frame.scale; st.weight = match.weight;
    }
    if (hasMixedSelection()) return;
    origTextSel = { ...st, k, i: hit.i, font, text, invisible };
    $('tbTextCtl').style.display = 'flex';
    $('tbShapeCtl').style.display = 'none';
    $('textBar').classList.add('origText');
    $('textBar').classList.remove('imgSel');
    if (st.size) $('tbSize').value = Math.round(st.size);
    setCol('tbColor', st.color);
    $('tbColorOp').value = Math.round(st.alpha * 100);
    $('tbBold').classList.toggle('active', st.weight >= 600 || /bold|heavy|black/i.test(st.fam));
    $('tbFont').value = font;
    showOriginalFontOption(st.fam, invisible ? match : null);
    fontPickerController.syncSelect($('tbFont'));
    ensureScreenFont(font, st.weight >= 600 || /bold|heavy|black/i.test(st.fam), {
      characters: origTextSel?.text || '',
    });
    if (barPinned || !barHover) positionTextBar(origSelBoxes[0]);
    else $('textBar').style.display = 'flex';
  } catch {}
}
function origHideTextBar() {
  if (!origTextSel) return;
  origTextSel = null;
  clearOriginalFontOption();
  $('textBar').classList.remove('origText');
  if (!selText) $('textBar').style.display = 'none';
}
let origStyleBusy = false, origStylePend = null;
async function origApplyTextStyle(prop, value) {
  if (!origTextSel) return;
  if (origStyleBusy) { origStylePend = [prop, value]; return; }
  origStyleBusy = true;
  try {
    const { k, i } = origTextSel;
    if (origTextSel.invisible) {
      const selected = { ...origTextSel }, hit = origSels[0];
      if (!hit) return;
      const style = {};
      if (prop === 'font') style.font = value;
      else if (prop === 'bold') style.bold = value;
      else if (prop === 'size') style.ocrSize = value;
      else if (prop === 'color') style.ocrColor = value;
      else if (prop === 'colorOp') { toast('OCR 원본 유지 편집에서는 글자 불투명도를 유지합니다', 2500); return; }
      await origApplyOcrText(k, hit, selected.text, style);
      return;
    }
    if (prop === 'size') {
      const cur = origTextSel.size || 12;
      const s = value / cur;
      if (isFinite(s) && s > 0 && Math.abs(s - 1) > 1e-4 && origSels.length) {
        const [x0, y0] = origSels[0].b;
        origTextSel.size = value;
        lastTextStyle.size = value; saveLastStyles();
        await origTransform(k, [i], [s, 0, 0, s, x0 * (1 - s), y0 * (1 - s)], '크기 변경');
      }
    } else if (prop === 'color' || prop === 'colorOp') {
      if (prop === 'color') origTextSel.color = value; else origTextSel.alpha = value;
      lastTextStyle[prop] = value; saveLastStyles();
      const n = parseInt(origTextSel.color.slice(1), 16);
      const a = Math.round((origTextSel.alpha === undefined ? 1 : origTextSel.alpha) * 255);
      await origApply(k, (F, M, pg) => {
        const o = F.FPDFPage_GetObject(pg, i);
        if (!o || typeof F.FPDFPageObj_SetFillColor !== 'function') throw new Error('색 변경 미지원');
        F.FPDFPageObj_SetFillColor(o, (n >> 16) & 255, (n >> 8) & 255, n & 255, a);
      }, '색 변경', true, palLive);  
    } else if (prop === 'font' || prop === 'bold') {
      const sel = origSels[0];
      if (!sel) return;
      const text = await origReadTextContent(editorStore.pages[k], i);
      const applied = await origTextToOverlay(k, { i, b: sel.b }, text, {
        size: origTextSel.size, color: origTextSel.color, alpha: origTextSel.alpha,
        font: prop === 'font' ? value : (origTextSel.font || inferSupportedFontKey(origTextSel.fam, text)),
        bold: prop === 'bold' ? value : (origTextSel.weight >= 600 || undefined)
      });
      if (applied) toast('선택한 글꼴을 적용했습니다', 2000);
    }
  } finally {
    origStyleBusy = false;
    if (origStylePend) {
      const [pp, vv] = origStylePend;
      origStylePend = null;
      origApplyTextStyle(pp, vv);
    }
  }
}
async function origClickSelect(ev, wrap, k) {
  const ctx = editContext(k);
  if (mixedOperationPending || activeDocLocked()) return;
  const p = editorStore.pages[k];
  if (!origPageOk(p)) return;
  try {
    const hit = await origHitTest(k, ev.clientX, ev.clientY);
    if (contextValid(ctx) && !mixedOperationPending) await origPickHit(k, hit, ev.shiftKey);
  } catch (e) {
    console.error(e);
    toast('원본 인식 실패: ' + (e.message || e).toString().slice(0, 60), 3000);
  }
}

const origOcrModels = new Map();
let origOcrAnalysisTail = Promise.resolve();
function origOcrCanvas(width, height) {
  if (width * height > 8000000 || width <= 0 || height <= 0) throw new Error('OCR 편집 영역이 너무 큽니다');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
  return canvas;
}
function origOcrMetadata(page) {
  try {
    const value = page.node.get(pdfLib.raw.PDFName.of('DaydayPDFOCRVisualEdits'))?.decodeText();
    if (!value || value.length > 200000) return [];
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.filter(entry => typeof entry.text === 'string' && entry.text.length <= 1000 &&
      entry.frame?.origin?.length === 2 && entry.frame.origin.every(Number.isFinite) && entry.frame.scale === 4 &&
      Number.isFinite(entry.frame.ux) && Number.isFinite(entry.frame.uy) &&
      Math.abs(Math.hypot(entry.frame.ux, entry.frame.uy) - 1) < .001 &&
      entry.frame.width > 0 && entry.frame.height > 0 && entry.frame.width * entry.frame.height < 8000000 &&
      Array.isArray(entry.glyphs) && entry.glyphs.length === Array.from(entry.text).length &&
      entry.glyphs.every((g, i) => g.char === Array.from(entry.text)[i] && (/\s/u.test(g.char) ? !g.bbox : g.bbox &&
        Object.values(g.bbox).length === 4 && Object.values(g.bbox).every(Number.isFinite) &&
        g.bbox.x0 >= 0 && g.bbox.y0 >= 0 && g.bbox.x1 > g.bbox.x0 && g.bbox.y1 > g.bbox.y0 &&
        g.bbox.x1 <= entry.frame.width && g.bbox.y1 <= entry.frame.height))) : [];
  } catch { return []; }
}
async function origPrepareOcrEdit(k, hit, st, text) {
  const p = editorStore.pages[k], src = p.src, idx = p.idx;
  const key = `${src}:${idx}:${hit.i}:${text}`;
  if (origOcrModels.has(key)) return origOcrModels.get(key);
  const run = origOcrAnalysisTail.catch(() => {}).then(async () => {
    const source = sources.get(src);
    if (!source) throw new Error('원본 문서가 닫혔습니다');
    await origScanBatch(src, [idx]);
    const objects = origCache.get(`${src}:${idx}`) || [], object = objects.find(o => o.i === hit.i) || hit;
    const pdf = await pdfLib.raw.PDFDocument.load(source.bytes, { updateMetadata: false });
    const previous = origOcrMetadata(pdf.getPage(idx)).filter(entry => {
      if (entry.text !== text) return false;
      const points = entry.glyphs.filter(g => g.bbox).flatMap(g => [ocrRasterPoint(entry.frame, g.bbox.x0, g.bbox.y0),
        ocrRasterPoint(entry.frame, g.bbox.x1, g.bbox.y0), ocrRasterPoint(entry.frame, g.bbox.x0, g.bbox.y1),
        ocrRasterPoint(entry.frame, g.bbox.x1, g.bbox.y1)]);
      const bounds = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
        Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
      return bounds.every((n, i) => Math.abs(n - hit.b[i]) < 3);
    })
      .sort((a, b) => Math.hypot(a.frame.origin[0] - hit.b[0], a.frame.origin[1] - hit.b[3]) -
        Math.hypot(b.frame.origin[0] - hit.b[0], b.frame.origin[1] - hit.b[3]))[0];
    let frame = previous?.frame || ocrRasterFrame(object.ocrItem, object.ocrStyle, hit.b);
    const recognitionWidth = frame.width;
    if (!previous) frame = { ...frame, width: frame.width + 128 };  
    const page = await source.doc.getPage(idx + 1), viewport = page.getViewport({ scale: 1, rotation: 0 });
    const canvas = origOcrCanvas(frame.width, frame.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport, transform: ocrRasterTransform(frame, viewport.transform),
      background: '#ffffff' }).promise;
    let entries = previous?.glyphs;
    if (!entries) {
      const recognition = origOcrCanvas(recognitionWidth, frame.height);
      recognition.getContext('2d').drawImage(canvas, 0, 0);
      entries = ocrSymbolsForText(text, await recognizeOcrEditLine(recognition));
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    let model = { text, frame, image, recognitionWidth, glyphs: entries.map(entry => analyzeOcrGlyph(image, entry)), source: src, index: idx };
    const hint = resolveEditablePdfFont(st.fam, text, { invisible: true });
    let match;
    if (previous?.font && FONTS[previous.font] && Number.isFinite(previous.weight)) {
      const record = await fetchPdfFontRecord(previous.font, previous.weight >= 600, '');
      const base = fontkit.create(record.bytes);
      match = { key: previous.font, weight: previous.weight, bold: previous.weight >= 600, record,
        font: base.variationAxes?.wght ? base.getVariation({ wght: previous.weight }) : base, match: 'visual' };
    } else match = await matchOcrRasterFont(model, { hint, fonts: FONTS, fetchFont: fetchPdfFontRecord,
      fontkit, canvasFactory: origOcrCanvas });
    if (!previous) {
      const refined = refineOcrGlyphBoxes(model, match.font);
      model.glyphs = refined.map(entry => analyzeOcrGlyph(image, entry));
      match = await matchOcrRasterFont(model, { hint: match, fonts: FONTS, fetchFont: fetchPdfFontRecord,
        fontkit, canvasFactory: origOcrCanvas });
    }
    model = calibrateOcrLayout(model, match);
    validateOcrAppearance(model, origOcrCanvas);
    return model;
  });
  origOcrAnalysisTail = run.then(() => {}, () => {});
  origOcrModels.set(key, run);
  while (origOcrModels.size > 2) origOcrModels.delete(origOcrModels.keys().next().value);
  try { return await run; } catch (error) { origOcrModels.delete(key); throw error; }
}

async function origApplyOcrText(k, hit, newText, style = {}, prepared = null) {
  const ctx = editContext(k), p = ctx.page, src = p.src, idx = p.idx;
  const unchanged = () => contextValid(ctx) && p.src === src && p.idx === idx;
  try {
    const st = await origReadTextStyle(p, hit.i), text = await origReadTextContent(p, hit.i);
    let model = prepared || await origPrepareOcrEdit(k, hit, st, text);
    if (!unchanged() || model.source !== src || model.index !== idx) return false;
    const restyle = Object.keys(style).length > 0;
    if (newText === text && !restyle) return true;
    if (style.font || style.bold !== undefined) {
      const key = style.font || model.match.key, bold = style.bold ?? model.match.bold;
      const record = await fetchPdfFontRecord(key, bold, ''), base = fontkit.create(record.bytes);
      const font = base.variationAxes?.wght ? base.getVariation({ wght: bold ? 700 : 400 }) : base;
      model = { ...model, match: { ...model.match, key, bold, weight: bold ? 700 : 400, record, font } };
    }
    if (style.ocrSize) model = { ...model, size: style.ocrSize * model.frame.scale };
    const patch = composeOcrRasterEdit(model, newText, origOcrCanvas, { restyle, color: style.ocrColor });
    const snap = makeSnap();
    const removed = await withPdfiumDoc(sources.get(src).bytes, async (F, M, doc) => {
      const page = F.FPDF_LoadPage(doc, idx);
      try {
        removeTextForReplacement(F, page, hit.i);
        if (!F.FPDFPage_GenerateContent(page)) throw new Error('검색 텍스트 교체 실패');
      } finally { F.FPDF_ClosePage(page); }
      const writer = F.PDFiumExt_OpenFileWriter();
      let ptr = 0;
      try {
        if (!F.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('PDF 저장 실패');
        const size = F.PDFiumExt_GetFileWriterSize(writer); ptr = M.wasmExports.malloc(size);
        F.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return M.HEAPU8.slice(ptr, ptr + size);
      } finally { if (ptr) M.wasmExports.free(ptr); F.PDFiumExt_CloseFileWriter(writer); }
    });
    const original = await pdfLib.raw.PDFDocument.load(removed, { updateMetadata: false });
    const out = await pdfLib.raw.PDFDocument.create();
    const [page] = await out.copyPages(original, [idx]); out.addPage(page);
    for (const part of opaqueOcrPatchImages(model, patch, origOcrCanvas)) {
      const image = await out.embedPng(part.canvas.toDataURL('image/png'));
      const bottom = ocrRasterPoint(model.frame, part.x, part.y + part.canvas.height);
      page.drawImage(image, { x: bottom[0], y: bottom[1], width: part.canvas.width / model.frame.scale,
        height: part.canvas.height / model.frame.scale, rotate: degrees(Math.atan2(model.frame.uy, model.frame.ux) * 180 / Math.PI) });
    }
    if (newText) {
      out.registerFontkit(createAlignedSubsetFontkit(fontkit, { weight: model.match.weight }));
      const font = await out.embedFont(model.match.record.bytes, { subset: true, customName: model.match.record.customName });
      const glyphs = patch.glyphs.filter(g => g.bbox);
      if (glyphs.length) {
        const l = Math.min(...glyphs.map(g => g.bbox.x0)), r = Math.max(...glyphs.map(g => g.bbox.x1));
        const t = Math.min(...glyphs.map(g => g.bbox.y0)), b = Math.max(...glyphs.map(g => g.bbox.y1));
        const size = (b - t) / model.frame.scale / font.heightAtSize(1);
        const descent = font.heightAtSize(size) - font.heightAtSize(size, { descender: false });
        const baseline = ocrRasterPoint(model.frame, l, b - descent * model.frame.scale);
        const width = font.widthOfTextAtSize(newText, size);
        const sx = (r - l) / model.frame.scale / width;
        const name = page.node.newFontDictionary('DaydayOCREdit', font.ref), L = pdfLib.raw;
        page.pushOperators(L.pushGraphicsState(), L.beginText(), L.setTextRenderingMode(L.TextRenderingMode.Invisible),
          L.setFontAndSize(name, size), L.setTextMatrix(model.frame.ux * sx, model.frame.uy * sx,
            -model.frame.uy, model.frame.ux, baseline[0], baseline[1]), L.showText(font.encodeText(newText)), L.endText(), L.popGraphicsState());
      }
    }
    const records = origOcrMetadata(page).filter(entry => entry.text !== text ||
      Math.hypot(entry.frame.origin[0] - model.frame.origin[0], entry.frame.origin[1] - model.frame.origin[1]) > 2);
    if (newText) records.push({ text: newText, frame: model.frame, glyphs: patch.glyphs,
      font: model.match.key, weight: model.match.weight });
    page.node.set(pdfLib.raw.PDFName.of('DaydayPDFOCRVisualEdits'), pdfLib.raw.PDFHexString.fromText(JSON.stringify(records.slice(-50))));
    const bytes = await out.save({ useObjectStreams: false });
    if (!unchanged()) return false;
    const pdfDocument = await openPdfDocument(bytes.slice()).promise;
    if (!unchanged()) { await pdfDocument.destroy(); return false; }
    const sourceId = ++srcSeq;
    sources.set(sourceId, { bytes, doc: pdfDocument, name: sources.get(src)?.name || '원본' });
    ctx.doc.srcIds.push(sourceId); p.src = sourceId; p.idx = 0;
    pushSnap(snap); origClearSel();
    const wrap = document.getElementById('pg' + k);
    if (wrap) { delete wrap.dataset.origGhosts; enqueueRender(wrap); }
    scheduleThumbRefresh(k); origDecorateVisible();
    return true;
  } catch (error) {
    if (error.code === 'OCR_EDIT_UNAVAILABLE') toast(error.message, 5000);
    else { console.error(error); toast('OCR 수정 실패: ' + error.message, 4000); }
    return false;
  }
}

function origShowOcrUnavailable(text, error) {
  if (document.querySelector('.ocrUnavailableDialog')) return;
  const dialog = document.createElement('dialog'); dialog.className = 'ocrUnavailableDialog';
  dialog.dataset.reason = error.reason || 'analysis-failed';
  dialog.setAttribute('aria-labelledby', 'ocrUnavailableTitle');
  dialog.setAttribute('aria-describedby', 'ocrUnavailableNote');
  const title = document.createElement('h3'); title.id = 'ocrUnavailableTitle';
  title.textContent = error.code === 'OCR_EDIT_UNAVAILABLE' ? 'OCR 텍스트 수정 불가' : 'OCR 분석을 완료하지 못했습니다';
  const note = document.createElement('p'); note.id = 'ocrUnavailableNote';
  note.textContent = error.code === 'OCR_EDIT_UNAVAILABLE'
    ? '원본 모양을 유지하기 어려운 문장입니다. 검색과 복사는 계속 사용할 수 있습니다'
    : error.message;
  const input = document.createElement('textarea'); input.value = text; input.readOnly = true;
  input.rows = 3; input.setAttribute('aria-label', 'OCR 문장');
  const actions = document.createElement('div'); actions.className = 'ocrEditActions';
  const close = document.createElement('button'); close.textContent = '닫기';
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  actions.append(close); dialog.append(title, note, input, actions); document.body.append(dialog);
  dialog.showModal(); close.focus();
}

async function origEditOcrText(k, hit, st) {
  const ctx = editContext(k), p = ctx.page, src = p.src, idx = p.idx;
  const unchanged = () => contextValid(ctx) && p.src === src && p.idx === idx;
  const text = await origReadTextContent(p, hit.i);
  toast('글자 위치와 글꼴을 분석합니다. 최초 분석에는 시간이 걸릴 수 있습니다', 5000);
  let model;
  try { model = await origPrepareOcrEdit(k, hit, st, text); }
  catch (error) { if (unchanged()) origShowOcrUnavailable(text, error); return; }
  if (!unchanged() || document.querySelector('.ocrEditPanel')) return;
  origClearSel();
  const wrap = document.getElementById('pg' + k), { view, rT } = await origView(p);
  const panel = document.createElement('div'); panel.className = 'ocrEditPanel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'OCR 글자 수정');
  const label = document.createElement('div'); label.className = 'ocrEditLabel';
  label.textContent = `비슷한 글꼴: ${FONTS[model.match.key].label} · 굵기 ${model.match.weight}`;
  const input = document.createElement('textarea'); input.value = text; input.rows = 2;
  input.setAttribute('aria-label', 'OCR 문장'); input.spellcheck = false;
  const note = document.createElement('div'); note.className = 'ocrEditNote';
  note.textContent = '수정하지 않은 글자는 원본을 유지합니다. Enter 적용 · Esc 취소';
  const actions = document.createElement('div'); actions.className = 'ocrEditActions';
  const cancel = document.createElement('button'); cancel.textContent = '취소';
  const apply = document.createElement('button'); apply.textContent = '적용'; apply.className = 'primary';
  actions.append(cancel, apply); panel.append(label, input, note, actions); document.body.append(panel);
  const preview = origOcrCanvas(model.frame.width, model.frame.height);
  preview.className = 'ocrEditPreview'; preview.style.pointerEvents = 'none'; wrap.append(preview);
  const placePreview = () => {
    const points = [[0, 0], [model.frame.width, 0], [0, model.frame.height]].map(([x, y]) =>
      pagePtToFrac(p, view, rT, ...ocrRasterPoint(model.frame, x, y))).map(([x, y]) => [x * wrap.clientWidth, y * wrap.clientHeight]);
    preview.style.transform = `matrix(${(points[1][0] - points[0][0]) / preview.width},${(points[1][1] - points[0][1]) / preview.width},${(points[2][0] - points[0][0]) / preview.height},${(points[2][1] - points[0][1]) / preview.height},${points[0][0]},${points[0][1]})`;
  };
  placePreview();
  const rect = wrap.getBoundingClientRect(), rr = pageRectToDispRect(p, view, rT, hit.b);
  panel.style.left = Math.max(8, Math.min(innerWidth - 448, rect.left + rr.l * rect.width)) + 'px';
  panel.style.top = Math.max(8, Math.min(innerHeight - 200, rect.top + (rr.t + rr.h) * rect.height + 12)) + 'px';
  let finished = false;
  const cleanup = () => { finished = true; panel.remove(); preview.remove(); observer.disconnect(); };
  const observer = new MutationObserver(() => { if (!unchanged() || !wrap.isConnected) cleanup(); });
  observer.observe($('viewer'), { childList: true, subtree: true });
  const update = () => {
    const context = preview.getContext('2d'); context.clearRect(0, 0, preview.width, preview.height);
    try {
      const patch = composeOcrRasterEdit(model, input.value.replace(/[\r\n]+/g, ' '), origOcrCanvas);
      context.drawImage(patch.canvas, 0, 0);
      note.textContent = '수정하지 않은 글자는 원본을 유지합니다. Enter 적용 · Esc 취소'; apply.disabled = false; placePreview();
    } catch (error) { note.textContent = error.message; apply.disabled = true; }
  };
  const commit = async () => {
    if (finished || apply.disabled) return;
    apply.disabled = true;
    const value = input.value.replace(/[\r\n]+/g, ' ');
    if (value === text || !unchanged()) { cleanup(); return; }
    const ok = await origApplyOcrText(k, hit, value, {}, model);
    if (ok) cleanup(); else if (!finished) apply.disabled = false;
  };
  input.addEventListener('input', update);
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); cleanup(); }
    else if (event.key === 'Enter') { event.preventDefault(); commit(); }
  });
  cancel.addEventListener('click', cleanup); apply.addEventListener('click', commit);
  input.focus(); input.select();
}

async function origTextToOverlay(k, hit, newText, st) {
  const ctx = editContext(k);
  const p = editorStore.pages[k];
  const sourceAtStart = p.src, indexAtStart = p.idx;
  const unchanged = () => contextValid(ctx) && p.src === sourceAtStart && p.idx === indexAtStart;
  const original = await origReadTextStyle(p, hit.i);
  const invisible = isInvisiblePdfText(original);
  if (invisible) return origApplyOcrText(k, hit, newText);
  const match = resolveEditablePdfFont(original.fam, newText, { invisible });
  const font = st.font || match.key;
  const bold = st.bold !== undefined ? st.bold : original.weight >= 600;
  const loaded = await ensureScreenFont(font, bold, { characters: newText });
  if (!unchanged()) return false;
  if (!loaded) { toast('글꼴을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도하세요', 3500); return false; }
  const { view, rT } = await origView(p);
  const rr = pageRectToDispRect(p, view, rT, hit.b);
  let size = st.size || (hit.b[3] - hit.b[1]);
  if (!unchanged()) return false;
  const snap = makeSnap();
  const ok = await origApply(k, (F, M, pg) => {
    removeTextForReplacement(F, pg, hit.i);
  }, '텍스트 전환', false, true);
  if (!ok) return false;
  setOrigMode(false);
  const wrap = document.getElementById('pg' + k);
  const hex = /^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#000000';
  const obj = {
    fx: rr.l, fy: rr.t, text: newText,
    size: Math.max(6, Math.round(size * 100) / 100),
    color: hex,
    colorOp: st.alpha !== undefined && st.alpha < 1 ? st.alpha : undefined,
    font,
    bold: bold || undefined
  };
  editorStore.pages[k].texts.push(obj);
  pushSnap(snap);
  if (wrap) {
    positionMarks(wrap, editorStore.pages[k]);
    const mark = [...wrap.querySelectorAll('.textMark')].pop();
    if (mark) selectMark(k, obj, mark);
  }
  scheduleThumbRefresh(k);
  return true;
}

async function isolatePageSource(p) {
  const s = sources.get(p.src);
  const shared = editorStore.pages.some(q => q !== p && q.src === p.src) ||
                 editorStore.documents.some(d => d.pages !== editorStore.pages && d.pages.some(q => q !== p && q.src === p.src));
  if (!shared && s.doc.numPages === 1 && p.idx === 0) return;
  const lib = await pdfLib.raw.PDFDocument.load(s.bytes);
  const nd = await pdfLib.raw.PDFDocument.create();
  const [pg] = await nd.copyPages(lib, [p.idx]);
  nd.addPage(pg);
  const bytes = await nd.save({ useObjectStreams: false });
  await origSwapSource(p, bytes);
  p.idx = 0;
}

async function origSwapSource(p, bytes, canCommit) {
  return originalSourceEditor.swap(p, bytes, editorStore.activeDocument, canCommit);
}

function editContext(k) {
  return originalSourceEditor.captureContext(editorStore.activeDocument, editorStore.pages, k);
}
function contextValid(ctx) {
  return originalSourceEditor.contextValid(ctx, editorStore.activeDocument, editorStore.pages);
}

async function origApply(k, mutator, msg, keepSel, skipSnap, commit = null) {
  const ctx = editContext(k);
  const p = editorStore.pages[k];
  if (!p) return false;
  await getPdfium();  
  if (!contextValid(ctx)) return false;  
  const prevCursor = document.body.style.cursor;
  document.body.style.cursor = 'progress';
  try {
    const snap = makeSnap();  
    await isolatePageSource(p);
    const outBytes = await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
      const pg = F.FPDF_LoadPage(doc, p.idx);
      if (!pg) throw new Error('페이지 로드 실패');
      try {
        await mutator(F, M, pg, doc);
        if (!mutator.noGen && !F.FPDFPage_GenerateContent(pg)) throw new Error('콘텐츠 재생성 실패');
      } finally { F.FPDF_ClosePage(pg); }
      const wr = F.PDFiumExt_OpenFileWriter();
      try {
        if (!F.PDFiumExt_SaveAsCopy(doc, wr)) throw new Error('저장 실패');
        const size = F.PDFiumExt_GetFileWriterSize(wr);
        const op = M.wasmExports.malloc(size);
        F.PDFiumExt_GetFileWriterData(wr, op, size);
        const out = M.HEAPU8.slice(op, op + size);
        M.wasmExports.free(op);
        return out;
      } finally { F.PDFiumExt_CloseFileWriter(wr); }
    });
    if (!contextValid(ctx)) { console.warn('편집 중 문서가 바뀌어 결과를 폐기했습니다'); return false; }
    if (!await origSwapSource(p, outBytes, () => contextValid(ctx) && (!commit || commit.valid()))) return false;
    commit?.apply();
    if (!skipSnap) pushSnap(snap);  
    if (!keepSel) origClearSel();
    const wrap = document.getElementById('pg' + k);
    if (wrap) { delete wrap.dataset.origGhosts; enqueueRender(wrap); }  
    scheduleThumbRefresh(k);
    origDecorateVisible();
    return true;
  } catch (e) {
    console.error(e);
    toast('원본 ' + msg + ' 실패: ' + (e.message || e).toString().slice(0, 60), 3500);
    return false;
  } finally { document.body.style.cursor = prevCursor; }
}


const origVisualModels = new Map();
async function origPrepareVisualSelection(p, hit) {
  const key = `${p.src}:${p.idx}:${hit.i}`;
  if (origVisualModels.has(key)) return origVisualModels.get(key);
  const source = sources.get(p.src), index = p.idx;
  const run = (async () => {
    const frame = ocrRasterFrame(hit.ocrItem, hit.ocrStyle, hit.b);
    const page = await source.doc.getPage(index + 1), viewport = page.getViewport({ scale: 1, rotation: 0 });
    const canvas = origOcrCanvas(frame.width, frame.height), context = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport, transform: ocrRasterTransform(frame, viewport.transform), background: '#ffffff' }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const region = analyzeOcrVisualSelection(image, analyzeOcrGlyph);
    return { frame, image, ...ocrVisualCanvases(image, region, origOcrCanvas) };
  })();
  origVisualModels.set(key, run);
  while (origVisualModels.size > 8) origVisualModels.delete(origVisualModels.keys().next().value);
  try { return await run; } catch (error) { origVisualModels.delete(key); throw error; }
}

async function origOcrVisualOperation(k, idxs, matrix, msg, commit = null) {
  const ctx = editContext(k), p = ctx.page, src = p.src, idx = p.idx;
  const unchanged = () => contextValid(ctx) && p.src === src && p.idx === idx && (!commit || commit.valid());
  const cursor = document.body.style.cursor;
  document.body.style.cursor = 'progress';
  try {
    const objects = await origObjects(p), selected = objects.filter(o => idxs.includes(o.i));
    const models = [];
    for (const hit of selected.filter(o => o.invisible)) {
      if (selected.some(o => o.type === 3 && o.b[0] <= hit.b[0] && o.b[1] <= hit.b[1] &&
          o.b[2] >= hit.b[2] && o.b[3] >= hit.b[3])) continue;
      models.push(await origPrepareVisualSelection(p, hit));
    }
    if (!unchanged()) return false;
    const snap = makeSnap();
    const edited = await withPdfiumDoc(sources.get(src).bytes, async (F, M, doc) => {
      const pg = F.FPDF_LoadPage(doc, idx);
      try {
        for (const i of [...idxs].sort((a, b) => b - a)) {
          const object = F.FPDFPage_GetObject(pg, i);
          if (!object) throw new Error('오브젝트를 찾지 못했습니다');
          if (matrix) transformPdfObject(F, object, matrix);
          else {
            if (!F.FPDFPage_RemoveObject(pg, object)) throw new Error('오브젝트 제거 실패');
            F.FPDFPageObj_Destroy(object);
          }
        }
        if (!F.FPDFPage_GenerateContent(pg)) throw new Error('콘텐츠 재생성 실패');
      } finally { F.FPDF_ClosePage(pg); }
      const writer = F.PDFiumExt_OpenFileWriter(); let ptr = 0;
      try {
        if (!F.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('PDF 저장 실패');
        const size = F.PDFiumExt_GetFileWriterSize(writer); ptr = M.wasmExports.malloc(size);
        F.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return M.HEAPU8.slice(ptr, ptr + size);
      } finally { if (ptr) M.wasmExports.free(ptr); F.PDFiumExt_CloseFileWriter(writer); }
    });
    const L = pdfLib.raw, original = await L.PDFDocument.load(edited, { updateMetadata: false });
    const output = await L.PDFDocument.create(), [page] = await output.copyPages(original, [idx]); output.addPage(page);
    for (const model of models) for (const part of opaqueOcrPatchImages(model, model.patch, origOcrCanvas)) {
      const image = await output.embedPng(part.canvas.toDataURL('image/png'));
      const bottom = ocrRasterPoint(model.frame, part.x, part.y + part.canvas.height);
      page.drawImage(image, { x: bottom[0], y: bottom[1], width: part.canvas.width / model.frame.scale,
        height: part.canvas.height / model.frame.scale, rotate: degrees(Math.atan2(model.frame.uy, model.frame.ux) * 180 / Math.PI) });
    }
    if (matrix) for (const model of models) {
      const image = await output.embedPng(model.ink.toDataURL('image/png'));
      const bottom = ocrRasterPoint(model.frame, 0, model.frame.height);
      page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...matrix));
      page.drawImage(image, { x: bottom[0], y: bottom[1], width: model.frame.width / model.frame.scale,
        height: model.frame.height / model.frame.scale, rotate: degrees(Math.atan2(model.frame.uy, model.frame.ux) * 180 / Math.PI) });
      page.pushOperators(L.popGraphicsState());
    }
    page.node.delete(L.PDFName.of('DaydayPDFOCRVisualEdits'));
    const bytes = await output.save({ useObjectStreams: false });
    if (!unchanged()) return false;
    const editedDocument = await openPdfDocument(bytes.slice()).promise;
    if (!unchanged()) { await editedDocument.loadingTask.destroy(); return false; }
    const sourceId = ++srcSeq;
    sources.set(sourceId, { bytes, doc: editedDocument, name: sources.get(src)?.name || '원본' });
    ctx.doc.srcIds.push(sourceId); p.src = sourceId; p.idx = 0;
    commit?.apply();
    pushSnap(snap); origClearSel();
    const wrap = document.getElementById('pg' + k);
    if (wrap) { delete wrap.dataset.origGhosts; enqueueRender(wrap); }
    scheduleThumbRefresh(k); origDecorateVisible();
    if (matrix) {
      const next = await origObjects(p);
      if (editorStore.pages[k] === p) await origSelect(k, next.filter(o => idxs.includes(o.i)), !!commit);
    }
    return true;
  } catch (error) {
    console.error(error);
    toast(error.code === 'OCR_EDIT_UNAVAILABLE'
      ? `OCR ${msg} 불가: 글자 주변 배경을 복원할 수 없습니다`
      : `OCR ${msg} 실패: ${error.message}`, 4500);
    return false;
  } finally { document.body.style.cursor = cursor; }
}

async function origDeleteSel() {
  if (mixedOperationPending || !origSels.length) return;
  const commit = captureMixedOverlayCommit(null);
  if (commit) mixedOperationPending = true;
  try {
    if (origSels[0].isA) return await annotDeleteSel(commit);
    const k = origSels[0].k, ctx = editContext(k);
    const idxs = origSels.map(s => s.i).sort((a,b) => b-a);
    const objects = await origObjects(ctx.page);
    if (!contextValid(ctx) || (commit && !commit.valid())) return false;
    if (objects.some(o => o.invisible && idxs.includes(o.i)))
      return await origOcrVisualOperation(k,idxs,null,'삭제',commit);
    return await origApply(k,(F,M,pg) => {
      for (const i of idxs) {
        const o = F.FPDFPage_GetObject(pg,i);
        if (!o || !F.FPDFPage_RemoveObject(pg,o)) throw new Error('오브젝트 제거 실패');
        F.FPDFPageObj_Destroy(o);
      }
    },'삭제',false,false,commit);
  } finally { if (commit) mixedOperationPending = false; }
}

async function origTransform(k, idxs, m, msg, commit = null) {
  const objects = await origObjects(editorStore.pages[k]);
  if (objects.some(o => o.invisible && idxs.includes(o.i))) return origOcrVisualOperation(k, idxs, m, msg, commit);
  const ok = await origApply(k, (F, M, pg) => {
    for (const i of idxs) {
      const o = F.FPDFPage_GetObject(pg, i);
      if (!o) throw new Error('오브젝트를 찾지 못했습니다');
      transformPdfObject(F, o, m);
    }
  }, msg, true, false, commit);  
  if (!ok) return false;
  try {  
    const objs = await origObjects(editorStore.pages[k]);
    await origSelect(k, objs.filter(o => idxs.includes(o.i)), !!commit);
  } catch { origClearSel(); }
  return true;
}

async function origFilteredBytes(p, keepFn, stripAnnots = false) {
  return withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      const n = F.FPDFPage_CountObjects(pg);
      for (let i = n - 1; i >= 0; i--) {
        if (keepFn(i)) continue;
        const o = F.FPDFPage_GetObject(pg, i);
        if (o && F.FPDFPage_RemoveObject(pg, o)) F.FPDFPageObj_Destroy(o);
      }
      if (stripAnnots)
        for (let i = F.FPDFPage_GetAnnotCount(pg) - 1; i >= 0; i--) F.FPDFPage_RemoveAnnot(pg, i);
      if (!F.FPDFPage_GenerateContent(pg)) throw new Error('콘텐츠 재생성 실패');
    } finally { F.FPDF_ClosePage(pg); }
    const wr = F.PDFiumExt_OpenFileWriter();
    try {
      if (!F.PDFiumExt_SaveAsCopy(doc, wr)) throw new Error('저장 실패');
      const size = F.PDFiumExt_GetFileWriterSize(wr);
      const op = M.wasmExports.malloc(size);
      F.PDFiumExt_GetFileWriterData(wr, op, size);
      const out = M.HEAPU8.slice(op, op + size);
      M.wasmExports.free(op);
      return out;
    } finally { F.PDFiumExt_CloseFileWriter(wr); }
  });
}

async function origAnnotOnlyBytes(p, keepA) {
  return withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      for (let i = F.FPDFPage_CountObjects(pg) - 1; i >= 0; i--) {
        const o = F.FPDFPage_GetObject(pg, i);
        if (o && F.FPDFPage_RemoveObject(pg, o)) F.FPDFPageObj_Destroy(o);
      }
      for (let i = F.FPDFPage_GetAnnotCount(pg) - 1; i >= 0; i--)
        if (!keepA.has(i)) F.FPDFPage_RemoveAnnot(pg, i);
      if (!F.FPDFPage_GenerateContent(pg)) throw new Error('콘텐츠 재생성 실패');
    } finally { F.FPDF_ClosePage(pg); }
    const wr = F.PDFiumExt_OpenFileWriter();
    try {
      if (!F.PDFiumExt_SaveAsCopy(doc, wr)) throw new Error('저장 실패');
      const size = F.PDFiumExt_GetFileWriterSize(wr);
      const op = M.wasmExports.malloc(size);
      F.PDFiumExt_GetFileWriterData(wr, op, size);
      const out = M.HEAPU8.slice(op, op + size);
      M.wasmExports.free(op);
      return out;
    } finally { F.PDFiumExt_CloseFileWriter(wr); }
  });
}

function origLift(wrap, p, keepOriginal) {
  const cv = wrap.querySelector('canvas');
  const pageRect = wrap.getBoundingClientRect();
  const dpr = pageRect.width ? cv.width / pageRect.width : 1;
  const sprites = origSelBoxes.map(b => {
    const box = b.getBoundingClientRect();
    const s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(box.width * dpr));
    s.height = Math.max(1, Math.round(box.height * dpr));
    s._ox = box.left - pageRect.left; s._oy = box.top - pageRect.top;
    s.className = 'origSprite';
    s.style.left = s._ox + 'px'; s.style.top = s._oy + 'px';
    s.style.width = box.width + 'px'; s.style.height = box.height + 'px';
    wrap.appendChild(s);
    return s;
  });
  const lift = { sprites, done: false, bgApplied: false };
  const selIdx = new Set(origSels.map(s => s.i));
  const visualHits = origSels.filter(s => s.invisible).map(s => ({ ...s }));
  (async () => {
    try {
      const onlyBytes = await origFilteredBytes(p, i => selIdx.has(i), true);  
      if (lift.done) return;
      let full = null;
      const pdOnly = await openPdfDocument(onlyBytes.slice()).promise;
      const onlyId = -(++srcSeq);
      sources.set(onlyId, { bytes: onlyBytes, doc: pdOnly, name: '미리보기' });
      try {
        full = document.createElement('canvas');
        await paintPage({ ...p, src: onlyId }, full, editorStore.zoom, dpr, null,
          { background: 'rgba(0,0,0,0)' });
        full._offX = full._offY = 0;
      } finally { sources.delete(onlyId); try { pdOnly.destroy(); } catch {} }
      if (lift.done) return;
      let tmp = null;
      if (!keepOriginal) {  
        const bytes = await origFilteredBytes(p, i => !selIdx.has(i));
        if (lift.done) return;
        const pdoc = await openPdfDocument(bytes.slice()).promise;
        const tmpId = -(++srcSeq);  
        sources.set(tmpId, { bytes, doc: pdoc, name: '미리보기' });
        tmp = document.createElement('canvas');
        try { await paintPage({ ...p, src: tmpId }, tmp, editorStore.zoom, dpr); }
        finally { sources.delete(tmpId); try { pdoc.destroy(); } catch {} }
        if (tmp.width !== cv.width || tmp.height !== cv.height) tmp = null;  
      }
      if (visualHits.length) {
        const { viewport } = await pagePainter.getRenderSpec(p, editorStore.zoom * dpr);
        const [a, b, c, d, e, f] = viewport.transform;
        for (const hit of visualHits) {
          const model = await origPrepareVisualSelection(p, hit);
          const { frame } = model, [x, y] = frame.origin, scale = frame.scale;
          const transform = [(a * frame.ux + c * frame.uy) / scale, (b * frame.ux + d * frame.uy) / scale,
            (a * frame.uy - c * frame.ux) / scale, (b * frame.uy - d * frame.ux) / scale, a * x + c * y + e, b * x + d * y + f];
          const fc = full.getContext('2d'); fc.save(); fc.setTransform(...transform); fc.drawImage(model.ink, 0, 0); fc.restore();
          if (tmp) {
            const tc = tmp.getContext('2d'); tc.save();
            const croppedTransform = [...transform];
            croppedTransform[4] -= full._offX; croppedTransform[5] -= full._offY;
            tc.setTransform(...croppedTransform);
            tc.drawImage(model.erase, 0, 0); tc.restore();
          }
        }
      }
      if (lift.done) return;
      for (const s of sprites) {
        const c2 = s.getContext('2d');
        c2.clearRect(0, 0, s.width, s.height);
        c2.drawImage(full, full._offX + s._ox * dpr, full._offY + s._oy * dpr, s.width, s.height,
          0, 0, s.width, s.height);
      }
      if (tmp) {
        cv.getContext('2d').drawImage(tmp, 0, 0);
        if (wrap._tiles) { lift.tileLayer = wrap._tiles.layer; lift.tileLayer.style.visibility = 'hidden'; }
        lift.bgApplied = true;
      }
    } catch {}
  })();
  return lift;
}
function origDrop(wrap, lift, committed) {
  if (!lift) return;
  lift.done = true;
  if (lift.tileLayer) lift.tileLayer.style.visibility = '';
  if (lift.bgApplied) delete wrap._tilePreviewKey;
  if (committed) {
    setTimeout(() => lift.sprites.forEach(s => s.remove()), 300);
  } else {
    lift.sprites.forEach(s => s.remove());
    if (lift.bgApplied && wrap) { wrap.dataset.rendered = ''; enqueueRender(wrap); }  
  }
}

function origMoveStart(ev) {
  if (mixedOperationPending || spacePan || ev.button !== 0 || !origSels.length || ev.target.classList.contains('oh')) return;
  ev.preventDefault(); ev.stopPropagation();
  const k = origSels[0].k, wrap = document.getElementById('pg' + k);
  const isA = origSels[0].isA;  
  const mixed = hasMixedSelection();
  const ctx = editContext(k);
  const overlays = mixed ? selectedObjectEntries().map(s => ({mark:s.mark, translate:s.mark.style.translate})) : [];
  let dup = ev.ctrlKey, lastPointer = null;
  const ghosts = [];
  function enableCopy() {
    if (dup) return;
    dup = true;
    if (moved && lift && !isA) {
      origDrop(wrap,lift,false);
      for (const s of starts) { s.b.style.left=s.l+'px'; s.b.style.top=s.t+'px'; }
      lift = origLift(wrap,editorStore.pages[k],true);
      if (lastPointer) mv(lastPointer);
    }
  }
  const modifier = event => { if (event.key === 'Control') enableCopy(); };
  const sx = ev.clientX, sy = ev.clientY;
  const pageRect = wrap.getBoundingClientRect();
  const starts = origSelBoxes.map(b => {
    const box = b.getBoundingClientRect();
    return { b, l: box.left - pageRect.left, t: box.top - pageRect.top };
  });
  const moveDelta = trackObjectMoveDelta(ev);
  let moved = false, lift = null, fdx = 0, fdy = 0;
  const mv = e2 => {
    if (e2.ctrlKey) enableCopy();
    let { dx, dy } = moveDelta(e2);
    if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) < (e2.altKey ? 1 : 3)) return;
    lastPointer = e2;
    if (!moved) lift = isA ? { sprites: [], done: false, bgApplied: false }
                           : origLift(wrap, editorStore.pages[k], dup);  
    moved = true;
    if (e2.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }  
    fdx = dx; fdy = dy;
    if (dup && !ghosts.length) for (const s of overlays) {
      const ghost = s.mark.cloneNode(true);
      ghost.classList.remove('sel'); ghost.classList.add('objectCopyGhost');
      ghost.style.translate = s.translate; ghost.querySelectorAll('.objHandle').forEach(h => h.remove());
      s.mark.before(ghost); ghosts.push(ghost);
    }
    overlays.forEach(s => s.mark.style.translate =
      `calc(var(--mark-offset-x, 0px) + ${dx}px) calc(var(--mark-offset-y, 0px) + ${dy}px)`);
    starts.forEach((s, j) => {
      s.b.style.left = (s.l + dx) + 'px';
      s.b.style.top = (s.t + dy) + 'px';
      const sp = lift.sprites[j];
      if (sp) { sp.style.left = (s.l + dx) + 'px'; sp.style.top = (s.t + dy) + 'px'; }
    });
  };
  const up = async e2 => {
    if (e2.ctrlKey) enableCopy();
    window.removeEventListener('keydown',modifier,true);
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    ghosts.forEach(ghost=>ghost.remove());
    if (!moved) {
      try {
        const om = overlayMarkAt(wrap, e2.clientX, e2.clientY);
        if (om) {
          if (e2.shiftKey) toggleObjectMultiSelection(k,om._ctx.obj,om);
          else if (!mixed || !selectedObjectEntries().some(s => s.obj === om._ctx.obj)) selectMark(k,om._ctx.obj,om);
          return;
        }
        const hit = await origHitTest(k, e2.clientX, e2.clientY);
        if (hit && contextValid(ctx)) {
          if (e2.shiftKey) await origPickHit(k,hit,true);
          else if (!origSels.some(s => s.isA ? s.a === hit.a && hit.isA : s.i === hit.i && !hit.isA))
            await origSelect(k,[hit]);
        }
      } catch {}
      return;
    }
    try {
      if (!contextValid(ctx)) { origDrop(wrap,lift,false); return; }
      if (!dup) {
        const ok = await queueOriginalMove(k,fdx,fdy);
        origDrop(wrap,lift,ok);
        return;
      }
      const p = editorStore.pages[k];
      const { view, rT } = await origView(p);
      const [x1, y1] = dispToPagePt(p, wrap, view, rT, sx, sy);
      const [x2, y2] = dispToPagePt(p, wrap, view, rT, sx + fdx, sy + fdy);
      const ddx = x2 - x1, ddy = y2 - y1;
      let ok;
      const selections = [...origSels];
      const selectedOverlays = mixed ? selectedObjectEntries().map(entry => entry.obj) : [];
      const copies = copyMixedOverlayObjects(selectedOverlays,p);
      const rect = wrap.getBoundingClientRect();
      if (copies.length) translateObjectBundle(copies,0,fdx/rect.width,fdy/rect.height,Infinity,Infinity);
      const valid = () => contextValid(ctx) && selectedOverlays.every(o => p.texts.includes(o));
      mixedOperationPending = true;
      try {
        ok = await origDuplicate(k,selections.filter(s=>!s.isA).map(s=>s.i),ddx,ddy,0,null,{
          annotations: selections.filter(s=>s.isA).map(s=>s.a), valid,
          apply() { p.texts.push(...copies); positionMarks(wrap,p); }
        });
        if (ok && valid()) {
          if (copies.length) selectPastedObjectBundle(k,copies,0,wrap);
          const hits = isA ? (await origAnnots(p)).slice(-selections.length) : (await origObjects(p)).slice(-1);
          if (valid()) await origSelect(k,hits,!!copies.length);
        }
      } finally { mixedOperationPending = false; }
      origDrop(wrap, lift, ok);
    } catch (e) { console.error(e); origDrop(wrap, lift, false); }
    finally { overlays.forEach(s => s.mark.style.translate = s.translate); }
  };
  window.addEventListener('keydown', modifier, true);
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}

async function origDuplicate(k, idxs, ddx, ddy, rotateDeg, rotateCenter, group = null) {
  const ctx = editContext(k);
  const p = editorStore.pages[k];
  if (!p) return false;
  await getPdfium();
  if (!contextValid(ctx)) return false;
  const prevCursor = document.body.style.cursor;
  document.body.style.cursor = 'progress';
  try {
    const snap = makeSnap();
    await isolatePageSource(p);
    const srcB = sources.get(p.src).bytes;
    const A = await pdfLib.raw.PDFDocument.load(srcB);
    const page = A.getPage(0);
    if (idxs.length) {
      const keep = new Set(idxs);
      const onlyBytes = await origFilteredBytes(p, i => keep.has(i), true);
      const only = await pdfLib.raw.PDFDocument.load(onlyBytes);
      const box = page.getMediaBox();
      const emb = await A.embedPage(only.getPage(p.idx), { left:box.x,bottom:box.y,
        right:box.x+box.width,top:box.y+box.height },[1,0,0,1,0,0]);
      const draw = { x: ddx, y: ddy };
      if (rotateDeg && rotateCenter) {
        const rad = rotateDeg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        draw.x += rotateCenter.x - c * rotateCenter.x + s * rotateCenter.y;
        draw.y += rotateCenter.y - s * rotateCenter.x - c * rotateCenter.y;
        draw.rotate = degrees(rotateDeg);
      }
      page.drawPage(emb, draw);
    }
    if (group?.annotations.length) {
      const name = pdfLib.raw.PDFName.of, annotations = page.node.Annots();
      const shift = array => A.context.obj(array.asArray().map((n,i)=>n.asNumber()+(i%2 ? ddy : ddx)));
      for (const index of group.annotations) {
        const original = annotations.lookup(index), copy = original.clone(A.context);
        for (const key of ['Rect','QuadPoints','L','Vertices','CL']) {
          const coords = original.lookup(name(key));
          if (coords instanceof pdfLib.raw.PDFArray) copy.set(name(key),shift(coords));
        }
        const ink = original.lookup(name('InkList'));
        if (ink) copy.set(name('InkList'),A.context.obj(ink.asArray().map((_,i)=>shift(ink.lookup(i)))));
        copy.delete(name('Popup')); copy.delete(name('NM')); copy.delete(name('IRT'));
        annotations.push(A.context.register(copy));
      }
    }
    const outBytes = await A.save({ useObjectStreams: false });
    if (!contextValid(ctx)) { console.warn('복제 중 문서가 바뀌어 결과를 폐기했습니다'); return false; }
    const valid = () => contextValid(ctx) && (!group || group.valid());
    if (!valid() || !await origSwapSource(p,new Uint8Array(outBytes),valid)) return false;
    group?.apply();
    pushSnap(snap);
    origClearSel();
    const wrap = document.getElementById('pg' + k);
    if (wrap) { delete wrap.dataset.origGhosts; enqueueRender(wrap); }
    scheduleThumbRefresh(k);
    origDecorateVisible();
    return true;
  } catch (e) {
    console.error(e);
    toast('원본 복제 실패: ' + (e.message || e).toString().slice(0, 60), 3500);
    return false;
  } finally { document.body.style.cursor = prevCursor; }
}

function origResizeStart(ev, box, dir) {
  if (ev.button !== 0 || origSels.length !== 1) return;
  ev.preventDefault(); ev.stopPropagation();
  const sel = origSels[0], k = sel.k, wrap = document.getElementById('pg' + k);
  const isA = sel.isA;
  const style = getComputedStyle(box);
  const start = { x: ev.clientX, y: ev.clientY, l: parseFloat(style.left), t: parseFloat(style.top),
    w: parseFloat(style.width), h: parseFloat(style.height) };
  let moved = false, lift = null;
  let resized = { ...start, flipX: false, flipY: false };
  const mv = e2 => {
    const dx = e2.clientX - start.x, dy = e2.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    if (!moved) lift = isA ? { sprites: [], done: false, bgApplied: false } : origLift(wrap, editorStore.pages[k]);
    moved = true;
    resized = resizeObjectBox(start, dir, dx, dy, e2.shiftKey);
    const { l, t, w, h } = resized;
    box.style.left = l + 'px'; box.style.top = t + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
    const sp = lift.sprites[0];
    if (sp) {
      sp.style.left = l + 'px'; sp.style.top = t + 'px';
      sp.style.width = w + 'px'; sp.style.height = h + 'px';
      sp.style.transform = `scale(${resized.flipX ? -1 : 1}, ${resized.flipY ? -1 : 1})`;
    }
  };
  const up = async () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    if (!moved) return;
    try {
      const p = editorStore.pages[k];
      const { view, rT } = await origView(p);
      const r = wrap.getBoundingClientRect();
      const c1 = dispToPagePt(p, wrap, view, rT, r.left + resized.l, r.top + resized.t);
      const c2 = dispToPagePt(p, wrap, view, rT, r.left + resized.l + resized.w, r.top + resized.t + resized.h);
      const nx0 = Math.min(c1[0], c2[0]), nx1 = Math.max(c1[0], c2[0]);
      const ny0 = Math.min(c1[1], c2[1]), ny1 = Math.max(c1[1], c2[1]);
      let ok;
      if (isA) {
        ok = await annotSetRects(k, [{ a: sel.a, rect: [nx0, ny0, nx1, ny1] }], '주석 크기 변경');
      } else {
        const matrix = originalResizeMatrix(start, resized,
          (x, y) => { const f = pagePtToFrac(p, view, rT, x, y); return [f[0] * r.width, f[1] * r.height]; },
          (x, y) => pageFracToPt(p, view, rT, x / r.width, y / r.height));
        ok = matrix ? await origTransform(k, [sel.i], matrix, '크기 변경') : false;
      }
      origDrop(wrap, lift, ok);
      if (!ok) { box.style.left = start.l + 'px'; box.style.top = start.t + 'px';
        box.style.width = start.w + 'px'; box.style.height = start.h + 'px'; }
    } catch (e) { console.error(e); origDrop(wrap, lift, false); }
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}

function rotationReadout() {
  let label;
  return {
    show(event, angle) {
      if (!label) {
        label = document.createElement('span');
        label.className = 'rotationReadout';
        document.body.appendChild(label);
      }
      label.textContent = angle.toFixed(2) + '°';
      label.style.left = Math.min(window.innerWidth - 75,event.clientX+14)+'px';
      label.style.top = Math.max(0,event.clientY-28)+'px';
    },
    close() { label?.remove(); },
  };
}
function origRotateStart(ev, box) {
  if (ev.button !== 0 || origSels.length !== 1 || origSels[0].isA) return;
  ev.preventDefault(); ev.stopPropagation();
  const sel = origSels[0], k = sel.k, wrap = document.getElementById('pg' + k);
  const dup = ev.ctrlKey, readout = rotationReadout();
  const br = box.getBoundingClientRect();
  const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
  let lastA = Math.atan2(ev.clientY - cy, ev.clientX - cx), accum = 0;
  let moved = false, lift = null, previewDeg = 0;
  const mv = e2 => {
    const a = Math.atan2(e2.clientY - cy, e2.clientX - cx);
    let da = a - lastA;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    accum += da * (e2.altKey ? .02 : 1); lastA = a;
    if (!moved && Math.hypot(e2.clientX - ev.clientX, e2.clientY - ev.clientY) < 2) return;
    if (!moved) lift = origLift(wrap, editorStore.pages[k], dup);
    moved = true;
    previewDeg = accum * 180 / Math.PI;
    if (e2.shiftKey) previewDeg = Math.round(previewDeg / 90) * 90;
    readout.show(e2,previewDeg);
    box.style.transformOrigin = 'center center';
    box.style.transform = `rotate(${previewDeg}deg)`;
    if (lift && lift.sprites[0]) {
      lift.sprites[0].style.transformOrigin = 'center center';
      lift.sprites[0].style.transform = `rotate(${previewDeg}deg)`;
    }
  };
  const up = async () => {
    window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
    readout.close();
    if (!moved) return;
    const rad = -previewDeg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    const pcx = (sel.b[0] + sel.b[2]) / 2, pcy = (sel.b[1] + sel.b[3]) / 2;
    const matrix = [c, s, -s, c, pcx - c * pcx + s * pcy, pcy - s * pcx - c * pcy];
    let ok = false;
    try {
      ok = dup
        ? await origDuplicate(k, [sel.i], 0, 0, -previewDeg, { x: pcx, y: pcy })
        : await origTransform(k, [sel.i], matrix, '회전');
    }
    catch (e) { console.error(e); }
    if (!ok && box.isConnected) box.style.transform = '';
    origDrop(wrap, lift, ok);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}

async function origEditText(k, hit) {
  const p = editorStore.pages[k];
  const F0 = await getPdfium();
  if (typeof F0.FPDFText_SetText === 'function') return origInlineEditText(k, hit);
  let text = '', fsize = 0, color = '#000000';
  await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      const o = F.FPDFPage_GetObject(pg, hit.i);
      const tp = F.FPDFText_LoadPage(pg);
      const len = F.FPDFTextObj_GetText(o, tp, 0, 0);  
      if (len > 0) {
        const buf = M.wasmExports.malloc(len);
        F.FPDFTextObj_GetText(o, tp, buf, len);
        text = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(buf, buf + len)).replace(/\0+$/, '');
        M.wasmExports.free(buf);
      }
      if (typeof F.FPDFText_ClosePage === 'function') F.FPDFText_ClosePage(tp);
      if (typeof F.FPDFTextObj_GetFontSize === 'function') {
        const fb = M.wasmExports.malloc(4);
        if (F.FPDFTextObj_GetFontSize(o, fb)) fsize = new Float32Array(M.HEAPU8.buffer, fb, 1)[0];
        M.wasmExports.free(fb);
      }
      if (typeof F.FPDFPageObj_GetFillColor === 'function') {
        const cb = M.wasmExports.malloc(16);
        if (F.FPDFPageObj_GetFillColor(o, cb, cb + 4, cb + 8, cb + 12)) {
          const u = new Uint32Array(M.HEAPU8.buffer, cb, 4);
          color = '#' + [u[0], u[1], u[2]].map(v => (v & 255).toString(16).padStart(2, '0')).join('');
        }
        M.wasmExports.free(cb);
      }
    } finally { F.FPDF_ClosePage(pg); }
  });
  const originalStyle = await origReadTextStyle(p, hit.i);
  const { view, rT } = await origView(p);
  const rr = pageRectToDispRect(p, view, rT, hit.b);
  const ok = await origApply(k, (F, M, pg) => {
    const o = F.FPDFPage_GetObject(pg, hit.i);
    if (!o || !F.FPDFPage_RemoveObject(pg, o)) throw new Error('원본 제거 실패');
    F.FPDFPageObj_Destroy(o);
  }, '텍스트 전환');
  if (!ok) return;
  setOrigMode(false);  
  const wrap = document.getElementById('pg' + k);
  if (!wrap) return;
  const obj = {
    fx: rr.l, fy: rr.t, text,
    size: Math.max(6, Math.round(originalStyle.size || fsize || (hit.b[3] - hit.b[1]))),
    color: /^#[0-9a-f]{6}$/i.test(originalStyle.color || '') ? originalStyle.color
      : (/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'),
    colorOp: originalStyle.alpha !== undefined && originalStyle.alpha < 1 ? originalStyle.alpha : undefined,
    font: inferSupportedFontKey(originalStyle.fam, text),
    bold: originalStyle.weight >= 600 || undefined
  };
  const snap2 = makeSnap();
  editorStore.pages[k].texts.push(obj);
  positionMarks(wrap, editorStore.pages[k]);
  const mark = [...wrap.querySelectorAll('.textMark')].pop();
  if (!mark) return;
  mark._preSnap = snap2;
  mark._orig = '';
  selectMark(k, obj, mark);
  startMarkEdit(mark);
  mark._preSnap = snap2;
}

async function origInlineEditText(k, hit) {
  const ctx = editContext(k);
  const p = editorStore.pages[k], wrap = document.getElementById('pg' + k);
  if (!wrap) return;
  const sourceStyle = await origReadTextStyle(p, hit.i);
  const invisible = isInvisiblePdfText(sourceStyle);
  if (invisible) return origEditOcrText(k, hit, sourceStyle);
  let text = '', fsize = 0, color = '#000000', famName = '', fweight = 0, pageText = '', fembedded = true;
  await withPdfiumDoc(sources.get(p.src).bytes, async (F, M, doc) => {
    const pg = F.FPDF_LoadPage(doc, p.idx);
    if (!pg) throw new Error('페이지 로드 실패');
    try {
      const o = F.FPDFPage_GetObject(pg, hit.i);
      const tp = F.FPDFText_LoadPage(pg);
      const len = F.FPDFTextObj_GetText(o, tp, 0, 0);
      if (len > 0) {
        const buf = M.wasmExports.malloc(len);
        F.FPDFTextObj_GetText(o, tp, buf, len);
        text = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(buf, buf + len)).replace(/\0+$/, '');
        M.wasmExports.free(buf);
      }
      if (typeof F.FPDFText_CountChars === 'function' && typeof F.FPDFText_GetText === 'function') {
        try {
          const nch = F.FPDFText_CountChars(tp);
          if (nch > 0) {
            const b2 = M.wasmExports.malloc((nch + 1) * 2);
            const got = F.FPDFText_GetText(tp, 0, nch, b2);
            pageText = new TextDecoder('utf-16le')
              .decode(M.HEAPU8.slice(b2, b2 + Math.max(0, got) * 2)).replace(/\0+$/, '');
            M.wasmExports.free(b2);
          }
        } catch {}
      }
      if (typeof F.FPDFText_ClosePage === 'function') F.FPDFText_ClosePage(tp);
      if (typeof F.FPDFTextObj_GetFontSize === 'function') {
        const fb = M.wasmExports.malloc(4);
        if (F.FPDFTextObj_GetFontSize(o, fb)) fsize = new Float32Array(M.HEAPU8.buffer, fb, 1)[0];
        M.wasmExports.free(fb);
      }
      if (fsize && typeof F.FPDFPageObj_GetMatrix === 'function') {
        const mb = M.wasmExports.malloc(24);
        if (F.FPDFPageObj_GetMatrix(o, mb)) {
          const mm = new Float32Array(M.HEAPU8.buffer, mb, 6);
          const vs = Math.hypot(mm[2], mm[3]);
          if (vs > 0) fsize *= vs;
        }
        M.wasmExports.free(mb);
      }
      if (typeof F.FPDFPageObj_GetFillColor === 'function') {
        const cb = M.wasmExports.malloc(16);
        if (F.FPDFPageObj_GetFillColor(o, cb, cb + 4, cb + 8, cb + 12)) {
          const u = new Uint32Array(M.HEAPU8.buffer, cb, 4);
          color = `rgb(${u[0] & 255},${u[1] & 255},${u[2] & 255})`;
        }
        M.wasmExports.free(cb);
      }
      if (typeof F.FPDFTextObj_GetFont === 'function') {
        try {
          const fh = F.FPDFTextObj_GetFont(o);
          famName = readPdfiumFontName(F, M, fh);
          if (typeof F.FPDFFont_GetWeight === 'function') fweight = F.FPDFFont_GetWeight(fh) || 0;
          if (typeof F.FPDFFont_GetIsEmbedded === 'function') fembedded = !!F.FPDFFont_GetIsEmbedded(fh);
        } catch {}
      }
    } finally { F.FPDF_ClosePage(pg); }
  });
  if (!contextValid(ctx)) return;
  origClearSel();
  const { view, rT } = await origView(p);
  const rr = pageRectToDispRect(p, view, rT, hit.b);
  let bg = '#fff';
  try {
    const cv = wrap.querySelector('canvas');
    const cx = Math.max(0, Math.min(cv.width - 1, Math.round(rr.l * cv.width) - 5));
    const cy = Math.max(0, Math.min(cv.height - 1, Math.round((rr.t + rr.h / 2) * cv.height)));
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(cx, cy, 1, 1).data;
    if (d[3] > 128) bg = `rgb(${d[0]},${d[1]},${d[2]})`;  
  } catch {}
  const cleanFam = famName.replace(/^[A-Z]{6}\+/, '');
  const fontMatch = resolveEditablePdfFont(cleanFam, text, { invisible });
  const inferredFont = fontMatch.key;
  const inferredBold = fweight >= 600 || /bold|heavy|black/i.test(cleanFam);
  const face = await ensureScreenFont(inferredFont, inferredBold, { characters: text });
  if (!contextValid(ctx)) return;
  if (!face && invisible) { toast('글꼴을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도하세요', 3500); return; }
  const inp = document.createElement('div');
  inp.className = 'origEdit';
  inp.contentEditable = 'true';
  inp.textContent = text;
  inp.style.left = (rr.l * 100) + '%';
  inp.style.top = (rr.t * 100) + '%';
  inp.style.minWidth = (rr.w * 100) + '%';
  inp.style.minHeight = (rr.h * 100) + '%';
  inp.style.background = bg;
  inp.style.color = color;
  const serif = /times|serif|georgia|garamond|book|batang|myeongjo|myungjo|명조|바탕/i.test(cleanFam);
  inp.style.fontFamily = (!face && cleanFam ? `"${cleanFam}", ` : '') +
    (FONTS[inferredFont]?.css || (serif ? 'Georgia, "Times New Roman", serif' : 'Arial, "Malgun Gothic", sans-serif'));
  if (inferredBold) inp.style.fontWeight = '700';
  wrap.appendChild(inp);
  const dispH = wrap.clientHeight * rr.h;
  const paperViewport = await sources.get(p.src).doc.getPage(p.idx + 1).then(page => page.getViewport({ scale: 1, rotation: rT }));
  const paperFit = p.resize ? Math.min(p.resize[0] / paperViewport.width, p.resize[1] / paperViewport.height) : 1;
  inp.style.fontSize = (fsize ? fsize * editorStore.zoom * paperFit : dispH * 0.78) + 'px';
  inp.style.lineHeight = dispH + 'px';
  inp.addEventListener('input', () =>
    scheduleScreenFont(inferredFont, inferredBold, inp.innerText.replace(/\n+$/, '')));
  try {
    if (text.trim()) {
      const fpx = parseFloat(inp.style.fontSize);
      const mc = document.createElement('canvas').getContext('2d');
      mc.font = (inp.style.fontWeight === '700' ? '700 ' : '') + fpx + 'px ' + inp.style.fontFamily;
      const w0 = mc.measureText(text).width;
      const targetW = wrap.clientWidth * rr.w;
      if (w0 > 4) {
        const fit = Math.max(0.6, Math.min(1.6, targetW / w0));
        if (Math.abs(fit - 1) > 0.06) inp.style.fontSize = (fpx * fit) + 'px';
      }
    }
  } catch {}
  inp.focus();
  const rng = document.createRange();
  rng.selectNodeContents(inp);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(rng);
  let done = false;
  const finish = async commit => {
    if (done) return;
    done = true;
    const nv = inp.innerText.replace(/\n+$/, '');
    inp.remove();
    if (!commit || nv === text || !contextValid(ctx)) return;
    const known = new Set(text + pageText);
    const newChars = [...new Set(nv)].filter(c => c !== '\n' && !known.has(c));
    const cjkName = /batang|myeongjo|myungjo|gulim|gothic|dotum|malgun|nanum|spoqa|hy|kopub|명조|바탕|고딕|굴림|돋움/i.test(famName);
    let risky = false;
    if (newChars.length) {
      if (/^[A-Z]{6}\+/.test(famName)) risky = true;
      else if (!fembedded && !cjkName && newChars.some(c => c.charCodeAt(0) > 127)) risky = true;
    }
    if (invisible || fontMatch.match === 'exact' || risky) {
      const st = await origReadTextStyle(p, hit.i);  
      if (!contextValid(ctx)) return;
      const ok2 = await origTextToOverlay(k, hit, nv, {
        size: st.size, color: st.color, alpha: st.alpha, weight: st.weight,
        font: resolveEditablePdfFont(st.fam, nv, { invisible }).key, bold: inferredBold,
      });
      if (ok2 && invisible) toast('OCR 텍스트를 수정했습니다', 2000);
      else if (ok2 && risky && fontMatch.match !== 'exact') toast('지원 글꼴로 텍스트를 수정했습니다', 2500);
      return;
    }
    const ok = await origApply(k, (F, M, pg) => {
      const o = F.FPDFPage_GetObject(pg, hit.i);
      if (!o) throw new Error('오브젝트를 찾지 못했습니다');
      const ws = new Uint8Array((nv.length + 1) * 2);  
      for (let j = 0; j < nv.length; j++) {
        const c = nv.charCodeAt(j);
        ws[j * 2] = c & 255; ws[j * 2 + 1] = c >> 8;
      }
      const sp = M.wasmExports.malloc(ws.length);
      M.HEAPU8.set(ws, sp);
      const r = F.FPDFText_SetText(o, sp);
      M.wasmExports.free(sp);
      if (!r) throw new Error('텍스트 변경 실패');
    }, '텍스트 수정');  
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();  
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }  
    else if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

function setOrigMode(on) {
  if (on) stopDrawing();
  if (on && activeDocLocked()) { lockNotice(); return; }
  origMode = on;
  $('btnOrig').classList.toggle('active', on);
  document.body.classList.toggle('origMode', on);
  if (!on) { origClearSel(); origClearGhosts(); }
  else {
    cancelRegion();  
    setTextMode(false);
    stopShapeDraft();
    stopConnectorPickMode();
    deselectText();
    getPdfium().then(origDecorateVisible)
      .catch(error => {
        console.error(error);
        toast(desktopViewMode
          ? 'PDFium 엔진 로컬 파일을 불러오지 못했습니다 — 실행 폴더를 확인하세요'
          : 'PDFium 엔진 로드 실패 — 인터넷 연결을 확인하세요', 4000);
      });
  }
}

let origSquelchClick = false;
viewer.addEventListener('mousedown', ev => {
  if (!origMode || ev.button !== 0 || spacePan) return;
  if (ev.target.closest('.origEdit')) return;  
  const oe = viewer.querySelector('.origEdit');
  if (oe) oe.blur();
  if (ev.target.closest('.origBox, .obj')) return;  
  const selectionDocument = editorStore.activeDocument;
  const selectionStillActive = () => origMode && !spacePan && !activeDocLocked() &&
    editorStore.activeDocument === selectionDocument;
  startPageMarquee({
    windowObject: window, viewer, event: ev, isActive: selectionStillActive,
    acceptsPage: wrap => origPageOk(editorStore.pages[+wrap.dataset.k], true),
    async onSelect(wrap, rect, { startX: sx, startY: sy, endX, endY }) {
      origSquelchClick = true;
      setTimeout(() => origSquelchClick = false, 0);
      if (!wrap) { origClearSel(); return; }
      const k = +wrap.dataset.k, p = editorStore.pages[k];
      const e2 = { clientX: endX, clientY: endY };
      try {
        const { view, rT } = await origView(p);
        const [ax, ay] = dispToPagePt(p, wrap, view, rT, sx, sy);
        const [bx, by] = dispToPagePt(p, wrap, view, rT, e2.clientX, e2.clientY);
        const rx0 = Math.min(ax, bx), rx1 = Math.max(ax, bx);
        const ry0 = Math.min(ay, by), ry1 = Math.max(ay, by);
        const objs = await origObjects(p);
        if (!selectionStillActive() || editorStore.pages[k] !== p) return;
        let hits = objs.filter(o => o.b[0] < rx1 && o.b[2] > rx0 && o.b[1] < ry1 && o.b[3] > ry0);
        if (!hits.length) {  
          const anns = await origAnnots(p).catch(() => []);
          hits = anns.filter(o => o.b[0] < rx1 && o.b[2] > rx0 && o.b[1] < ry1 && o.b[3] > ry0);
        }
        if (!selectionStillActive() || editorStore.pages[k] !== p) return;
        if (!hits.length) {  
          const cx0 = Math.min(sx, e2.clientX), cx1 = Math.max(sx, e2.clientX);
          const cy0 = Math.min(sy, e2.clientY), cy1 = Math.max(sy, e2.clientY);
          const marks = [...wrap.querySelectorAll('.obj')].filter(m => {
            const r = m.getBoundingClientRect();
            return r.left < cx1 && r.right > cx0 && r.top < cy1 && r.bottom > cy0;
          });
          if (marks.length) {
            origClearSel();
            selectPastedObjectBundle(k, marks.map(mark => mark._ctx.obj), 0, wrap);
            toast(marks.length + '개 선택됨');
            return;
          }
        }
        await origSelect(k, hits);
        if (!hits.length) toast('영역 안에 원본 오브젝트가 없습니다');
      } catch (e) { console.error(e); }
    },
  });
}, true);

viewer.addEventListener('dblclick', async e => {
  if (!origMode) return;
  if (e.target.closest('.origEdit')) return;  
  if (e.target.closest('.obj')) return;       
  const wrap = e.target.closest('.pageWrap');
  if (!wrap) return;
  const k = +wrap.dataset.k, p = editorStore.pages[k];
  if (!origPageOk(p, true)) return;
  e.preventDefault();
  try {
    const hit = await origHitTest(k, e.clientX, e.clientY);
    if (!hit) return;
    if (hit.isA) { toast('주석 내용 수정은 지원하지 않습니다 — 이동·크기·색·삭제만 가능'); return; }
    if (hit.type !== 1) { toast('텍스트 오브젝트만 내용을 수정할 수 있습니다'); return; }
    await origEditText(k, hit);
  } catch (err) {
    console.error(err);
    toast('텍스트 수정 실패: ' + (err.message || err).toString().slice(0, 60), 3000);
  }
});

let spacePan = false, panDrag = null;
function clearSpacePan() {
  spacePan = false; panDrag = null;
  document.body.classList.remove('spacePan');
  viewer.style.cursor = '';
}
window.addEventListener('keyup', e => {
  if (e.key !== ' ') return;
  spacePan = false;
  document.body.classList.remove('spacePan');
  if (!panDrag) viewer.style.cursor = '';
}, true);
window.addEventListener('blur', clearSpacePan);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearSpacePan(); });
viewer.addEventListener('mousedown', e => {
  if (!spacePan) return;
  e.preventDefault();
  panDrag = { x: e.clientX, y: e.clientY, l: viewer.scrollLeft, t: viewer.scrollTop };
  viewer.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!panDrag) return;
  viewer.scrollLeft = panDrag.l - (e.clientX - panDrag.x);
  viewer.scrollTop = panDrag.t - (e.clientY - panDrag.y);
});
window.addEventListener('mouseup', () => {
  if (!panDrag) return;
  panDrag = null;
  origSquelchClick = true;  
  setTimeout(() => origSquelchClick = false, 0);
  viewer.style.cursor = spacePan ? 'grab' : '';
});


let autosaveTimer = null, autosavePending = false;
const savedSrcKeys = new Set();  
function scheduleAutosave() {
  if (!autosaveEnabled) return;
  autosavePending = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(doAutosave, 1500);
}
async function clearAutosave() {
  await idbDel(autosaveSessionKey);
  for (const k of await idbKeys()) if (String(k).startsWith(autosaveSrcPrefix)) await idbDel(k);
  savedSrcKeys.clear();
}
async function doAutosave(options = {}) {
  const throwOnError = options?.throwOnError === true;
  clearTimeout(autosaveTimer);
  if (!autosaveEnabled) { autosavePending = false; return true; }
  try {
    editorStore.captureActiveScroll(viewer.scrollTop);
    if (!editorStore.documents.length) { autosavePending = false; await clearAutosave(); return; }
    const usedSrc = new Set();
    editorStore.documents.forEach(d => collectSourceRefs(d.pages, usedSrc));  
    for (const id of usedSrc) {           
      if (savedSrcKeys.has(id)) continue;
      const s = sources.get(id);
      if (s) { await idbPut(autosaveSrcPrefix + id, { id, name: s.name, bytes: s.bytes }); savedSrcKeys.add(id); }
    }
    const docArr = editorStore.documents.map(toAutosaveDocumentDto);
    await idbPut(autosaveSessionKey, { t: Date.now(), v: 2, docs: docArr, srcIds: [...usedSrc], active: editorStore.documents.indexOf(editorStore.activeDocument) });
    autosavePending = false;
    for (const k of await idbKeys()) {
      if (!String(k).startsWith(autosaveSrcPrefix)) continue;
      const id = +String(k).slice(autosaveSrcPrefix.length);
      if (!usedSrc.has(id)) { await idbDel(k); savedSrcKeys.delete(id); }
    }
    return true;
  } catch (e) {
    console.warn('임시저장 실패', e);
    if (throwOnError) throw e;
    return false;
  }
}
function handleAutosaveVisibilityChange() {
  if (document.visibilityState === 'hidden' && autosavePending) doAutosave();
}
function handleBeforeUnload(e) {
  const unsavedNoAutosave = !autosaveEnabled && editorStore.documents.some(d => d.dirty);
  if (!autosavePending && !unsavedNoAutosave) return;
  if (autosavePending) doAutosave();  
  e.preventDefault(); e.returnValue = '';
}

function remapTransferPage(p, idMap, trusted) {
  return remapTransferPageDto(p, id => idMap.get(id), sanitizeTextObj, trusted);
}
const STARTUP_STORAGE_TIMEOUT_MS = 10000;
const STARTUP_PDF_OPEN_TIMEOUT_MS = 30000;
const STARTUP_PAINT_TIMEOUT_MS = 12000;

function withStartupTimeout(promise, timeoutMs, message) {
  if (!(timeoutMs > 0)) return Promise.resolve(promise);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function loadTransferredSources(srcList, options = {}) {
  const openTimeoutMs = Math.max(0, Number(options.openTimeoutMs) || 0);
  const idMap = new Map();
  for (const sv of (srcList || [])) {
    if (!sv || !sv.bytes) continue;
    const bytes = sv.bytes instanceof Uint8Array ? sv.bytes : new Uint8Array(sv.bytes);
    const loadingTask = openPdfDocument(bytes.slice());
    let pdoc;
    try {
      pdoc = await withStartupTimeout(
        loadingTask.promise,
        openTimeoutMs,
        `복구 PDF를 ${Math.round(openTimeoutMs / 1000)}초 안에 열지 못했습니다`,
      );
    } catch (error) {
      try { await loadingTask.destroy(); } catch {}
      throw error;
    }
    const nid = ++srcSeq;
    sources.set(nid, { bytes, doc: pdoc, name: sv.name || '원본.pdf',
                       locked: await detectPdfLocked(pdoc) });
    idMap.set(sv.id, nid);
  }
  return idMap;
}
async function materializeTransferredDocs(payload, options = {}) {
  const incoming = payload && (payload.docs || (payload.doc ? [payload.doc] : null));
  if (!incoming || !incoming.length) throw new Error('전송할 문서 데이터를 찾을 수 없습니다');
  const idMap = await loadTransferredSources(payload.sources, options);
  return recoveryFeature.materializePayload(payload, idMap);
}

async function receiveTransferredDocuments(payload, sender = null) {
  let opened = [];
  try {
    const received = await materializeTransferredDocs(payload);
    opened = received.opened;
    const requestedIndex = Number(payload?.targetIndex);
    const insertAt = Number.isFinite(requestedIndex)
      ? Math.max(0, Math.min(editorStore.documents.length, Math.floor(requestedIndex)))
      : editorStore.documents.length;
    editorStore.documents.splice(insertAt, 0, ...opened);
    switchDoc(opened[received.openAt]);
    editorStore.selectedDocuments.clear();
    opened.forEach(d => editorStore.selectedDocuments.add(d));
    editorStore.tabSelectionAnchor = opened[0] || null;
    renderTabs();
    if (autosaveEnabled) scheduleAutosave();
    const from = sender && sender.windowNumber ? `창 ${sender.windowNumber}에서 ` : '';
    toast(opened.length > 1
      ? `${from}${opened.length}개 문서를 받았습니다`
      : `${from}문서를 받았습니다`);
    return true;
  } catch (e) {
    if (opened.length) {
      const failed = new Set(opened);
      const activeFailed = failed.has(editorStore.activeDocument);
      const remaining = editorStore.documents.filter(d => !failed.has(d));
      if (activeFailed) switchDoc(remaining[remaining.length - 1] || null);
      editorStore.documents = remaining;
      editorStore.selectedDocuments.clear();
      renderTabs();
    }
    sweepSources();
    console.error(e);
    throw e;
  }
}
windowTransfer.setReceiveHandler(payload => receiveTransferredDocuments(payload));
windowPeers.setReceiveHandler((payload, sender) => receiveTransferredDocuments(payload, sender));
windowPeers.setDragRequestHandler((documentIds, target) => sendDraggedDocsToPeer(documentIds, target));
async function restoreAutosavedSession(s) {
  const srcList = s.sources ||
    (await withStartupTimeout(
      Promise.all((s.srcIds || []).map(id => idbGet(autosaveSrcPrefix + id))),
      STARTUP_STORAGE_TIMEOUT_MS,
      '이전 작업 저장소가 응답하지 않습니다',
    )).filter(Boolean);
  const idMap = await loadTransferredSources(srcList, {
    openTimeoutMs: STARTUP_PDF_OPEN_TIMEOUT_MS,
  });
  let first = null;
  for (const dd of s.docs) {
    const d = recoveryFeature.materializeDocument(dd, idMap, {
      trusted: false,
      includeRuntimeState: false,
    });
    editorStore.documents.push(d);
    if (!first) first = d;
  }
  switchDoc(editorStore.documents[s.active] || first);
  renderTabs();
}
async function receiveDetachedDocument(token) {
  if (!windowTransfer.canClaimFromOpener())
    throw new Error('원래 편집기 창과 연결할 수 없습니다');
  const payload = windowTransfer.claimFromOpener(token);
  try {
    const { opened, openAt } = await materializeTransferredDocs(payload, {
      openTimeoutMs: STARTUP_PDF_OPEN_TIMEOUT_MS,
    });
    editorStore.documents.push(...opened);
    switchDoc(opened[openAt]);
    document.title = opened.length > 1 ? opened.length + '개 문서 - PDF 편집기' : opened[0].name + ' - PDF 편집기';
    if (autosaveEnabled) scheduleAutosave();
    windowTransfer.finishToOpener(token, true);
    toast(opened.length > 1 ? opened.length + '개 문서를 새 창에서 열었습니다' : '분리된 문서를 열었습니다');
    return true;
  } catch (e) {
    try { windowTransfer.finishToOpener(token, false, e.message || String(e)); } catch {}
    throw e;
  }
}

function waitForStartupContentPaint() {
  return waitForStartupContentReady({
    hasActiveContent: () => !!editorStore.activeDocument && editorStore.pages.length > 0,
    hasPaintedContent: () => [...viewer.querySelectorAll('.pageWrap canvas')].some(canvas =>
      canvas.hasAttribute('width') && canvas.hasAttribute('height') &&
      canvas.width > 0 && canvas.height > 0),
    isRenderSettled: () => !renderCoordinator.busy && renderCoordinator.size === 0,
    requestFrame: callback => requestAnimationFrame(callback),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    now: () => performance.now(),
    timeoutMs: STARTUP_PAINT_TIMEOUT_MS,
    settleDelayMs: 250,
  });
}

windowTransfer.setStartupPromise((async () => {
  let restored = false;
  let receivedDetached = false;
  try {
    const desktopRestoreRequested = desktopViewMode &&
      new URLSearchParams(location.search).get('restore') === '1';
    if (desktopViewMode && !desktopRestoreRequested) return;
    if (!autosaveEnabled) {
      await withStartupTimeout(
        clearAutosave(),
        STARTUP_STORAGE_TIMEOUT_MS,
        '이전 작업 저장소 정리가 지연되고 있습니다',
      );
    }
    else {
      const s = await withStartupTimeout(
        idbGet(autosaveSessionKey),
        STARTUP_STORAGE_TIMEOUT_MS,
        '이전 작업 저장소가 응답하지 않습니다',
      );
      if (s && s.docs && s.docs.length) {
        spin(true, '이전 작업 여는 중...');
        await restoreAutosavedSession(s);
        restored = true;
        toast('세션 복구 완료 (' + editorStore.documents.length + '개 문서)');
      }
    }
    if (detachToken && !restored) {
      spin(true, '문서를 새 창으로 옮기는 중...');
      receivedDetached = await receiveDetachedDocument(detachToken);
    }
  } catch (e) {
    console.error(e);
    toast((detachToken ? '새 창 분리 실패: ' : '복구 실패: ') + (e.message || e).toString().slice(0, 70), 4500);
  } finally { spin(false); }
  if (restored || receivedDetached) await waitForStartupContentPaint();
})());

let lastErrToast = 0;
function reportError(msg) {
  const now = Date.now();
  if (now - lastErrToast < 5000) return;
  lastErrToast = now;
  toast('⚠ 오류: ' + String(msg).slice(0, 80), 4000);
}
function handleWindowError(e) { if (e.message) reportError(e.message); }
function handleUnhandledRejection(e) {
  reportError(e.reason && (e.reason.message || e.reason) || '알 수 없는 오류');
}

function isMobileLayout() { return window.matchMedia('(max-width: 768px)').matches; }
function closeTopUiForBack() {
  if (tutorialController.close()) return true;
  if (moResolve) { moDone(null); return true; }
  if (saveErrorOpen) { closeSaveFailDialog(); return true; }
  if (safeSaveResolve) { finishSafeCopySave(false); return true; }
  if (closeDocResolve) { finishCloseDocConfirm('cancel'); return true; }
  const overlays = ['exOverlay', 'imgCrOverlay', 'crOverlay', 'szOverlay', 'prOverlay', 'setOverlay', 'mgOverlay'];
  const openOverlay = overlays.find(id => $(id).classList.contains('show'));
  if (openOverlay) {
    $(openOverlay).classList.remove('show');
    if (openOverlay === 'imgCrOverlay') imgCrCtx = null;
    return true;
  }
  if ($('tabList').classList.contains('show')) { closeTabList(); return true; }
  if ($('searchBar').style.display === 'flex') { closeSearch(); return true; }
  if ($('palettePop').style.display !== 'none') { closePalette(); return true; }
  const openMenu = ['ctxMenu', 'tabMenu', 'shapeMenu', 'objMenu'].find(id => $(id).style.display === 'block');
  if (openMenu) { $(openMenu).style.display = 'none'; return true; }
  if (isMobileLayout() && !sidebar.classList.contains('hidden')) { toggleThumbs(); return true; }
  return false;
}
const dialogHost = createDialogHost({
  windowObject: window,
  historyObject: history,
  locationObject: location,
  shouldArm: () => location.protocol !== 'file:' && !!history.pushState &&
    isMobileLayout(),
  closeTop: closeTopUiForBack,
  notifyExit: () => toast('뒤로가기를 한 번 더 누르면 앱을 나갑니다', 2200),
});

dialogHost.mount();

let thumbPinchWidth = 0;
const pointerGestureRouter = createPointerGestureRouter({
  documentObject: document,
  viewer,
  sidebar,
  isMobileLayout,
  onViewerPinchStart: (x, y) => {
    drawingController.cancel();
    finishObjectDrag?.();
    viewportZoom.beginPinch(x, y);
  },
  onViewerScale: viewportZoom.movePinch,
  onViewerPinchEnd: viewportZoom.endPinch,
  onSidebarPinchStart: () => { thumbPinchWidth = thumbW; },
  onSidebarScale: factor => {
    thumbW = Math.min(THUMB_DISPLAY_MAX,
      Math.max(THUMB_DISPLAY_MIN, Math.round(thumbPinchWidth * factor)));
    document.documentElement.style.setProperty('--thumbw', thumbW + 'px');
    settings.set('thumbW', thumbW);
  },
  onViewerPointerDown: event => {
    if (event.pointerType === 'touch' && !event.isPrimary) {
      finishObjectDrag?.();
      event.stopPropagation();
      return;
    }
    if (isMobileLayout() && !sidebar.classList.contains('hidden')) toggleThumbs();
  },
});

const sourceAppVersion = document.querySelector('meta[name="pdf-editor-version"]')?.content || '0.0.0.0';
if ($('appVer').textContent.indexOf('__APP') === 0) $('appVer').textContent = 'DEV ' + sourceAppVersion;
$('documentLicenseText').closest('details').addEventListener('toggle', async event => {
  if (!event.target.open || $('documentLicenseText').dataset.loaded) return;
  try {
    const notices = await Promise.all(['/THIRD_PARTY_NOTICES.txt', '/assets/pdfjs/6.2.108/wasm/LICENSE_QUICKJS',
      '/assets/pdfjs/6.2.108/wasm/LICENSE_PDFJS_QUICKJS', '/licenses/document-tools/NOTICES.txt'].map(async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('고지를 불러오지 못했습니다.');
      return response.text();
    }));
    $('documentLicenseText').textContent = notices.join('\n\n');
    $('documentLicenseText').dataset.loaded = 'true';
  }
  catch (error) { $('documentLicenseText').textContent = error.message; }
});
$('setLicenseAppVer').textContent = $('appVer').textContent;
$('betaTag').title = '베타 ' + $('appVer').textContent + ' — 자주 업데이트됩니다';

if (!isMobileLayout()) setThumbnailColumns(1);
setViewMode(viewMode);
let lastLayoutWidth = window.innerWidth;
function handleWindowResize() {
  if (desktopViewMode && (window.innerWidth < 96 || window.innerHeight < 96)) return;
  if ($('prOverlay').classList.contains('show')) updatePrintPreview();
  hideDesktopTabTip();
  const widthChanged = Math.abs(window.innerWidth - lastLayoutWidth) > 1;
  lastLayoutWidth = window.innerWidth;
  const previousPanelWidth = panelW;
  syncPanelWidth(panelW);
  if (panelW !== previousPanelWidth) settings.set('panelW', panelW);
  const editingMobileText = isMobileLayout() && !!selText?.mark?.isContentEditable;
  if (editorStore.fitWidth && widthChanged && !editingMobileText) doFitWidth();
  if ($('tabList').classList.contains('show')) positionTabList();
  if (barManual && $('textBar').style.display !== 'none') applyBarPinAnchor(barManual);
  else if ($('textBar').style.display !== 'none') positionTextBar();
  if ($('shapeTextBar').style.display !== 'none') positionShapeTextBar();
  restoreRegionRect();
}

const tabController = createTabController(({ listen, assign }) => {
  listen($('tabStrip'), 'wheel', handleTabStripWheel, { passive: false });
  listen($('tabStrip'), 'dragover', handleTabStripDragOver);
  listen($('tabStrip'), 'dragleave', handleTabStripDragLeave);
  listen($('tabStrip'), 'drop', handleTabStripDrop);
  listen($('tabStrip'), 'scroll', hideDesktopTabTip, { passive: true });
  assign($('btnTabList'), 'onclick', handleTabListButton);
  listen($('tabList'), 'click', event => event.stopPropagation());
  listen($('tabMenu'), 'click', handleTabMenuClick);
});

const viewerController = createViewerController(({ listen, assign }) => {
  for (const input of [$('pageJump'), $('zoomInput')]) {
    let touchInput = false;
    listen(input, 'pointerdown', event => { touchInput = event.pointerType === 'touch'; });
    listen(input, 'pointercancel', () => { touchInput = false; });
    listen(input, 'click', () => {
      if (touchInput) input.select();
      touchInput = false;
    });
  }
  assign($('pgPrev'), 'onclick', () => gotoPage(editorStore.currentPage));
  assign($('pgNext'), 'onclick', () => gotoPage(editorStore.currentPage + 2));
  listen($('pageJump'), 'keydown', handlePageJumpKeydown);
  listen($('zoomInput'), 'change', applyZoomInput);
  listen($('zoomInput'), 'keydown', handleZoomInputKeydown);
  listen(viewer, 'wheel', handleViewerZoomWheel, { passive: false });
  listen(viewer, 'wheel', handleViewModeWheel, { passive: false });
  listen(viewer, 'mousedown', handleViewModeMouseDown);
  listen($('sfInput'), 'input', handleSearchInput);
  listen($('sfInput'), 'keydown', handleSearchInputKeydown);
  assign($('sfPrev'), 'onclick', () => stepMatch(-1));
  assign($('sfNext'), 'onclick', () => stepMatch(1));
  assign($('sfClose'), 'onclick', closeSearch);
  document.querySelectorAll('.sbtn.vm').forEach(button =>
    assign(button, 'onclick', () => setViewMode(button.dataset.vm)));
});

const toolbarController = createToolbarController(({ listen, assign }) => {
  listen(window, 'pointerdown', commitObjectToolbarNumberBeforePointerDown, true);
  assign($('tbDelete'), 'onclick', deleteSelText);
  assign($('btnOpen'), 'onclick', handleOpenButton);
  assign($('btnAppend'), 'onclick', openMergeDialog);
  assign($('btnSave'), 'onclick', saveAll);
  assign($('btnSaveAs'), 'onclick', saveAsAll);
  assign($('btnPrint'), 'onclick', () => openPrintDialog(false));
  assign($('btnRedo'), 'onclick', redo);
  assign($('btnRotL'), 'onclick', () => rotate(-90));
  assign($('btnRotR'), 'onclick', () => rotate(90));
  assign($('btnBlank'), 'onclick', addBlank);
  assign($('btnUndo'), 'onclick', undo);
  assign($('btnZoomIn'), 'onclick', () => viewportZoom.to(editorStore.zoom * 1.2));
  assign($('btnZoomOut'), 'onclick', () => viewportZoom.to(editorStore.zoom / 1.2));
  assign($('btnFitPage'), 'onclick', () => { updateCurrentPage(); doFitPage(true); });
  assign($('btnFit'), 'onclick', doFitWidth);
  assign($('btnThumbs'), 'onclick', toggleThumbs);
  assign($('btnSettings'), 'onclick', openSettingsDialog);
  assign($('btnText'), 'onclick', toggleTextModeFromButton);
  assign($('btnSearch'), 'onclick', openSearch);
  assign($('btnOrig'), 'onclick', () => setOrigMode(!origMode));
  assign($('btnRegion'), 'onclick', () =>
    (regionMode || regionBox || stampData) ? cancelRegion() : startRegionSelect());
  assign($('regionCopyCommit'), 'onclick', async event => {
    event.stopPropagation();
    await regionCommit();
  });
  assign($('regionCancel'), 'onclick', event => {
    event.stopPropagation();
    cancelRegion();
  });
  assign($('btnShape'), 'onclick', handleShapeButton);
  assign($('btnConnectArrow'), 'onclick', handleConnectArrowButton);
  listen($('shapeMenu'), 'click', handleShapeMenuClick);
  assign($('fileInput'), 'onchange', handleFileInputChange);
});

const dialogsController = createDialogsController(({ listen, assign }) => {
  assign($('saveErrorOk'), 'onclick', closeSaveFailDialog);
  listen($('saveErrorOverlay'), 'keydown', handleSaveErrorKeydown, true);
  assign($('safeSaveOk'), 'onclick', () => finishSafeCopySave(true));
  assign($('safeSaveCancel'), 'onclick', () => finishSafeCopySave(false));
  listen($('safeSaveOverlay'), 'keydown', handleSafeSaveKeydown, true);
  assign($('closeDocOk'), 'onclick', () => finishCloseDocConfirm('discard'));
  assign($('closeDocSave'), 'onclick', () => finishCloseDocConfirm('save'));
  assign($('closeDocSaveAs'), 'onclick', () => finishCloseDocConfirm('save-as'));
  assign($('closeDocCancel'), 'onclick', () => finishCloseDocConfirm('cancel'));
  listen(window, 'keydown', handleCloseDocKeydown, true);
  assign($('moTabs'), 'onclick', () => moDone('tabs'));
  assign($('moMerge'), 'onclick', () => moDone('merge'));
  assign($('moCancel'), 'onclick', () => moDone(null));
  assign($('prCancel'), 'onclick', () => $('prOverlay').classList.remove('show'));
  assign($('szCancel'), 'onclick', () => $('szOverlay').classList.remove('show'));
  assign($('crCancel'), 'onclick', () => $('crOverlay').classList.remove('show'));
  assign($('imgCrCancel'), 'onclick', closeImageCropDialog);
  assign($('exCancel'), 'onclick', () => $('exOverlay').classList.remove('show'));
  assign($('setCancel'), 'onclick', () => $('setOverlay').classList.remove('show'));
});

const toolbarDisplayController = createToolbarDisplayController({
  documentObject: document, windowObject: window,
  read: () => settings.get('toolbarDisplay'),
  write: value => settings.set('toolbarDisplay', value),
  storageKey: 'pdfEditor.toolbarDisplay',
  readSize: () => settings.get('toolbarSize'),
  writeSize: value => settings.set('toolbarSize', value),
  sizeStorageKey: 'pdfEditor.toolbarSize',
});

const tutorialController = createEditorTutorial({
  documentObject: document, windowObject: window,
  getDocument: () => editorStore.activeDocument,
  hasSeen: () => settings.get('tutorialSeen') === '1',
  rememberSeen: () => settings.set('tutorialSeen', '1'),
  replayButton: $('setTutorialStart'),
});

const textStyleShortcutRouter = createShortcutRouter({ target: window, onKeyDown: handleTextStyleShortcut, options: true });
const shortcutRouter = createShortcutRouter({ target: window, onKeyDown: handleEditorShortcut });
const searchShortcutRouter = createShortcutRouter({
  target: window,
  onKeyDown: handleSearchShortcut,
  options: true,
});
const clipboardController = createClipboardController({ target: window, onPaste: handleClipboardPaste });

function isWindowsMutationTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest('.obj, .objHandle, [contenteditable="true"], #shapeMenu, #palettePop, #objMenu')) return true;
  return origMode && !!target.closest('.pageWrap');
}

function handleWindowsBlockedPointer(event) {
  if (windowsAccess.current.canEditCurrentDocuments || !isWindowsMutationTarget(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  requireWindowsEdit();
}

function handleWindowsBlockedDrag(event) {
  if (windowsAccess.current.canEditCurrentDocuments) return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('#sidebar, .pageWrap, .obj')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  requireWindowsEdit();
}

const windowsHostBridge = Object.freeze({
  version: 3,
  nativeTabsVersion: 1,
  setAccessPolicy: policy => setWindowsAccessPolicy(policy),
  openFiles: files => {
    requireWindowsNewWork({ throwOnBlocked: true });
    return openFiles(files, false);
  },
  async mergeFiles(files) {
    requireWindowsNewWork({ throwOnBlocked: true });
    openMergeDialog();
    mgItems = [];
    await addMergeFiles(files);
  },
  closeActiveDocument() {
    if (editorStore.activeDocument) closeDoc(editorStore.activeDocument);
  },
  activateNativeTab,
  closeNativeTab,
  moveNativeTab,
  detachNativeTab,
  requestNativeTabTransfer,
  publishNativeTabs,
});

async function openDesktopSharedDocument(metadata, bytes) {
  if (!desktopViewMode || !['open-document', 'append-document', 'merge-candidate'].includes(metadata?.cmd)) return false;
  const safeName = String(metadata.name || '문서.pdf');
  let opened;
  if (metadata.cmd === 'merge-candidate') {
    if (metadata.resetMerge) {
      openMergeDialog();
      mgItems = [];
      renderMgList();
    }
    await addMergeFiles([new File([bytes], safeName, { type: 'application/pdf' })]);
    opened = true;
  } else {
    const file = { name: safeName, size: bytes.byteLength, type: 'application/pdf',
      _docPath: metadata.docPath || null, arrayBuffer: async () => bytes.buffer };
    opened = await openFiles([file], metadata.cmd === 'append-document');
  }
  desktopHost.send({
    type: 'document-ready',
    apiVersion: 4,
    requestId: metadata.requestId || null,
    ok: !!opened,
    purpose: metadata.cmd,
  });
  return opened;
}

function handleDesktopHostCommand(message) {
  if (!desktopViewMode || !message || typeof message !== 'object') return;
  if (message.cmd === 'background-preview') {
    const paused = message.paused === true;
    if (backgroundPreviewPaused === paused) return;
    backgroundPreviewPaused = paused;
    thumbnailCoordinator.setPaused(paused);
    if (paused) {
      clearTimeout(thumbPrepassT);
      pageLifecycle.invalidateSweeps();
      thumbnailWorkerController.shutdown();
    } else {
      scheduleDimsSweep();
      scheduleThumbPrepass();
    }
  } else if (message.cmd === 'trim-preview-cache') {
    if (!backgroundPreviewPaused) return;
    for (const id of sources.keys()) {
      renderCoordinator.invalidateSource(id);
      thumbnailCoordinator.invalidateSource(id);
    }
  } else if (message.cmd === 'save-target') {
    desktopCanSaveInPlace = message.canSaveInPlace === true;
    syncSaveButtons();
  } else if (message.cmd === 'prepare-document') displayPainter.warmup();
  else if (message.cmd === 'update-state') showUpdateState(message);
  else if (message.cmd === 'set-access-policy') setWindowsAccessPolicy(message.policy || {});
  else if (message.cmd === 'set-theme' && ['dark', 'light'].includes(message.theme)) {
    ({ theme, glassEffect } = readThemePreferences(settings));
    applyTheme(false);
    syncThemeOpts();
  }
  else if (message.cmd === 'dismiss-boot-splash') {
    window.dispatchEvent(new Event('pdf-editor-dismiss-boot-splash'));
  }
  else if (message.cmd === 'set-window-resize-enabled') {
    document.documentElement.dataset.windowResizeEnabled = message.enabled ? 'true' : 'false';
  }
  else if (message.cmd === 'toggle-thumbnails') toggleThumbs();
  else if (message.cmd === 'choose-multi-open') {
    const requestId = String(message.requestId || '');
    askMultiOpen(Math.max(2, +message.count || 2)).then(mode => desktopHost.send({
      type: 'multi-open-choice', apiVersion: 4, requestId, mode: mode || null,
    }));
  }
  else if (message.cmd === 'flush') {
    (async () => {
      try { commitPendingNudge(); } catch {}
      if (!autosaveEnabled && String(message.requestId).startsWith('idle-')) throw new Error('Autosave is disabled');
      if (autosaveEnabled) await doAutosave({ throwOnError: true });
      const active = editorStore.activeDocument;
      desktopHost.send({
        type: 'flush-done', apiVersion: 4, requestId: message.requestId || null,
        dirty: !!active?.dirty,
        hasHistory: !!(active && (active.undoStack?.length || active.redoStack?.length)),
      });
    })().catch(error => {
      console.error(error);
      desktopHost.send({
        type: 'flush-done', apiVersion: 4, requestId: message.requestId || null,
        dirty: !!editorStore.activeDocument?.dirty,
        hasHistory: !!(editorStore.activeDocument &&
          (editorStore.activeDocument.undoStack?.length || editorStore.activeDocument.redoStack?.length)),
        error: String(error?.message || error),
      });
    });
  } else if (message.cmd === 'request-close') {
    desktopHost.send({ type: 'requestClose', apiVersion: 4 });
  } else if (message.cmd === 'confirm-close') {
    const requestId = String(message.requestId || '');
    const prompt = message.title ? '"' + message.title + '"\n' + uiText('변경 사항을 저장하시겠습니까?') +
      (message.temporaryPrint ? '\n' + uiText('저장하지 않고 닫으면 임시 인쇄 파일이 삭제됩니다.') : '') :
      String(message.message || uiText('변경 사항을 저장하시겠습니까?'));
    confirmCloseMessage(prompt, message.canSaveInPlace ?? desktopCanSaveInPlace).then(choice => desktopHost.send({
      type: 'close-confirmed', apiVersion: 4, requestId, choice, confirmed: choice === 'discard',
    }));
  } else if (message.cmd === 'save-for-close') {
    saveDesktop(message.saveAs === true, { onComplete: ok => desktopHost.send({
      type: 'save-for-close-result', apiVersion: 4, requestId: message.requestId, ok,
    }) });
  } else if (message.cmd === 'save-result') {
    const transfer = desktopSaveTransfers.get(message.requestId);
    if (!transfer) return;
    desktopSaveTransfers.delete(message.requestId);
    spin(false);
    if (message.ok) {
      if (editorStore.activeDocument) editorStore.activeDocument.docPath = message.docPath || null;
      applySavedName(String(message.name || transfer.name).replace(/\.pdf$/i, ''), null);
      toast('저장됨: ' + String(message.name || transfer.name));
    } else if (!message.canceled) {
      saveFailAlert(new Error(message.error || 'Windows 파일 저장에 실패했습니다'));
      if (!transfer.forceSaveAs && !transfer.onComplete) setTimeout(() => saveDesktop(true), 0);
    }
    transfer.onComplete?.(message.ok === true);
  } else if (message.cmd === 'clipboard-put-committed') {
    const pending = desktopClipboardPuts.get(message.requestId);
    if (!pending) return;
    desktopClipboardPuts.delete(message.requestId);
    pending.resolve({ timestamp: message.timestamp });
  } else if (message.cmd === 'clipboard-put-rejected') {
    const pending = desktopClipboardPuts.get(message.requestId);
    if (!pending) return;
    desktopClipboardPuts.delete(message.requestId);
    pending.reject(new Error(message.error || '셸 클립보드가 복사 데이터를 받지 못했습니다'));
  } else if (message.cmd === 'clipboard-state') {
    const pending = desktopClipboardGets.get(message.requestId);
    if (!pending) return;
    desktopClipboardGets.delete(message.requestId);
    pending.resolve({ meta: message.meta || {} });
  } else if (message.cmd === 'clipboard-data-unavailable') {
    const pending = desktopClipboardGets.get(message.requestId);
    if (!pending) return;
    desktopClipboardGets.delete(message.requestId);
    pending.resolve(null);
  } else if (message.cmd === 'paste-from-shell') {
    spin(true, '페이지 붙여넣는 중...');
    pastePagesFromShellClipboard({
      createDocument: true,
      name: String(message.title || '새 문서'),
    }).catch(error => {
      console.error(error);
      toast('새 문서 생성 실패: ' + String(error?.message || error).slice(0, 80), 4200);
    }).finally(() => spin(false));
  }
}

function handleDesktopSharedBuffer(metadata, buffer) {
  if (metadata?.cmd === 'clipboard-put-buffer') {
    const pending = desktopClipboardPuts.get(metadata.requestId);
    if (!pending?.packet) return false;
    const target = new Uint8Array(buffer);
    if (target.byteLength !== pending.packet.byteLength)
      throw new Error('셸 클립보드 버퍼 크기가 일치하지 않습니다');
    target.set(pending.packet);
    pending.packet = null;
    desktopHost.send({
      type: 'clipboard-put-done', apiVersion: 4, requestId: metadata.requestId,
    });
    return true;
  }
  if (metadata?.cmd === 'clipboard-data') {
    const pending = desktopClipboardGets.get(metadata.requestId);
    if (!pending) return false;
    desktopClipboardGets.delete(metadata.requestId);
    const packet = new Uint8Array(buffer).slice();
    pending.resolve(pending.withMetadata ? { packet, meta: metadata.meta || {} } : packet);
    return true;
  }
  if (metadata?.cmd === 'save-buffer') {
    const transfer = desktopSaveTransfers.get(metadata.requestId);
    if (!transfer) return false;
    const target = new Uint8Array(buffer);
    if (target.byteLength !== transfer.bytes.byteLength)
      throw new Error('Windows 저장 버퍼 크기가 일치하지 않습니다');
    target.set(transfer.bytes);
    transfer.bytes = null;
    desktopHost.send({ type: 'save-put-done', apiVersion: 4, requestId: metadata.requestId });
    return true;
  }
  if (['open-document', 'append-document', 'merge-candidate'].includes(metadata?.cmd)) {
    const bytes = new Uint8Array(buffer).slice();
    desktopDocumentQueue = desktopDocumentQueue.catch(() => {}).then(() =>
      openDesktopSharedDocument(metadata, bytes));
    return desktopDocumentQueue;
  }
  return false;
}

const pdfEditorHostApi = Object.freeze({
  version: 4,
  mode: desktopViewMode ? 'desktop-view' : 'web',
  setAccessPolicy: policy => setWindowsAccessPolicy(policy),
  getDocumentState: () => ({
    title: editorStore.activeDocument?.name || '새 문서',
    dirty: !!editorStore.activeDocument?.dirty,
    hasDocument: !!editorStore.activeDocument,
    docPath: editorStore.activeDocument?.docPath || null,
  }),
  flush() {
    try { commitPendingNudge(); } catch {}
    scheduleAutosave();
    return true;
  },
});

const appLifecycleController = createAppLifecycleController(({ listen, cleanup }) => {
  if (!desktopViewMode) {
    Object.defineProperty(window, 'pdfEditorWindowsBridge', {
      configurable: true,
      value: windowsHostBridge,
    });
  }
  Object.defineProperty(window, 'pdfEditorHostApi', {
    configurable: true,
    value: pdfEditorHostApi,
  });
  desktopHost.onMessage(handleDesktopHostCommand);
  desktopHost.onSharedBuffer(({ metadata, buffer }) => {
    Promise.resolve(handleDesktopSharedBuffer(metadata, buffer)).catch(error => {
      console.error(error);
      if (['open-document', 'append-document', 'merge-candidate'].includes(metadata?.cmd)) {
        desktopHost.send({
          type: 'document-ready', apiVersion: 4, requestId: metadata?.requestId || null,
          ok: false, purpose: metadata?.cmd,
          error: String(error?.message || error).slice(0, 180),
        });
      } else {
        if (metadata?.cmd === 'save-buffer') {
          const transfer = desktopSaveTransfers.get(metadata?.requestId);
          if (transfer) {
            desktopSaveTransfers.delete(metadata.requestId);
            spin(false);
            saveFailAlert(error);
            transfer.onComplete?.(false);
            if (!transfer.forceSaveAs && !transfer.onComplete) setTimeout(() => saveDesktop(true), 0);
          }
        }
        const pendingPut = desktopClipboardPuts.get(metadata?.requestId);
        if (pendingPut) {
          desktopClipboardPuts.delete(metadata.requestId);
          pendingPut.reject(error);
        }
        const pendingGet = desktopClipboardGets.get(metadata?.requestId);
        if (pendingGet) {
          desktopClipboardGets.delete(metadata.requestId);
          pendingGet.reject(error);
        }
      }
    });
  });
  desktopHost.mount();
  if (desktopViewMode) {
    document.querySelectorAll('.desktopResizeZone').forEach(zone => {
      listen(zone, 'pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        desktopHost.send({
          type: 'window-resize', apiVersion: 4, edge: zone.dataset.edge,
        });
      });
    });
  }
  listen(window, 'storage', event => {
    if (!isThemeStorageEvent(event)) return;
    ({ theme, glassEffect } = readThemePreferences(settings));
    applyTheme(); syncThemeOpts();
  });
  listen(window, 'wheel', handleGlobalCtrlWheel, { passive: false });
  listen(sidebar, 'mousedown', focusSidebar, true);
  listen(sidebar, 'pointerdown', focusSidebar, true);
  listen(viewer, 'mousedown', focusViewer, true);
  listen(viewer, 'pointerdown', focusViewer, true);
  listen(document, 'pointerdown', handleMobileTipPointerDown, true);
  listen(document, 'pointermove', handleMobileTipPointerMove, true);
  listen(document, 'pointerup', handleMobileTipPointerUp, true);
  listen(document, 'pointercancel', handleMobileTipPointerCancel, true);
  listen(document, 'click', handleMobileTipClick, true);
  listen(document, 'contextmenu', handleMobileTipContextMenu, true);
  listen(document, 'pointerdown', handleMobileContextPointerDown, true);
  listen(document, 'pointermove', handleMobileContextPointerMove, { capture: true, passive: false });
  listen(document, 'pointerup', handleMobileContextPointerEnd, true);
  listen(document, 'pointercancel', handleMobileContextPointerEnd, true);
  listen(document, 'click', handleMobileContextClick, true);
  listen(viewer, 'scroll', cancelMobileContextPress, { capture: true, passive: true });
  listen(window, 'blur', cancelMobileContextPress);
  listen(document, 'pointerdown', handleWindowsBlockedPointer, true);
  listen(document, 'dragstart', handleWindowsBlockedDrag, true);
  listen(document, 'contextmenu', handleWindowsBlockedDrag, true);
  listen(document, 'visibilitychange', handleAutosaveVisibilityChange);
  listen(window, 'beforeunload', handleBeforeUnload);
  listen(window, 'pagehide', () => windowPeers.dispose());
  listen(window, 'error', handleWindowError);
  listen(window, 'unhandledrejection', handleUnhandledRejection);
  listen(window, 'resize', handleWindowResize);
  cleanup(() => {
    if (window.pdfEditorWindowsBridge === windowsHostBridge) {
      Reflect.deleteProperty(window, 'pdfEditorWindowsBridge');
    }
    if (window.pdfEditorHostApi === pdfEditorHostApi) Reflect.deleteProperty(window, 'pdfEditorHostApi');
    desktopHost.dispose();
    if (clipboardSerializeWorker) {
      clipboardSerializeWorker.terminate();
      clipboardSerializeWorker = null;
    }
    const disposedError = new Error('편집기 종료로 클립보드 작업이 취소되었습니다');
    for (const job of clipboardSerializeJobs.values()) job.reject(disposedError);
    for (const job of desktopClipboardPuts.values()) job.reject(disposedError);
    for (const job of desktopClipboardGets.values()) job.reject(disposedError);
    clipboardSerializeJobs.clear();
    desktopClipboardPuts.clear();
    desktopClipboardGets.clear();
    webClipboardBroker?.dispose();
    if (mobileTipPress) clearTimeout(mobileTipPress.timer);
    cancelMobileContextPress();
    mobileContextSuppressTarget = null;
    clearTimeout(mobileTipHideTimer);
    hideMobileButtonTip();
    windowPeers.dispose();
  });
});


let eraserQueue = Promise.resolve(), pendingErasures = 0;
let eraserTarget = null;
function previewObjectEraser(draft) {
  const { wrap, mark, points, width, height, style } = draft;
  const bounds = eraserBounds(points, style.sw), size = markPageSize(wrap);
  const sx = size.width / width, sy = size.height / height;
  const canvas = mark.firstElementChild || mark.appendChild(document.createElement('canvas'));
  const scale = Math.min(sx, 2048 / Math.max(bounds.w, bounds.h));
  canvas.width = Math.max(1, Math.ceil(bounds.w * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.h * scale));
  Object.assign(mark.style, { left: bounds.l*sx+'px', top: bounds.t*sy+'px', opacity: '.48' });
  canvas.style.width = bounds.w*sx+'px'; canvas.style.height = bounds.h*sy+'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale,0,0,scale,-bounds.l*scale,-bounds.t*scale);
  drawEraserTip(ctx,points,style.sw,style.tip,'#6499bb');
}

async function eraseObjectStroke(draft) {
  const { wrap, k, page, points, style, width, height } = draft;
  const ctx = editContext(k), initialSrc = page.src;
  const valid = () => editorStore.pages[k] === page && contextValid(ctx) && page.src === initialSrc &&
    windowsAccess.current.canEditCurrentDocuments && !activeDocLocked();
  if (!valid()) return;
  const target = draft.eraserTarget?.page === page ? draft.eraserTarget : null;
  const trail = eraserBounds(points, style.sw);
  const intersects = b => b.w > 0 && b.h > 0 && b.l < trail.l+trail.w && b.l+b.w > trail.l &&
    b.t < trail.t+trail.h && b.t+b.h > trail.t;
  const resolution = b => Math.min(4, 4096 / Math.max(b.w,b.h), Math.sqrt(8000000 / (b.w*b.h)));
  const wr = wrap.getBoundingClientRect();
  const marks = [...wrap.querySelectorAll('.obj')].reverse();
  for (const mark of marks) {
    const obj = mark._ctx?.obj;
    if (!obj || target && target.obj !== obj) continue;
    const r = mark.getBoundingClientRect(), pad = Math.max(1,(obj.sw || 0)/2);
    const box = { l:(r.left-wr.left)/wr.width*width-pad, t:(r.top-wr.top)/wr.height*height-pad,
      w:r.width/wr.width*width+2*pad, h:r.height/wr.height*height+2*pad };
    if (!intersects(box)) continue;
    if (obj.clipOpaque && sources.has(obj.clipSrc) && obj.fw > 0 && obj.fh > 0) {
      const stroke = fragmentStroke(obj,width,height,points,style);
      const image = new Image(); image.src = obj.data; await image.decode();
      const preview = document.createElement('canvas');
      try {
        preview.width = image.naturalWidth; preview.height = image.naturalHeight;
        preview.getContext('2d').drawImage(image,0,0);
        if (!applyFragmentStrokes(preview,[stroke],undefined,true)) {
          const region = fragmentStrokeBounds(stroke);
          const density = Math.min(preview.width/(obj.fw*width),preview.height/(obj.fh*height));
          if (style.sw*density >= 2 || region[2] <= 0 || region[3] <= 0) continue;
          const w = region[2]*obj.fw*width, h = region[3]*obj.fh*height;
          const scale = Math.min(8/style.sw, 2048/Math.max(w,h));
          const detail = await paintObjectClip(obj,w*scale,h*scale,region);
          try { if (!applyFragmentStrokes(detail,[stroke],region,true)) continue; }
          finally { detail.width = detail.height = 0; }
        }
        if (!valid() || !page.texts.includes(obj)) return;
        const snap = makeSnap();
        const replacement = { ...obj, data:preview.toDataURL('image/png'),
          clipErasures:[...(obj.clipErasures || []),stroke] };
        page.texts[page.texts.indexOf(obj)] = replacement;
        if (target) target.obj = replacement;
        pushSnap(snap); positionMarks(wrap,page); scheduleThumbRefresh(k);
        return;
      } finally { preview.width = preview.height = 0; }
    }
    const direct = obj.type === 'img' && !obj.rot && !obj.flipX && !obj.flipY;
    const canvas = document.createElement('canvas');
    try {
      if (direct) {
        Object.assign(box,{ l:obj.fx*width, t:obj.fy*height, w:obj.fw*width, h:obj.fh*height });
        const image = new Image(); image.src = obj.data; await image.decode();
        const ratio = Math.min(1, 8192/Math.max(image.width,image.height), Math.sqrt(16000000/(image.width*image.height)));
        canvas.width = Math.max(1,Math.round(image.width*ratio)); canvas.height = Math.max(1,Math.round(image.height*ratio));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      } else {
        const sc = resolution(box);
        canvas.width = Math.max(1,Math.ceil(box.w*sc)); canvas.height = Math.max(1,Math.ceil(box.h*sc));
        box.w = canvas.width/sc; box.h = canvas.height/sc;
        const one = { texts:[obj] };
        await outputOverlayRenderer.prepareImages(one);
        if (obj.text) await ensureScreenFont(obj.font || 'spoqa', !!obj.bold, {characters:obj.text});
        outputOverlayRenderer.drawObjects(one,canvas,width,{width:width*sc,height:height*sc,x:box.l*sc,y:box.t*sc});
      }
      if (!eraseCanvasStroke(canvas,box,points,style)) continue;
      if (!valid() || !page.texts.includes(obj)) return;
      const snap = makeSnap();
      const replacement = { type:'img', data:canvas.toDataURL('image/png'), fx:box.l/width, fy:box.t/height,
        fw:box.w/width, fh:box.h/height, ...(direct ? {fillOp:obj.fillOp} : {}),
        ...(obj.blend === 'multiply' || obj.brush === 'highlighter' ? {blend:'multiply'} : {}) };
      page.texts[page.texts.indexOf(obj)] = replacement;
      if (target) target.obj = replacement;
      detachDanglingConnectors(page.texts);
      pushSnap(snap); positionMarks(wrap,page); scheduleThumbRefresh(k);
      return;
    } finally { canvas.width = canvas.height = 0; }
  }
  if (!page.src || target?.obj || !valid()) return;
  const { view, rT } = await origView(page);
  const { objs, annots } = await origScanPage(page);
  for (const hit of [...annots].reverse().concat([...objs].reverse())) {
    if (hit.invisible || target && (target.isA ? !hit.isA || hit.a !== target.a : hit.isA || hit.i !== target.i)) continue;
    const rr = pageRectToDispRect(page,view,rT,hit.b);
    const box = {l:rr.l*width,t:rr.t*height,w:rr.w*width,h:rr.h*height};
    if (!intersects(box) || !valid()) continue;
    const bytes = hit.isA ? await origAnnotOnlyBytes(page,new Set([hit.a])) : await origFilteredBytes(page,i=>i===hit.i,true);
    const loading = openPdfDocument(bytes.slice()), isolated = await loading.promise, id = -(++srcSeq);
    sources.set(id,{bytes,doc:isolated});
    let canvas;
    try {
      canvas = await renderPageRegion({...page,src:id},rr.l,rr.t,rr.w,rr.h,resolution(box),true);
      if (!eraseCanvasStroke(canvas,box,points,style) || !valid()) continue;
      const pt = (x,y) => pageFracToPt(page,view,rT,x,y);
      const a=pt(rr.l,rr.t+rr.h), b=pt(rr.l+rr.w,rr.t+rr.h), c=pt(rr.l,rr.t);
      const matrix=[b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1],a[0],a[1]];
      if (!hit.isA && hit.type === 5) {
        const piece = await PDFDocument.create(), sheet = piece.addPage([box.w,box.h]);
        const input = (await PDFDocument.load(bytes)).getPage(page.idx);
        const form = await embedRegion(piece,input,hit.b,rT);
        const fw = rT % 180 ? form.height : form.width, fh = rT % 180 ? form.width : form.height;
        const stroke = fragmentStroke({fx:rr.l,fy:rr.t,fw:rr.w,fh:rr.h},width,height,points,style);
        maskEmbeddedFragment(piece,form,fw,fh,[stroke]);
        sheet.drawPage(form,{xScale:box.w/fw,yScale:box.h/fh});
        const masked = await piece.save();
        if (!valid()) return;
        await withPdfiumDoc(masked, (F, M, sourceDoc) => origApply(k, (lib, mod, pg, doc) =>
          replacePdfObjectForm(lib,pg,doc,hit.i,sourceDoc,
            [matrix[0]/box.w,matrix[1]/box.w,matrix[2]/box.h,matrix[3]/box.h,...a]), '부분 지우개'));
      } else if (hit.isA) {
        const result = await pdfLib.raw.PDFDocument.create();
        const [copy] = await result.copyPages(await getLibDoc(page.src),[page.idx]); result.addPage(copy);
        const png = await result.embedPng(canvas.toDataURL('image/png'));
        const stream = result.context.flateStream('q '+matrix.join(' ')+' cm /Ink Do Q', {
          Type:'XObject',Subtype:'Form',BBox:hit.b,Resources:{XObject:{Ink:png.ref}} });
        const annotation = copy.node.Annots().lookup(hit.a);
        annotation.set(pdfLib.raw.PDFName.of('AP'),result.context.obj({N:result.context.register(stream)}));
        const out = await result.save(), snap = makeSnap();
        if (valid() && await origSwapSource(page,out,valid)) {
          page.idx=0; pushSnap(snap); enqueueRender(wrap); scheduleThumbRefresh(k);
        }
      } else {
        await origApply(k,(F,M,pg,doc)=>replacePdfObjectBitmap(F,M,pg,doc,hit.i,canvas,matrix),'부분 지우개');
      }
      return;
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
      sources.delete(id); await loading.destroy();
    }
  }
}
function stopDrawing() {
  if (document.body.classList.contains('drawingMode')) drawingController.stop();
}
const drawingController = createDrawingController({
  windowObject: window, viewer, button: $('btnDraw'), bar: $('drawingBar'), presets: INK_BRUSHES,
  readPreferences: () => settings.get('drawing'),
  writePreferences: value => settings.set('drawing', value),
  onBrushChange: () => { eraserTarget = null; },
  onModeChange: active => { if (!active) eraserTarget = null; },
  eraseStroke: draft => {
    draft.eraserTarget = eraserTarget;
    pendingErasures++;
    eraserQueue = eraserQueue.then(() => eraseObjectStroke(draft)).catch(error => {
      console.error(error); toast('부분 지우개 실패 · ' + error.message, 3500);
    }).finally(() => { pendingErasures--; });
  },
  renderEraserPreview: previewObjectEraser,
  openColor: (id, apply) => openPalette(id, apply, { recordHistory: false }),
  closeColor() {
    if (palTarget?.btnId !== 'inkColor') return false;
    closePalette(); return true;
  },
  canDraw: () => windowsAccess.current.canEditCurrentDocuments && !!editorStore.pages.length && !activeDocLocked(),
  prepare() {
    commitPendingNudge(); deselectText(); origClearSel();
    if (origMode) setOrigMode(false);
    stopShapeDraft(); stopConnectorPickMode(); cancelRegion(); setTextMode(false);
    multiPickMode = false; document.body.classList.remove('multiPick');
    $('shapeMenu').style.display = 'none';
    focusViewer();
  },
  pageAt(target) {
    const wrap = target.closest?.('.pageWrap');
    const k = wrap ? +wrap.dataset.k : -1, page = editorStore.pages[k];
    if (!wrap || !viewer.contains(wrap) || !page) return null;
    const size = markPageSize(wrap);
    return { wrap, k, page, width: page._w1 || size.width / editorStore.zoom,
      height: page._h1 || size.height / editorStore.zoom };
  },
  createStroke: createInkObject,
  renderPreview(mark, object, wrap) {
    const { width, height } = markPageSize(wrap);
    drawShapeEl(mark, object, width, height);
  },
  commitStroke({ wrap, k, page }, object) {
    if (editorStore.pages[k] !== page) return;
    const snap = makeSnap(); page.texts.push(object); pushSnap(snap);
    positionMarks(wrap, page); scheduleThumbRefresh(k); focusViewer();
  },
});

const editorControllers = Object.freeze([
  drawingController,
  appLifecycleController,
  ...(desktopViewMode ? [] : [tabController]),
  viewerController,
  viewportScrollSpace,
  toolbarController,
  dialogsController,
  textStyleShortcutRouter,
  shortcutRouter,
  searchShortcutRouter,
  clipboardController,
  pointerGestureRouter,
  toolbarDisplayController,
  tutorialController,
]);

function mountEditorControllers() {
  for (const controller of editorControllers) controller.mount();
}

function disposeEditorControllers() {
  displayPainter.shutdown(); thumbnailWorkerController.shutdown();
  cancelPendingViewFit();
  ++documentViewRevision;
  for (const controller of [...editorControllers].reverse()) controller.dispose();
  mergeOpenDocuments.close();
  desktopMerge?.dispose();
  dialogHost.dispose();
}

mountEditorControllers();
if (desktopViewMode) {
  desktopHost.send({ type: 'recovery-policy', apiVersion: 4, enabled: autosaveEnabled });
  Promise.resolve(window.pdfEditorStartupPromise).catch(() => {}).finally(() => {
    desktopHost.send({ type: 'view-ready', apiVersion: 4 });
    publishDesktopDocumentState();
  });
}
return Object.freeze({ dispose: disposeEditorControllers });
}
