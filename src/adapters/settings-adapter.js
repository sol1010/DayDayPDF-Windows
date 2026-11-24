export const EDITOR_SETTING_KEYS = Object.freeze({
  printOptions: 'pdfEditor.printOptions',
  startupMode: 'pdfEditor.startupMode',
  tutorialSeen: 'pdfEditor.tutorialSeen',
  toolbarDisplay: 'pdfEditor.toolbarDisplay',
  toolbarSize: 'pdfEditor.toolbarSize',
  autosave: 'pdfEditor.autosave',
  thumbW: 'pdfEditor.thumbW',
  theme: 'pdfEditor.theme',
  glassEffect: 'pdfEditor.glassEffect',
  keymap: 'pdfEditor.keymap',
  thumbsKey: 'pdfEditor.thumbsKey',
  drawing: 'pdfEditor.drawing',
  lastText: 'pdfEditor.lastText',
  lastShape: 'pdfEditor.lastShape',
  lastShapeText: 'pdfEditor.lastShapeText',
  barPin: 'pdfEditor.barPin',
  barPos: 'pdfEditor.barPos',
  shapeTextBarPin: 'pdfEditor.shapeTextBarPin',
  shapeTextBarPos: 'pdfEditor.shapeTextBarPos',
  palRecent: 'pdfEditor.palRecent',
  panelW: 'pdfEditor.panelW',
  dupQ: 'pdfEditor.dupQ',
  viewMode: 'pdfEditor.viewMode',
});

export function createSettingsAdapter(storage) {
  const keyOf = name => {
    const key = EDITOR_SETTING_KEYS[name];
    if (!key) throw new Error(`알 수 없는 편집기 설정입니다: ${name}`);
    return key;
  };
  return Object.freeze({
    get(name) { return storage.getItem(keyOf(name)); },
    set(name, value) { storage.setItem(keyOf(name), value); },
    remove(name) { storage.removeItem(keyOf(name)); },
  });
}
