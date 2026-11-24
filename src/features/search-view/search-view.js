export function createSearchViewFeature() {
  async function find(pages, query, getPageItems) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const matches = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const items = await getPageItems(pages[pageIndex]);
      items.forEach((item, itemIndex) => {
        if ((item.str || '').toLowerCase().includes(normalized))
          matches.push({ k: pageIndex, ii: itemIndex });
      });
    }
    return matches;
  }

  function step(index, count, delta) {
    return count ? (index + delta + count) % count : index;
  }

  function basePage(currentPage, viewMode) {
    return viewMode === 'double' ? currentPage - (currentPage % 2) : currentPage;
  }

  function flip(currentPage, pageCount, viewMode, direction) {
    if (!pageCount || viewMode === 'scroll') return currentPage;
    const base = basePage(currentPage, viewMode);
    const stepSize = viewMode === 'double' ? 2 : 1;
    return Math.min(pageCount - 1, Math.max(0, base + direction * stepSize));
  }

  return Object.freeze({ find, step, basePage, flip });
}
