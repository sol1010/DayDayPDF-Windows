export function waitForStartupContentReady({
  hasActiveContent,
  hasPaintedContent,
  isRenderSettled,
  requestFrame,
  setTimer,
  clearTimer,
  now,
  timeoutMs = 12000,
  settleDelayMs = 250,
}) {
  const started = now();
  return new Promise(resolve => {
    let resolved = false;
    let paintFramesQueued = false;
    let deadline = null;

    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      if (deadline !== null) clearTimer(deadline);
      resolve();
    };
    const resolveAfterPaintFrames = () => {
      if (paintFramesQueued || resolved) return;
      paintFramesQueued = true;
      requestFrame(() => requestFrame(resolveOnce));
    };

    deadline = setTimer(resolveOnce, Math.max(1, Number(timeoutMs) || 12000));

    const check = () => {
      if (resolved) return;
      const noContent = !hasActiveContent();
      const painted = !noContent && hasPaintedContent();
      const settled = !noContent && now() - started >= settleDelayMs && isRenderSettled();
      if (noContent || painted || settled) resolveAfterPaintFrames();
      else requestFrame(check);
    };
    requestFrame(check);
  });
}
