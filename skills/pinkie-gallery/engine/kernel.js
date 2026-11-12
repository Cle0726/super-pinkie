/* 碧琪成品库 · 页面内排版内核。
 * 在渲染页面里运行：把内容填进模板 → 等字体 → 自动缩字 → 检查（溢出、出界、对比度、重叠、字太小、字体回退）。
 * 模板约定：
 *   data-slot="title"          文字槽（支持 **强调** 和换行）
 *   data-slot-img="photo"      图片槽（<img>）；data-slot-bg="photo" 背景图槽
 *   data-if="subtitle"         有这个内容才显示；data-ifnot="x" 没有才显示
 *   <template data-each="points" data-max="6"> 列表；里面用 data-field / data-field-img / data-index
 *   data-fit="40"              字多时从 CSS 里写的字号往下缩，最小 40px
 *   data-maxlines="2"          最多几行（配合 data-fit 一起用）
 *   data-fit-scale="0.72"      整块一起缩（子元素字号写成 calc(var(--fit) * 36px)），最小比例
 *   data-on-image              压在照片上的字（模板自己负责遮罩，内核不查对比度）
 *   data-decor                 装饰字，不查
 *   data-bleed                 允许出画布（出血、装饰）
 *   data-allow-overlap         允许和别的槽重叠
 */
