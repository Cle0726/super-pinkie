/* 碧琪上岸记 · 装备生效（v4，11-13）。
   商店 / 扭蛋拿到的命中特效、粒子主题、大招过场、结算动画，装备以后在这里变成真的画面和声音。
   之前这些东西只存在后端（items.equipped），界面一律读形态自带的 hit / particle / ult，买了等于没买；
   命中特效 6 个里有 5 个、结算动画 4 个全部没有实现。
   每件东西一份「风格」：自己的粒子配方 + 自己的配色 + 自己的声音 + 自己的徽记（商店货架上看得见，点「试一下」就播）。
   谁用：laolao-game-stage.js（刷题舞台）、laolao-game-battle.js（讨伐 / 守关）、laolao-game-practice.js（结算）、laolao-game-shop.js（货架预览）。 */
(() => {
  'use strict';
  if (window.__pinkieLoadout) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (markup, cls) => { const t = document.createElement('template'); t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" ${cls ? `class="${cls}"` : ''} aria-hidden="true" focusable="false" ${markup}</svg>`; return t.content.firstChild; };
  const reduced = () => Boolean(desk()?.motion?.reduced) || fx()?.settings?.().tier === 'quiet';
  const sfx = (name, opts) => { try { return fx()?.sfx?.(name, opts); } catch { return false; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ───────────── 风格表 ─────────────
  // pal = [主色, 副色, 高光]；fx = 引擎里的配方名；snd = 声音；tag = 一句话说它是什么感觉（商店里显示）。
  const HIT = {
    ink: {fx: 'ink', pal: ['#3A0D18', '#8C1730', '#E8314F'], snd: 'hit-ink', tag: '红笔两道，墨点四溅'},
    star: {fx: 'star', pal: ['#FFD36E', '#FF9BC8', '#FFF6DC'], snd: 'hit-star', tag: '星芒炸开，一串玻璃响'},
    bubble: {fx: 'bubble', pal: ['#9FE6FF', '#D9CBFF', '#FFFFFF'], snd: 'hit-bubble', tag: '啵的一声，泡泡往上飘'},
    petal: {fx: 'petal', pal: ['#FFC2DA', '#F27FB0', '#FFF2F7'], snd: 'hit-petal', tag: '一道花风扫过去'},
    neon: {fx: 'neon', pal: ['#FF3FD1', '#3FF3FF', '#B3FF3F'], snd: 'hit-neon', tag: '霓虹电弧，合成器一声'},
    stamp: {fx: 'stamp', pal: ['#5A0F16', '#C4122F', '#F2C35B'], snd: 'hit-stamp', tag: '金印砸下，很重'},
  };
  const PARTICLES = {
    sakura: {fx: 'petals', pal: ['#FFC6DC', '#F08AB4', '#FFF2F7'], tag: '樱花纸片慢慢落'},
    snowfall: {fx: 'snow', pal: ['#FFFFFF', '#CFE6FF', '#8FC6FF'], tag: '大片雪花，安静'},
    firefly: {fx: 'embers', pal: ['#FFB24A', '#FFE08A', '#FF6A3A'], tag: '暖色火星往上升'},
    galaxy: {fx: 'stars', pal: ['#B9A4FF', '#6FD3FF', '#FFF4D6'], tag: '星砂和光环'},
    notes: {fx: 'notes', pal: ['#C46BFF', '#FF6FB7', '#7FD3FF'], tag: '声波一圈圈荡开'},
    coins: {fx: 'coins', pal: ['#FFD25E', '#C8902A', '#FFF1C2'], tag: '金币翻着面弹出来'},
  };
  const ULT = {
    curtain: {fx: 'curtain', pal: ['#C4122F', '#F2C35B', '#FFF4DC'], tag: '红幕拉开，聚光灯'},
    ink: {fx: 'ink', pal: ['#1E1620', '#5B4A5E', '#DB1F74'], tag: '一滴墨晕满全场'},
    warp: {fx: 'warp', pal: ['#7B5CFF', '#3DE0C8', '#FFFFFF'], tag: '星线拉长，穿过去'},
    stamp: {fx: 'stamp', pal: ['#C4122F', '#F2C35B', '#FFF4DC'], tag: '巨印从天而降'},
  };
  const RESULT = {
    fireworks: {pal: ['#FF6FA8', '#FFD36E', '#7FD3FF'], tag: '五发烟花，各炸各的颜色'},
    ribbon: {pal: ['#DB1F74', '#F2C35B', '#FFF4DC'], tag: '两条缎带横着抖开'},
    'stamp-rain': {pal: ['#C4122F', '#8C1730', '#F2C35B'], tag: '一枚枚印章盖下来'},
    popup: {pal: ['#F7A8C8', '#8FC6FF', '#FFE08A'], tag: '像立体书一样翻开'},
  };
  const COVER = {
    sakura: {board: '#F08AB4', css: 'radial-gradient(circle at 24% 20%,#fff 0 5%,transparent 6%),radial-gradient(circle at 70% 66%,#ffd9e8 0 7%,transparent 8%),linear-gradient(135deg,#FFC6DC,#F08AB4)', tag: '粉底，落樱'},
    night: {board: '#2A2157', css: 'radial-gradient(circle at 30% 26%,#fff 0 1.4%,transparent 2%),radial-gradient(circle at 64% 44%,#fff 0 1%,transparent 1.6%),radial-gradient(circle at 78% 20%,#FFE08A 0 6%,transparent 7%),linear-gradient(160deg,#1B1740,#3B2A6B)', tag: '深蓝，一弯月'},
    kraft: {board: '#A67C52', css: 'repeating-linear-gradient(90deg,rgba(90,60,30,.07) 0 2px,transparent 2px 6px),linear-gradient(135deg,#C9A277,#A67C52)', tag: '牛皮纸，粗纤维'},
    palace: {board: '#7A1426', css: 'repeating-linear-gradient(45deg,rgba(242,195,91,.22) 0 2px,transparent 2px 12px),repeating-linear-gradient(-45deg,rgba(242,195,91,.22) 0 2px,transparent 2px 12px),linear-gradient(135deg,#8C1730,#5A0F16)', tag: '朱红，金线菱格'},
    ink: {board: '#D6CEC0', css: 'radial-gradient(ellipse at 30% 70%,rgba(30,22,32,.75) 0 22%,transparent 46%),radial-gradient(ellipse at 74% 30%,rgba(30,22,32,.4) 0 14%,transparent 38%),linear-gradient(135deg,#F4EFE6,#DDD5C8)', tag: '宣纸，两团墨'},
    winter: {board: '#8FB6E8', css: 'radial-gradient(circle at 22% 24%,#fff 0 3%,transparent 4%),radial-gradient(circle at 62% 60%,#fff 0 4%,transparent 5%),radial-gradient(circle at 80% 22%,#fff 0 2%,transparent 3%),linear-gradient(160deg,#CFE6FF,#8FB6E8)', tag: '浅蓝，初雪'},
  };
  const TABLES = {hit: HIT, particles: PARTICLES, ult: ULT, result: RESULT, cover: COVER};
  const split = id => { const s = String(id || ''); const k = s.indexOf(':'); return k < 0 ? ['', s] : [s.slice(0, k), s.slice(k + 1)]; };
  const styleOf = id => { const [slot, name] = split(id); return TABLES[slot]?.[name] ? {slot, name, ...TABLES[slot][name]} : null; };

  // 现在装备着什么（没装 = 跟随形态，返回 null）
  function current(slot) {
    const id = G()?.cache?.state?.items?.equipped?.[slot];
    return id ? styleOf(id) : null;
  }

  // ───────────── 生效 ─────────────
  // 命中：装了命中特效就用它的配方 / 配色 / 声音；没装用形态自带的。
  function hit(target, {form, crit = false, size, style} = {}) {
    const engine = fx(); if (!engine?.hit) return false;
    const st = style || current('hit');
    const fxForm = G()?.fxForm?.(form);
    if (st) engine.hit(st.fx, target, {crit, palette: st.pal, sfxName: st.snd, form: fxForm, ...(size ? {size} : {})});
    else engine.hit(form?.hit || 'sparkle', target, {crit, palette: form?.palette, form: fxForm, ...(size ? {size} : {})});
    return true;
  }
  // 击破 / 庆祝的粒子：装了粒子主题就用它。
  function burst(target, {form, scale = 1, style, kind} = {}) {
    const engine = fx(); if (!engine?.burst) return false;
    const st = style || current('particles');
    if (st) engine.burst(st.fx, target, {palette: st.pal, scale});
    else engine.burst(kind || form?.particle || 'sparkle', target, {palette: form?.palette, scale});
    return true;
  }
  // 大招过场用哪个预设
  function ultOf(form) { const st = current('ult'); return st ? {preset: st.fx, palette: st.pal, item: true} : {preset: form?.ult || 'burst', palette: form?.palette, item: false}; }

  // 结算动画：在结算卡（host）上演。返回是否演了（没装就让调用方走默认）。
  async function result(host, {rank = 'A', style} = {}) {
    const st = style || current('result');
    if (!st || !host?.isConnected) return false;
    if (reduced()) return true;
    const layer = el('div', 'pkl-res'); layer.dataset.preset = st.name; layer.style.setProperty('--a', st.pal[0]); layer.style.setProperty('--b', st.pal[1]); layer.style.setProperty('--c', st.pal[2]);
    host.classList.add('pkl-res-host'); host.append(layer);
    const done = ms => setTimeout(() => layer.remove(), ms);
    const point = (x, y) => { const r = host.getBoundingClientRect(); return {x: r.left + r.width * x, y: r.top + r.height * y}; };
    if (st.name === 'fireworks') {
      const shots = [[.18, .3, 'stars'], [.8, .22, 'confetti'], [.5, .12, 'sparkle'], [.3, .6, 'gold'], [.72, .55, 'hearts']];
      const pals = [[st.pal[0], '#fff', st.pal[1]], [st.pal[2], st.pal[0], '#fff'], [st.pal[1], '#fff', st.pal[2]], ['#FFD25E', '#fff1c2', '#C8902A'], ['#C39BFF', '#fff', '#7FD3FF']];
      shots.slice(0, rank === 'C' ? 2 : rank === 'B' ? 3 : 5).forEach(([x, y, kind], i) => setTimeout(() => {
        if (!host.isConnected) return;
        const trail = el('i', 'pkl-rocket'); trail.style.left = x * 100 + '%'; trail.style.setProperty('--y', y * 100 + '%'); trail.style.setProperty('--tone', pals[i][0]); layer.append(trail);
        sfx('firework', {pitch2: 1 + i * .12});
        setTimeout(() => { try { fx()?.burst(kind, point(x, y), {palette: pals[i], scale: 1.25}); } catch { /* 无引擎 */ } }, 280);
      }, i * 260));
      done(2600);
    } else if (st.name === 'ribbon') {
      for (const side of ['l', 'r']) { const r = el('div', 'pkl-ribbon is-' + side); r.append(el('span', '', side === 'l' ? 'STAGE CLEAR' : rank === 'S' ? 'PERFECT' : 'WELL DONE')); layer.append(r); }
      sfx('ribbon');
      setTimeout(() => { try { fx()?.burst('confetti', point(.5, .1), {palette: st.pal, scale: 1.2}); } catch { /* 无引擎 */ } }, 360);
      done(2800);
    } else if (st.name === 'stamp-rain') {
      const words = rank === 'S' ? ['优', '满', '赞', '妙', '稳', '绝', '优'] : rank === 'C' ? ['阅', '加', '油'] : ['阅', '赞', '稳', '过', '好'];
      words.forEach((w, i) => setTimeout(() => {
        if (!host.isConnected) return;
        const s = el('div', 'pkl-seal', w); s.style.left = (8 + (i * 37 % 84)) + '%'; s.style.top = (10 + (i * 53 % 62)) + '%'; s.style.setProperty('--rot', (i * 47 % 40 - 20) + 'deg'); layer.append(s);
        setTimeout(() => sfx('hit-stamp'), 130);
      }, i * 150));
      done(3000);
    } else if (st.name === 'popup') {
      host.classList.add('pkl-popup'); setTimeout(() => host.classList.remove('pkl-popup'), 1200);
      for (let i = 0; i < 5; i++) { const p = el('i', 'pkl-fold'); p.style.setProperty('--i', i); p.style.left = (12 + i * 19) + '%'; layer.append(p); }
      sfx('popup');
      setTimeout(() => { try { fx()?.burst('cards', point(.5, .3), {palette: st.pal, scale: 1.1}); } catch { /* 无引擎 */ } }, 420);
      done(2400);
    }
    return true;
  }

  // ───────────── 徽记（货架 / 衣橱 / 图鉴上的样子）─────────────
  const MOTIF = {
    'hit:ink': '<path d="M14 44L46 14" stroke-width="5"/><path d="M22 50L50 26" stroke-width="3" opacity=".7"/><circle cx="13" cy="20" r="3" fill="currentColor" stroke="none"/><circle cx="50" cy="46" r="2" fill="currentColor" stroke="none"/>',
    'hit:star': '<path d="M32 6c2 14 12 24 26 26-14 2-24 12-26 26-2-14-12-24-26-26 14-2 24-12 26-26z" fill="currentColor" stroke="none"/><circle cx="50" cy="13" r="2.500" fill="currentColor" stroke="none"/>',
    'hit:bubble': '<circle cx="26" cy="36" r="15"/><circle cx="46" cy="20" r="8"/><circle cx="48" cy="46" r="4.500"/><path d="M17 31a10 10 0 0 1 7-7" opacity=".7"/>',
    'hit:petal': '<path d="M10 44C24 46 44 36 56 14" stroke-width="3"/><path d="M40 40c-8-2-10-10-4-16 8 2 10 10 4 16z" fill="currentColor" stroke="none"/><path d="M22 28c-5-3-5-9 0-13 5 3 5 9 0 13z" fill="currentColor" stroke="none" opacity=".7"/>',
    'hit:neon': '<path d="M8 40l12-16 10 12 10-20 8 14 8-8" stroke-width="3.500"/><path d="M8 50h48" opacity=".5"/>',
    'hit:stamp': '<rect x="14" y="14" width="36" height="36" rx="4" stroke-width="4"/><path d="M23 24h18M23 32h18M23 40h12" stroke-width="3"/>',
    'particles:sakura': '<g fill="currentColor" stroke="none"><path d="M32 30c-5-8-3-16 0-20 3 4 5 12 0 20z"/><path d="M34 31c8-5 16-3 20 0-4 3-12 5-20 0z" opacity=".85"/><path d="M33 34c5 8 3 16 0 20-3-4-5-12 0-20z" opacity=".7"/><path d="M30 33c-8 5-16 3-20 0 4-3 12-5 20 0z" opacity=".85"/></g><circle cx="32" cy="32" r="2.500"/>',
    'particles:snowfall': '<path d="M32 8v48M11 20l42 24M53 20L11 44"/><path d="M26 12l6 6 6-6M26 52l6-6 6 6"/>',
    'particles:firefly': '<path d="M32 10c8 9 12 15 12 22a12 12 0 0 1-24 0c0-7 4-13 12-22z" fill="currentColor" stroke="none" opacity=".85"/><circle cx="14" cy="16" r="2" fill="currentColor" stroke="none"/><circle cx="52" cy="24" r="1.500" fill="currentColor" stroke="none"/><path d="M26 54h12"/>',
    'particles:galaxy': '<ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(-24 32 32)"/><circle cx="32" cy="32" r="6" fill="currentColor" stroke="none"/><circle cx="52" cy="18" r="1.800" fill="currentColor" stroke="none"/><circle cx="12" cy="46" r="1.400" fill="currentColor" stroke="none"/>',
    'particles:notes': '<path d="M24 44V16l22-5v28"/><ellipse cx="19" cy="45" rx="6" ry="4.500" fill="currentColor" stroke="none"/><ellipse cx="41" cy="40" rx="6" ry="4.500" fill="currentColor" stroke="none"/>',
    'particles:coins': '<ellipse cx="32" cy="22" rx="16" ry="7"/><path d="M16 22v10c0 4 7 7 16 7s16-3 16-7V22"/><path d="M16 32v10c0 4 7 7 16 7s16-3 16-7V32" opacity=".7"/>',
    'ult:curtain': '<path d="M8 10h48"/><path d="M10 10c2 16 0 30-2 44M22 10c0 14-4 28-12 40M54 10c-2 16 0 30 2 44M42 10c0 14 4 28 12 40"/><path d="M32 30l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z" fill="currentColor" stroke="none"/>',
    'ult:ink': '<path d="M32 8c10 12 16 20 16 28a16 16 0 0 1-32 0c0-8 6-16 16-28z" fill="currentColor" stroke="none"/><circle cx="50" cy="50" r="3" fill="currentColor" stroke="none" opacity=".6"/><circle cx="12" cy="18" r="2" fill="currentColor" stroke="none" opacity=".6"/>',
    'ult:warp': '<path d="M32 32L6 10M32 32L58 10M32 32L6 54M32 32L58 54M32 32V6M32 32v26M32 32H6M32 32h26" stroke-width="2"/><circle cx="32" cy="32" r="5" fill="currentColor" stroke="none"/>',
    'ult:stamp': '<path d="M22 8h20v14l6 8v8H16v-8l6-8z" fill="currentColor" stroke="none"/><path d="M12 46h40M18 54h28" stroke-width="4"/>',
    'result:fireworks': '<path d="M32 30V12M32 30l12-12M32 30l16 2M32 30l10 12M32 30L20 18M32 30l-16 2M32 30L22 42" stroke-width="2.500"/><path d="M32 40v16" opacity=".6"/><circle cx="32" cy="30" r="3" fill="currentColor" stroke="none"/>',
    'result:ribbon': '<path d="M6 22h52v14H6z" fill="currentColor" stroke="none" opacity=".9"/><path d="M6 22l8 7-8 7M58 22l-8 7 8 7" stroke-width="2.500"/><path d="M18 36l-4 16 8-5 6 7 2-18" opacity=".7"/>',
    'result:stamp-rain': '<rect x="8" y="10" width="20" height="20" rx="3" stroke-width="3" transform="rotate(-10 18 20)"/><rect x="34" y="18" width="22" height="22" rx="3" stroke-width="3" transform="rotate(8 45 29)"/><rect x="14" y="38" width="18" height="18" rx="3" stroke-width="3" transform="rotate(6 23 47)"/>',
    'result:popup': '<path d="M6 48l26-8 26 8M32 40V20M6 48V22l26-6 26 6v26"/><path d="M20 30l12-14 12 14" opacity=".7"/>',
  };
  const KIND_FRAME = {hit: 'M32 3l25 14.500v29L32 61 7 46.500v-29z', particles: 'M32 3a29 29 0 1 0 0 58 29 29 0 0 0 0-58z', ult: 'M32 3l8 15 17 3-12 12 3 17-16-8-16 8 3-17L7 21l17-3z', result: 'M8 8h48v40L32 61 8 48z'};
  // 一个带底色、边框形状、图案的小徽记。hit 六边形 / 粒子圆 / 大招星 / 结算盾，一眼分得出是哪一类。
  function emblem(id, {size = 'md'} = {}) {
    const st = styleOf(id); const [slot, name] = split(id);
    const box = el('div', 'pkl-emblem is-' + size); box.dataset.slot = slot; box.dataset.name = name;
    if (!st) { box.append(el('b', '', '?')); return box; }
    if (slot === 'cover') { box.classList.add('is-cover'); const c = el('i', 'pkl-cover'); c.style.background = st.css; c.append(el('i', 'pkl-cover__spine'), el('i', 'pkl-cover__label')); box.append(c); return box; }
    const [a, b, c] = st.pal; box.style.setProperty('--a', a); box.style.setProperty('--b', b); box.style.setProperty('--c', c);
    const gid = 'pkl-g-' + Math.random().toString(36).slice(2, 8);
    box.append(svg(`viewBox="0 0 64 64"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <path class="frame" d="${KIND_FRAME[slot] || KIND_FRAME.particles}" fill="url(#${gid})"/><path class="rim" d="${KIND_FRAME[slot] || KIND_FRAME.particles}" fill="none"/>
      <g fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round" transform="translate(13 13) scale(.594)"><g class="motif">${MOTIF[id] || ''}</g></g>`, 'pkl-emblem__svg'));
    return box;
  }
  // 试一下：在 node 上把这件东西真的播一遍（商店货架、衣橱装备栏）。
  async function demo(id, node) {
    const st = styleOf(id); if (!st || !node) return false;
    if (st.slot === 'hit') { hit(node, {style: st, crit: false, size: .9}); return true; }
    if (st.slot === 'particles') { burst(node, {style: st, scale: .9}); sfx('reward', {}); return true; }
    if (st.slot === 'result') { const host = node.closest('.pks-sku, .pks-wr__detail, .pks-dex__card') || node; return result(host, {style: st, rank: 'S'}); }
    if (st.slot === 'ult') {
      const g = G(), form = g?.equippedForm?.();
      const TITLE = {curtain: '谢幕', ink: '泼墨', warp: '跃迁', stamp: '落印'};
      try { await fx()?.cinematic(st.fx, {text: TITLE[st.fx] || '大招', sub: 'PREVIEW · 试看', kicker: form?.name || '碧琪', art: g?.ultArt?.(form?.id) || g?.portrait?.(form?.id), palette: st.pal, particle: form?.particle, form: g?.fxForm?.(form)}); } catch { /* 被跳过 */ }
      return true;
    }
    return false;
  }
  const tagOf = id => styleOf(id)?.tag || '';
  const canDemo = id => ['hit', 'particles', 'ult', 'result'].includes(split(id)[0]) && Boolean(styleOf(id));

  window.__pinkieLoadout = {current, hit, burst, ultOf, result, emblem, demo, tagOf, canDemo, styleOf, tables: TABLES};
})();
