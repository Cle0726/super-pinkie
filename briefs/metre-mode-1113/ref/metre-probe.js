// 隔离副本专用的探针（不进仓库、不进 App）：命中测试 + 碧琪残留扫描。输出尽量短。
(() => {
  const vis = (el) => { if (el.checkVisibility && !el.checkVisibility({checkOpacity: false, checkVisibilityCSS: true})) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const desc = (el) => el ? (el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.')) : 'null';
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); };
  const hits = () => {
    const out = [];
    for (const b of document.querySelectorAll('button,[role=button],a[href],summary,select,input,textarea,[role=menuitem],[role=tab],[role=option]')) {
      if (!vis(b)) continue;
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = top && (b === top || b.contains(top) || (top.contains(b) && !top.closest('button,a')));
      out.push({b: desc(b), t: (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 14), box: box(b), ok, by: ok ? '' : desc(top), dis: b.disabled || undefined});
    }
    return out;
  };
  // 被盖住的按钮；ignoreMask=true 时忽略「被模态遮罩盖住」的（那是应该的）
  const bad = (maskSel = '.pinkie-session-search-mask, .laolao-menu-mask, [class*=backdrop], [class*=scrim]') => {
    const list = hits().filter((x) => !x.ok);
    const masked = list.filter((x) => { const m = document.querySelector(maskSel); return m && x.by === desc(m); });
    const real = list.filter((x) => !masked.includes(x));
    return {total: hits().length, masked: masked.length, bad: real.map((x) => `${x.b}|${x.t}|${x.box} by ${x.by}`).slice(0, 12)};
  };
  const hue = (c) => {
    const m = String(c).match(/[\d.]+/g); if (!m || m.length < 3) return null;
    let [r, g, b, a] = m.map(Number);
    if (/^color\(srgb/.test(c)) { r *= 255; g *= 255; b *= 255; }
    if (a === 0) return null;
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d === 0) return null;
    const l = (mx + mn) / 2, s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return {h: (h * 60 + 360) % 360, s};
  };
  const scan = (rootEl = document.body) => {
    const out = new Set(); const re = /碧琪|Pinkie|先生|pinkie|Dismiss/;
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT); let el;
    while ((el = w.nextNode())) {
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const d = desc(el);
      for (const a of ['aria-label', 'title', 'alt', 'placeholder']) { const v = el.getAttribute(a); if (v && re.test(v)) out.add(`attr ${d} ${a}=${v.slice(0, 30)}`); }
      for (const n of el.childNodes) if (n.nodeType === 3 && re.test(n.textContent)) out.add(`text ${d} ${n.textContent.trim().slice(0, 30)}`);
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO') out.add(`img ${d} ${(el.currentSrc || el.src || el.poster || '').split('/').pop().slice(0, 40)}`);
      if (cs.backgroundImage.includes('url(')) out.add(`bgimg ${d} ${cs.backgroundImage.slice(0, 60)}`);
      for (const p of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke', 'outlineColor']) {
        const v = cs[p]; if (!v || v === 'none') continue;
        if (p === 'borderTopColor' && parseFloat(cs.borderTopWidth) === 0) continue;
        if (p === 'outlineColor' && cs.outlineStyle === 'none') continue;
        if (p === 'color' && !el.textContent.trim() && el.tagName !== 'svg') continue;
        const hs = hue(v); if (hs && (hs.h >= 285 || hs.h <= 5) && hs.s > 0.3) out.add(`hue ${d} ${p} ${v}`);
      }
    }
    return [...out].slice(0, 40);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = (el, d = 0, max = 4) => { if (d > max) return ''; const seen = {}; let s = ''; for (const c of el.children) { const k = c.tagName.toLowerCase() + '.' + [...c.classList].join('.'); if (seen[k]) continue; seen[k] = 1; s += '\n' + '  '.repeat(d) + k + tree(c, d + 1, max); } return s; };
  const info = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const cs = getComputedStyle(el); return `${desc(el)} [${box(el)}] pos=${cs.position} z=${cs.zIndex} bg=${cs.backgroundColor} bd=${cs.borderTopWidth} ${cs.borderTopColor} rad=${cs.borderRadius} blur=${cs.backdropFilter} sh=${cs.boxShadow.slice(0, 50)} color=${cs.color} font=${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily.slice(0, 24)}`; };
  const over = (a, b) => { const A = document.querySelector(a)?.getBoundingClientRect(), B = document.querySelector(b)?.getBoundingClientRect(); return A && B ? (A.bottom > B.top + 1 && A.top < B.bottom - 1 && A.right > B.left + 1 && A.left < B.right - 1) : null; };
  window.MP = {hits, bad, scan, sleep, tree, info, box, over, desc};
})();
