export function createDesktopHostAdapter({ windowObject, mode }) {
  const enabled = mode === 'desktop-view';
  const nativeHost = enabled ? windowObject.chrome?.webview || null : null;
  const messageHandlers = new Set();
  const sharedBufferHandlers = new Set();
  let mounted = false;

  function parseAdditionalData(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch { return {}; }
  }

  function dispatchMessage(value) {
    for (const handler of messageHandlers) handler(value);
  }

  function handleNativeMessage(event) {
    dispatchMessage(event.data);
  }

  function handleWindowMessage(event) {
    if (nativeHost || event.source !== windowObject.parent) return;
    if (windowObject.location.origin !== 'null' && event.origin !== windowObject.location.origin) return;
    dispatchMessage(event.data);
  }

  function handleSharedBuffer(event) {
    const metadata = parseAdditionalData(event.additionalData);
    const buffer = event.getBuffer();
    try {
      for (const handler of sharedBufferHandlers) handler({ metadata, buffer });
    } finally {
      try { nativeHost?.releaseBuffer(buffer); } catch {}
    }
  }

  function send(message) {
    if (!enabled) return false;
    if (nativeHost) {
      nativeHost.postMessage(message);
      return true;
    }
    if (windowObject.parent && windowObject.parent !== windowObject) {
      windowObject.parent.postMessage(message, windowObject.location.origin);
      return true;
    }
    return false;
  }

  function sendWithAdditionalObjects(message, objects) {
    if (!enabled || !nativeHost?.postMessageWithAdditionalObjects || !objects?.length) return false;
    nativeHost.postMessageWithAdditionalObjects(message, objects);
    return true;
  }

  function mount() {
    if (!enabled || mounted) return false;
    if (nativeHost) {
      nativeHost.addEventListener('message', handleNativeMessage);
      nativeHost.addEventListener('sharedbufferreceived', handleSharedBuffer);
    } else {
      windowObject.addEventListener('message', handleWindowMessage);
    }
    mounted = true;
    return true;
  }

  function dispose() {
    if (!mounted) return false;
    if (nativeHost) {
      nativeHost.removeEventListener('message', handleNativeMessage);
      nativeHost.removeEventListener('sharedbufferreceived', handleSharedBuffer);
    } else {
      windowObject.removeEventListener('message', handleWindowMessage);
    }
    messageHandlers.clear();
    sharedBufferHandlers.clear();
    mounted = false;
    return true;
  }

  return Object.freeze({
    enabled,
    native: !!nativeHost,
    send,
    sendWithAdditionalObjects,
    mount,
    dispose,
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onSharedBuffer(handler) {
      sharedBufferHandlers.add(handler);
      return () => sharedBufferHandlers.delete(handler);
    },
  });
}
