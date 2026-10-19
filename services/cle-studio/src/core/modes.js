// C.le. is an oil painting: the art style is fixed to 'paint' (line drawing survives only on tiny
// function keys). Day / night is the native theme mode, applied live and persisted.
const ART_KEY = 'cle:art-style';
const listeners = new Set();

export const artStyle = () => 'paint';
export function setArtStyle(style) {
  document.documentElement.dataset.cleArt = style;
  try { localStorage.setItem(ART_KEY, style); } catch {}
  listeners.forEach((fn) => fn(style));
}
export const onArtStyle = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const settingsKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('openclaw.control.settings.v1'));
export const isNight = () => document.documentElement.dataset.themeMode === 'dark';
export function setNight(night) {
  const html = document.documentElement, mode = night ? 'dark' : 'light';
  try { for (const k of settingsKeys()) { const v = JSON.parse(localStorage.getItem(k) || '{}'); v.themeMode = mode; localStorage.setItem(k, JSON.stringify(v)); } } catch {}
  html.dataset.themeMode = mode;
  if (/^custom-/.test(html.dataset.theme || '')) html.dataset.theme = `custom-${mode}`;
  // let the native shell pick it up too (it listens for storage changes on reload; the attributes apply now)
  window.dispatchEvent(new StorageEvent('storage', {key: settingsKeys()[0] || null}));
}

export function initModes() {
  document.documentElement.dataset.cleArt = 'paint';
  try { localStorage.removeItem(ART_KEY); } catch {}
}

// a pair of quiet segmented controls
export function modeSwitches() {
  const box = document.createElement('div');
  box.className = 'cle-modes';
  box.innerHTML = `<div class="cle-seg" role="radiogroup" aria-label="昼夜"><button type="button" role="radio" data-night="0">昼</button><button type="button" role="radio" data-night="1">夜</button></div>`;
  const paint = () => {
    for (const b of box.querySelectorAll('[data-art]')) b.setAttribute('aria-checked', String(b.dataset.art === artStyle()));
    for (const b of box.querySelectorAll('[data-night]')) b.setAttribute('aria-checked', String((b.dataset.night === '1') === isNight()));
  };
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-art]'), n = e.target.closest('[data-night]');
    if (a) setArtStyle(a.dataset.art);
    if (n) setNight(n.dataset.night === '1');
    paint();
    e.stopPropagation();
  });
  paint();
  box.refresh = paint;
  return box;
}
