export function positionContextMenu(menu, x, y, windowObject = window) {
  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();
  const viewport = windowObject.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const width = viewport?.width || windowObject.innerWidth;
  const height = viewport?.height || windowObject.innerHeight;
  menu.style.left = Math.max(left + 4, Math.min(x, left + width - rect.width - 4)) + 'px';
  menu.style.top = Math.max(top + 4, Math.min(y, top + height - rect.height - 4)) + 'px';
}

export function createContextPasteState({ readKind }) {
  const revisions = new WeakMap();
  function setDisabled(item, disabled) {
    item.classList.toggle('dim', disabled);
    item.setAttribute('aria-disabled', String(disabled));
  }
  async function refresh(menu, item, acceptedKinds, isAllowed) {
    const revision = (revisions.get(item) || 0) + 1;
    revisions.set(item, revision);
    setDisabled(item, true);
    if (!isAllowed()) return;
    let kind = null;
    try { kind = await readKind(); } catch {   }
    if (revisions.get(item) !== revision || menu.style.display !== 'block') return;
    setDisabled(item, !isAllowed() || !acceptedKinds.includes(kind));
  }
  return Object.freeze({ refresh });
}
