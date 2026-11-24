import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocumentTools } from '../../src/features/document-tools/editor-document-tools.js';
import { createEditorSecurity } from '../../src/features/document-tools/editor-security.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides = {}) {
  const nodes = new Map(), calls = [], classes = new Set();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      _value: '', checked: false, hidden: false, disabled: false, files: [],
      get value() { return this._value; },
      set value(value) { this._value = value; if (value === '' && selector.endsWith('Input')) this.files = []; },
      focus() {}, getClientRects: () => [1],
    });
    return nodes.get(selector);
  };
  node('#documentOutput').value = 'pdf';
  node('#documentLanguage').value = 'kor+eng';
  node('#documentQuality').value = 'balanced';
  const panel = {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    querySelector: node,
    querySelectorAll: () => ['#documentOutput', '#documentInput', '#documentLanguage', '#documentQuality',
      '#documentForce', '[data-run]', '[data-open]'].map(node),
    addEventListener() {},
  };
  globalThis.document = { createElement: () => panel, body: { append() {} }, getElementById: () => null };
  const source = new File(['source'], 'source.pdf', { type: 'application/pdf' });
  const converted = { bytes: new Uint8Array([37, 80, 68, 70]), name: 'result.pdf', type: 'application/pdf', warnings: ['warning'] };
  const saved = { ok: true, requestId: 'saved-result' };
  const feature = createEditorDocumentTools({
    getCurrentFile: async () => overrides.currentFile ? overrides.currentFile() : source,
    hasCurrentFile: () => overrides.hasCurrentFile ?? true,
    prepareSelectedFile: file => overrides.prepare ? overrides.prepare(file) : file,
    loadRuntime: async () => ({ convertEditorDocument: async (file, options) => {
      calls.push(['convert', file, options.output]);
      return overrides.convert ? overrides.convert(file, options) : converted;
    } }),
    save: async (...args) => { calls.push(['save', ...args]); return overrides.save ? overrides.save(...args) : saved; },
    openPdf: async (...args) => { calls.push(['open', ...args]); return overrides.open ? overrides.open(...args) : true; },
    notify: message => calls.push(['notify', message]),
  });
  feature.open();
  return { node, calls, classes, converted, saved, source, feature,
    run: () => node('[data-run]').onclick(),
    setOutput(output) { node('#documentOutput').value = output; node('#documentOutput').onchange(); },
  };
}

test('OCR and imported PDF results open automatically after saving, with the exact bytes and native save identity', async () => {
  for (const output of ['pdf', 'import']) {
    const s = setup();
    s.setOutput(output);
    const imported = new File(['office'], 'input.docx');
    s.node('#documentInput').files = [imported];
    await s.run();
    assert.deepEqual(s.calls.map(call => call[0]), ['convert', 'save', 'open', 'notify']);
    assert.equal(s.calls[0][1], output === 'pdf' ? s.source : imported);
    const [, file, saved] = s.calls[2];
    assert.equal(file.name, 'result.pdf');
    assert.equal(file.type, 'application/pdf');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), s.converted.bytes);
    assert.equal(saved, s.saved);
    assert.match(s.calls[3][1], /warning/);
    assert.equal(s.classes.has('show'), false);
    assert.equal(s.node('[data-open]').hidden, true);
    await s.node('[data-open]').onclick();
    assert.equal(s.calls.filter(call => call[0] === 'open').length, 1);
  }
});

