export function createClipboardController({ target, onPaste }) {
  let mounted = false;
  function mount() {
    if (mounted) return false;
    target.addEventListener('paste', onPaste);
    mounted = true;
    return true;
  }
  function dispose() {
    if (!mounted) return false;
    target.removeEventListener('paste', onPaste);
    mounted = false;
    return true;
  }
  return Object.freeze({ name: 'clipboard', mount, dispose, get mounted() { return mounted; } });
}
