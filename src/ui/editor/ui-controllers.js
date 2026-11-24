function createBindingsController(name, setup) {
  let mounted = false;
  let cleanups = [];

  function mount() {
    if (mounted) return false;
    mounted = true;
    const listen = (target, type, listener, options) => {
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener(type, listener, options));
      return listener;
    };
    const assign = (target, property, listener) => {
      const previous = target[property];
      target[property] = listener;
      cleanups.push(() => { if (target[property] === listener) target[property] = previous; });
      return listener;
    };
    const cleanup = callback => { cleanups.push(callback); return callback; };
    try {
      const returned = setup({ listen, assign, cleanup });
      if (typeof returned === 'function') cleanups.push(returned);
      return true;
    } catch (error) {
      dispose();
      throw error;
    }
  }

  function dispose() {
    if (!mounted) return false;
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch {}
    }
    mounted = false;
    return true;
  }

  return Object.freeze({ name, mount, dispose, get mounted() { return mounted; } });
}

export function createTabController(setup) {
  return createBindingsController('tabs', setup);
}

export function createViewerController(setup) {
  return createBindingsController('viewer', setup);
}

export function createToolbarController(setup) {
  return createBindingsController('toolbar', setup);
}

export function createDialogsController(setup) {
  return createBindingsController('dialogs', setup);
}

export function createAppLifecycleController(setup) {
  return createBindingsController('app-lifecycle', setup);
}
