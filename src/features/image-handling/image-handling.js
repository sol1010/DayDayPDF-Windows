export function createImageHandlingFeature() {
  function fitObject(naturalWidth, naturalHeight, pageWidth, pageHeight, at = null) {
    let widthPoints = naturalWidth * .75;
    let heightPoints = naturalHeight * .75;
    const ratio = Math.min(1, pageWidth * .6 / widthPoints, pageHeight * .6 / heightPoints);
    widthPoints *= ratio;
    heightPoints *= ratio;
    const width = widthPoints / pageWidth;
    const height = heightPoints / pageHeight;
    const centerX = at ? at.fx : .5;
    const centerY = at ? at.fy : .5;
    return {
      fx: Math.max(0, Math.min(1 - width, centerX - width / 2)),
      fy: Math.max(0, Math.min(1 - height, centerY - height / 2)),
      fw: width,
      fh: height,
    };
  }

  function rasterPages(sourceId, pageCount) {
    return Array.from({ length: pageCount }, (_, index) => ({
      src: sourceId,
      idx: index,
      rot: 0,
      texts: [],
    }));
  }

  return Object.freeze({ fitObject, rasterPages });
}
