export const createPageLifecycle = ({
  getSource, isPageInUse, getPages, getViewport, updateAspectRatio,
  shouldRefit, requestRefit, setTimer, clearTimer,
}) => {
  const cleanupTimers = new Map();
  let dimensionSweepToken = 0;
  let dimensionSweepTimer = null;

  function cancelCleanup(pageModel) {
    if (!pageModel || !pageModel.src) return;
    const key = pageModel.src + ':' + pageModel.idx;
    const timer = cleanupTimers.get(key);
    if (timer) {
      clearTimer(timer);
      cleanupTimers.delete(key);
    }
  }

  function scheduleCleanup(pageModel) {
    if (!pageModel || pageModel.blank || !pageModel.src) return;
    const key = pageModel.src + ':' + pageModel.idx;
    clearTimer(cleanupTimers.get(key));
    cleanupTimers.set(key, setTimer(() => {
      cleanupTimers.delete(key);
      const source = getSource(pageModel.src);
      if (!source || isPageInUse(pageModel)) return;
      source.doc.getPage(pageModel.idx + 1).then(pdfPage => {
        if (isPageInUse(pageModel) || getSource(pageModel.src) !== source) return;
        try { pdfPage.cleanup(); } catch {}
      }).catch(() => {});
    }, 400));
  }

  function scheduleDimensionSweep() {
    clearTimer(dimensionSweepTimer);
    dimensionSweepTimer = setTimer(sweepDimensions, 150);
  }

  async function sweepDimensions() {
    const token = ++dimensionSweepToken;
    const pages = getPages();
    for (let index = 0; index < pages.length; index++) {
      if (token !== dimensionSweepToken || getPages() !== pages) return;
      const pageModel = pages[index];
      if (!pageModel || pageModel._w1 || pageModel.blank || pageModel.resize) continue;
      try { await getViewport(pageModel, 1); }
      catch { continue; }
      if (token !== dimensionSweepToken) return;
      updateAspectRatio(index, pageModel);
      if (shouldRefit(pageModel)) requestRefit();
      if (index % 16 === 15) await new Promise(resolve => setTimer(resolve));
    }
  }

  function invalidateSweeps() {
    dimensionSweepToken++;
    clearTimer(dimensionSweepTimer);
    dimensionSweepTimer = null;
  }

  return Object.freeze({
    cancelCleanup,
    scheduleCleanup,
    scheduleDimensionSweep,
    sweepDimensions,
    invalidateSweeps,
    get cleanupCount() { return cleanupTimers.size; },
  });
};
