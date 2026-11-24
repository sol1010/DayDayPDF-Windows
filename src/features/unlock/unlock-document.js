export function createUnlockFeature({ decrypt, openDocument, detectLocked, getSource }) {
  async function prepare(sourceIds, password) {
    const replacements = new Map();
    try {
      for (const sourceId of sourceIds) {
        const source = getSource(sourceId);
        const bytes = await decrypt(source.bytes, password);
        const document = await openDocument(bytes.slice()).promise;
        if (await detectLocked(document)) {
          try { document.destroy(); } catch {}
          throw new Error('이 파일은 잠금 해제를 지원하지 않습니다');
        }
        if (document.numPages !== source.doc.numPages) {
          try { document.destroy(); } catch {}
          throw new Error('해제 사본의 페이지 구성이 원본과 다릅니다');
        }
        replacements.set(sourceId, { bytes, doc: document, name: source.name });
      }
      return replacements;
    } catch (error) {
      for (const replacement of replacements.values()) {
        try { replacement.doc.destroy(); } catch {}
      }
      throw error;
    }
  }

  function remapDocuments(documents, sourceMap) {
    for (const document of documents) {
      document.pages.forEach(page => {
        if (sourceMap.has(page.src)) page.src = sourceMap.get(page.src);
      });
      for (const sourceId of sourceMap.values()) {
        if (document.pages.some(page => page.src === sourceId) && !document.srcIds.includes(sourceId))
          document.srcIds.push(sourceId);
      }
    }
  }

  return Object.freeze({ prepare, remapDocuments });
}
