export function createDesktopMergeAdapter({ windowObject, host, exportSnapshot }) {
  const pending = new Map();
  function finish(id, error, value) {
    const job = pending.get(id); if (!job) return;
    pending.delete(id); windowObject.clearTimeout(job.timer); job.channel?.close();
    if (error) job.reject(error); else job.resolve(value);
  }
  function request(type, tabId = null) {
    const requestId = windowObject.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const job = { resolve, reject, timer: windowObject.setTimeout(() => finish(requestId, new Error('열린 문서 응답 시간이 초과되었습니다.')), 120000) };
      pending.set(requestId, job);
      try {
        if (tabId) {
          job.channel = new windowObject.BroadcastChannel('daydaypdf-merge:' + requestId);
          job.channel.onmessage = event => {
            const message = event.data;
            if (message?.requestId !== requestId) return;
            finish(requestId, message.error ? new Error(message.error) : null, message.packet);
          };
        }
        if (!host.send({ type, apiVersion: 4, requestId, tabId })) throw new Error('열린 문서를 불러올 수 없습니다.');
      } catch (error) { finish(requestId, error); }
    });
  }
  const removeHandler = host.onMessage(message => {
    if (message?.cmd === 'merge-tabs-result')
      finish(message.requestId, message.error ? new Error(message.error) : null, message.documents);
    else if (message?.cmd === 'merge-snapshot-request' && /^[a-f0-9-]{36}$/i.test(message.requestId || '')) {
      (async () => {
        const channel = new windowObject.BroadcastChannel('daydaypdf-merge:' + message.requestId);
        try { channel.postMessage({ requestId: message.requestId, packet: await exportSnapshot() }); }
        catch (error) { channel.postMessage({ requestId: message.requestId, error: String(error?.message || error) }); }
        finally { channel.close(); }
      })();
    }
  });
  return Object.freeze({
    list: () => request('merge-tabs-list'),
    snapshot: tabId => request('merge-tab-snapshot', tabId),
    dispose() { removeHandler(); for (const id of [...pending.keys()]) finish(id, new Error('편집기를 닫았습니다.')); },
  });
}
