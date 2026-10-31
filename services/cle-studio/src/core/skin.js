// Native plugin styles are removed on disconnect along with host registrations.
// Retain one document-owned copy so the transcript keeps its readable layout
// while the native UI reports the real connection state. No RPC or timers live here.
export function retainSkin(moduleUrl, doc = document) {
  const href = new URL('index.css', moduleUrl).href;
  const previous = [...doc.querySelectorAll('link[data-cle-skin]')];
  if (previous.some((link) => link.href === href)) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-cle-skin', '');
  // Keep the last good revision until its successor has really loaded. A failed
  // update must not strip the skin; a successful one must not accumulate copies.
  link.addEventListener('load', () => previous.forEach((old) => old.remove()), {once: true});
  link.addEventListener('error', () => link.remove(), {once: true});
  doc.head.append(link);
}
