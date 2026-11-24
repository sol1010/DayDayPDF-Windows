export function createWindowTransferAdapter(windowObject) {
  return Object.freeze({
    detachedToken() {
      const nameMatch = /^pdfEditorDetached_([a-z0-9-]{8,80})$/i.exec(windowObject.name || '');
      const raw = new URL(windowObject.location.href).searchParams.get('detached') || (nameMatch ? nameMatch[1] : '');
      return /^[a-z0-9-]{8,80}$/i.test(raw) ? raw : '';
    },
    captureBootHtml() {
      return '<!DOCTYPE html>\n' + windowObject.document.documentElement.outerHTML;
    },
    setClaimHandler(handler) { windowObject.__pdfEditorClaimDetachedDoc = handler; },
    setFinishHandler(handler) { windowObject.__pdfEditorFinishDetachedDoc = handler; },
    setReceiveHandler(handler) { windowObject.__pdfEditorReceiveMergedDocs = handler; },
    setStartupPromise(promise) { windowObject.pdfEditorStartupPromise = promise; },
    open(...args) { return windowObject.open(...args); },
    connectedReceiver() {
      try {
        const target = windowObject.opener;
        return target && !target.closed && typeof target.__pdfEditorReceiveMergedDocs === 'function' ? target : null;
      } catch { return null; }
    },
    receiveDocuments(target, payload) { return target.__pdfEditorReceiveMergedDocs(payload); },
    canClaimFromOpener() {
      const target = windowObject.opener;
      return !!target && !target.closed && typeof target.__pdfEditorClaimDetachedDoc === 'function';
    },
    claimFromOpener(token) { return windowObject.opener.__pdfEditorClaimDetachedDoc(token); },
    finishToOpener(token, ok, reason) {
      return windowObject.opener.__pdfEditorFinishDetachedDoc(token, ok, reason);
    },
  });
}
