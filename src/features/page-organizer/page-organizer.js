export function createPageOrganizerFeature({ clonePage }) {
  function targetIndexes(pages, selectedIndexes, currentPage) {
    if (selectedIndexes.size) return [...selectedIndexes].sort((a, b) => a - b);
    return pages.length ? [Math.min(currentPage, pages.length - 1)] : [];
  }

  function move(pages, selectedIndexes, from, to) {
    const group = selectedIndexes.has(from)
      ? [...selectedIndexes].sort((a, b) => a - b)
      : [from];
    const moving = group.map(index => pages[index]);
    const before = pages.filter((_, index) => !group.includes(index) && index < to).length;
    const nextPages = pages.filter((_, index) => !group.includes(index));
    nextPages.splice(before, 0, ...moving);
    return {
      pages: nextPages,
      selectedIndexes: new Set(moving.map((_, index) => before + index)),
    };
  }

  function rotate(pages, indexes, degrees) {
    indexes.forEach(index => {
      const page = pages[index];
      page.rot = ((page.rot + degrees) % 360 + 360) % 360;
      if (degrees % 180 !== 0 && page._w1) {
        const width = page._w1;
        page._w1 = page._h1;
        page._h1 = width;
      }
    });
    return pages;
  }

  function remove(pages, selectedIndexes) {
    return {
      pages: pages.filter((_, index) => !selectedIndexes.has(index)),
      selectedIndexes: new Set(),
    };
  }

  function createBlankPage(size = [595.28, 841.89]) {
    return { src: null, idx: -1, rot: 0, texts: [], blank: [...size] };
  }

  function insertionIndex(pages, selectedIndexes) {
    return selectedIndexes.size ? Math.max(...selectedIndexes) + 1 : pages.length;
  }

  function insert(pages, selectedIndexes, items, at = insertionIndex(pages, selectedIndexes)) {
    pages.splice(at, 0, ...items);
    return {
      pages,
      selectedIndexes: new Set(items.map((_, index) => at + index)),
      at,
    };
  }

  function copy(pages, indexes) {
    return indexes.map(index => clonePage(pages[index]));
  }

  function cloneItems(items) {
    return items.map(clonePage);
  }

  return Object.freeze({
    targetIndexes,
    move,
    rotate,
    remove,
    createBlankPage,
    insertionIndex,
    insert,
    copy,
    cloneItems,
  });
}
