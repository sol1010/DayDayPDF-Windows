export function createMergeOpenDocumentsController({ documentObject, listDocuments, addDocuments, reportError }) {
  const get = id => documentObject.getElementById(id);
  const panel = get('mgOpenDocuments'), list = get('mgOpenList'), add = get('mgOpenAdd'), toggle = get('mgOpen');
  let revision = 0, busy = false;
  const text = value => documentObject.defaultView.DaydayPDFI18n?.t?.(value) || value;
  function close() {
    revision++; panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', async () => {
    if (busy) return;
    if (!panel.hidden) { close(); return; }
    const ticket = ++revision;
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    list.textContent = text('문서 목록을 불러오는 중…'); add.disabled = true;
    try {
      const documents = await listDocuments();
      if (ticket !== revision) return;
      list.replaceChildren();
      for (const item of documents) {
        const row = documentObject.createElement('label'); row.className = 'mgOpenRow';
        const input = documentObject.createElement('input'); input.type = 'checkbox'; input.value = String(item.id);
        const name = documentObject.createElement('span'); name.className = 'mgOpenName'; name.dataset.i18nIgnore = ''; name.textContent = item.name;
        const count = documentObject.createElement('span'); count.className = 'mgOpenCount'; count.textContent = item.count ? `${item.count}p` : '';
        row.append(input, name, count); list.append(row);
      }
      if (!documents.length) list.textContent = text('열려 있는 문서가 없습니다.');
    } catch (error) {
      if (ticket !== revision) return;
      list.textContent = text('문서 목록을 불러오지 못했습니다.'); reportError(error);
    }
  });
  list.addEventListener('change', () => { add.disabled = busy || !list.querySelector('input:checked'); });
  add.addEventListener('click', async () => {
    if (busy) return;
    const ids = [...list.querySelectorAll('input:checked')].map(input => input.value);
    if (!ids.length) return;
    busy = true; add.disabled = toggle.disabled = true;
    try { await addDocuments(ids); close(); }
    catch (error) { reportError(error); }
    finally { busy = false; toggle.disabled = false; add.disabled = !list.querySelector('input:checked'); }
  });
  return Object.freeze({ close });
}
