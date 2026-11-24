const PEER_PROTOCOL = 'pdf-editor-window-peer';
const PEER_VERSION = 1;
const PEER_MAX_AGE_MS = 5000;
const DEFAULT_TRANSFER_TIMEOUT_MS = 120000;

function inactiveAdapter() {
  return Object.freeze({
    supported: false,
    windowId: '',
    windowNumber: 0,
    peers: () => [],
    updateMetadata: () => false,
    setReceiveHandler: () => false,
    setDragRequestHandler: () => false,
    transferDocuments: async () => { throw new Error('PC 창 연결을 사용할 수 없습니다'); },
    requestDraggedDocuments: async () => { throw new Error('PC 창 연결을 사용할 수 없습니다'); },
    focus: () => false,
    dispose: () => false,
  });
}

function validId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{8,80}$/i.test(value);
}

export function createWindowPeerAdapter(windowObject, options = {}) {
  const context = windowObject.pdfEditorWindowsContext;
  const BroadcastChannelConstructor = windowObject.BroadcastChannel;
  if (!context || !validId(context.sessionId) || !validId(context.windowId) ||
      typeof BroadcastChannelConstructor !== 'function') return inactiveAdapter();

  const now = options.now || (() => Date.now());
  const setIntervalFn = options.setIntervalFn || ((handler, delay) => windowObject.setInterval(handler, delay));
  const clearIntervalFn = options.clearIntervalFn || (token => windowObject.clearInterval(token));
  const setTimeoutFn = options.setTimeoutFn || ((handler, delay) => windowObject.setTimeout(handler, delay));
  const clearTimeoutFn = options.clearTimeoutFn || (token => windowObject.clearTimeout(token));
  const windowId = context.windowId;
  const windowNumber = Math.max(1, Number(context.windowNumber) || 1);
  let channel;
  try { channel = new BroadcastChannelConstructor(`${PEER_PROTOCOL}:${context.sessionId}`); }
  catch { return inactiveAdapter(); }

  const peers = new Map();
  const pending = new Map();
  const dragPending = new Map();
  let receiveHandler = null;
  let dragRequestHandler = null;
  let disposed = false;
  let metadata = { title: `창 ${windowNumber}`, documentCount: 0 };

  function post(message) {
    if (disposed) return false;
    channel.postMessage({
      protocol: PEER_PROTOCOL,
      version: PEER_VERSION,
      senderId: windowId,
      ...message,
    });
    return true;
  }

  function announce() {
    try {
      return post({
        type: 'announce',
        windowNumber,
        title: metadata.title,
        documentCount: metadata.documentCount,
        ready: typeof receiveHandler === 'function',
      });
    } catch { return false; }
  }

  function currentPeers() {
    const cutoff = now() - PEER_MAX_AGE_MS;
    for (const [id, peer] of peers) if (peer.seenAt < cutoff) peers.delete(id);
    return [...peers.values()]
      .filter(peer => peer.ready)
      .sort((a, b) => a.windowNumber - b.windowNumber || a.title.localeCompare(b.title))
      .map(peer => Object.freeze({ ...peer }));
  }

  function replyTransfer(message, ok, reason = '') {
    try {
      post({
        type: 'transfer-result',
        targetId: message.senderId,
        requestId: message.requestId,
        ok: !!ok,
        reason: String(reason || '').slice(0, 240),
      });
    } catch {}
  }

  function replyDragRequest(message, ok, reason = '') {
    try {
      post({
        type: 'drag-request-result',
        targetId: message.senderId,
        requestId: message.requestId,
        ok: !!ok,
        reason: String(reason || '').slice(0, 240),
      });
    } catch {}
  }

  async function onMessage(event) {
    const message = event && event.data;
    if (!message || message.protocol !== PEER_PROTOCOL || message.version !== PEER_VERSION ||
        !validId(message.senderId) || message.senderId === windowId) return;

    if (message.type === 'announce') {
      peers.set(message.senderId, {
        id: message.senderId,
        windowNumber: Math.max(1, Number(message.windowNumber) || 1),
        title: String(message.title || `창 ${message.windowNumber || ''}`).slice(0, 120),
        documentCount: Math.max(0, Number(message.documentCount) || 0),
        ready: message.ready === true,
        seenAt: now(),
      });
      return;
    }
    if (message.type === 'closed') {
      peers.delete(message.senderId);
      return;
    }
    if (message.type === 'focus' && message.targetId === windowId) {
      try { windowObject.focus(); } catch {}
      return;
    }
    if (message.type === 'transfer-result' && message.targetId === windowId) {
      const record = pending.get(message.requestId);
      if (!record || record.targetId !== message.senderId) return;
      pending.delete(message.requestId);
      clearTimeoutFn(record.timeout);
      if (message.ok) record.resolve(true);
      else record.reject(new Error(message.reason || '대상 창에서 문서를 받지 못했습니다'));
      return;
    }
    if (message.type === 'drag-request-result' && message.targetId === windowId) {
      const record = dragPending.get(message.requestId);
      if (!record || record.targetId !== message.senderId) return;
      dragPending.delete(message.requestId);
      clearTimeoutFn(record.timeout);
      if (message.ok) record.resolve(true);
      else record.reject(new Error(message.reason || '원본 창에서 탭을 보내지 못했습니다'));
      return;
    }
    if (message.type === 'drag-transfer-request' && message.targetId === windowId) {
      if (typeof dragRequestHandler !== 'function') {
        replyDragRequest(message, false, '원본 창이 탭 드래그를 처리할 수 없습니다');
        return;
      }
      try {
        const documentIds = Array.isArray(message.documentIds)
          ? message.documentIds.slice(0, 100).map(String) : [];
        if (!documentIds.length) throw new Error('옮길 탭 식별자가 없습니다');
        const ok = await dragRequestHandler(documentIds, {
          id: message.senderId,
          windowNumber: Math.max(1, Number(message.senderWindowNumber) || 1),
          targetIndex: Math.max(0, Number(message.targetIndex) || 0),
        });
        replyDragRequest(message, ok !== false, ok === false ? '원본 창에서 탭을 보내지 못했습니다' : '');
      } catch (error) {
        replyDragRequest(message, false, error && error.message || error);
      }
      return;
    }
    if (message.type === 'transfer-documents' && message.targetId === windowId) {
      if (typeof receiveHandler !== 'function') {
        replyTransfer(message, false, '대상 창이 아직 준비되지 않았습니다');
        return;
      }
      try {
        const ok = await receiveHandler(message.payload, {
          id: message.senderId,
          windowNumber: Math.max(1, Number(message.senderWindowNumber) || 1),
        });
        replyTransfer(message, ok !== false, ok === false ? '대상 창에서 문서를 열지 못했습니다' : '');
      } catch (error) {
        replyTransfer(message, false, error && error.message || error);
      }
    }
  }

  if (typeof channel.addEventListener === 'function') channel.addEventListener('message', onMessage);
  else channel.onmessage = onMessage;

  const heartbeat = setIntervalFn(announce, 1500);
  announce();

  return Object.freeze({
    supported: true,
    windowId,
    windowNumber,
    peers: currentPeers,
    updateMetadata(next = {}) {
      metadata = {
        title: String(next.title || metadata.title).slice(0, 120),
        documentCount: Math.max(0, Number(next.documentCount) || 0),
      };
      return announce();
    },
    setReceiveHandler(handler) {
      receiveHandler = typeof handler === 'function' ? handler : null;
      announce();
      return !!receiveHandler;
    },
    setDragRequestHandler(handler) {
      dragRequestHandler = typeof handler === 'function' ? handler : null;
      return !!dragRequestHandler;
    },
    transferDocuments(targetId, payload, timeoutMs = DEFAULT_TRANSFER_TIMEOUT_MS) {
      if (!validId(targetId) || targetId === windowId)
        return Promise.reject(new Error('대상 PC 창이 올바르지 않습니다'));
      if (!currentPeers().some(peer => peer.id === targetId))
        return Promise.reject(new Error('대상 PC 창과 연결되어 있지 않습니다'));
      const requestId = windowObject.crypto && typeof windowObject.crypto.randomUUID === 'function'
        ? windowObject.crypto.randomUUID()
        : `${windowId}-${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeoutFn(() => {
          pending.delete(requestId);
          reject(new Error('대상 PC 창의 응답 시간이 초과되었습니다'));
        }, Math.max(1000, Number(timeoutMs) || DEFAULT_TRANSFER_TIMEOUT_MS));
        pending.set(requestId, { targetId, resolve, reject, timeout });
        try {
          post({
            type: 'transfer-documents',
            targetId,
            requestId,
            senderWindowNumber: windowNumber,
            payload,
          });
        } catch (error) {
          pending.delete(requestId);
          clearTimeoutFn(timeout);
          reject(error);
        }
      });
    },
    requestDraggedDocuments(sourceId, documentIds, targetIndex = 0, timeoutMs = DEFAULT_TRANSFER_TIMEOUT_MS) {
      if (!validId(sourceId) || sourceId === windowId)
        return Promise.reject(new Error('원본 PC 창이 올바르지 않습니다'));
      if (!currentPeers().some(peer => peer.id === sourceId))
        return Promise.reject(new Error('원본 PC 창과 연결되어 있지 않습니다'));
      const ids = Array.isArray(documentIds) ? documentIds.slice(0, 100).map(String).filter(Boolean) : [];
      if (!ids.length) return Promise.reject(new Error('옮길 탭 식별자가 없습니다'));
      const requestId = windowObject.crypto && typeof windowObject.crypto.randomUUID === 'function'
        ? windowObject.crypto.randomUUID()
        : `${windowId}-drag-${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeoutFn(() => {
          dragPending.delete(requestId);
          reject(new Error('원본 PC 창의 응답 시간이 초과되었습니다'));
        }, Math.max(1000, Number(timeoutMs) || DEFAULT_TRANSFER_TIMEOUT_MS));
        dragPending.set(requestId, { targetId: sourceId, resolve, reject, timeout });
        try {
          post({
            type: 'drag-transfer-request',
            targetId: sourceId,
            requestId,
            senderWindowNumber: windowNumber,
            documentIds: ids,
            targetIndex: Math.max(0, Number(targetIndex) || 0),
          });
        } catch (error) {
          dragPending.delete(requestId);
          clearTimeoutFn(timeout);
          reject(error);
        }
      });
    },
    focus(targetId) {
      if (!validId(targetId) || targetId === windowId) return false;
      try { return post({ type: 'focus', targetId }); }
      catch { return false; }
    },
    dispose() {
      if (disposed) return false;
      try { post({ type: 'closed' }); } catch {}
      disposed = true;
      clearIntervalFn(heartbeat);
      if (typeof channel.removeEventListener === 'function') channel.removeEventListener('message', onMessage);
      else channel.onmessage = null;
      try { channel.close(); } catch {}
      for (const record of pending.values()) {
        clearTimeoutFn(record.timeout);
        record.reject(new Error('PC 창 연결이 종료되었습니다'));
      }
      pending.clear();
      for (const record of dragPending.values()) {
        clearTimeoutFn(record.timeout);
        record.reject(new Error('PC 창 연결이 종료되었습니다'));
      }
      dragPending.clear();
      peers.clear();
      return true;
    },
  });
}
