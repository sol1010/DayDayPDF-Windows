import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createClipboardController } from '../../src/ui/editor/clipboard-controller.js';
import { createDialogHost } from '../../src/ui/editor/dialog-host.js';
import { createDomRefs } from '../../src/ui/editor/dom-refs.js';
import { createPointerGestureRouter } from '../../src/ui/editor/pointer-gesture-router.js';
import { createShortcutRouter } from '../../src/ui/editor/shortcut-router.js';
import {
  createAppLifecycleController,
  createDialogsController,
  createTabController,
  createToolbarController,
  createViewerController,
} from '../../src/ui/editor/ui-controllers.js';

function fakeTarget(extra = {}) {
  const listeners = new Map();
  const calls = [];
  return Object.assign({
    calls,
    addEventListener(type, listener, options) {
      calls.push(['add', type, listener, options]);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener, options) {
      calls.push(['remove', type, listener, options]);
      listeners.get(type)?.delete(listener);
    },
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
  }, extra);
}

function fakeClassList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
  };
}

test('DOM refs validate the complete startup contract once and reject unknown ids', () => {
  const nodes = new Map([['viewer', { id: 'viewer' }], ['sidebar', { id: 'sidebar' }]]);
  const refs = createDomRefs({ getElementById: id => nodes.get(id) || null }, ['viewer', 'sidebar']);
  assert.equal(refs.get('viewer'), nodes.get('viewer'));
  assert.deepEqual(refs.ids, ['viewer', 'sidebar']);
  assert.throws(() => refs.get('missing'), /검증되지 않은 DOM 요소/);
  assert.throws(
    () => createDomRefs({ getElementById: id => nodes.get(id) || null }, ['viewer', 'toolbar']),
    /필수 DOM 요소가 없습니다: toolbar/,
  );
});

test('fixed UI controllers are inert until mount and restore bindings on dispose', () => {
  const factories = [
    createTabController,
    createViewerController,
    createToolbarController,
    createDialogsController,
    createAppLifecycleController,
  ];
  for (const factory of factories) {
    const target = fakeTarget();
    const previous = () => 'previous';
    const assigned = { onclick: previous };
    let clicks = 0;
    const controller = factory(({ listen, assign, cleanup }) => {
      listen(target, 'click', () => { clicks += 1; });
      assign(assigned, 'onclick', () => { clicks += 10; });
      cleanup(() => { clicks += 100; });
    });

    assert.equal(target.calls.length, 0);
    assert.equal(assigned.onclick, previous);
    assert.equal(controller.mount(), true);
    assert.equal(controller.mount(), false);
    target.emit('click');
    assigned.onclick();
    assert.equal(clicks, 11);
    assert.equal(controller.dispose(), true);
    assert.equal(controller.dispose(), false);
    assert.equal(clicks, 111);
    assert.equal(target.listenerCount('click'), 0);
    assert.equal(assigned.onclick, previous);
    assert.equal(controller.mount(), true);
    assert.equal(controller.dispose(), true);
  }
});

test('shortcut and clipboard routers attach once, detach cleanly, and can remount', () => {
  const target = fakeTarget();
  let keys = 0, pastes = 0;
  const shortcuts = createShortcutRouter({ target, onKeyDown: () => { keys += 1; }, options: true });
  const clipboard = createClipboardController({ target, onPaste: () => { pastes += 1; } });
  assert.equal(target.calls.length, 0);
  shortcuts.mount();
  clipboard.mount();
  target.emit('keydown');
  target.emit('paste');
  assert.deepEqual([keys, pastes], [1, 1]);
  shortcuts.dispose();
  clipboard.dispose();
  target.emit('keydown');
  target.emit('paste');
  assert.deepEqual([keys, pastes], [1, 1]);
  shortcuts.mount();
  shortcuts.dispose();
});

test('pointer router preserves one-finger scroll and a fixed pinch baseline across replaced text targets', () => {
  const documentObject = fakeTarget();
  const text = fakeTarget(), viewer = fakeTarget({ contains: node => node === text });
  const sidebar = fakeTarget({ classList: fakeClassList(), contains: () => false });
  const scales = [], starts = []; let ends = 0, drawerCloses = 0;
  const router = createPointerGestureRouter({
    documentObject, viewer, sidebar, isMobileLayout: () => true,
    onViewerPinchStart: (...args) => starts.push(args), onViewerPinchEnd: () => ends++,
    onViewerScale: (...args) => scales.push(args), onSidebarScale: () => {},
    onViewerPointerDown: () => drawerCloses++,
  });
  const touch = (id, x, y = 0) => ({ identifier: id, clientX: x, clientY: y, target: text });
  const event = (type, touches) => ({ type, touches, cancelable: true, prevented: false,
    preventDefault() { this.prevented = true; } });
  assert.equal(documentObject.calls.length + viewer.calls.length + sidebar.calls.length, 0);
  router.mount(); assert.equal(sidebar.classList.contains('hidden'), true);
  viewer.emit('pointerdown', {}); assert.equal(drawerCloses, 1);
  const single = event('touchmove', [touch(1, 20)]);
  viewer.emit('touchmove', single); assert.equal(single.prevented, false);
  viewer.emit('touchstart', event('touchstart', [touch(1, 0), touch(2, 100)]));
  assert.deepEqual(starts, [[50, 0]]);
  const sample = event('touchmove', [touch(1, 0), touch(2, 120)]);
  text.emit('touchmove', sample); viewer.emit('touchmove', sample);
  assert.deepEqual(scales, [[1.2, 60, 0]], 'one update per complete pair of touch coordinates');
  viewer.contains = () => false;  
  text.emit('touchmove', event('touchmove', [touch(1, 20), touch(2, 160)]));
  assert.deepEqual(scales.at(-1), [1.4, 90, 0], 'scale remains relative to the gesture start');
  text.emit('touchend', event('touchend', [touch(1, 20)])); assert.equal(ends, 1);
  const remainder = event('touchmove', [touch(1, 40)]); text.emit('touchmove', remainder);
  assert.equal(remainder.prevented, true, 'the remaining finger must not start a native scroll jump');
  text.emit('touchend', event('touchend', []));
  assert.equal(text.listenerCount('touchmove'), 0);
  const nextScroll = event('touchmove', [touch(3, 60)]); viewer.emit('touchmove', nextScroll);
  assert.equal(nextScroll.prevented, false);
  router.dispose(); assert.equal(documentObject.listenerCount('gesturestart'), 0);
  assert.equal(viewer.listenerCount('touchstart'), 0); assert.equal(sidebar.listenerCount('touchmove'), 0);
});

