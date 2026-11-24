export function createCropResizeFeature({ rotateDelta, getRotation }) {
  function clearMeasuredSize(page) {
    delete page._w1;
    delete page._h1;
  }

  function resetResize(pages, indexes) {
    indexes.forEach(index => {
      delete pages[index].resize;
      clearMeasuredSize(pages[index]);
    });
  }

  async function resize(pages, indexes, width, height, orientation, getViewport) {
    for (const index of indexes) {
      const page = pages[index];
      let targetWidth = Math.min(width, height);
      let targetHeight = Math.max(width, height);
      if (orientation === 'landscape') [targetWidth, targetHeight] = [targetHeight, targetWidth];
      else if (orientation === 'auto') {
        const viewport = await getViewport(page, 1);
        if (viewport.width > viewport.height)
          [targetWidth, targetHeight] = [targetHeight, targetWidth];
      }
      if (page.blank) page.blank = [targetWidth, targetHeight];
      else page.resize = [targetWidth, targetHeight];
      clearMeasuredSize(page);
    }
  }

  function applyCrop(pages, indexes, crop) {
    indexes.forEach(index => {
      pages[index].crop = [...crop];
      clearMeasuredSize(pages[index]);
    });
  }

  function resetCrop(pages, indexes) {
    indexes.forEach(index => {
      delete pages[index].crop;
      clearMeasuredSize(pages[index]);
    });
  }

  function cropImageObject(object, crop, pageWidth, pageHeight) {
    const oldWidth = object.fw * pageWidth;
    const oldHeight = object.fh * pageHeight;
    const oldCenterX = (object.fx + object.fw / 2) * pageWidth;
    const oldCenterY = (object.fy + object.fh / 2) * pageHeight;
    const localX = (crop[0] + crop[2] / 2 - .5) * oldWidth;
    const localY = (crop[1] + crop[3] / 2 - .5) * oldHeight;
    const [deltaX, deltaY] = rotateDelta(localX, localY, getRotation(object));
    const newWidth = crop[2] * oldWidth;
    const newHeight = crop[3] * oldHeight;
    object.fx = (oldCenterX + deltaX - newWidth / 2) / pageWidth;
    object.fy = (oldCenterY + deltaY - newHeight / 2) / pageHeight;
    object.fw = newWidth / pageWidth;
    object.fh = newHeight / pageHeight;
  }

  return Object.freeze({ resetResize, resize, applyCrop, resetCrop, cropImageObject });
}
