export function createPrintExportFeature({ clonePage, parseRange, getViewport }) {
  function pageIndexes(mode, pages, selectedIndexes, customRange) {
    if (mode === 'selected')
      return selectedIndexes.size ? [...selectedIndexes].sort((a, b) => a - b) : null;
    if (mode === 'custom') return parseRange(customRange, pages.length);
    return pages.map((_, index) => index);
  }

  async function orient(pages, indexes, orientation) {
    const list = indexes.map(index => clonePage(pages[index]));
    if (orientation === 'auto') return list;
    for (const page of list) {
      const viewport = await getViewport(page, 1);
      const landscape = viewport.width > viewport.height;
      if ((orientation === 'portrait' && landscape) ||
          (orientation === 'landscape' && !landscape)) {
        if (page.blank) page.blank = [page.blank[1], page.blank[0]];
        else if (page.resize) page.resize = [page.resize[1], page.resize[0]];
        else page.rot = (page.rot + 90) % 360;
        delete page._w1;
        delete page._h1;
      }
    }
    return list;
  }

  return Object.freeze({ pageIndexes, orient });
}
