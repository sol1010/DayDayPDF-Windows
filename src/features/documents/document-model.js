export function createDocumentModelFeature() {
  function createDocument(id, name) {
    return {
      id,
      name,
      pages: [],
      selected: new Set(),
      zoom: 1,
      fitWidth: true,
      fitDone: false,
      currentPage: 0,
      undoStack: [],
      redoStack: [],
      lastSelected: -1,
      scrollTop: 0,
      srcIds: [],
      dirty: false,
      _atSavedState: true,
      fileHandle: null,
    };
  }

  function createSourcePages(sourceId, pageCount) {
    return Array.from({ length: pageCount }, (_, index) => ({
      src: sourceId,
      idx: index,
      rot: 0,
      texts: [],
    }));
  }

  function lockedSourceIds(pages, getSource) {
    return [...new Set(
      pages
        .filter(page => page.src && getSource(page.src)?.locked)
        .map(page => page.src),
    )];
  }

  return Object.freeze({ createDocument, createSourcePages, lockedSourceIds });
}
