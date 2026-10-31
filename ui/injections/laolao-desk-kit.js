/* 碧琪手账 v2 · 共享组件（学习台各页和学习模式聊天卡片共用）。样式在 laolao-desk-kit.css，作用域 .pk-ink。 */
(() => {
  'use strict';
  if (window.__pinkieDeskKit) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const STAR = 'M12 2.8l2.75 5.7 6.15.75-4.55 4.25 1.2 6.15L12 16.6l-5.55 3.05 1.2-6.15L3.1 9.25l6.15-.75z';
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  // 星星的 <symbol> 和金箔 / 半颗渐变只放一份；<use> 里的路径靠继承的 --sf / --ss 上色。
  function sprite() {
    if (document.getElementById('pk-sprite')) return;
    const holder = document.createElementNS(SVG, 'svg');
    holder.id = 'pk-sprite'; holder.setAttribute('aria-hidden', 'true'); holder.setAttribute('width', '0'); holder.setAttribute('height', '0');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = '<defs><linearGradient id="pk-half"><stop offset="50%" stop-color="#E5488F"/><stop offset="50%" stop-color="transparent"/></linearGradient>'
      + '<linearGradient id="pk-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3A1"/><stop offset=".45" stop-color="#E2B95A"/><stop offset=".55" stop-color="#F8E7B0"/><stop offset="1" stop-color="#C39236"/></linearGradient>'
      + `<symbol id="pk-star" viewBox="0 0 24 24"><path fill="var(--sf)" d="${STAR}"/><path fill="none" stroke="var(--ss)" stroke-width="1.6" stroke-linejoin="round" d="${STAR}"/></symbol></defs>`;
    (document.body || document.documentElement).append(holder);
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const animate = (node, on) => { if (on && !media?.matches) { node.classList.add('pk-anim'); node.addEventListener('animationend', () => node.classList.remove('pk-anim'), {once: true}); } return node; };

  // 掌握度四级 → 星星：none 没学、learned 学过（半颗）、lit 做对过、mastered 独立掌握（金箔）；weak 待复测按半颗。
  const STATE_STAR = {none: '', learned: 'half', weak: 'half', lit: 'full', mastered: 'gold'};
  const STATE_LABEL = {none: '没学', learned: '学过', weak: '待复测', lit: '做对过', mastered: '独立掌握'};
  function star(state = '', {label, animateIn = false} = {}) {
    sprite();
    const s = STATE_STAR[state] ?? state;
    const node = document.createElementNS(SVG, 'svg');
    node.setAttribute('class', 'pk-star'); node.setAttribute('viewBox', '0 0 24 24');
    if (s) node.dataset.s = s;
    if (label) { node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); } else node.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use'); use.setAttribute('href', '#pk-star'); node.append(use);
    return animate(node, animateIn);
  }
  // 一排星星：counts 形如 {gold: 1, full: 2, half: 1, total: 6}，或直接给每颗的状态数组。
  function stars(spec, {label} = {}) {
    const row = el('span', 'pk-stars');
    const list = Array.isArray(spec) ? spec : [...Array(spec.gold || 0).fill('gold'), ...Array(spec.full || 0).fill('full'), ...Array(spec.half || 0).fill('half')];
    const total = Array.isArray(spec) ? list.length : Math.max(spec.total || 0, list.length);
    for (let i = 0; i < total; i++) row.append(star(list[i] || ''));
    if (label) { row.setAttribute('role', 'img'); row.setAttribute('aria-label', label); }
    return row;
  }
  function stamp(text, {tone = 'pink', size = '', animateIn = false} = {}) {
    const node = el('span', 'pk-stamp', text);
    if (tone !== 'pink') node.dataset.tone = tone; if (size) node.dataset.size = size;
    return animate(node, animateIn);
  }
  function note(text, {by = '碧琪写在页边'} = {}) {
    const node = el('div', 'pk-note');
    if (by) node.append(el('small', '', by));
    node.append(document.createTextNode(text));
    return node;
  }
  function highlight(text, {animateIn = false} = {}) { return animate(el('span', 'pk-hl', text), animateIn); }
  function taped(node, {animateIn = false, one = false} = {}) { node.classList.add('pk-taped'); if (one) node.dataset.tape = 'one'; return animate(node, animateIn); }
  // 贴纸：1x / 2x 两档（LANGUAGE.md §8.3：源图不超过显示尺寸 2 倍）。占位立绘没有烘焙白边，用 raw 补。
  function sticker(src, {width = 120, alt = '', src2x = '', raw = false, animateIn = false} = {}) {
    const img = el('img', 'pk-sticker'); img.src = src; if (src2x) img.srcset = `${src} 1x, ${src2x} 2x`;
    img.width = width; img.alt = alt; img.decoding = 'async'; img.loading = 'lazy'; if (!alt) img.setAttribute('aria-hidden', 'true');
    if (raw) img.dataset.raw = '';
    return animate(img, animateIn);
  }
  function button(label, action, {kind = 'ink', size = '', withStar = false} = {}) {
    const node = el('button', kind === 'link' ? 'pk-link' : 'pk-btn', label); node.type = 'button';
    if (kind !== 'link') node.dataset.kind = kind; if (size) node.dataset.size = size;
    if (withStar) node.append(star('full'));
    if (action) node.addEventListener('click', action);
    return node;
  }
  function segmented(options, value, onChange, {label = ''} = {}) {
    const group = el('div', 'pk-seg'); group.setAttribute('role', 'group'); if (label) group.setAttribute('aria-label', label);
    for (const [id, text] of options) {
      const b = el('button', '', text); b.type = 'button'; b.setAttribute('aria-pressed', String(id === value));
      b.addEventListener('click', () => { group.querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', String(n === b))); onChange?.(id); });
      group.append(b);
    }
    return group;
  }

  // ---------- 条目（PLAN §2）----------
  const KIND_LABEL = {point: '考点', attempt: '作答', wrong: '错题', note: '笔记', word: '生词', page: '书页', mat: '讲义', plan: '计划', lesson: '一节课', set: '一组题'};
  const parseRef = ref => { const m = /^([a-z]+):(.+)$/.exec(String(ref || '')); return m ? {kind: m[1], id: m[2]} : null; };
  // 小条目卡：聊天里用户气泡顶部、学习台「问碧琪」的预览。card 来自 pinkie.learning.ref.resolve。
  function refChip(card, {onOpen} = {}) {
    const node = el(onOpen ? 'button' : 'span', 'pk-ref'); if (onOpen) { node.type = 'button'; node.addEventListener('click', onOpen); }
    node.append(el('span', 'pk-kind', KIND_LABEL[card.kind] || '条目'), el('b', '', card.title || '条目'));
    if (card.state) node.append(star(card.state, {label: STATE_LABEL[card.state]}));
    node.title = card.subtitle || card.title || '';
    return node;
  }
  // 手账卡片：碧琪消息里的「翻到这页」。
  function refCard(card, {onOpen, action = '翻到这页 →'} = {}) {
    const node = el('div', 'pk-card'), text = el('div');
    text.append(el('small', '', [KIND_LABEL[card.kind] || '条目', card.subtitle].filter(Boolean).join(' · ')), el('b', '', card.title || ''));
    node.append(text);
    if (onOpen) node.append(button(action, onOpen, {kind: 'link'}));
    return node;
  }
  // 回执：碧琪或先生往手账里写了东西，可撤销（PLAN §3.1-4）。
  function receipt(text, {onUndo, label = '收'} = {}) {
    const node = el('div', 'pk-receipt'); node.setAttribute('role', 'status');
    node.append(stamp(label, {size: 'sm'}), el('span', '', text));
    if (onUndo) {
      const undo = button('撤销', async () => {
        undo.disabled = true;
        try { await onUndo(); node.dataset.undone = ''; undo.remove(); }
        catch (error) { undo.disabled = false; undo.title = error?.message || '撤销失败'; }
      }, {kind: 'link'});
      node.append(undo);
    }
    return node;
  }

  window.__pinkieDeskKit = {el, star, stars, stamp, note, highlight, taped, sticker, button, segmented, refChip, refCard, receipt, parseRef,
    STATE_STAR, STATE_LABEL, KIND_LABEL, get reduced() { return Boolean(media?.matches); }};
})();
