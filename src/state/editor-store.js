const ACTIVE_DOCUMENT_FIELDS = Object.freeze({
  pages: 'pages',
  selectedPages: 'selected',
  zoom: 'zoom',
  fitWidth: 'fitWidth',
  currentPage: 'currentPage',
  documentName: 'name',
  undoStack: 'undoStack',
  redoStack: 'redoStack',
  lastSelected: 'lastSelected',
  scrollTop: 'scrollTop',
  dirty: 'dirty',
  fileHandle: 'fileHandle',
});

function createInactiveState() {
  return {
    pages: [], selected: new Set(), zoom: 1, fitWidth: true, currentPage: 0,
    name: '', undoStack: [], redoStack: [], lastSelected: -1, scrollTop: 0,
    dirty: false, fileHandle: null,
  };
}

class EditorStore {
  constructor() {
    this._documents = [];
    this._activeDocumentId = null;
    this._inactiveState = createInactiveState();
    this._viewOrder = new WeakMap();
    this._viewSequence = 0;
    this.selectedDocuments = new Set();
    this.tabSelectionAnchor = null;
  }

  get documents() { return this._documents; }
  set documents(value) {
    if (!Array.isArray(value)) throw new TypeError('documents는 배열이어야 합니다');
    this._documents = value;
    if (!this.activeDocument) this._activeDocumentId = null;
    for (const document of [...this.selectedDocuments]) {
      if (!value.includes(document)) this.selectedDocuments.delete(document);
    }
    if (this.tabSelectionAnchor && !value.includes(this.tabSelectionAnchor))
      this.tabSelectionAnchor = null;
  }

  get activeDocument() {
    if (this._activeDocumentId === null) return null;
    return this._documents.find(document => document.id === this._activeDocumentId) || null;
  }
  set activeDocument(document) { this.activate(document); }

  activate(document) {
    if (document === null) {
      this._activeDocumentId = null;
      this._inactiveState = createInactiveState();
      return null;
    }
    if (!this._documents.includes(document))
      throw new Error('열린 문서만 활성화할 수 있습니다');
    this._activeDocumentId = document.id;
    this._viewOrder.set(document, ++this._viewSequence);
    return document;
  }

  lastViewed(documents) {
    return documents.reduce((last, doc) => (this._viewOrder.get(doc) || 0) >
      (this._viewOrder.get(last) || 0) ? doc : last, null);
  }

  captureActiveScroll(scrollTop) {
    const document = this.activeDocument;
    if (document) document.scrollTop = Math.max(0, Number(scrollTop) || 0);
  }

  _activeState() { return this.activeDocument || this._inactiveState; }
}

for (const [storeField, documentField] of Object.entries(ACTIVE_DOCUMENT_FIELDS)) {
  Object.defineProperty(EditorStore.prototype, storeField, {
    configurable: false,
    enumerable: false,
    get() { return this._activeState()[documentField]; },
    set(value) { this._activeState()[documentField] = value; },
  });
}

export const createEditorStore = () => new EditorStore();
