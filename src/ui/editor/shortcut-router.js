export function isSelectAllShortcut(event) {
  return !event.defaultPrevented && !event.isComposing &&
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
    (event.code === 'KeyA' || event.key?.toLowerCase() === 'a');
}

export function createShortcutRouter({ target, onKeyDown, options }) {
  let mounted = false;
  function mount() {
    if (mounted) return false;
    target.addEventListener('keydown', onKeyDown, options);
    mounted = true;
    return true;
  }
  function dispose() {
    if (!mounted) return false;
    target.removeEventListener('keydown', onKeyDown, options);
    mounted = false;
    return true;
  }
  return Object.freeze({ name: 'shortcuts', mount, dispose, get mounted() { return mounted; } });
}
