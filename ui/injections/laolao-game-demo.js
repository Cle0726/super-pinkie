/* ?game-demo：把每种粒子、每种大招过场、顿帧、震屏、奖励四级都放一遍。没有这个参数时什么都不做。 */
(() => {
  'use strict';
  if (!/[?&]game-demo\b/.test(location.search) || window.__pinkieGameDemo) return;
  const ready = () => new Promise(r => window.__pinkieGameFx ? r(window.__pinkieGameFx) : addEventListener('pinkie:gamefx-ready', () => r(window.__pinkieGameFx), {once: true}));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function boot() {
    const fx = await ready();
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const stage = el('div', 'pk-gamefx-demo-stage'); const target = el('div', 'target', '敌人'); stage.append(target);
    const hud = el('div', 'target'); hud.dataset.gameHud = 'stars'; hud.textContent = '⭐ 0'; hud.style.cssText = 'position:absolute;right:40px;top:30px;width:110px;height:54px;border-radius:16px';
    stage.append(hud);
    const panel = el('aside', 'pk-gamefx-demo'); panel.append(el('h2', '', '游戏特效演示'));
    const out = el('output');
    const center = () => { const r = target.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };
    panel.append(el('h3', '', '档位'));
    const tiers = el('div', 'grid'); panel.append(tiers);
    const tierButtons = fx.tiers.map(t => { const b = el('button', '', t.label); b.addEventListener('click', () => { fx.setTier(t.id); paint(); }); tiers.append(b); return [t.id, b]; });
    const paint = () => { const s = fx.settings(); for (const [id, b] of tierButtons) b.setAttribute('aria-pressed', String(s.tier === id)); };
    paint(); addEventListener('pinkie:gamefx-settings', paint);
    panel.append(el('h3', '', '粒子（22）'));
    const kinds = el('div', 'grid'); panel.append(kinds);
    for (const k of fx.kinds) { const b = el('button', '', k); b.addEventListener('click', () => fx.burst(k, center(), {power: 1.2})); kinds.append(b); }
    panel.append(el('h3', '', '大招过场（9）'));
    const presets = el('div', 'grid'); panel.append(presets);
    for (const p of fx.presets) { const b = el('button', '', fx.presetLabel[p]); b.addEventListener('click', () => fx.cinematic(p, {text: '碧琪大招！', sub: fx.presetLabel[p], particle: 'stars'})); presets.append(b); }
    panel.append(el('h3', '', '打击'));
    const hits = el('div', 'grid'); panel.append(hits);
    const add = (label, fn) => { const b = el('button', '', label); b.addEventListener('click', fn); hits.append(b); };
    add('命中', () => { fx.burst('stars', {x: 120 + 330, y: innerHeight - 120}, {pattern: 'stream', to: target, count: 24}); fx.sfx('hit'); });
    add('暴击', async () => { fx.burst('sparkle', center(), {count: 120, power: 1.6}); fx.sfx('crit'); fx.shake(1.4); await fx.hitstop(80); });
    add('顿帧 90ms', () => fx.hitstop(90));
    add('震屏', () => fx.shake(1.5));
    for (const lv of ['small', 'medium', 'big', 'cinematic']) add('奖励 ' + lv, () => fx.playAward({id: 'demo-' + lv + Date.now(), kind: lv === 'cinematic' ? 'boss' : 'stars', amount: lv === 'small' ? 1 : 15, reason: '演示奖励', fx: lv}, {from: target}));
    const all = el('button', '', '▶ 全部放一遍'); all.style.marginTop = '12px'; all.addEventListener('click', () => playAll()); panel.append(all, out);
    document.body.append(stage, panel);
    setInterval(() => { const s = fx.stats(), f = fx.fps(1500); out.textContent = `档位 ${fx.settings().label}\nWebGL ${s.webgl ? '开' : (s.fallback ? '平面版' : '待机')}  上下文 ${s.contexts}\nrAF ${s.rafActive ? '运行' : '停'}  帧 ${s.frames}\n帧率 中位 ${f.median}  低 5% ${f.p5}`; }, 500);
    async function playAll({gap = 260, cineGap = 300} = {}) {
      const log = [];
      for (const k of fx.kinds) { await fx.burst(k, center(), {power: 1.2}); log.push(k); await wait(gap); }
      await wait(600);
      for (const p of fx.presets) { const r = await fx.cinematic(p, {text: '碧琪大招！', sub: fx.presetLabel[p], particle: 'stars'}); log.push(p + ':' + (r.played ? 'ok' : r.reason)); await wait(cineGap); }
      await fx.hitstop(80); fx.shake(1.2);
      for (const lv of ['small', 'medium', 'big']) await fx.playAward({id: 'all-' + lv + Date.now(), kind: 'stars', amount: 12, reason: '演示', fx: lv}, {from: target});
      return log;
    }
    window.__pinkieGameDemo = {playAll, target, center};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
})();
