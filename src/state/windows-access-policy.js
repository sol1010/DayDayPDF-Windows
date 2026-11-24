const DEFAULT_BROWSER_POLICY = Object.freeze({
  hosted: false,
  mode: 'browser',
  canOpenNewDocuments: true,
  canEditCurrentDocuments: true,
  canSaveCurrentDocuments: true,
  graceRemainingSeconds: null,
  message: '',
});

function nonNegativeSeconds(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

export function normalizeWindowsAccessPolicy(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Windows 접근 정책이 필요합니다');
  const mode = typeof input.mode === 'string' && input.mode.trim() ? input.mode.trim() : 'blocked';
  return Object.freeze({
    hosted: true,
    mode,
    canOpenNewDocuments: input.canOpenNewDocuments === true,
    canEditCurrentDocuments: input.canEditCurrentDocuments === true,
    canSaveCurrentDocuments: true,
    graceRemainingSeconds: nonNegativeSeconds(input.graceRemainingSeconds),
    message: typeof input.message === 'string' ? input.message.slice(0, 240) : '',
  });
}

export function createWindowsAccessPolicy() {
  let current = DEFAULT_BROWSER_POLICY;
  const listeners = new Set();

  function setFromHost(input) {
    current = normalizeWindowsAccessPolicy(input);
    for (const listener of [...listeners]) listener(current);
    return current;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('정책 구독 함수가 필요합니다');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    get current() { return current; },
    setFromHost,
    subscribe,
  });
}
