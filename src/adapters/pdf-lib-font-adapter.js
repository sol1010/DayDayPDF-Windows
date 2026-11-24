export function createPdfLibAdapter(library) {
  return Object.freeze({
    raw: library,
    PDFDocument: library.PDFDocument,
    StandardFonts: library.StandardFonts,
    degrees: library.degrees,
    rgb: library.rgb,
  });
}

export function createAlignedSubsetFontkit(library, { weight = 400 } = {}) {
  if (!library || typeof library.create !== 'function') {
    throw new TypeError('fontkit.create가 필요합니다');
  }

  const patchFont = font => {
    if (font?.variationAxes?.wght && typeof font.getVariation === 'function') {
      const axis = font.variationAxes.wght;
      font = font.getVariation({ wght: Math.max(axis.min, Math.min(axis.max, weight)) });
    }
    if (!font || typeof font.createSubset !== 'function') return font;
    const createSubset = font.createSubset;
    font.createSubset = function (...args) {
      const subset = createSubset.apply(this, args);
      if (!subset || typeof subset._addGlyph !== 'function') return subset;
      const addGlyph = subset._addGlyph;
      subset._addGlyph = function (...glyphArgs) {
        if (this.font?.loca?.version === 1 && this.loca?.version == null) {
          this.loca.version = 1;
        }
        return addGlyph.apply(this, glyphArgs);
      };
      return subset;
    };
    return font;
  };

  return Object.freeze({
    create(...args) {
      const created = library.create(...args);
      return created && typeof created.then === 'function'
        ? created.then(patchFont)
        : patchFont(created);
    },
  });
}

export function normalizeFontCharacters(value, extra = '') {
  return [...new Set(Array.from(`${extra}${value || ''}`)
    .filter(character => character === ' ' || character.codePointAt(0) >= 0x20))]
    .sort((left, right) => left.codePointAt(0) - right.codePointAt(0))
    .join('');
}

export function googleFontsCss2Url(family, { weight = null, text = '' } = {}) {
  const encodedFamily = encodeURIComponent(String(family || '').trim()).replace(/%20/g, '+');
  const familyValue = weight ? `${encodedFamily}:wght@${weight}` : encodedFamily;
  return `https://fonts.googleapis.com/css2?family=${familyValue}&text=${encodeURIComponent(text)}&display=swap`;
}

