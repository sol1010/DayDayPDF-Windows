import { mountEditorApp } from './editor-app.js';

const bootSplash = document.getElementById('appBootSplash');
const bootStatus = document.getElementById('appBootStatus');
const editorMode = 'desktop-view';
const bootProgressTimer = setTimeout(() => bootSplash?.classList.add('showProgress'), 2000);

let readyAnnounced = false;
function finishBootSplash() {
  bootSplash?.remove();
  if (!readyAnnounced) {
    readyAnnounced = true;
    window.dispatchEvent(new Event('pdf-editor-ready'));
  }
}

function fadeOutBootSplash() {
  if (!bootSplash) { finishBootSplash(); return; }
  clearTimeout(bootProgressTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bootSplash.classList.add('fadeOut');
    bootSplash.addEventListener('transitionend', finishBootSplash, { once: true });
    setTimeout(finishBootSplash, 800);
  }));
}

window.addEventListener('pdf-editor-dismiss-boot-splash', fadeOutBootSplash, { once: true });

try {
  const editorApp = await mountEditorApp({
    mode: editorMode,
  });
  await Promise.resolve(window.pdfEditorStartupPromise).catch(() => {});
} catch (error) {
  clearTimeout(bootProgressTimer);
  bootSplash?.classList.add('showProgress', 'loadFailed');
  if (bootStatus) bootStatus.textContent = '편집기를 불러오지 못했습니다';
  if (editorMode === 'desktop-view' && window.chrome?.webview) {
    window.chrome.webview.postMessage({
      type: 'startup-error',
      apiVersion: 4,
      message: String(error?.message || error).slice(0, 240),
    });
  }
  console.error(error);
}
