export function createDialogHost({
  windowObject,
  historyObject,
  locationObject,
  shouldArm,
  closeTop,
  notifyExit,
  now = () => Date.now(),
}) {
  let mounted = false;
  let exitUntil = 0;

  const onBack = () => {
    if (now() < exitUntil) {
      dispose();
      historyObject.back();
      return;
    }
    const closed = closeTop();
    historyObject.pushState({ pdfEditorGuard: true }, '', locationObject.href);
    if (!closed) {
      exitUntil = now() + 2000;
      notifyExit();
    }
  };

  function mount() {
    if (mounted || !shouldArm()) return false;
    mounted = true;
    historyObject.replaceState({ ...(historyObject.state || {}), pdfEditorBase: true }, '', locationObject.href);
    historyObject.pushState({ pdfEditorGuard: true }, '', locationObject.href);
    windowObject.addEventListener('popstate', onBack);
    return true;
  }

  function dispose() {
    if (!mounted) return false;
    windowObject.removeEventListener('popstate', onBack);
    mounted = false;
    return true;
  }

  return Object.freeze({ name: 'dialog-host', mount, dispose, get mounted() { return mounted; } });
}
