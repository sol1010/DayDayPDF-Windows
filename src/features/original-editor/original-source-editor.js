export function createOriginalSourceEditor({
  openDocument,
  getSource,
  registerSource,
  addDocumentSource,
}) {
  function captureContext(document, pages, pageIndex) {
    return { doc: document, page: pages[pageIndex], k: pageIndex };
  }

  function contextValid(context, document, pages) {
    return document === context.doc && pages[context.k] === context.page;
  }

  async function swap(page, bytes, document, canCommit = () => true) {
    const pdfDocument = await openDocument(bytes.slice()).promise;
    if (!canCommit()) { await pdfDocument.destroy(); return null; }
    const old = getSource(page.src);
    const sourceId = registerSource({ bytes, doc: pdfDocument, name: old ? old.name : '원본' });
    addDocumentSource(document, sourceId);
    page.src = sourceId;
    return sourceId;
  }

  return Object.freeze({ captureContext, contextValid, swap });
}
