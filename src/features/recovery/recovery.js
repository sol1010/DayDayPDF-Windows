export function createRecoveryFeature({ createDocument, remapPage, collectSourceRefs }) {
  function materializeDocument(dto, idMap, { trusted = false, includeRuntimeState = true } = {}) {
    const document = createDocument(dto.name || '전송된 문서');
    document.dirty = !!dto.dirty;
    document.openedWithPassword = dto.openedWithPassword === true;
    document._atSavedState = typeof dto.atSavedState === 'boolean'
      ? dto.atSavedState
      : !document.dirty;
    if (includeRuntimeState) {
      try { document.fileHandle = dto.fileHandle ? structuredClone(dto.fileHandle) : null; }
      catch { document.fileHandle = null; }
    } else {
      document.fileHandle = dto.handle || null;
    }
    document.pages = (dto.pages || []).map(page => remapPage(page, idMap, trusted));
    document.srcIds = [...new Set(collectSourceRefs(document.pages))];
    const hasScrollTop = Object.prototype.hasOwnProperty.call(dto, 'scrollTop') &&
      Number.isFinite(+dto.scrollTop);
    document.scrollTop = hasScrollTop ? Math.max(0, +dto.scrollTop) : 0;
    if (!includeRuntimeState) {
      document.fitDone = hasScrollTop;
      return document;
    }
    document.selected = new Set((dto.selected || []).filter(index => index >= 0 && index < document.pages.length));
    document.zoom = Number.isFinite(+dto.zoom) ? Math.max(.1, Math.min(8, +dto.zoom)) : 1;
    document.fitWidth = dto.fitWidth !== false;
    document.fitDone = !document.fitWidth || hasScrollTop;
    document.currentPage = Math.max(0, Math.min(document.pages.length - 1, +dto.currentPage || 0));
    document.lastSelected = Number.isFinite(+dto.lastSelected) ? +dto.lastSelected : -1;
    document.undoStack = (dto.undoStack || []).map(snapshot => ({
      pages: (snapshot.pages || []).map(page => remapPage(page, idMap, true)),
      atSavedState: snapshot.atSavedState === true,
    }));
    document.redoStack = (dto.redoStack || []).map(snapshot => ({
      pages: (snapshot.pages || []).map(page => remapPage(page, idMap, true)),
      atSavedState: snapshot.atSavedState === true,
    }));
    return document;
  }

  function materializePayload(payload, idMap) {
    const incoming = payload && (payload.docs || (payload.doc ? [payload.doc] : null));
    if (!incoming || !incoming.length) throw new Error('전송할 문서 데이터를 찾을 수 없습니다');
    const opened = incoming.map(dto => materializeDocument(dto, idMap, { trusted: true }));
    const openAt = Math.max(0, Math.min(opened.length - 1, +payload.active || 0));
    return { opened, openAt };
  }

  return Object.freeze({ materializeDocument, materializePayload });
}
