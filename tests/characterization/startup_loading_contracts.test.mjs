import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { waitForStartupContentReady } from '../../src/core/startup-guard.js';

function createScheduler() {
  const frames = [];
  const timers = new Map();
  const cleared = [];
  let nextTimer = 1;
  return {
    frames,
    cleared,
    requestFrame(callback) { frames.push(callback); },
    runFrame() {
      const callback = frames.shift();
      assert.ok(callback, '실행할 animation frame이 있어야 합니다');
      callback();
    },
    setTimer(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { cleared.push(id); timers.delete(id); },
    fireFirstTimer() {
      const [id, record] = timers.entries().next().value || [];
      assert.ok(record, '실행할 deadline 타이머가 있어야 합니다');
      timers.delete(id);
      record.callback();
    },
    firstDelay() { return timers.values().next().value?.delay; },
  };
}

test('startup deadline resolves even when a hidden WebView stops every animation frame', async () => {
  const scheduler = createScheduler();
  let resolved = false;
  const ready = waitForStartupContentReady({
    hasActiveContent: () => true,
    hasPaintedContent: () => false,
    isRenderSettled: () => false,
    requestFrame: callback => scheduler.requestFrame(callback),
    setTimer: (callback, delay) => scheduler.setTimer(callback, delay),
    clearTimer: id => scheduler.clearTimer(id),
    now: () => 0,
    timeoutMs: 12000,
  }).then(() => { resolved = true; });

  assert.equal(scheduler.firstDelay(), 12000);
  assert.equal(resolved, false);
  scheduler.fireFirstTimer();
  await ready;
  assert.equal(resolved, true);
});

test('painted startup content waits for two presentation frames before becoming ready', async () => {
  const scheduler = createScheduler();
  let resolved = false;
  const ready = waitForStartupContentReady({
    hasActiveContent: () => true,
    hasPaintedContent: () => true,
    isRenderSettled: () => false,
    requestFrame: callback => scheduler.requestFrame(callback),
    setTimer: (callback, delay) => scheduler.setTimer(callback, delay),
    clearTimer: id => scheduler.clearTimer(id),
    now: () => 0,
  }).then(() => { resolved = true; });

  scheduler.runFrame();
  scheduler.runFrame();
  assert.equal(resolved, false);
  scheduler.runFrame();
  await ready;
  assert.equal(resolved, true);
  assert.deepEqual(scheduler.cleared, [1]);
});

test('an empty render queue becomes startup-ready only after the settle delay', async () => {
  const scheduler = createScheduler();
  let now = 0;
  const ready = waitForStartupContentReady({
    hasActiveContent: () => true,
    hasPaintedContent: () => false,
    isRenderSettled: () => true,
    requestFrame: callback => scheduler.requestFrame(callback),
    setTimer: (callback, delay) => scheduler.setTimer(callback, delay),
    clearTimer: id => scheduler.clearTimer(id),
    now: () => now,
    settleDelayMs: 250,
  });

  scheduler.runFrame();
  assert.equal(scheduler.frames.length, 1);
  now = 250;
  scheduler.runFrame();
  scheduler.runFrame();
  scheduler.runFrame();
  await ready;
});

test('PC loading UI keeps the normal top-right close affordance and never hides the active controller', async () => {
  const [template, shellCss, main, xaml, host] = await Promise.all([
    readFile(new URL('../../src/PDF편집기.template.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/shell.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../windows/PdfEditor.Preview/MainWindow.xaml', import.meta.url), 'utf8'),
    readFile(new URL('../../windows/PdfEditor.Preview/MainWindow.xaml.cs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(template + shellCss, /appBootExit/);
  assert.match(main, /setTimeout\(\(\) => bootSplash\?\.classList\.add\('showProgress'\), 2000\)/);
  assert.match(main, /type: 'startup-error'/);
  assert.match(xaml,
    /x:Name="StartupLoadingCloseButton"[\s\S]{0,400}Content="&#xE8BB;"[\s\S]{0,240}CloseCaptionButtonStyle/);
  assert.match(host,
    /StartupLoadingProgress\.Visibility = Visibility\.Visible;[\s\S]{0,120}StartupLoadingCloseButton\.Visibility = Visibility\.Visible/);
  assert.match(host, /controller\.IsVisible = true/);
  assert.match(host, /SetContentHostVisible\(true\)/);
  assert.doesNotMatch(host, /controller\.IsVisible = session\.ViewReady/);
  assert.match(host, /_startupReadyTimeoutTimer = new\(\) \{ Interval = TimeSpan\.FromSeconds\(60\) \}/);
});