(function () {
  'use strict';

  function isEmpty(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }

  function textOf(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object' && !Array.isArray(v)) return String(v.text ?? '');
    return String(v);
  }

  // 安全地写入文字：转义一切，只认 **强调** 和换行。
  function writeText(el, value) {
    const raw = textOf(value);
    el.textContent = '';
    const lines = raw.split(/\r?\n/);
    lines.forEach(function (line, li) {
      const parts = line.split(/\*\*(.+?)\*\*/g);
      parts.forEach(function (part, pi) {
        if (!part) return;
        if (pi % 2 === 1) {
          const span = document.createElement('span');
          span.className = 'hl';
          span.textContent = part;
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(part));
        }
      });
      if (li < lines.length - 1) el.appendChild(document.createElement('br'));
    });
    el.setAttribute('data-chars', String(raw.replace(/\*\*/g, '').replace(/\s/g, '').length));
  }

  function setImage(el, src, isBg) {
    const holder = isBg ? el : (el.parentElement || el);
    if (!src) {
      holder.classList.add('pinkie-empty');
      if (!isBg) el.style.display = 'none';
      return;
    }
    if (isBg) {
      el.style.backgroundImage = 'url("' + String(src).replace(/"/g, '%22') + '")';
    } else {
      el.src = src;
      el.decoding = 'sync';
    }
    holder.classList.add('pinkie-has-image');
  }

  function lookup(scope, key) {
    if (key === '.') return scope;
    if (scope && typeof scope === 'object') return scope[key];
    return undefined;
  }

  function bindConditionals(root, scope, attrIf, attrIfNot) {
    root.querySelectorAll('[' + attrIf + ']').forEach(function (el) {
      if (isEmpty(lookup(scope, el.getAttribute(attrIf)))) el.remove();
    });
    root.querySelectorAll('[' + attrIfNot + ']').forEach(function (el) {
      if (!isEmpty(lookup(scope, el.getAttribute(attrIfNot)))) el.remove();
    });
  }

  function bindScope(root, scope, prefix, images) {
    const f = prefix; // 'slot' 或 'field'
    bindConditionals(root, scope, f === 'slot' ? 'data-if' : 'data-field-if', f === 'slot' ? 'data-ifnot' : 'data-field-ifnot');
    root.querySelectorAll('[data-' + f + ']').forEach(function (el) {
      const key = el.getAttribute('data-' + f);
      writeText(el, lookup(scope, key));
      if (f === 'field' && !el.hasAttribute('data-slot-name')) el.setAttribute('data-slot-name', key);
    });
    root.querySelectorAll('[data-' + f + '-img]').forEach(function (el) {
      const key = el.getAttribute('data-' + f + '-img');
      setImage(el, images(lookup(scope, key)), false);
    });
    root.querySelectorAll('[data-' + f + '-bg]').forEach(function (el) {
      const key = el.getAttribute('data-' + f + '-bg');
      setImage(el, images(lookup(scope, key)), true);
    });
  }

  function bind(data, images) {
    // 先展开列表（列表里的字段在克隆里绑定），再绑顶层。
    document.querySelectorAll('template[data-each]').forEach(function (tpl) {
      const key = tpl.getAttribute('data-each');
      let items = data[key];
      if (!Array.isArray(items)) items = isEmpty(items) ? [] : [items];
      const max = Number(tpl.getAttribute('data-max') || 0);
      if (max) items = items.slice(0, max);
      const frag = document.createDocumentFragment();
      items.forEach(function (item, i) {
        const clone = tpl.content.cloneNode(true);
        const wrap = document.createElement('div');
        wrap.appendChild(clone);
        const scope = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {text: item, '.': item};
        wrap.querySelectorAll('[data-index]').forEach(function (el) {
          const pad = Number(el.getAttribute('data-index') || 1);
          el.textContent = String(i + 1).padStart(pad, '0');
        });
        bindScope(wrap, scope, 'field', images);
        wrap.querySelectorAll('[data-field-name]').forEach(function (el) {
          el.setAttribute('data-slot-name', key + '[' + (i + 1) + '].' + el.getAttribute('data-field-name'));
        });
        while (wrap.firstChild) frag.appendChild(wrap.firstChild);
      });
      tpl.parentNode.insertBefore(frag, tpl);
      tpl.parentNode.setAttribute('data-count', String(items.length));
      tpl.remove();
    });
    bindScope(document, data, 'slot', images);
    document.querySelectorAll('[data-slot]').forEach(function (el) {
      el.setAttribute('data-slot-name', el.getAttribute('data-slot'));
    });
    document.documentElement.setAttribute('data-bound', '1');
  }

  function applyTheme(vars) {
    const root = document.documentElement;
    Object.keys(vars || {}).forEach(function (k) { root.style.setProperty(k, vars[k]); });
  }

  function firstFamily(fontFamily) {
    return String(fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  }

  async function loadFonts() {
    const wanted = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text || !node.parentElement) continue;
      const cs = getComputedStyle(node.parentElement);
      const families = cs.fontFamily.split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); });
      families.forEach(function (family) {
        const key = family + '|' + cs.fontWeight + '|' + cs.fontStyle;
        const prev = wanted.get(key) || {family: family, weight: cs.fontWeight, style: cs.fontStyle, text: ''};
        prev.text += text;
        wanted.set(key, prev);
      });
    }
    const loads = [];
    wanted.forEach(function (w) {
      const spec = w.style + ' ' + w.weight + ' 40px "' + w.family + '"';
      loads.push(document.fonts.load(spec, w.text.slice(0, 2000)).catch(function () { return []; }));
    });
    await Promise.all(loads);
    await document.fonts.ready;
  }

  function knownFamilies() {
    const set = new Set();
    document.fonts.forEach(function (face) { set.add(String(face.family).replace(/^["']|["']$/g, '')); });
    return set;
  }

  // 读出一个元素实际用上的是不是声明的第一字体：只对页面里有 @font-face 的字体判断。
  function fontFallbackIssues() {
    const known = knownFamilies();
    const issues = [];
    const seen = new Set();
    document.querySelectorAll('[data-slot-name]').forEach(function (el) {
      const text = (el.textContent || '').trim();
      if (!text) return;
      const cs = getComputedStyle(el);
      const fam = firstFamily(cs.fontFamily);
      if (!known.has(fam)) return;
      const spec = cs.fontStyle + ' ' + cs.fontWeight + ' 40px "' + fam + '"';
      const ok = document.fonts.check(spec, text.slice(0, 200));
      const key = fam + spec;
      if (!ok && !seen.has(key)) {
        seen.add(key);
        issues.push({slot: el.getAttribute('data-slot-name'), kind: 'font', family: fam});
      }
    });
    return issues;
  }

  function overflowing(el) {
    const maxLines = Number(el.getAttribute('data-maxlines') || 0);
    if (maxLines) {
      const cs = getComputedStyle(el);
      let lh = parseFloat(cs.lineHeight);
      if (!lh || isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.25;
      const lines = Math.round(el.scrollHeight / lh);
      if (lines > maxLines) return {lines: lines, maxLines: maxLines};
    }
    // 字形会比行高略高一点（尤其是粗体数字、强调底色），这不算放不下；真放不下时至少多出将近一行。
    const tol = Math.max(2, parseFloat(getComputedStyle(el).fontSize) * 0.3);
    if (el.scrollHeight > el.clientHeight + tol || el.scrollWidth > el.clientWidth + tol) {
      return {scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth};
    }
    return null;
  }

  function fitText() {
    const fitted = {};
    document.querySelectorAll('[data-fit]').forEach(function (el) {
      const min = Number(el.getAttribute('data-fit')) || 12;
      let size = parseFloat(getComputedStyle(el).fontSize);
      const start = size;
      let guard = 0;
      while (overflowing(el) && size > min && guard < 200) {
        size = Math.max(min, size - Math.max(1, size * 0.03));
        el.style.fontSize = size + 'px';
        guard++;
      }
      const name = el.getAttribute('data-slot-name') || el.getAttribute('data-slot') || '';
      if (name) fitted[name] = {from: Math.round(start), to: Math.round(size)};
    });
    document.querySelectorAll('[data-fit-scale]').forEach(function (el) {
      const min = Number(el.getAttribute('data-fit-scale')) || 0.7;
      let scale = 1;
      el.style.setProperty('--fit', '1');
      let guard = 0;
      while (overflowing(el) && scale > min && guard < 100) {
        scale = Math.max(min, scale - 0.02);
        el.style.setProperty('--fit', String(scale));
        guard++;
      }
      el.setAttribute('data-fit-result', String(Math.round(scale * 100) / 100));
    });
    return fitted;
  }

  function parseColor(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1};
  }

  function luminance(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function backgroundBehind(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (node.hasAttribute('data-on-image')) return {image: true};
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return {image: true};
      if (/gradient/.test(cs.backgroundImage)) {
        const colors = cs.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
        const parsed = colors.map(parseColor).filter(function (c) { return c && c.a > 0.5; });
        if (parsed.length) return {colors: parsed};
      }
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0.5) return {colors: [bg]};
      node = node.parentElement;
    }
    return {colors: [{r: 255, g: 255, b: 255, a: 1}]};
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
  }

  function intersects(a, b, tol) {
    return a.x + tol < b.x + b.w && b.x + tol < a.x + a.w && a.y + tol < b.y + b.h && b.y + tol < a.y + a.h;
  }

  // 文字真正占的范围（块元素可能比字宽）：用 Range 量。
  function inkRect(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) return rectOf(el);
    return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
  }

  function check(canvas, opts) {
    const issues = [];
    const minFont = Number(opts.minFont || 0);
    const slots = Array.prototype.slice.call(document.querySelectorAll('[data-slot-name]'))
      .filter(function (el) { return (el.textContent || '').trim() && el.offsetParent !== null; });

    slots.forEach(function (el) {
      const name = el.getAttribute('data-slot-name');
      const of = overflowing(el);
      const hasFit = el.hasAttribute('data-fit') || el.hasAttribute('data-maxlines') || getComputedStyle(el).overflow !== 'visible';
      if (of && hasFit) {
        const chars = Number(el.getAttribute('data-chars') || (el.textContent || '').length);
        let ratio = 1;
        if (of.lines) ratio = of.maxLines / of.lines;
        else ratio = Math.min(of.clientH / Math.max(1, of.scrollH), of.clientW / Math.max(1, of.scrollW));
        issues.push({slot: name, kind: 'overflow', chars: chars, fit: Math.max(1, Math.floor(chars * ratio * 0.95)), detail: of});
      }
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (minFont && size < minFont - 0.5 && !el.hasAttribute('data-decor') && !el.closest('[data-small-ok]')) {
        issues.push({slot: name, kind: 'tiny', size: Math.round(size), min: minFont});
      }
      if (!el.hasAttribute('data-decor') && !el.closest('[data-on-image]')) {
        const fg = parseColor(cs.color);
        const bg = backgroundBehind(el);
        if (fg && bg.colors) {
          const worst = Math.min.apply(null, bg.colors.map(function (c) { return contrast(fg, c); }));
          const bold = Number(cs.fontWeight) >= 600;
          const need = (size >= 48 || (size >= 36 && bold)) ? 3 : 4.5;
          if (worst < need) issues.push({slot: name, kind: 'contrast', ratio: Math.round(worst * 100) / 100, need: need});
        }
      }
      if (!el.closest('[data-bleed]')) {
        const r = inkRect(el);
        if (r.x < -1 || r.y < -1 || r.x + r.w > canvas.w + 1 || r.y + r.h > canvas.h + 1) {
          issues.push({slot: name, kind: 'outside'});
        }
      }
    });

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i], b = slots[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (a.closest('[data-allow-overlap]') || b.closest('[data-allow-overlap]')) continue;
        if (intersects(inkRect(a), inkRect(b), 4)) {
          issues.push({slot: a.getAttribute('data-slot-name'), other: b.getAttribute('data-slot-name'), kind: 'overlap'});
        }
      }
    }

    fontFallbackIssues().forEach(function (x) { issues.push(x); });

    document.querySelectorAll('img').forEach(function (img) {
      if (img.style.display !== 'none' && img.getAttribute('src') && (!img.complete || img.naturalWidth === 0)) {
        issues.push({slot: img.getAttribute('data-slot-img') || img.getAttribute('data-field-img') || 'img', kind: 'image-broken'});
      }
    });
    const empties = Array.prototype.slice.call(document.querySelectorAll('.pinkie-empty')).length;
    return {issues: issues, emptyImages: empties};
  }

  async function waitImages() {
    const imgs = Array.prototype.slice.call(document.images).filter(function (i) { return i.getAttribute('src'); });
    await Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (res) { img.onload = img.onerror = res; });
    }));
  }

  window.__pinkie = {
    run: async function (payload) {
      const data = payload.data || {};
      const images = function (v) {
        if (isEmpty(v)) return '';
        const key = textOf(v);
        return (payload.images && payload.images[key]) || '';
      };
      applyTheme(payload.vars);
      bind(data, images);
      await waitImages();
      await loadFonts();
      const fitted = fitText();
      await loadFonts();
      const fitted2 = fitText();
      Object.keys(fitted2).forEach(function (k) { if (fitted[k]) fitted[k].to = fitted2[k].to; else fitted[k] = fitted2[k]; });
      const result = check(payload.canvas, payload.check || {});
      result.fitted = fitted;
      return result;
    },
  };
})();
