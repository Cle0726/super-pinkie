/* 学习台奖励层：音效、红笔批注条、连对、星星飞行、连续章、星星罐、结算页、碧琪贴纸。
   动画只走学习台 ctx.motion（transform / opacity；描边用 DrawSVG）。减少动效只认 motion.reduced。 */
(() => {
  'use strict';
  if (window.__pinkieDeskReward) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const SOUND_KEY = 'pinkie.study.sound.v1';
  const STAR = 'M12 2.8l2.75 5.7 6.15.75-4.55 4.25 1.2 6.15L12 16.6l-5.55 3.05 1.2-6.15L3.1 9.25l6.15-.75z';
  const SLOTS = {cheer: 'correct', oops: 'wrong-eraser', combo: 'streak3', focus: 'thinking-pencil', finish: 'done-stamp', jar: 'done-stamp', leave: 'asleep', quiet: 'exam-day'};
  const RIGHT_LINES = ['稳。', '这个记住了。', '一下就想起来了。', '对，就是它。', '漂亮。', '记得很牢嘛。'];
  const WRONG_LINES = ['没关系，再看一眼。', '这个容易混，正常。', '记一下荧光笔那几个字。', '下次就对了。'];
  const live = new Set();
  const timers = new Set();
  let sleepId = 0, audio = null, master = null, gesture = false, popsLeft = 0;
  const voices = [];
  const lastPick = {};
  let noise = null;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { for (const id of timers) clearTimeout(id); timers.clear(); clearTimeout(sleepId); sleepId = 0; };

  function soundPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(SOUND_KEY) || '');
      if (raw && typeof raw === 'object') return {on: raw.on !== false, volume: raw.volume === 'mid' ? 'mid' : 'low'};
    } catch { /* 缺省开、音量小 */ }
    return {on: true, volume: 'low'};
  }
  function motionOf(node) {
    const desk = window.__pinkieStudyDesk;
    const pane = node?.closest?.('[data-pane]');
    const found = pane && desk?.contexts?.().find(c => c.pane?.id === pane.dataset.pane);
    if (found?.motion) return found.motion;
    if (desk?.motion) return desk.motion;
    return {reduced: false, gsap: window.__pinkieDeskVendors?.gsap || null, splitIn() { return null; }, drawIn() { return null; }, confettiAt() { return null; }};
  }
  function gsapOf(motion) { return motion?.gsap || window.__pinkieDeskVendors?.gsap || null; }
  function scheduleSleep(gsap) {
    if (!gsap?.ticker) return;
    clearTimeout(sleepId);
    sleepId = setTimeout(() => {
      sleepId = 0;
      const kids = gsap.globalTimeline?.getChildren(true, true, true) || [];
      if (!kids.some(t => t.isActive?.())) gsap.ticker.sleep();
    }, 320);
  }
  function tween(gsap, target, vars) {
    if (!gsap || target == null) return Promise.resolve();
    return new Promise(resolve => {
      let obj, settled = false;
      const done = () => { if (settled) return; settled = true; live.delete(obj); scheduleSleep(gsap); resolve(); };
      const update = vars.onUpdate, complete = vars.onComplete;
      obj = gsap.to(target, {...vars, onUpdate() { update?.call(this); }, onComplete() { complete?.(); done(); }, onInterrupt: done});
      live.add(obj);
    });
  }
  function tweenFrom(gsap, target, from, vars) {
    if (!gsap || target == null) return Promise.resolve();
    return new Promise(resolve => {
      let obj, settled = false;
      const done = () => { if (settled) return; settled = true; live.delete(obj); scheduleSleep(gsap); resolve(); };
      const update = vars.onUpdate, complete = vars.onComplete;
      obj = gsap.fromTo(target, from, {...vars, onUpdate() { update?.call(this); }, onComplete() { complete?.(); done(); }, onInterrupt: done});
      live.add(obj);
    });
  }
  function fade(node, from, to, ms = 120) {
    if (!node) return Promise.resolve();
    if (typeof node.animate !== 'function') { node.style.opacity = String(to); return Promise.resolve(); }
    const anim = node.animate([{opacity: from}, {opacity: to}], {duration: ms, easing: 'ease-out', fill: 'forwards'});
    return anim.finished.catch(() => {}).then(() => { if (node.isConnected) node.style.opacity = String(to); anim.cancel(); });
  }
  function deskRoot(node) { return node?.closest?.('#pinkie-study-desk') || node; }
  function point(node, root) {
    const a = node.getBoundingClientRect(), b = root.getBoundingClientRect();
    const sx = b.width / (root.offsetWidth || b.width) || 1, sy = b.height / (root.offsetHeight || b.height) || 1;
    return {x: (a.left - b.left) / sx + a.width / sx / 2, y: (a.top - b.top) / sy + a.height / sy / 2, sx, sy};
  }
  function starNode() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'pk-fly-star'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', STAR); path.setAttribute('fill', '#E5488F'); svg.append(path); return svg;
  }
  function killMotion() {
    for (const t of live) { try { t.progress?.(1); } catch { /* 已结束 */ } t.kill?.(); }
    live.clear();
    document.querySelectorAll('.pk-fly-layer').forEach(n => n.remove());
    clearTimers();
    const gsap = window.__pinkieDeskVendors?.gsap || window.__pinkieStudyDesk?.motion?.gsap;
    gsap?.ticker.sleep();
  }
  function suspendAudio() {
    for (const v of voices.splice(0)) v.stop();
    if (audio && audio.state === 'running') audio.suspend().catch(() => {});
  }

  function ensureAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = soundPrefs().volume === 'mid' ? 0.32 : 0.18;
    master.connect(audio.destination);
    return audio;
  }
  function arm() {
    gesture = true;
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', arm, true);
  document.addEventListener('keydown', arm, true);
  function noiseBuffer(ctx) {
    if (noise) return noise;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  }
  function env(gain, peak, hold, release) {
    const t = gain.context.currentTime, level = Math.max(0.0001, peak);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.004);
    gain.gain.setValueAtTime(level, t + 0.004 + Math.max(0, hold));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.004 + Math.max(0, hold) + release);
  }
  function beginVoice(ms) {
    const prefs = soundPrefs();
    if (!prefs.on || !gesture || document.hidden || (document.hasFocus && !document.hasFocus())) return null;
    const ctx = ensureAudio();
    if (!ctx) return null;
    if (master) master.gain.value = prefs.volume === 'mid' ? 0.32 : 0.18;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    while (voices.length >= 3) voices.shift().stop();
    const gain = ctx.createGain();
    gain.connect(master);
    const voice = {gain, stop() { try { gain.disconnect(); } catch { /* 已断开 */ } const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); }};
    voices.push(voice);
    later(() => voice.stop(), ms);
    return {ctx, gain, t: ctx.currentTime};
  }
  function osc(ctx, type, freq, when, dur, dest, level = 1) {
    const node = ctx.createOscillator(), g = ctx.createGain();
    node.type = type; node.frequency.setValueAtTime(freq, when);
    g.gain.value = level; node.connect(g); g.connect(dest);
    node.start(when); node.stop(when + dur);
    return node;
  }
  function playTick() {
    const v = beginVoice(90); if (!v) return;
    env(v.gain, 0.5, 0.008, 0.03);
    osc(v.ctx, 'triangle', 1800, v.t, 0.04, v.gain);
  }
  function playRight() {
    const v = beginVoice(420); if (!v) return;
    env(v.gain, 1, 0.2, 0.16);
    [1319, 1760].forEach((freq, i) => {
      const when = v.t + i * 0.13;
      osc(v.ctx, 'sine', freq, when, 0.07, v.gain, 0.82);
      osc(v.ctx, 'triangle', freq, when, 0.07, v.gain, 0.18);
    });
  }
  function playWrong() {
    const v = beginVoice(300); if (!v) return;
    env(v.gain, 0.6, 0.18, 0.1);
    const node = v.ctx.createOscillator();
    node.type = 'sine';
    node.frequency.setValueAtTime(196, v.t);
    node.frequency.linearRampToValueAtTime(165, v.t + 0.18);
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    node.connect(lp); lp.connect(v.gain);
    node.start(v.t); node.stop(v.t + 0.2);
  }
  function playCombo() {
    const v = beginVoice(520); if (!v) return;
    env(v.gain, 0.85, 0.22, 0.22);
    [1047, 1319, 1568, 2093].forEach((freq, i) => osc(v.ctx, 'triangle', freq, v.t + i * 0.055, 0.055, v.gain));
  }
  function playStamp() {
    const v = beginVoice(240); if (!v) return;
    env(v.gain, 0.9, 0.12, 0.08);
    const node = v.ctx.createOscillator();
    node.type = 'sine';
    node.frequency.setValueAtTime(90, v.t);
    node.frequency.exponentialRampToValueAtTime(50, v.t + 0.12);
    node.connect(v.gain); node.start(v.t); node.stop(v.t + 0.13);
    const src = v.ctx.createBufferSource();
    src.buffer = noiseBuffer(v.ctx);
    const bp = v.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
    const g = v.ctx.createGain(); g.gain.value = 0.4;
    src.connect(bp); bp.connect(g); g.connect(v.gain);
    src.start(v.t); src.stop(v.t + 0.03);
  }
  function playFinish(bell) {
    const v = beginVoice(1200); if (!v) return;
    env(v.gain, 0.72, 0.45, 0.6);
    for (const freq of [523.25, 659.25, 783.99]) osc(v.ctx, 'sine', freq, v.t, 0.45, v.gain, 0.34);
    osc(v.ctx, 'triangle', 1046.5, v.t, 0.45, v.gain, 0.28);
    if (!bell) return;
    const node = v.ctx.createOscillator(), g = v.ctx.createGain();
    node.type = 'sine'; node.frequency.value = 2093;
    g.gain.setValueAtTime(0.0001, v.t);
    g.gain.exponentialRampToValueAtTime(0.28, v.t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, v.t + 0.7);
    node.connect(g); g.connect(v.gain);
    node.start(v.t + 0.05); node.stop(v.t + 0.75);
  }
  function playPop() {
    if (popsLeft <= 0) return;
    popsLeft -= 1;
    const v = beginVoice(80); if (!v) return;
    env(v.gain, 0.25, 0.008, 0.02);
    const node = v.ctx.createOscillator();
    node.type = 'sine';
    node.frequency.setValueAtTime(2400, v.t);
    node.frequency.linearRampToValueAtTime(3200, v.t + 0.025);
    node.connect(v.gain); node.start(v.t); node.stop(v.t + 0.03);
  }
  function sound(name, opts = {}) {
    if (name === 'tick') playTick();
    else if (name === 'right') playRight();
    else if (name === 'wrong') playWrong();
    else if (name === 'combo') playCombo();
    else if (name === 'stamp') playStamp();
    else if (name === 'finish') playFinish(Boolean(opts.bell));
    else if (name === 'pop') playPop();
  }

  function pick(kind) {
    const list = kind === 'wrong' ? WRONG_LINES : RIGHT_LINES;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && list[i] === lastPick[kind]) i = (i + 1) % list.length;
    lastPick[kind] = list[i];
    return list[i];
  }
  function comboLine(n) {
    if (n === 3) return '连对 3 个！';
    if (n === 5) return '5 个了，手感来了';
    if (n === 10) return '10 连对！碧琪要给你鼓掌了';
    if (n > 0 && n % 5 === 0) return `${n} 连对，停不下来了吧`;
    return '';
  }
  // 标题固定，不随事件变；罐满、请假这类事件放在标题下一行小字里，碧琪那句只说这一组。三处不重字。
  function titleFor(summary = {}) {
    if (summary.failed) return '这一页背完啦';
    return summary.quiet ? '这一页背完了' : '这一页背完啦';
  }
  function eventLine(summary = {}) {
    if (summary.failed) return '';
    const days = summary.streak?.current | 0;
    const out = [];
    if (summary.jar?.filledNow) out.push(summary.jar?.unit === 'sets' ? '今天的两组背完了' : '今天的星星罐装满了');
    if (summary.streak?.leaveUsedYesterday) out.push('昨天用了一张请假条，连续还在');
    else if (summary.firstFinishToday && days === 1) out.push('今天从第 1 天盖起');
    return out.join(' · ');
  }
  function localLine(summary = {}) {
    const accuracy = Number(summary.accuracy) || 0;
    if (summary.quiet) return '稳住节奏，今晚早点睡';
    if (accuracy === 1) return '一道没错，记得很牢';
    if (accuracy >= 0.8) return '大部分都记住了，错的下组先看';
    return '错的那几道，下一组先看它们';
  }
  const lines = {
    pick,
    combo: comboLine,
    title: titleFor,
    event: eventLine,
    local: localLine,
    failed: '结算没记上，星星已经记了',
    exit: n => `还差 ${n} 题就盖章了，先放着？`,
    pending: n => `碧琪还在给 ${n} 张卡出题，这组先用翻卡和配对`,
    rightTitle: '对啦！',
    wrongTitle: '差一点',
    partialTitle: '差一点点',
    again: '这题等会儿再来一次',
    judging: '碧琪在看…',
  };

  function drawCheck(path, motion) {
    if (!path) return;
    if (motion.reduced) { path.style.opacity = '1'; return; }
    const drawn = motion.drawIn?.(path, {duration: .3, ease: 'power2.out'});
    if (drawn) return;
    const len = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 64;
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    const gsap = gsapOf(motion);
    if (gsap) tween(gsap, path, {strokeDashoffset: 0, duration: .3, ease: 'power2.out'});
    else path.style.strokeDashoffset = '0';
  }
  function feedbackSheet(host, opts = {}) {
    const motion = motionOf(host);
    const kind = opts.kind || 'right';
    let sheetHost = host.querySelector(':scope > .pk-sheet-host');
    if (!sheetHost) { sheetHost = el('div', 'pk-sheet-host'); host.append(sheetHost); }
    sheetHost.replaceChildren();
    const sheet = el('div', 'pk-sheet');
    sheet.dataset.kind = kind;
    sheet.setAttribute('role', 'status');
    sheet.setAttribute('aria-live', 'polite');
    const mark = el('div', 'pk-sheet-mark');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M12 25l8 8 16-18');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '3.2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    if (kind === 'wrong') {
      // 答错：一块斜放的小橡皮，套着纸套，旁边掉两粒橡皮屑。不是「=」号。
      svg.innerHTML = '<g transform="rotate(-32 24 24)"><rect x="8" y="16" width="32" height="15" rx="3.5" class="pk-eraser-body"/>'
        + '<path d="M24 16v15" class="pk-eraser-band"/><rect x="24" y="16" width="16" height="15" rx="0" class="pk-eraser-sleeve"/></g>'
        + '<circle cx="10" cy="38" r="1.8" class="pk-eraser-crumb"/><circle cx="16" cy="41" r="1.3" class="pk-eraser-crumb"/>';
      mark.dataset.mark = 'eraser';
    } else svg.append(path);
    mark.append(svg);
    const copy = el('div', 'pk-sheet-copy');
    const title = opts.title || (kind === 'wrong' ? lines.wrongTitle : kind === 'partial' ? lines.partialTitle : lines.rightTitle);
    const line = opts.line || (kind === 'wrong' ? pick('wrong') : kind === 'partial' ? '' : pick('right'));
    copy.append(el('strong', 'pk-sheet-title', title));
    if (line) copy.append(el('p', 'pk-sheet-line', line));
    if (opts.answerHtml) { const ans = el('div', 'pk-sheet-answer'); ans.innerHTML = opts.answerHtml; copy.append(ans); }
    if (opts.missing?.length) copy.append(el('p', 'pk-sheet-missing', '还差：' + opts.missing.join('、')));
    if (kind === 'wrong' && opts.again !== false) copy.append(el('p', 'pk-sheet-again', lines.again));
    const btn = el('button', 'pk-btn', '继续');
    btn.type = 'button'; btn.dataset.kind = 'go'; btn.setAttribute('aria-label', '继续');
    sheet.append(mark, copy, btn); sheetHost.append(sheet); sheetHost.hidden = false;
    if (!opts.silent) {
      if (kind === 'wrong') sound('wrong');
      else sound('right');
    }
    if (motion.reduced) fade(sheet, 0, 1, 120);
    else {
      const gsap = gsapOf(motion);
      // 反馈卡就在选项下面：轻轻落座（expo-out，不回弹，VFX.md §3.6）。
      if (gsap) tweenFrom(gsap, sheet, {y: 10, opacity: 0}, {y: 0, opacity: 1, duration: .26, ease: 'expo.out'});
      else sheet.style.transform = 'none';
      if (kind === 'right') drawCheck(path, motion);
    }
    let shut = false;
    const close = () => {
      if (shut) return Promise.resolve();
      shut = true; btn.disabled = true;
      const remove = () => { sheet.remove(); if (!sheetHost.childElementCount) sheetHost.hidden = true; };
      if (motion.reduced || !gsapOf(motion)) return fade(sheet, 1, 0, 120).then(remove);
      return tween(gsapOf(motion), sheet, {opacity: 0, duration: .12, ease: 'power2.in'}).then(remove);
    };
    btn.addEventListener('click', () => { const ret = opts.onContinue?.(); Promise.resolve(ret).then(close); });
    later(() => { if (!shut && btn.isConnected) btn.focus(); }, 20);
    return {close, sheet};
  }

  function burst(origin, motion) {
    const root = deskRoot(origin);
    if (!root || !origin) return;
    const layer = el('div', 'pk-fly-layer');
    root.append(layer);
    const here = point(origin, root);
    const jobs = [];
    for (let i = 0; i < 6; i++) {
      const star = starNode();
      star.style.left = here.x + 'px'; star.style.top = here.y + 'px';
      layer.append(star);
      const ang = -Math.PI * 0.95 + i * 0.32, dist = 26 + (i % 3) * 12;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      if (motion.reduced || !gsapOf(motion)) jobs.push(fade(star, 0, 1, 120).then(() => fade(star, 1, 0, 120)));
      else jobs.push(tween(gsapOf(motion), {t: 0}, {t: 1, duration: .42, ease: 'power2.out', onUpdate() {
        const t = this.targets()[0].t;
        star.style.transform = `translate(${dx * t}px, ${dy * t}px) scale(${0.6 + 0.5 * (1 - t)})`;
        star.style.opacity = String(t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      }}));
    }
    Promise.all(jobs).then(() => layer.remove());
  }
  function comboBadge(host, n) {
    const motion = motionOf(host);
    const count = Math.max(0, n | 0);
    let badge = host.querySelector(':scope > .pk-combo, .pk-combo');
    if (!badge) { badge = el('div', 'pk-combo'); badge.setAttribute('aria-live', 'polite'); host.append(badge); }
    if (!badge.querySelector('b')) badge.append(el('b', '', '0'), el('span', '', '连对'));
    const num = badge.querySelector('b');
    const prev = Number(badge.dataset.n || 0);
    badge.dataset.n = String(count); badge.dataset.on = count ? '1' : '0';
    badge.setAttribute('aria-label', count ? `连对 ${count}` : '连对从头数');
    if (count === prev) return badge;
    num.textContent = String(count);
    if (motion.reduced || !gsapOf(motion)) num.style.opacity = count ? '1' : '0.4';
    else if (!count) tween(gsapOf(motion), num, {opacity: 0.35, duration: .2});
    else tweenFrom(gsapOf(motion), num, {y: 8, scale: 1.18, opacity: 0.4}, {y: 0, scale: 1, opacity: 1, duration: .2, ease: 'power2.out'});
    const text = comboLine(count);
    let note = host.querySelector(':scope > .pk-margin-line');
    if (!text) { if (note) fade(note, 1, 0, motion.reduced ? 120 : 180).then(() => note.remove()); return badge; }
    if (!note) { note = el('p', 'pk-margin-line'); host.append(note); }
    const token = String(count) + ':' + Date.now();
    note.dataset.token = token;
    note.textContent = text;
    if (motion.reduced) fade(note, 0, 1, 120);
    else fade(note, 0, 1, 160);
    later(() => { if (note.isConnected && note.dataset.token === token) fade(note, 1, 0, 180).then(() => note.remove()); }, 2400);
    if (count === 3 || count === 5 || count === 10) {
      sound('combo');
      if (!motion.reduced) burst(host.querySelector('.pk-drill-nib') || badge, motion);
    }
    return badge;
  }

  function starsFly(fromEl, toEl, n, opts = {}) {
    const count = Math.max(0, Math.min(12, n | 0));
    if (!fromEl || !toEl || !count) return Promise.resolve();
    const motion = motionOf(fromEl);
    const root = deskRoot(fromEl);
    if (opts.sound !== false) { popsLeft = Math.min(6, count); }
    if (motion.reduced || !gsapOf(motion)) {
      if (opts.sound !== false) for (let i = 0; i < Math.min(6, count); i++) sound('pop');
      return fade(toEl, 0.55, 1, 120);
    }
    const layer = el('div', 'pk-fly-layer');
    root.append(layer);
    const a = point(fromEl, root), b = point(toEl, root);
    const dx = b.x - a.x, dy = b.y - a.y;
    const jobs = [];
    for (let i = 0; i < count; i++) {
      const star = starNode();
      star.style.left = a.x + 'px'; star.style.top = a.y + 'px'; star.style.opacity = '0';
      layer.append(star);
      const drift = (i - (count - 1) / 2) * 10;
      jobs.push(tween(gsapOf(motion), {t: 0}, {t: 1, duration: .6, delay: i * .04, ease: 'none', onStart() { if (opts.sound !== false) sound('pop'); }, onUpdate() {
        const t = this.targets()[0].t;
        const lift = Math.sin(Math.PI * t) * -72;
        star.style.opacity = String(t < 0.08 ? t / 0.08 : t > 0.86 ? (1 - t) / 0.14 : 1);
        star.style.transform = `translate(${dx * t + drift * (1 - t)}px, ${dy * t + lift}px) scale(${0.7 + 0.35 * Math.sin(Math.PI * t)})`;
      }}));
    }
    return Promise.all(jobs).then(() => layer.remove());
  }

  function leaveSet(leave) {
    const set = new Set();
    if (Array.isArray(leave)) leave.forEach((v, i) => { if (v === true) set.add(i); else if (typeof v === 'number') set.add(v); });
    return set;
  }
  function stampStreak(host, spec = {}) {
    const days = Math.max(0, spec.days | 0);
    let week = Array.isArray(spec.week) ? spec.week.slice() : Array(7).fill(false);
    let leaves = leaveSet(spec.leave);
    const future = new Set();
    if (Array.isArray(spec.weekKind) && spec.weekKind.length) {
      week = spec.weekKind.map(kind => kind === 'stamped' || kind === 'leave');
      leaves = new Set();
      spec.weekKind.forEach((kind, i) => { if (kind === 'leave') leaves.add(i); if (kind === 'future') future.add(i); });
    }
    host.classList.add('pk-streak-block');
    host.replaceChildren();
    const seal = el('div', 'pk-seal');
    seal.setAttribute('role', 'img');
    seal.setAttribute('aria-label', `连续 ${days} 天`);
    seal.append(el('b', '', String(days)), el('small', '', '天'));
    const row = el('div', 'pk-week');
    row.setAttribute('role', 'img');
    const names = ['一', '二', '三', '四', '五', '六', '日'];
    names.forEach((name, i) => {
      const cell = el('span', 'pk-week-cell');
      cell.append(el('i', '', name));
      if (future.has(i)) { cell.dataset.state = 'future'; cell.setAttribute('aria-label', `周${name} 还没到`); }
      else if (leaves.has(i)) { cell.dataset.state = 'leave'; cell.setAttribute('aria-label', `周${name} 请假`); }
      else if (week[i]) { cell.dataset.state = 'stamped'; cell.setAttribute('aria-label', `周${name} 已盖章`); }
      else { cell.dataset.state = 'open'; cell.setAttribute('aria-label', `周${name} 还没盖`); }
      row.append(cell);
    });
    const press = el('i', 'pk-seal-press');
    press.setAttribute('aria-hidden', 'true');
    const sealWrap = el('div', 'pk-seal-wrap');
    sealWrap.append(press, seal);
    const side = el('div', 'pk-streak-side');
    side.append(row);
    if (spec.caption) side.append(el('p', 'pk-seal-cap', spec.caption));
    host.append(sealWrap, side);
    // 要盖新章时先藏起来，等星星进罐再「啪」地盖下去。
    if (spec.pending) seal.style.opacity = '0';
    const api = {el: host, seal, stamp() {
      const motion = motionOf(host);
      sound('stamp');
      if (motion.reduced || !gsapOf(motion)) { press.style.opacity = '0'; return fade(seal, 0, 1, 120); }
      const gsap = gsapOf(motion);
      // 印章从上方压下来，压到底比原尺寸略小（压痕），再回弹；印泥外圈的压痕淡出。
      gsap.set(seal, {scale: 1.6, rotate: -14, opacity: 0, transformOrigin: '50% 50%'});
      gsap.set(press, {scale: .86, opacity: 0, transformOrigin: '50% 50%'});
      const down = tween(gsap, seal, {keyframes: [
        {scale: .9, rotate: -4, opacity: 1, duration: .16, ease: 'power3.in'},
        {scale: 1, rotate: -6, duration: .2, ease: 'back.out(3)'},
      ]});
      const ring = tween(gsap, press, {keyframes: [
        {opacity: 0, duration: .15},
        {scale: 1.18, opacity: .5, duration: .08, ease: 'power2.out'},
        {scale: 1.32, opacity: 0, duration: .5, ease: 'power2.out'},
      ]});
      return Promise.all([down, ring]);
    }};
    return api;
  }

  let jarSeq = 0;
  function starJar(host, spec = {}) {
    const unit = spec.unit || 'sets';
    const goal = Math.max(1, spec.goal | 0 || (unit === 'sets' ? 2 : 30));
    let today = Math.max(0, spec.today | 0);
    const id = 'pk-jar-clip-' + (++jarSeq);
    host.classList.add('pk-jar');
    const fig = el('figure', 'pk-jar');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 80 104'); svg.setAttribute('class', 'pk-jar-svg'); svg.setAttribute('role', 'img');
    // 罐子记今天背完几组。满 2 组就是今天完成；多出来的组数写在旁边，星星不进这个罐子。
    svg.innerHTML = `<path class="pk-jar-lid" d="M16 4h48a4 4 0 0 1 4 4v6H12V8a4 4 0 0 1 4-4z"/>
      <path class="pk-jar-glass" d="M26 14h28v8H26z"/>
      <path class="pk-jar-glass" d="M16 24h48v48a12 12 0 0 1-12 12H28a12 12 0 0 1-12-12V24z"/>
      <defs><clipPath id="${id}"><path d="M20 28h40v42a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V28z"/></clipPath></defs>
      <g clip-path="url(#${id})">
        <rect class="pk-jar-water" x="20" y="28" width="40" height="50"/>
      </g>
      <path class="pk-jar-glass" d="M32 26c1 7 1 11 0 16M48 26c-1 7-1 11 0 16"/>`;
    const cap = el('figcaption', '', '');
    const capNow = el('b', '', String(today));
    const capRest = document.createTextNode('');
    cap.append(capNow, capRest);
    fig.append(svg, cap); host.replaceChildren(fig);
    const level = svg.querySelector('.pk-jar-water');
    // 水位只用这一处 CSS transform。不要再往罐子里放几颗星：那会变成另一套数字。
    level.style.transformBox = 'fill-box';
    level.style.transformOrigin = '50% 100%';
    const ratioOf = value => Math.max(0, Math.min(1, value / goal));
    const writeCap = n => {
      const v = Math.max(0, Math.round(n));
      fig.classList.toggle('is-full', v >= goal);
      if (unit === 'sets' && v >= goal) {
        capNow.textContent = '完成';
        capRest.textContent = v > goal ? ` · 今天 ${v} 组` : '';
        svg.setAttribute('aria-label', `今天的学习完成了，背了 ${v} 组`);
      } else if (unit === 'sets') {
        capNow.textContent = String(v);
        capRest.textContent = ` / ${goal} 组`;
        svg.setAttribute('aria-label', `今天 ${v} / ${goal} 组`);
      } else {
        capNow.textContent = String(v);
        capRest.textContent = ` / ${goal}`;
        svg.setAttribute('aria-label', `星星罐 ${v} / ${goal}`);
      }
    };
    const setLevel = ratio => { level.style.transform = `scaleY(${Math.max(0.001, ratio)})`; };
    let shown = ratioOf(today);
    let shownCount = today;
    setLevel(shown);
    writeCap(today);
    const paint = (animate) => {
      const target = ratioOf(today);
      const motion = motionOf(host);
      const gsap = gsapOf(motion);
      if (!animate || motion.reduced || !gsap) { shown = target; shownCount = today; setLevel(target); writeCap(today); return Promise.resolve(); }
      const from = shown;
      const value = {t: 0};
      const start = shownCount;
      const end = today;
      return tween(gsap, value, {t: 1, duration: .55, ease: 'power2.out', onUpdate() {
        shown = from + (target - from) * value.t;
        shownCount = start + (end - start) * value.t;
        setLevel(shown);
        writeCap(shownCount);
      }}).then(() => { shown = target; shownCount = end; setLevel(target); writeCap(end); });
    };
    return {el: host, svg, get today() { return today; }, goal, paint,
      add(n = 1) { today = Math.max(0, today + Math.round(n) || 0); return paint(true); },
      set(n = 0) { today = Math.max(0, n | 0); return paint(false); },
      bump() {
        const motion = motionOf(host);
        if (motion.reduced || !gsapOf(motion)) return Promise.resolve();
        return tween(gsapOf(motion), svg, {keyframes: [{scale: 1.08, duration: .07}, {scale: 1, duration: .14}], transformOrigin: '50% 90%'});
      },
      full() {
        const motion = motionOf(host);
        if (motion.reduced || !gsapOf(motion)) return fade(svg, 0.7, 1, 120);
        return tween(gsapOf(motion), svg, {keyframes: [{rotate: -5, duration: .08}, {rotate: 4.5, duration: .08}, {rotate: -2.5, duration: .08}, {rotate: 0, duration: .1}], transformOrigin: '50% 80%'});
      }};
  }

  function clock(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function roll(node, to, format, motion) {
    const gsap = gsapOf(motion);
    if (motion.reduced || !gsap) { node.textContent = format(to); return Promise.resolve(); }
    const value = {n: 0};
    return tween(gsap, value, {n: to, duration: .9, ease: 'power3.out', onUpdate() { if (node.isConnected) node.textContent = format(value.n); }})
      .then(() => { if (node.isConnected) node.textContent = format(to); });
  }
  // 数据卡依次上浮落位（不歪、不回弹）。
  function stickNote(note, i, motion) {
    if (motion.reduced || !gsapOf(motion)) return fade(note, 0, 1, 120);
    return tweenFrom(gsapOf(motion), note, {y: 14, opacity: 0}, {y: 0, opacity: 1, duration: .42, delay: .08 + i * .09, ease: 'power3.out'});
  }
  function beijingIndex() {
    const name = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Shanghai', weekday: 'short'}).format(new Date());
    return {Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6}[name] ?? 0;
  }
  function weekOf(summary) {
    if (Array.isArray(summary.streak?.week)) return summary.streak.week.slice();
    if (Array.isArray(summary.week)) return summary.week.slice();
    const week = Array(7).fill(false);
    if (summary.firstFinishToday || summary.streak?.stampedToday) week[beijingIndex()] = true;
    return week;
  }
  function leaveOf(summary) {
    if (Array.isArray(summary.streak?.leave) || Array.isArray(summary.leave)) return summary.streak?.leave || summary.leave;
    if (!summary.streak?.leaveUsedYesterday) return [];
    return [(beijingIndex() + 6) % 7];
  }
  // 结算页。summary.failed 表示结算接口没成功：只摆本地真数据（星星、首答正确率、用时），
  // 不盖章、不撒纸屑、罐子和连续章都不出现，给一行说明和「再试一次」。
  function completeScreen(host, summary = {}, opts = {}) {
    const motion = motionOf(host);
    const failed = Boolean(summary.failed);
    const screen = el('section', 'pk-done');
    screen.dataset.state = failed ? 'failed' : summary.quiet ? 'quiet' : 'ok';
    screen.setAttribute('aria-label', titleFor(summary));
    const stickerHost = el('div', 'pk-done-sticker pk-react-host');
    const heading = el('h2', 'pk-done-title', titleFor(summary));
    const event = el('p', 'pk-done-event', failed ? '' : eventLine(summary));
    event.hidden = !event.textContent;
    const board = el('div', 'pk-done-board');
    const stats = el('div', 'pk-done-stats');
    const earned = Math.max(0, summary.stars | 0);
    const accuracy = Math.round((Number(summary.accuracy) || 0) * 100);
    const cards = [
      ['星星', earned, n => '+' + Math.round(n), 'star'],
      ['正确', accuracy, n => Math.round(n) + '%', 'right'],
      ['用时', Math.max(0, Math.round((Number(summary.ms) || 0) / 1000)), n => clock(n * 1000), 'time'],
    ].map(([label, value, format, tone]) => {
      const note = el('div', 'pk-stick');
      note.dataset.tone = tone;
      const num = el('b', '', motion.reduced ? format(value) : format(0));
      note.append(el('small', '', label), num);
      stats.append(note);
      return {note, num, value, format};
    });
    board.append(stats);
    let jar = null;
    let streak = null;
    const streakHost = el('div', 'pk-done-streak');
    if (!failed) {
      const jarHost = el('div', 'pk-done-jar');
      const after = Math.max(0, summary.jar?.today | 0);
      const sets = summary.jar?.unit === 'sets' || summary.jar?.unit == null;
      const goal = summary.jar?.goal || (sets ? 2 : 30);
      const gained = sets ? 1 : earned;
      jar = starJar(jarHost, {today: Math.max(0, after - gained), goal, unit: sets ? 'sets' : 'stars'});
      board.append(jarHost);
      const days = summary.streak?.current | 0;
      const caption = summary.firstFinishToday ? `连续 ${days} 天` : summary.streak?.stampedToday ? '今天的章已经盖了' : '';
      streak = stampStreak(streakHost, {days, week: weekOf(summary), weekKind: summary.streak?.weekKind, leave: leaveOf(summary), caption, pending: Boolean(summary.firstFinishToday)});
    } else streakHost.hidden = true;
    const line = el('p', 'pk-done-line', failed ? '' : localLine(summary));
    line.hidden = failed;
    const failNote = el('div', 'pk-done-failed');
    failNote.hidden = !failed;
    const actions = el('div', 'pk-done-actions');
    const again = el('button', 'pk-btn', '再背一组'); again.type = 'button'; again.dataset.kind = 'go'; again.setAttribute('aria-label', '再背一组');
    // 后端说没有下一组可背，就不给这个按钮，免得点了落空。
    again.hidden = failed || !opts.onAgain || summary.nextSuggestion === null || (summary.nextSuggestion === undefined && opts.requireSuggestion);
    const retry = el('button', 'pk-btn', '再试一次'); retry.type = 'button'; retry.dataset.kind = 'go'; retry.setAttribute('aria-label', '再试一次');
    if (failed) { failNote.append(el('p', '', lines.failed)); actions.append(retry); }
    const back = el('button', 'pk-link', summary.backLabel || '回笔记本'); back.type = 'button'; back.setAttribute('aria-label', back.textContent);
    actions.append(again, back);
    screen.append(stickerHost, heading, event, board, streakHost, line, failNote, actions);
    host.append(screen);
    // 键盘：焦点落在结算页本身（不落在按钮上，免得连按 Enter 又开一组），下一次 Tab 就是「再背一组」。
    const active = document.activeElement;
    if (!active || active === document.body || host.contains(active) || !active.isConnected) { screen.tabIndex = -1; screen.focus({preventScroll: true}); }
    sticker(stickerHost, failed ? 'focus' : summary.quiet ? 'quiet' : summary.jar?.filledNow ? 'jar' : 'finish');
    if (!motion.reduced) motion.splitIn?.(heading, {duration: .35, stagger: .02});
    else fade(heading, 0, 1, 120);
    const rolls = cards.map((card, i) => {
      stickNote(card.note, i, motion);
      return roll(card.num, card.value, card.format, motion);
    });
    const settle = () => { if (screen.isConnected) screen.dataset.settled = '1'; };
    if (failed) Promise.all(rolls).then(settle);
    else later(() => {
      if (!screen.isConnected) return;
      const flying = earned > 0 ? starsFly(cards[0].note, jar.svg, Math.min(12, earned), {sound: true}) : Promise.resolve();
      flying.then(() => {
        if (!screen.isConnected) return;
        return Promise.all([jar.add(summary.jar?.unit === 'stars' ? earned : 1), jar.bump()]);
      }).then(() => {
        if (!screen.isConnected) return;
        const jobs = [];
        if (summary.firstFinishToday) jobs.push(streak.stamp());
        if (summary.jar?.filledNow) {
          sound('finish', {bell: true});
          jobs.push(jar.full());
          if (!summary.quiet && !motion.reduced) motion.confettiAt?.(screen, 'large');
        } else sound('finish');
        return Promise.all([...jobs, ...rolls]);
      }).then(settle, settle);
    }, motion.reduced ? 140 : 380);
    const cheer = failed ? null : opts.cheer;
    if (cheer) Promise.race([
      Promise.resolve(cheer).then(v => (v && typeof v === 'object' ? v.line : v) || ''),
      // 真模型一句要 10 秒上下（后端自己 15 秒超时）；先放本地那句，等得到就淡入替换。
      new Promise(resolve => later(() => resolve(''), 18000)),
    ]).then(text => {
      if (!text || text === line.textContent || text === event.textContent || text === heading.textContent || !line.isConnected) return;
      fade(line, 1, 0, 120).then(() => { line.textContent = text; return fade(line, 0, 1, 120); });
    }).catch(() => {});
    let closed = false;
    const close = () => { if (closed) return; closed = true; screen.remove(); };
    again.addEventListener('click', () => { close(); opts.onAgain?.(); });
    back.addEventListener('click', () => { close(); opts.onBack?.(); });
    retry.addEventListener('click', async () => {
      if (retry.disabled) return;
      retry.disabled = true; retry.textContent = '正在记…';
      try {
        const ok = await opts.onRetry?.();
        if (ok) { close(); return; }
      } catch { /* 还是没记上 */ }
      retry.disabled = false; retry.textContent = '再试一次';
    });
    return {close, screen, jar, streak};
  }

  function sticker(host, slot) {
    const name = SLOTS[slot] || SLOTS.focus;
    const src = window.__pinkieStudyDesk?.sticker?.(name) || '';
    let img = host.querySelector('img.pk-react');
    if (!img) {
      img = el('img', 'pk-sticker pk-react');
      img.alt = ''; img.width = 112; img.height = 112; img.decoding = 'async';
      img.setAttribute('aria-hidden', 'true');
      host.append(img);
    }
    if (src) img.src = src;
    img.dataset.slot = slot || 'focus';
    const motion = motionOf(host);
    if (motion.reduced || !gsapOf(motion)) return fade(img, 0.35, 1, 120);
    return tweenFrom(gsapOf(motion), img, {scaleX: 1.08, scaleY: 0.86}, {scaleX: 1, scaleY: 1, duration: .35, ease: 'back.out(1.7)', transformOrigin: '50% 100%'});
  }

  function paintProgress(track, ratio) {
    if (!track) return Promise.resolve();
    const ink = track.querySelector('.pk-drill-ink');
    const nib = track.querySelector('.pk-drill-nib');
    const next = Math.max(0, Math.min(1, Number(ratio) || 0));
    const max = Number(track.getAttribute('aria-valuemax')) || 1;
    track.setAttribute('aria-valuenow', String(Math.round(next * max)));
    const width = track.clientWidth || 0;
    const motion = motionOf(track);
    if (motion.reduced || !gsapOf(motion)) {
      if (ink) ink.style.transform = `scaleX(${next})`;
      if (nib) nib.style.transform = `translateX(${next * Math.max(0, width - 10)}px)`;
      return Promise.resolve();
    }
    const jobs = [];
    if (ink) jobs.push(tween(gsapOf(motion), ink, {scaleX: next, duration: .4, ease: 'power2.out', transformOrigin: 'left center'}));
    if (nib) jobs.push(tween(gsapOf(motion), nib, {x: next * Math.max(0, width - 10), duration: .4, ease: 'power2.out'}));
    return Promise.all(jobs);
  }

  function onHide() { if (document.hidden) { killMotion(); suspendAudio(); } }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pinkie:study-desk-unmount', () => { killMotion(); suspendAudio(); });
  window.addEventListener('blur', () => { /* 失焦不发声；sound() 里看 hasFocus */ });

  window.__pinkieDeskReward = {
    sound, soundKey: SOUND_KEY, soundPrefs, lines, feedbackSheet, comboBadge, starsFly, stampStreak, starJar,
    completeScreen, sticker, paintProgress, slots: SLOTS, clock,
    suspend: suspendAudio, stop() { killMotion(); suspendAudio(); },
  };
})();
