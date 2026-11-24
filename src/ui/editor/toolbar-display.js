export function createToolbarDisplayController({ documentObject: doc, windowObject: win,
  read, write, storageKey, readSize, writeSize, sizeStorageKey }) {
  const choices = [...doc.querySelectorAll('input[name="toolbarDisplay"]')];
  const sizeChoices = [...doc.querySelectorAll('input[name="toolbarSize"]')];
  const toolbar = doc.getElementById('toolbar');
  let mounted = false;
  function apply(value) {
    const mode = value === 'icons' ? 'icons' : 'labels';
    doc.documentElement.dataset.toolbarDisplay = mode;
    choices.forEach(input => { input.checked = input.value === mode; });
  }
  function restore() {
    try { apply(read()); } catch { apply('labels'); }
    try { applySize(readSize()); } catch { applySize('small'); }
  }
  function applySize(value) {
    const size = ['medium', 'large'].includes(value) ? value : 'small';
    doc.documentElement.dataset.toolbarSize = size;
    sizeChoices.forEach(input => { input.checked = input.value === size; });
  }
  function change(event) {
    if (!event.target.checked) return;
    const size = event.target.name === 'toolbarSize';
    (size ? applySize : apply)(event.target.value);
    try { (size ? writeSize : write)(event.target.value); } catch {   }
    win.dispatchEvent(new win.Event('resize'));
  }
  function storage(event) {
    if (event.key === storageKey || event.key === sizeStorageKey || event.key === null) {
      restore();
      win.dispatchEvent(new win.Event('resize'));
    }
  }
  function wheel(event) {
    if (event.ctrlKey || event.metaKey || toolbar.scrollWidth <= toolbar.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? toolbar.clientWidth : 1;
    const previous = toolbar.scrollLeft;
    toolbar.scrollLeft += delta * unit;
    if (toolbar.scrollLeft !== previous) event.preventDefault();
  }
  function mount() {
    if (mounted) return false;
    mounted = true;
    restore();
    [...choices, ...sizeChoices].forEach(input => input.addEventListener('change', change));
    win.addEventListener('storage', storage);
    toolbar.addEventListener('wheel', wheel, { passive: false });
    return true;
  }
  function dispose() {
    if (!mounted) return false;
    [...choices, ...sizeChoices].forEach(input => input.removeEventListener('change', change));
    win.removeEventListener('storage', storage);
    toolbar.removeEventListener('wheel', wheel);
    mounted = false;
    return true;
  }
  return Object.freeze({ name: 'toolbar-display', mount, dispose });
}
