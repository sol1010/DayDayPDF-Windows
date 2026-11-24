export const createThumbnailRenderer = ({
  getPageAt, maxPixelWidth, makeKey, cacheGet, setImage, cancelCleanup,
  getViewport, isScrolling, paintPage, trackRender, drawObjects,
  createCanvas, cachePut, scheduleCleanup, warn, getPageRaster = () => null,
}) => {
  const renderCanvas = createCanvas();

  async function renderThumbnail(element, cachedOnly = false) {
    const index = +element.dataset.k;
    const pageModel = getPageAt(index);
    if (!pageModel) return true;
    const image = element.querySelector('img');
    if (!image) return true;
    const key = makeKey(pageModel);
    if (element.dataset.rendered === key) return true;
    const hit = cacheGet(key);
    if (hit) {
      setImage(element, key, hit.blob, hit.w, hit.h);
      return true;
    }
    function availableRaster() {
      const raster = getPageRaster(pageModel, index);
      if (raster?.canvas?.width >= maxPixelWidth && (raster.precise || element.dataset.preview !== key)) return raster;
      return null;
    }
    if (cachedOnly && !availableRaster()) return false;
    cancelCleanup(pageModel);
    const token = (element._thumbToken || 0) + 1;
    element._thumbToken = token;
    try {
      const viewport = await getViewport(pageModel, 1);
      if (isScrolling() || element._thumbToken !== token || +element.dataset.k !== index) return false;
      const raster = availableRaster();
      if (cachedOnly && !raster) return false;
      const width = maxPixelWidth;
      if (raster) {
        renderCanvas.width = width;
        renderCanvas.height = Math.max(1, Math.round(width * viewport.height / viewport.width));
        renderCanvas.getContext('2d').drawImage(raster.canvas, 0, 0, width, renderCanvas.height);
      } else {
        await paintPage(pageModel, renderCanvas, width / viewport.width, 1, (task, finished) => {
          trackRender(task, finished, element, token);
        });
      }
      if (isScrolling() || element._thumbToken !== token ||
          +element.dataset.k !== index || getPageAt(index) !== pageModel) return false;
      drawObjects(pageModel, renderCanvas, viewport.width);
      const outputWidth = renderCanvas.width;
      const outputHeight = renderCanvas.height;
      const blob = await new Promise(resolve => renderCanvas.toBlob(resolve, 'image/webp', .8));
      if (!blob) return false;
      if (element._thumbToken !== token ||
          +element.dataset.k !== index || getPageAt(index) !== pageModel || makeKey(pageModel) !== key) return false;
      if (raster && !raster.precise) {
        setImage(element, key, blob, outputWidth, outputHeight, true);
        return false;
      }
      cachePut(pageModel.src, key, blob, outputWidth, outputHeight);
      setImage(element, key, blob, outputWidth, outputHeight);
      scheduleCleanup(pageModel);
      return true;
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') return false;
      warn('썸네일 렌더 실패', error);
      return true;
    }
  }

  return Object.freeze({ renderThumbnail });
};
