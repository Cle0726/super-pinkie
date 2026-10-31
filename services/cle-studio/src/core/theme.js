// Keep the browser on the C.le. theme. Plugin themes are chosen per browser when the
// gateway has no signed-in profile, so we write the same setting Appearance writes.
export const THEME_ID = 'cle-studio/cle';
const KEY_PREFIX = 'openclaw.control.settings.v1';

export function ensureTheme() {
  let changed = false;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (!value || value.theme === THEME_ID) continue;
      value.theme = THEME_ID;
      if (!['light', 'dark', 'system'].includes(value.themeMode)) value.themeMode = 'system';
      localStorage.setItem(key, JSON.stringify(value));
      changed = true;
    }
  } catch {}
  // The palette is applied at boot; reload once so the very first C.le. session is right.
  if (changed && !sessionStorage.getItem('cle:theme-reloaded')) {
    sessionStorage.setItem('cle:theme-reloaded', '1');
    location.reload();
    return false;
  }
  return true;
}
