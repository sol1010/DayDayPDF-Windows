export function createDesktopOutputAdapter(host) {
  const pending = new Map();
  host.onMessage(message => {
    if (message.cmd === 'output-progress') { pending.get(message.requestId)?.onProgress?.(message); return; }
    if (message.cmd !== 'output-result') return;
    const task = pending.get(message.requestId);
    if (!task) return;
    pending.delete(message.requestId);
    clearTimeout(task.timeout);
    task.detach?.();
    if (message.ok || message.canceled) task.resolve(message);
    else task.reject(new Error(message.error || '출력 작업에 실패했습니다.'));
  });
  host.onSharedBuffer(({ metadata, buffer }) => {
    if (metadata?.cmd !== 'output-buffer') return;
    const task = pending.get(metadata.requestId);
    if (!task?.bytes) return;
    const destination = new Uint8Array(buffer);
    if (destination.length !== task.bytes.length) {
      clearTimeout(task.timeout); task.detach?.(); pending.delete(metadata.requestId);
      task.reject(new Error('출력 데이터 크기가 일치하지 않습니다.')); return;
    }
    destination.set(task.bytes);
    task.bytes = null;
    host.send({ type: 'output-put-done', apiVersion: 4, requestId: metadata.requestId });
  });
  function request(options, bytes, timeoutMs = 600000, { signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      signal?.throwIfAborted();
      const cancel = () => host.send({ type: 'output-cancel', apiVersion: 4, requestId });
      const detach = () => signal?.removeEventListener('abort', cancel);
      const timeout = setTimeout(() => {
        if (signal) cancel();
        detach(); pending.delete(requestId);
        reject(new Error('출력 응답 시간이 초과되었습니다. 프린터 대기열을 확인한 후 다시 시도하세요.'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, bytes, timeout, detach, onProgress });
      signal?.addEventListener('abort', cancel, { once: true });
      if (!host.send({ ...options, apiVersion: 4, requestId, size: bytes?.byteLength })) {
        clearTimeout(timeout); detach(); pending.delete(requestId); reject(new Error('PC 출력 채널에 연결되지 않았습니다.'));
      }
    });
  }
  return {
    printers: () => request({ type: 'output-printers' }),
    resources: (action = 'sample') => request({ type: 'output-resources', action }, undefined, 5000),
    print: (bytes, options, progress) => request({ type: 'output-put', operation: 'print', ...options }, bytes, 600000, progress),
    save: (bytes, name) => request({ type: 'output-put', operation: 'save-copy', name }, bytes),
    openSaved: savedRequestId => request({ type: 'output-open-saved', savedRequestId }),
  };
}
