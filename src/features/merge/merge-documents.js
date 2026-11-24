export function createMergeFeature({ clonePage }) {
  function reorder(items, from, to) {
    const next = [...items];
    const [moving] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, moving);
    return next;
  }

  function materialize(items, currentPages, registerFileSource) {
    const pages = [];
    const sourceIds = [];
    for (const item of items) {
      if (item.kind === 'pages') {
        pages.push(...item.pages.map(clonePage));
        for (const id of item.sourceIds || []) if (!sourceIds.includes(id)) sourceIds.push(id);
        continue;
      }
      if (item.kind === 'current') {
        pages.push(...currentPages.map(clonePage));
        continue;
      }
      const sourceId = registerFileSource(item);
      sourceIds.push(sourceId);
      for (let index = 0; index < item.count; index++) {
        pages.push({ src: sourceId, idx: index, rot: 0, texts: [] });
      }
    }
    return { pages, sourceIds };
  }

  return Object.freeze({ reorder, materialize });
}
