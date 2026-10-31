// 碧琪's working mark, on the shipped renderer.
//
// laolao-cle-space.js is the original C.le. particle core: the signature dissolves into
// particles, the particles become 思绪流 / 书页 / 羽毛笔 / 体素, and 落款 writes the
// signature back before it collapses into the vector mark. We do not re-implement it here —
// we drive it, and we keep its cost bounded:
//
//   · one WebGL context per visible pane, never more than two (双模式 is the only split),
//     reused by *moving* the same element instead of building a new renderer per run;
//   · no context at all under prefers-reduced-motion or when WebGL is missing — the static
//     signature (the same outline the renderer uses) is drawn instead;
//   · parked, not deleted, when a pane stops working, so a second run costs no allocation;
//   · the renderer already skips frames when its host leaves the viewport or the document is
//     hidden; we additionally park everything on `pagehide`.
const BASE = '/cle/static/legacy/';
const MAX_GLYPHS = 2;                     // 双模式: one per pane, and no more

function script(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = BASE + src;
    element.onload = resolve;
    element.onerror = () => { element.remove(); reject(new Error(src)); };
    document.head.append(element);
  });
}

let runtimeP = null;
function runtime() {
  return runtimeP || (runtimeP = Promise.all([
    script('laolao-vendor-gsap.min.js', () => !!window.gsap),
    script('laolao-cle-signature.js', () => !!window.CleSignature),
  ]).then(() => import(BASE + 'laolao-cle-space.js')));
}

const reduceQuery = () => matchMedia('(prefers-reduced-motion: reduce)');
let webgl = null;
function webglOK() {
  if (webgl !== null) return webgl;
  let probe = null;
  try {
    probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    webgl = !!gl;
    // A probe context is a real context against the browser's per-page limit. Release it at
    // once: the renderer's own contexts must be the only ones counted.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  finally { probe = null; }
  return webgl;
}

// The static mark: the same outline the renderer holds, as plain SVG. Used when the
// animation must not run (reduced motion, no WebGL) and after a run has been signed off.
let staticSVG = '';
function signatureMark() {
  const host = document.createElement('span');
  host.className = 'cle-status__mark';
  host.setAttribute('aria-hidden', 'true');
  if (!staticSVG && window.CleSignature) {
    try {
      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tmp.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
      document.body.append(tmp);
      const paths = window.CleSignature.outline(tmp).map((d) => `<path d="${d}"/>`).join('');
      tmp.remove();
      staticSVG = `<svg viewBox="0 0 200 96" fill="currentColor" aria-hidden="true">${paths}</svg>`;
    } catch { staticSVG = ''; }
  }
  if (staticSVG) host.innerHTML = staticSVG;
  else host.textContent = 'C.le.';
  return host;
}

class Glyph {
  constructor() {
    this.el = document.createElement('span');
    this.el.className = 'cle-status__particles';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.append(signatureMark());
    this.space = null;
    this.state = 'idle';
    this.pending = false;
    this.dead = false;
    this.idle = true;      // parked: no animation is being watched
    this.want = 'idle';
  }

  // Show this mark inside `host`, at `state`. Safe to call every frame.
  show(host, state) {
    if (this.dead || !host) return;
    this.want = state;
    this.idle = false;
    if (this.el.parentElement !== host) host.append(this.el);
    this.el.dataset.state = state;
    if (this.space) {
      this.space.visible = true;
      this.space.loop();
      if (this.space.state !== state) this.space.set(state);
      return;
    }
    // One creation attempt at a time. `pending` is cleared only when the attempt settles,
    // otherwise a second sync pass while the module is still loading would build a second
    // renderer and leak a WebGL context.
    if (this.pending || this.dead || reduceQuery().matches || !webglOK()) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;                       // not laid out yet; next sync will retry
    this.pending = true;
    runtime().then(({CleSpace}) => {
      this.pending = false;
      if (this.dead || reduceQuery().matches || !webglOK()) return;
      if (this.space) return;
      this.el.replaceChildren();
      // Same palette, framing and point size as the original status mark. fitW follows the
      // box, so a narrower pane never crops the signature.
      const fitH = 5.4, fitW = Math.max(9.6, fitH * (this.el.clientWidth / Math.max(1, this.el.clientHeight)));
      this.space = new CleSpace(this.el, {palette: 'cle', count: 1500, size: .17, fitW, fitH, interactive: false});
      this.space.set(this.want === 'idle' ? 'think' : this.want);
      this.el.dataset.mode = 'particles';
    }).catch((error) => {
      this.pending = false;
      console.warn('[cle] particle renderer unavailable, keeping the static mark:', error.message);
      this.el.dataset.mode = 'static';
    });
  }

  park() {
    this.want = 'idle';
    this.idle = true;
    if (this.space) {
      this.space.visible = false;
      if (this.space.state !== 'idle') this.space.set('idle');
    }
    this.el.remove();
  }

  dispose() {
    this.dead = true;
    this.idle = true;
    try { this.space?.dispose(); } catch {}
    this.space = null;
    this.el.remove();
  }
}

// Two marks at most, keyed by session. Moving a mark between panes reuses its WebGL context.
// A third key would mean three live contexts; that only happens when a cached pane is still
// flagged visible, so the pool evicts the *idle* mark first and never a working one.
export function createGlyphPool(signal) {
  const glyphs = new Map();

  const reclaim = () => {
    for (const [key, glyph] of glyphs) {
      if (glyph.dead || !glyph.el.isConnected) { glyph.dispose(); glyphs.delete(key); }
    }
  };

  const evictOne = () => {
    // prefer a parked mark: nothing is watching its animation
    for (const [key, glyph] of glyphs) {
      if (glyph.idle || !glyph.el.isConnected) { glyph.dispose(); glyphs.delete(key); return true; }
    }
    return false;
  };

  return {
    // The mark for `key`. `state` idle means "park it" (the pane stopped working).
    use(key, host, state) {
      if (!key) return null;
      let glyph = glyphs.get(key);
      if (!glyph) {
        if (glyphs.size >= MAX_GLYPHS) {
          reclaim();
          if (glyphs.size >= MAX_GLYPHS) evictOne();
        }
        glyph = new Glyph();
        glyphs.set(key, glyph);
      }
      if (state === 'idle') glyph.park();
      else glyph.show(host, state);
      return glyph;
    },
    release(key) {
      const glyph = glyphs.get(key);
      if (!glyph) return;
      glyph.dispose();
      glyphs.delete(key);
    },
    parkAll() { for (const glyph of glyphs.values()) glyph.park(); },
    disposeAll() { for (const glyph of glyphs.values()) glyph.dispose(); glyphs.clear(); },
    get size() { return glyphs.size; },
  };
}

// Kept for callers that only need a one-off mark (older call sites / tests).
export function particleGlyph(signal) {
  const glyph = new Glyph();
  signal?.addEventListener('abort', () => glyph.dispose(), {once: true});
  return {
    attach: (target, run) => glyph.show(target, run?.mode === 'done' ? 'done' : 'think'),
    park: () => glyph.park(),
  };
}

export {signatureMark, MAX_GLYPHS};