test('PPT, Word, Excel, HWP and image results remain downloadable without opening a PDF tab', async () => {
  for (const [output, type] of [['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['hwp', 'application/x-hwp'], ['png', 'image/png'], ['jpg', 'application/zip']]) {
    const s = setup(); s.converted.type = type; s.setOutput(output);
    await s.run();
    assert.deepEqual(s.calls.map(call => call[0]), ['convert', 'save']);
    assert.equal(s.classes.has('show'), true);
    assert.equal(s.node('[data-open]').hidden, true);
  }
});

test('canceled saves, failed conversion and failed save never open a result tab', async () => {
  for (const overrides of [
    { save: async () => ({ canceled: true }) },
    { convert: async () => { throw new Error('conversion failed'); } },
    { save: async () => { throw new Error('save failed'); } },
  ]) {
    const s = setup(overrides); await s.run();
    assert.equal(s.calls.some(call => call[0] === 'open'), false);
    assert.equal(s.node('[data-open]').hidden, true);
    assert.equal(s.node('[data-run]').disabled, false);
  }
});

test('canceling an in-flight conversion or save suppresses automatic result opening', async () => {
  for (const stage of ['convert', 'save']) {
    const entered = deferred(), finish = deferred();
    const s = setup({ [stage]: async () => { entered.resolve(); return finish.promise; } });
    const task = s.run(); await entered.promise;
    s.node('[data-close]').onclick();
    finish.resolve(stage === 'convert' ? s.converted : s.saved);
    await task;
    assert.equal(s.calls.some(call => call[0] === 'open'), false);
    assert.match(s.node('.documentToolsStatus').textContent, /취소/);
    assert.equal(s.node('[data-run]').disabled, false);
  }
});

test('an opening failure preserves the result for retry without reconverting or saving again', async () => {
  let attempts = 0;
  const s = setup({ open: async () => ++attempts > 1 });
  await s.run();
  assert.equal(s.classes.has('show'), true);
  assert.equal(s.node('[data-open]').hidden, false);
  assert.match(s.node('.documentToolsStatus').textContent, /다시 시도/);
  await s.node('[data-open]').onclick();
  assert.deepEqual(s.calls.map(call => call[0]), ['convert', 'save', 'open', 'open', 'notify']);
  assert.equal(s.classes.has('show'), false);
});

test('repeated clicks while automatic opening is pending cannot duplicate the result tab', async () => {
  const entered = deferred(), finish = deferred();
  const s = setup({ open: async () => { entered.resolve(); return finish.promise; } });
  const task = s.run(); await entered.promise;
  await s.run(); await s.node('[data-open]').onclick();
  assert.equal(s.calls.filter(call => call[0] === 'open').length, 1);
  finish.resolve(true); await task;
  assert.equal(s.classes.has('show'), false);
});

test('conversion without a tab uses the chosen PDF and keeps office input independent', async () => {
  const s = setup({ hasCurrentFile: false, currentFile: () => { throw new Error('No tab may be read'); } });
  assert.equal(s.node('[data-pdf-source]').hidden, false);
  assert.equal(s.node('[data-run]').disabled, true);
  await s.run(); assert.deepEqual(s.calls, []);
  const pdf = new File(['chosen PDF'], 'Chosen.pdf', { type: 'application/pdf' });
  s.node('#documentPdfInput').files = [pdf]; s.node('#documentPdfInput').onchange();
  assert.equal(s.node('[data-pdf-name]').textContent, pdf.name);
  assert.equal(s.node('[data-run]').disabled, false);
  s.setOutput('import');
  assert.equal(s.node('[data-pdf-source]').hidden, true);
  assert.equal(s.node('[data-run]').disabled, true);
  s.setOutput('png'); s.converted.type = 'image/png';
  assert.equal(s.node('[data-run]').disabled, false);
  await s.run(); assert.equal(s.calls[0][1], pdf);
  assert.deepEqual(s.calls.map(call => call[0]), ['convert', 'save']);
  s.node('[data-close]').onclick(); s.feature.open();
  assert.equal(s.node('[data-run]').disabled, true);
  assert.equal(s.node('[data-pdf-name]').textContent, '');
});

test('file-based conversion respects host new-work restrictions before invoking the runtime', async () => {
  const s = setup({ hasCurrentFile: false, prepare: () => { throw new Error('New work unavailable'); } });
  s.node('#documentPdfInput').files = [new File(['pdf'], 'file.pdf')]; s.node('#documentPdfInput').onchange();
  await s.run(); assert.deepEqual(s.calls, []);
  assert.match(s.node('.documentToolsStatus').textContent, /New work unavailable/);
  assert.equal(s.node('[data-run]').disabled, false);
});

test('security tools without a tab process only the selected PDF for locking and unlocking', async () => {
  for (const mode of ['lock', 'unlock']) {
    const nodes = new Map(), calls = [];
    const node = selector => {
      if (!nodes.has(selector)) nodes.set(selector, {
        files: [], disabled: false, hidden: false, _value: '',
        get value() { return this._value; },
        set value(value) { this._value = value; if (value === '' && selector === '#securityPdfInput') this.files = []; },
        focus() {}, getClientRects: () => [1],
      });
      return nodes.get(selector);
    };
    globalThis.document = { createElement: () => ({
      classList: { add() {}, remove() {} }, querySelector: node,
      querySelectorAll: () => [...nodes.values()], addEventListener() {},
    }), body: { append() {} }, getElementById: () => null };
    const feature = createEditorSecurity({ hasCurrentFile: () => false,
      getCurrentFile: () => { throw new Error('No tab may be read'); },
      loadRuntime: async () => ({ secureEditorPdf: async (bytes, options) => { calls.push(['secure', bytes, options]); return bytes; } }),
      save: async (bytes, name) => { calls.push(['save', bytes, name]); return { ok: true }; },
    });
    feature.open(mode); assert.equal(node('[data-pdf-source]').hidden, false); assert.equal(node('[data-run]').disabled, true);
    const file = new File(['PDF bytes'], 'Selected.pdf', { type: 'application/pdf' });
    node('#securityPdfInput').files = [file]; node('#securityPdfInput').onchange();
    assert.equal(node('[data-run]').disabled, false);
    node('#securityPassword').value = node('#securityConfirm').value = 'Test-42';
    await node('form').onsubmit({ preventDefault() {} });
    assert.deepEqual(calls[0], ['secure', new Uint8Array(await file.arrayBuffer()), { mode, password: 'Test-42' }]);
    assert.equal(calls[1][2], mode === 'lock' ? 'Selected_암호설정.pdf' : 'Selected_암호해제.pdf');
    assert.equal(node('#securityPassword').value, '');
    node('[data-close]').onclick(); feature.open(mode);
    assert.equal(node('[data-run]').disabled, true); assert.equal(node('[data-pdf-name]').textContent, '');
  }
});