export function googleFontsFileUrl(cssText) {
  const urls = [...String(cssText || '').matchAll(/url\(\s*(['"]?)(https:\/\/[^)'"\s]+)\1\s*\)/g)]
    .map(match => match[2]);
  return urls.find(url => /\.woff2(?:\?|$)/i.test(url)) || urls[0] || '';
}

export function pdfEmbeddedFontName(definition, bold = false) {
  const asciiAlias = (definition?.aliases || []).find(value => /^[\x20-\x7e]+$/.test(value));
  const family = String(definition?.googleFamily || asciiAlias || definition?.key || 'DaydayFont')
    .replace(/[^A-Za-z0-9_-]+/g, '') || 'DaydayFont';
  return `${family}${bold ? '-Bold' : ''}`;
}

export function pdfSubsetFontName(definition, bold = false, seed = '') {
  const family = pdfEmbeddedFontName(definition, bold);
  let hash = 2166136261;
  for (const character of `${definition?.key || family}:${bold ? 700 : 400}:${seed}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let tag = '';
  for (let index = 0; index < 6; index++) {
    hash = Math.imul(hash ^ (hash >>> 13), 2246822519) >>> 0;
    tag += String.fromCharCode(65 + (hash % 26));
  }
  return `${tag}+${family}`;
}

export function createFontRegistry({
  gfSha,
  localBase = null,
  fontCatalog,
  fontCss,
  googleFontUrls,
  fetchFn,
  windowObject,
  documentObject,
  FontFaceConstructor,
  persistentCache = null,
  fetchInstalled = null,
  documentTextSubsets = true,
  onScreenError = (key, error) => console.warn('화면 글꼴 로드 실패', key, error),
}) {
  if (!Array.isArray(fontCatalog) || !fontCatalog.length) throw new Error('글꼴 카탈로그가 비었습니다');
  const bundledFiles = Object.freeze({
    spoqa: ['SpoqaHanSansRegular.ttf', 'SpoqaHanSansBold.ttf'],
    notosanskr: ['NotoSansKR-wght.ttf', 'NotoSansKR-wght.ttf'],
    nanum: ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'],
    myeongjo: ['NanumMyeongjo-Regular.ttf', 'NanumMyeongjo-Bold.ttf'],
    pen: ['NanumPenScript-Regular.ttf', 'NanumPenScript-Regular.ttf'],
    roboto: ['Roboto-wdth-wght.ttf', 'Roboto-wdth-wght.ttf'],
    robotoslab: ['RobotoSlab-wght.ttf', 'RobotoSlab-wght.ttf'],
  });
  const localUrl = (key, bold = false) => {
    const file = bundledFiles[key]?.[bold ? 1 : 0];
    return localBase && file
      ? new URL(file, new URL(localBase, documentObject.baseURI)).href
      : null;
  };
  const preferLocal = (key, urls, bold = false) => [localUrl(key, bold), ...(urls || [])].filter(Boolean);
  const fonts = Object.freeze(Object.fromEntries(fontCatalog.map(font => {
    if (font.source === 'installed') {
      const css = JSON.stringify(font.systemName) + ', sans-serif';
      return [font.key, Object.freeze({ ...font, family: font.systemName, css, previewCss: css })];
    }
    const remoteUrls = font.source === 'google' ? googleFontUrls(font, gfSha, font.regularFile) : font.urls;
    const remoteBoldUrls = font.boldFile
      ? googleFontUrls(font, gfSha, font.boldFile)
      : (font.boldUrls || remoteUrls);
    const urls = preferLocal(font.key, remoteUrls);
    const boldUrls = preferLocal(font.key, remoteBoldUrls, true);
    return [font.key, Object.freeze({
      ...font,
      family: `PDFEditor ${font.label}`,
      css: fontCss(font),
      previewFamily: font.googleFamily || font.label,
      previewCss: font.source === 'google'
        ? `"${font.googleFamily || font.label}","Segoe UI","Malgun Gothic",sans-serif`
        : fontCss(font),
      urls: Object.freeze([...(urls || [])]),
      boldUrls: Object.freeze([...(boldUrls || [])]),
      embedLatin: font.language === 'en',
      googleBold: !!font.boldFile || /\[[^\]]*wght[^\]]*\]/i.test(font.regularFile || ''),
    })];
  })));
  const recordCache = new Map();
  const recordLoads = new Map();
  const screenLoads = new Map();
  const screenFaces = new Map();
  const screenRecords = new Map();
  const titleLinks = new Map();
  const persistedFullKeys = new Set();

  const covers = (record, characters) => {
    if (!record?.bytes?.byteLength) return false;
    if (record.kind === 'full') return true;
    const available = new Set(record.characters || '');
    return Array.from(characters || '').every(character => available.has(character));
  };

  const requestedCharacters = (definition, value) => normalizeFontCharacters(
    value,
    definition.supportsKo ? ' Ag한글' : ' Ag',
  );

  async function persistentEntry(cacheKey) {
    if (!persistentCache) return null;
    try {
      if (persistentCache.getEntry) return await persistentCache.getEntry(cacheKey);
      const bytes = await persistentCache.get?.(cacheKey);
      return bytes?.byteLength ? { bytes, characters: '', kind: 'full' } : null;
    } catch {}
    return null;
  }

  async function persistEntry(cacheKey, record) {
    if (!record?.bytes?.byteLength || !persistentCache) return;
    try {
      if (persistentCache.putEntry) await persistentCache.putEntry(cacheKey, record);
      else await persistentCache.put?.(cacheKey, record.bytes);
    } catch {}
  }

  async function fetchFullRecord(key, bold = false, { persist = true } = {}) {
    const resolvedKey = fonts[key] ? key : 'spoqa';
    const cacheKey = resolvedKey + (bold ? '_b' : '');
    const installed = fonts[resolvedKey];
    if (installed.source === 'installed') {
      if (!recordLoads.has(cacheKey)) {
        const job = fetchInstalled(bold ? installed.boldFace : installed.regular)
          .catch(error => { recordLoads.delete(cacheKey); throw error; });
        recordLoads.set(cacheKey, job);
      }
      return recordLoads.get(cacheKey);
    }
    if (recordCache.has(cacheKey)) {
      const record = recordCache.get(cacheKey);
      if (persist && !persistedFullKeys.has(cacheKey)) {
        await persistEntry(cacheKey, record);
        persistedFullKeys.add(cacheKey);
      }
      return record;
    }
    let job = recordLoads.get(cacheKey);
    if (!job) {
      job = (async () => {
        const cached = await persistentEntry(cacheKey);
        if (cached?.bytes?.byteLength) {
          const record = Object.freeze({ ...cached, kind: 'full', characters: '' });
          persistedFullKeys.add(cacheKey);
          recordCache.set(cacheKey, record);
          return record;
        }
        const definition = fonts[resolvedKey];
        const urls = bold && definition.boldUrls?.length ? definition.boldUrls : definition.urls;
        for (const url of urls) {
          try {
            const response = await fetchFn(url);
            if (response.ok) {
              const bytes = new Uint8Array(await response.arrayBuffer());
              const record = Object.freeze({ bytes, characters: '', kind: 'full' });
              recordCache.set(cacheKey, record);
              return record;
            }
          } catch {}
        }
        return null;
      })().finally(() => recordLoads.delete(cacheKey));
      recordLoads.set(cacheKey, job);
    }
    const record = await job;
    if (persist && record && !persistedFullKeys.has(cacheKey)) {
      await persistEntry(cacheKey, record);
      persistedFullKeys.add(cacheKey);
    }
    return record;
  }

  async function fetchGoogleTextRecord(definition, bold, characters) {
    const weight = bold && definition.googleBold ? 700 : null;
    const cssUrl = googleFontsCss2Url(definition.previewFamily, { weight, text: characters });
    if (cssUrl.length > 7000) return null;
    try {
      const cssResponse = await fetchFn(cssUrl);
      if (!cssResponse.ok || typeof cssResponse.text !== 'function') return null;
      const fontUrl = googleFontsFileUrl(await cssResponse.text());
      if (!fontUrl) return null;
      const fontResponse = await fetchFn(fontUrl);
      if (!fontResponse.ok) return null;
      const bytes = new Uint8Array(await fontResponse.arrayBuffer());
      return bytes.byteLength
        ? Object.freeze({ bytes, characters, kind: 'google-text' })
        : null;
    } catch {
      return null;
    }
  }

  async function fetchFontRecord(key, bold = false, characters = '', { persist = true } = {}) {
    const resolvedKey = fonts[key] ? key : 'spoqa';
    const definition = fonts[resolvedKey];
    const wanted = requestedCharacters(definition, characters);
    if (!documentTextSubsets || definition.source !== 'google' || !wanted)
      return fetchFullRecord(resolvedKey, bold, { persist });

    const cacheKey = `${resolvedKey}${bold ? '_b' : ''}:text`;
    let cached = recordCache.get(cacheKey) || await persistentEntry(cacheKey);
    if (cached?.bytes?.byteLength && covers(cached, wanted)) {
      const record = Object.freeze({ ...cached });
      recordCache.set(cacheKey, record);
      return record;
    }
    let job = recordLoads.get(cacheKey);
    if (job) {
      const loaded = await job;
      if (covers(loaded, wanted)) return loaded;
      cached = loaded || cached;
    }
    const charactersToLoad = requestedCharacters(definition, `${cached?.characters || ''}${wanted}`);
    job = (async () => {
      const record = await fetchGoogleTextRecord(definition, bold, charactersToLoad);
      if (record) {
        recordCache.set(cacheKey, record);
        if (persist) await persistEntry(cacheKey, record);
        return record;
      }
      return fetchFullRecord(resolvedKey, bold, { persist });
    })().finally(() => recordLoads.delete(cacheKey));
    recordLoads.set(cacheKey, job);
    return job;
  }

  async function fetchPdfFontRecord(key, bold = false, characters = '', { persist = true } = {}) {
    const resolvedKey = fonts[key] ? key : 'spoqa';
    const definition = fonts[resolvedKey];
    const baseRecord = await fetchFullRecord(resolvedKey, bold, { persist });
    if (!baseRecord?.bytes?.byteLength) return null;
    if (definition.source === 'installed') {
      const face = bold ? definition.boldFace : definition.regular;
      return { ...baseRecord, key: resolvedKey, weight: face.weight, syntheticBold: bold && face.weight < 600,
        customName: baseRecord.embedSubset ? pdfSubsetFontName(definition, bold, normalizeFontCharacters(characters))
          : pdfEmbeddedFontName(definition, bold) };
    }
    const hasDistinctBoldFile = !!definition.boldFile || (
      definition.source !== 'google' &&
      definition.boldUrls?.some((url, index) => url !== definition.urls?.[index])
    );
    return Object.freeze({
      ...baseRecord,
      key: resolvedKey,
      bold: !!bold,
      embedSubset: true,
      customName: pdfSubsetFontName(definition, bold, normalizeFontCharacters(characters)),
      weight: bold ? 700 : 400,
      syntheticBold: !!bold && !hasDistinctBoldFile && !/\[[^\]]*wght[^\]]*\]/i.test(definition.regularFile || ''),
    });
  }

  async function fetchBytes(key, bold = false, { persist = true, characters = null } = {}) {
    const record = characters === null
      ? await fetchFullRecord(key, bold, { persist })
      : await fetchFontRecord(key, bold, characters, { persist });
    return record?.bytes || null;
  }

  function ensureTitleFont(key) {
    const resolvedKey = fonts[key] ? key : 'spoqa';
    const definition = fonts[resolvedKey];
    if (definition.source !== 'google' || titleLinks.has(resolvedKey)) return titleLinks.get(resolvedKey) || null;
    const head = documentObject.head || documentObject.querySelector?.('head');
    if (!head?.appendChild || !documentObject.createElement) return null;
    const sampleText = definition.language === 'ko' ? '가나다 Aa' : 'Aa Bb Cc';
    const titleText = normalizeFontCharacters(`${definition.previewFamily}${definition.label}${sampleText}`);
    const link = documentObject.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleFontsCss2Url(definition.previewFamily, { text: titleText });
    link.dataset.daydayFontTitle = resolvedKey;
    head.appendChild(link);
    titleLinks.set(resolvedKey, link);
    return link;
  }

  function ensureScreenFont(key, bold = false, { persist = true, characters = '' } = {}) {
    if (!('FontFace' in windowObject) || !documentObject.fonts) return Promise.resolve(null);
    const resolvedKey = fonts[key] ? key : 'spoqa';
    const definition = fonts[resolvedKey];
    const cacheKey = resolvedKey + (bold ? '_b' : '');
    if (definition.source === 'installed') return Promise.resolve(definition);
    const wanted = requestedCharacters(definition, characters || definition.label);
    if (screenFaces.has(cacheKey) && covers(screenRecords.get(cacheKey), wanted))
      return Promise.resolve(screenFaces.get(cacheKey));
    if (screenLoads.has(cacheKey)) {
      return screenLoads.get(cacheKey).then(face => {
        if (!face || covers(screenRecords.get(cacheKey), wanted)) return face;
        return ensureScreenFont(resolvedKey, bold, { persist, characters: wanted });
      });
    }
    const job = fetchFontRecord(resolvedKey, bold, wanted, { persist }).then(record => {
      if (!record?.bytes) return null;
      const face = new FontFaceConstructor(definition.family, record.bytes, {
        weight: bold ? '700' : '400',
        ...(/\[[^\]]*wght[^\]]*\]/i.test(definition.regularFile || '')
          ? { variationSettings: `"wght" ${bold ? 700 : 400}` } : {}),
      });
      return face.load().then(loaded => {
        const previous = screenFaces.get(cacheKey);
        documentObject.fonts.add(loaded);
        if (previous && previous !== loaded && typeof documentObject.fonts.delete === 'function')
          documentObject.fonts.delete(previous);
        screenFaces.set(cacheKey, loaded);
        screenRecords.set(cacheKey, record);
        return loaded;
      });
    }).catch(error => {
      onScreenError(resolvedKey, error);
      return null;
    }).finally(() => screenLoads.delete(cacheKey));
    screenLoads.set(cacheKey, job);
    return job;
  }

  async function persistentStats() {
    if (!persistentCache?.stats) return Object.freeze({ count: 0, bytes: 0, maxBytes: 0 });
    return persistentCache.stats();
  }

  async function clearPersistentCache() {
    persistedFullKeys.clear();
    if (persistentCache?.clear) await persistentCache.clear();
  }

  return Object.freeze({
    fonts, fetchBytes, fetchFontRecord, fetchPdfFontRecord, ensureScreenFont, ensureTitleFont,
    persistentStats, clearPersistentCache,
  });
}
