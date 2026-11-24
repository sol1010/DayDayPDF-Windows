export function snapshotSaveCheckpoint(state) {
  return state?._atSavedState === true;
}

export function markChanged(state) {
  if (!state) return false;
  const dirtyChanged = state.dirty !== true;
  state._atSavedState = false;
  state.dirty = true;
  return dirtyChanged;
}

export function markSaved(state) {
  if (!state) return false;
  const dirtyChanged = state.dirty !== false;
  for (const snapshot of [...(state.undoStack || []), ...(state.redoStack || [])]) {
    snapshot.atSavedState = false;
  }
  state._atSavedState = true;
  state.dirty = false;
  return dirtyChanged;
}

export function restoreSaveCheckpoint(state, snapshot) {
  if (!state) return false;
  const atSavedState = snapshot?.atSavedState === true;
  const nextDirty = !atSavedState;
  const dirtyChanged = state.dirty !== nextDirty;
  state._atSavedState = atSavedState;
  state.dirty = nextDirty;
  return dirtyChanged;
}
