import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = resolve(root, 'src');

async function listJavaScript(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJavaScript(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

test('phase 9 retires the legacy entry without changing the explicit mount boundary', async () => {
  const sourceFiles = await listJavaScript(sourceRoot);
  const relativeFiles = sourceFiles.map(path => relative(sourceRoot, path).replaceAll('\\', '/'));
  assert.ok(relativeFiles.includes('editor-app.js'));
  assert.ok(!relativeFiles.includes('legacy-app.js'));

  const main = await readFile(resolve(sourceRoot, 'main.js'), 'utf8');
  const editorApp = await readFile(resolve(sourceRoot, 'editor-app.js'), 'utf8');
  assert.match(main, /^import \{ mountEditorApp \} from '\.\/editor-app\.js';/);
  assert.match(main, /const editorMode = 'desktop-view'/);
  assert.match(main, /await mountEditorApp\(\{[\s\S]*mode: editorMode/);
  assert.match(main, /await Promise\.resolve\(window\.pdfEditorStartupPromise\)/);
  assert.match(main, /bootSplash\.classList\.add\('fadeOut'\)/);
  assert.match(editorApp, /export async function mountEditorApp\(\{ mode = 'desktop-view' \} = \{\}\)/);
  assert.doesNotMatch(main + editorApp, /legacy-app|mountLegacyEditor/);
});

test('the complete source module graph is acyclic', async () => {
  const sourceFiles = await listJavaScript(sourceRoot);
  const sourceSet = new Set(sourceFiles);
  const graph = new Map();
  const importPattern = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

  for (const path of sourceFiles) {
    const source = await readFile(path, 'utf8');
    const dependencies = [];
    for (const match of source.matchAll(importPattern)) {
      const dependency = resolve(dirname(path), match[1].replace(/\?source$/, ''));
      if (sourceSet.has(dependency)) dependencies.push(dependency);
    }
    graph.set(path, dependencies);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (path, stack = []) => {
    if (visiting.has(path)) {
      const cycleStart = stack.indexOf(path);
      const cycle = [...stack.slice(cycleStart), path]
        .map(item => relative(sourceRoot, item).replaceAll('\\', '/'));
      assert.fail(`순환 의존: ${cycle.join(' -> ')}`);
    }
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of graph.get(path) || []) visit(dependency, [...stack, path]);
    visiting.delete(path);
    visited.add(path);
  };
  for (const path of sourceFiles) visit(path);
  assert.equal(visited.size, sourceFiles.length);
});

test('unused phase compatibility getters are absent while runtime getters remain', async () => {
  const store = await readFile(resolve(sourceRoot, 'state/editor-store.js'), 'utf8');
  const windowTransfer = await readFile(resolve(sourceRoot, 'adapters/window-transfer.js'), 'utf8');
  const thumbnailWorker = await readFile(resolve(sourceRoot, 'rendering/thumbnail-worker-controller.js'), 'utf8');

  assert.doesNotMatch(store, /get (?:tabOrder|activeDocumentId)\s*\(/);
  assert.doesNotMatch(windowTransfer, /get opener\s*\(/);
  assert.doesNotMatch(thumbnailWorker, /get (?:activeSourceId|queuedCount)\s*\(/);
  assert.match(thumbnailWorker, /get errorCount\s*\(/);
});
