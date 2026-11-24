const STORAGE_RECENT = 'pdfEditorFontRecentV1';
const STORAGE_FAVORITES = 'pdfEditorFontFavoritesV1';
const MAX_RECENT = 8;

const safeParseList = (storage, key) => {
  try {
    const value = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch { return []; }
};

const normalized = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function createFontPicker({
  catalog,
  fonts,
  controls,
  panel,
  searchInput,
  categorySelect,
  list,
  count,
  closeButton,
  languageButtons,
  ensureFont,
  ensureTitleFont = () => null,
  getFontRequest = () => ({ characters: '', bold: false }),
  documentObject,
  windowObject,
  storage,
  onLoadError = () => {},
}) {
  const byKey = new Map(catalog.map(font => [font.key, font]));
  let activeControl = null;
  let language = 'all';
  let recent = safeParseList(storage, STORAGE_RECENT).filter(key => byKey.has(key)).slice(0, MAX_RECENT);
  let favorites = new Set(safeParseList(storage, STORAGE_FAVORITES).filter(key => byKey.has(key)));

  const isEnglish = () => documentObject.documentElement.lang === 'en';
  const categoryLabels = () => isEnglish()
    ? { all: 'All styles', sans: 'Sans serif', serif: 'Serif', display: 'Display', handwriting: 'Handwriting', mono: 'Monospace' }
    : { all: '전체 스타일', sans: '고딕', serif: '명조', display: '제목', handwriting: '손글씨', mono: '고정폭' };

  function persist() {
    try {
      storage.setItem(STORAGE_RECENT, JSON.stringify(recent));
      storage.setItem(STORAGE_FAVORITES, JSON.stringify([...favorites]));
    } catch {}
  }

  function populateNativeSelect(select) {
    select.replaceChildren();
    for (const [lang, label] of [['ko', '한국어'], ['en', 'English'], ['pc', 'PC']]) {
      if (!catalog.some(item => item.language === lang)) continue;
      const group = documentObject.createElement('optgroup');
      group.label = label;
      for (const font of catalog.filter(item => item.language === lang)) {
        const option = documentObject.createElement('option');
        option.value = font.key;
        option.textContent = font.label;
        group.appendChild(option);
      }
      select.appendChild(group);
    }
  }

  function selectedLabel(control) {
    const selected = control.select.selectedOptions?.[0];
    return selected?.textContent || byKey.get(control.select.value)?.label || 'Font';
  }

  function syncControl(control) {
    const definition = fonts[control.select.value];
    control.label.textContent = selectedLabel(control);
    control.button.title = `${isEnglish() ? 'Font' : '글꼴'} · ${selectedLabel(control)}`;
    control.button.style.fontFamily = definition?.css || '';
    control.button.dataset.fontKey = definition?.key || '';
  }

  function syncSelect(select) {
    const control = controls.find(item => item.select === select);
    if (control) syncControl(control);
  }

  function setCategoryOptions() {
    const value = categorySelect.value || 'all';
    const labels = categoryLabels();
    categorySelect.replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const option = documentObject.createElement('option');
      option.value = key;
      option.textContent = label;
      return option;
    }));
    categorySelect.value = labels[value] ? value : 'all';
    searchInput.placeholder = isEnglish() ? `Search ${catalog.length} fonts` : `글꼴 ${catalog.length}개 검색`;
    closeButton.title = isEnglish() ? 'Close' : '닫기';
    languageButtons.forEach(button => {
      const key = button.dataset.fontLanguage;
      if (key === 'pc') { button.hidden = !catalog.some(item => item.language === 'pc'); return; }
      button.textContent = key === 'all' ? (isEnglish() ? 'All' : '전체')
        : key === 'ko' ? (isEnglish() ? 'Korean' : '한글') : 'English';
    });
  }

  function score(font) {
    const favorite = favorites.has(font.key) ? 0 : 1;
    const recentIndex = recent.indexOf(font.key);
    return [favorite, recentIndex < 0 ? 99 : recentIndex, font.label];
  }

  function render() {
    const query = normalized(searchInput.value);
    const category = categorySelect.value || 'all';
    const filtered = catalog.filter(font => {
      if (!query && language !== 'all' && font.language !== language) return false;
      if (category !== 'all' && font.category !== category) return false;
      if (!query) return true;
      return normalized([font.label, font.key, ...(font.aliases || [])].join(' ')).includes(query);
    }).sort((a, b) => {
      const aa = score(a), bb = score(b);
      return aa[0] - bb[0] || aa[1] - bb[1] || aa[2].localeCompare(bb[2], isEnglish() ? 'en' : 'ko');
    });

    list.replaceChildren(...filtered.map(font => {
      ensureTitleFont(font.key);
      const row = documentObject.createElement('div');
      row.className = 'fontPickerItem';
      row.dataset.fontKey = font.key;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', activeControl?.select.value === font.key ? 'true' : 'false');

      const choose = documentObject.createElement('button');
      choose.type = 'button';
      choose.className = 'fontPickerChoose';
      const name = documentObject.createElement('span');
      name.className = 'fontPickerName';
      name.textContent = font.label;
      name.style.fontFamily = fonts[font.key]?.previewCss || '';
      const sample = documentObject.createElement('span');
      sample.className = 'fontPickerSample';
      sample.textContent = font.language === 'ko' || font.supportsKo ? '가나다 Aa' : 'Aa Bb Cc';
      sample.style.fontFamily = fonts[font.key]?.previewCss || '';
      choose.append(name, sample);
      choose.addEventListener('click', () => chooseFont(font.key));

      const favorite = documentObject.createElement('button');
      favorite.type = 'button';
      favorite.className = 'fontPickerFavorite';
      favorite.classList.toggle('active', favorites.has(font.key));
      favorite.textContent = favorites.has(font.key) ? '★' : '☆';
      favorite.title = isEnglish() ? 'Favorite' : '즐겨찾기';
      favorite.addEventListener('click', () => {
        if (favorites.has(font.key)) favorites.delete(font.key); else favorites.add(font.key);
        persist();
        render();
      });
      row.append(choose, favorite);
      return row;
    }));
    count.textContent = `${filtered.length} / ${catalog.length}`;
  }

  function position(control) {
    const rect = control.button.getBoundingClientRect();
    const mobile = windowObject.matchMedia('(max-width: 640px)').matches;
    panel.classList.toggle('mobile', mobile);
    if (mobile) {
      panel.style.left = '8px';
      panel.style.right = '8px';
      panel.style.top = 'auto';
      panel.style.bottom = 'max(8px, env(safe-area-inset-bottom))';
      return;
    }
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    const width = 344;
    const height = Math.min(480, windowObject.innerHeight - 24);
    const left = Math.max(8, Math.min(windowObject.innerWidth - width - 8, rect.left));
    const top = rect.bottom + height <= windowObject.innerHeight - 8
      ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function open(control) {
    activeControl = control;
    setCategoryOptions();
    language = byKey.get(control.select.value)?.language || 'all';
    languageButtons.forEach(button => button.classList.toggle('active', button.dataset.fontLanguage === language));
    searchInput.value = '';
    categorySelect.value = 'all';
    panel.hidden = false;
    position(control);
    render();
    windowObject.requestAnimationFrame(() => searchInput.focus());
  }

  function close() {
    panel.hidden = true;
    activeControl = null;
  }

  async function chooseFont(key) {
    if (!activeControl || !byKey.has(key)) return;
    const control = activeControl;
    const row = [...list.children].find(item => item.dataset.fontKey === key);
    row?.classList.add('loading');
    row?.setAttribute('aria-busy', 'true');
    const request = getFontRequest(control) || {};
    const loaded = await ensureFont(key, !!request.bold, {
      persist: true,
      characters: request.characters || byKey.get(key)?.label || '',
    });
    row?.classList.remove('loading');
    row?.removeAttribute('aria-busy');
    if (!loaded) { onLoadError(key); return; }
    if (activeControl !== control || panel.hidden) return;
    control.select.value = key;
    recent = [key, ...recent.filter(item => item !== key)].slice(0, MAX_RECENT);
    persist();
    syncControl(control);
    control.select.dispatchEvent(new windowObject.Event('change', { bubbles: true }));
    close();
  }

  for (const control of controls) {
    populateNativeSelect(control.select);
    control.select.tabIndex = -1;
    control.select.setAttribute('aria-hidden', 'true');
    control.button.addEventListener('click', event => { event.stopPropagation(); open(control); });
    control.select.addEventListener('change', () => syncControl(control));
    syncControl(control);
  }
  searchInput.addEventListener('input', render);
  categorySelect.addEventListener('change', render);
  languageButtons.forEach(button => button.addEventListener('click', () => {
    language = button.dataset.fontLanguage || 'all';
    languageButtons.forEach(item => item.classList.toggle('active', item === button));
    render();
  }));
  closeButton.addEventListener('click', close);
  documentObject.addEventListener('pointerdown', event => {
    if (panel.hidden || panel.contains(event.target) || controls.some(item => item.button.contains(event.target))) return;
    close();
  }, true);
  documentObject.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
  windowObject.addEventListener('resize', () => { if (activeControl) position(activeControl); });
  windowObject.addEventListener('daydaypdf:languagechange', () => {
    controls.forEach(syncControl);
    if (!panel.hidden) { setCategoryOptions(); render(); }
  });

  return Object.freeze({ open, close, render, syncSelect, syncAll: () => controls.forEach(syncControl) });
}
