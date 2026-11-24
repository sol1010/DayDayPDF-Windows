export function makeRenderKey(page, zoom) {
  return zoom + ':' + page.src + ':' + page.idx + ':' + page.rot + ':' +
    (page.resize ? page.resize.join('x') : '') + ':' +
    (page.blank ? page.blank.join('x') : '') + ':' +
    (page.crop ? page.crop.join(',') : '');
}

export function makeThumbKey(page) {
  return page.src + ':' + page.idx + ':' + page.rot + ':' +
    (page.resize ? page.resize.join('x') : '') + ':' +
    (page.blank ? page.blank.join('x') : '') + ':' +
    (page.crop ? page.crop.join(',') : '') + ':' +
    JSON.stringify(page.texts.map(object => ({
      ...object,
      _id: 0,
      data: object.data ? object.data.length + ':' + object.data.slice(13, 45) : undefined,
    })));
}