test('dialog host closes top UI before arming the double-back exit and is disposable', () => {
  const windowObject = fakeTarget();
  const operations = [];
  const historyObject = {
    state: { existing: true },
    replaceState: state => { historyObject.state = state; operations.push(['replace', state]); },
    pushState: state => { historyObject.state = state; operations.push(['push', state]); },
    back: () => operations.push(['back']),
  };
  let time = 100, closeCalls = 0, notices = 0;
  const host = createDialogHost({
    windowObject,
    historyObject,
    locationObject: { href: 'https://example.test/editor' },
    shouldArm: () => true,
    closeTop: () => ++closeCalls === 1,
    notifyExit: () => { notices += 1; },
    now: () => time,
  });
  assert.equal(windowObject.calls.length, 0);
  assert.equal(host.mount(), true);
  windowObject.emit('popstate');
  assert.equal(notices, 0);
  windowObject.emit('popstate');
  assert.equal(notices, 1);
  time = 200;
  windowObject.emit('popstate');
  assert.equal(operations.at(-1)[0], 'back');
  assert.equal(host.mounted, false);
  assert.equal(windowObject.listenerCount('popstate'), 0);
});

test('editor entry only assembles startup and UI module imports have no top-level listener registration', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /^import \{ mountEditorApp \} from '\.\/editor-app\.js';/);
  assert.equal((main.match(/^import\s/gm) || []).length, 1);
  assert.match(main, /await mountEditorApp\(\{/);
  assert.match(main, /fadeOutBootSplash\(\)/);

  const modules = [
    '../../src/ui/editor/ui-controllers.js',
    '../../src/ui/editor/shortcut-router.js',
    '../../src/ui/editor/clipboard-controller.js',
    '../../src/ui/editor/pointer-gesture-router.js',
    '../../src/ui/editor/dialog-host.js',
  ];
  for (const relative of modules) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    const firstFactory = source.search(/(?:export\s+)?function\s+create/);
    const firstListener = source.indexOf('.addEventListener(');
    assert.ok(firstFactory >= 0, relative);
    assert.ok(firstListener > firstFactory, relative);
  }
});

test('paste menu disables empty and incompatible clipboards and ignores stale async results', async () => {
  const { createContextPasteState } = await import('../../src/ui/editor/context-menu.js');
  const pending = [];
  const state = createContextPasteState({ readKind: () => new Promise(resolve => pending.push(resolve)) });
  const classes = new Set(), attributes = new Map();
  const item = { classList: { toggle(name,on) { on ? classes.add(name) : classes.delete(name); } },
    setAttribute(name,value) { attributes.set(name,value); } };
  const menu = { style: { display:'block' } };
  let allowed = true;
  const refresh = kinds => state.refresh(menu,item,kinds,()=>allowed);
  const empty = refresh(['pages','object']);
  assert.equal(attributes.get('aria-disabled'),'true');
  pending.shift()(null); await empty;
  assert.equal(classes.has('dim'),true);
  const objectOnThumbnail = refresh(['pages']); pending.shift()('object'); await objectOnThumbnail;
  assert.equal(classes.has('dim'),true);
  const objectOnPage = refresh(['pages','object']); pending.shift()('object'); await objectOnPage;
  assert.equal(attributes.get('aria-disabled'),'false');
  const old = refresh(['pages','object']), current = refresh(['pages']);
  pending.pop()(null); await current;
  pending.shift()('object'); await old;
  assert.equal(classes.has('dim'),true,'old menu result must not enable a newly opened menu');
  const changedDocument = refresh(['pages']); allowed=false; pending.shift()('pages'); await changedDocument;
  assert.equal(classes.has('dim'),true,'document or mode changes disable paste');
});

import { normalizePrintPreferences } from '../../src/ui/editor/print-dialog-controller.js';
test('print preferences validate persisted options and omit document-specific ranges', () => {
  const saved = normalizePrintPreferences({ orientation:'landscape', mode:'image', paper:'letter', color:'mono', duplex:'short', copies:3, printer:'Office PDF', range:'custom', custom:'2,5,9' });
  assert.deepEqual(saved, { orientation:'landscape', mode:'image', paper:'letter', color:'mono', duplex:'short', copies:3, printer:'Office PDF' });
  assert.deepEqual(normalizePrintPreferences({ orientation:'bad', mode:'bad', paper:'bad', color:'bad', duplex:'bad', copies:1000, printer:42 }), normalizePrintPreferences(null));
  for (const copies of [-1, 0, 1.5, '', 'NaN']) assert.equal(normalizePrintPreferences({copies}).copies, 1);
  assert.equal(normalizePrintPreferences({copies:'999'}).copies, 999);
});
