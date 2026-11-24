export function readThemePreferences(settings) {
  let theme = 'dark', glassEffect = true;
  try { theme = settings.get('theme') || 'dark'; glassEffect = settings.get('glassEffect') !== '0'; } catch {}
  if (theme === 'glass') {
    theme = 'light'; glassEffect = true;
    try { settings.set('theme', theme); settings.set('glassEffect', '1'); } catch {}
  }
  if (theme === 'system') {
    theme = 'dark';
    try { settings.set('theme', theme); } catch {}
  }
  if (!['light', 'dark'].includes(theme)) theme = 'dark';
  return { theme, glassEffect };
}

export function applyThemePreferences(root, { theme, glassEffect }) {
  root.dataset.theme = theme;
  root.toggleAttribute('data-glass', glassEffect);
  return theme;
}

export function isThemeStorageEvent(event) {
  return event.key === null || event.key === 'pdfEditor.theme' || event.key === 'pdfEditor.glassEffect';
}
