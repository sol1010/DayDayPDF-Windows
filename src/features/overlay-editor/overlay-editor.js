export function createOverlayEditorFeature({ isTextObject, getRotation, normalizeRotation }) {
  const category = object => isTextObject(object) ? 'text' : object.type === 'img' ? 'img' : 'shape';

  function reorderWithinCategories(items, isPicked, categoryOf, front) {
    const picked = items.filter(isPicked);
    if (!picked.length) return items;
    const categories = new Set(picked.map(categoryOf));
    const next = [...items];
    for (const currentCategory of categories) {
      const slots = [];
      const sameCategory = [];
      next.forEach((item, index) => {
        if (categoryOf(item) === currentCategory) {
          slots.push(index);
          sameCategory.push(item);
        }
      });
      const chosen = sameCategory.filter(isPicked);
      const rest = sameCategory.filter(item => !isPicked(item));
      const ordered = front ? [...rest, ...chosen] : [...chosen, ...rest];
      slots.forEach((slot, index) => { next[slot] = ordered[index]; });
    }
    return next;
  }

  function rotateQuarterTurn(object) {
    object.rot = normalizeRotation(getRotation(object) + 90);
    return object;
  }

  return Object.freeze({ category, reorderWithinCategories, rotateQuarterTurn });
}
