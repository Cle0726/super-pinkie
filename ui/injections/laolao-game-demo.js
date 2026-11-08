/* ?game-demo：把每种配方、命中招式、大招切入、法阵、奖励都放一遍（开发 / QA 用）。没有这个参数时什么都不做。 */
(() => {
  'use strict';
  if (!/[?&]game-demo\b/.test(location.search) || window.__pinkieGameDemo) return;
  const ready = () => new Promise(r => window.__pinkieGameFx ? r(window.__pinkieGameFx) : addEventListener('pinkie:gamefx-ready', () => r(window.__pinkieGameFx), {once: true}));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const DEMO_FORM = {id: 'daily', name: '日常碧琪', palette: ['#F7A8C8', '#DB1F74', '#FFD36E']};
  async function boot() {
    const fx = await ready();
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const stage = el('div', 'pk-gamefx-demo-stage'); const target = el('div', 'target', '错题怪'); stage.append(target);
    const hud = el('div', 'target'); hud.dataset.gameHud = 'stars'; hud.textContent = '星星 0'; hud.style.cssText = 'position:absolute;right:40px;top:30px;width:120px;height:52px;border-radius:14px;font-size:15px';
    stage.append(hud);
    const panel = el('aside', 'pk-gamefx-demo'); panel.append(el('h2', '', 'Game FX'));
    const out = el('output');
    const center = () => { const r = target.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; };
    const section = (title) => { panel.append(el('h3', '', title)); const g = el('div', 'grid'); panel.append(g); return g; };
    const button = (grid, label, fn) => { const b = el('button', '', label); b.addEventListener('click', fn); grid.append(b); return b; };
    const tiers = section('档位');
    const tierButtons = fx.tiers.map(t => [t.id, button(tiers, t.label, () => { fx.setTier(t.id); paint(); })]);
    const paint = () => { const s = fx.settings(); for (const [id, b] of tierButtons) b.setAttribute('aria-pressed', String(s.tier === id)); };
    paint(); addEventListener('pinkie:gamefx-settings', paint);
    const kinds = section(`配方（${fx.kinds.length}）`);
    for (const k of fx.kinds) button(kinds, k, () => fx.burst(k, center()));
    const hits = section(`命中招式（${fx.hits.length}）`);
    for (const h of fx.hits) button(hits, h, () => fx.hit(h, center(), {crit: false}));
    const crit = section('暴击 / 法阵 / 彗星');
    button(crit, '暴击·一闪', () => fx.hit('slash', center(), {crit: true}));
    button(crit, '暴击·水晶', () => fx.hit('shard', center(), {crit: true}));
    button(crit, '法阵', () => fx.sigil({x: center().x, y: center().y + 70}));
    button(crit, '彗星 → HUD', () => fx.comet(center(), hud, {count: 14}));
    button(crit, '冲击', () => fx.impact(center()));
    const presets = section(`大招切入（${fx.presets.length}）`);
    for (const p of fx.presets) button(presets, fx.presetLabel[p], () => fx.cinematic(p, {text: '星砂 · 流转', sub: '连续盖章 7 天', kicker: DEMO_FORM.name, palette: DEMO_FORM.palette, particle: 'stars', form: DEMO_FORM}));
    const awards = section('奖励');
    for (const lv of ['small', 'medium', 'big', 'cinematic']) button(awards, lv, () => fx.playAward({id: 'demo-' + lv + Date.now(), kind: lv === 'cinematic' ? 'awaken' : 'stars', amount: lv === 'small' ? 3 : 48, reason: '背一背 · 全对', fx: lv}, {from: target, form: DEMO_FORM, palette: lv === 'cinematic' ? DEMO_FORM.palette : undefined, kicker: DEMO_FORM.name}));
    button(awards, '金印', () => fx.playAward({id: 'seal-' + Date.now(), kind: 'seals', amount: 2, reason: '守关成功', fx: 'medium'}, {from: target}));
    button(awards, '碎片', () => fx.playAward({id: 'shard-' + Date.now(), kind: 'shards', amount: 5, reason: '收服错题怪', fx: 'small'}, {from: target}));
    const all = el('button', '', '▶ 全部放一遍'); all.style.marginTop = '14px'; all.addEventListener('click', () => playAll()); panel.append(all, out);
    document.body.append(stage, panel);
    setInterval(() => { const s = fx.stats(), f = fx.fps(1500); out.textContent = `tier ${fx.settings().label}\nWebGL ${s.webgl ? 'on' : (s.fallback ? 'flat' : 'idle')}  ctx ${s.contexts}\nrAF ${s.rafActive ? 'run' : 'stop'}  frames ${s.frames}\nfps median ${f.median}  p5 ${f.p5}`; }, 500);
    async function playAll({gap = 380, cineGap = 300} = {}) {
      const log = [];
      for (const k of fx.kinds) { await fx.burst(k, center()); log.push(k); await wait(gap); }
      for (const h of fx.hits) { await fx.hit(h, center(), {sound: false}); log.push('hit:' + h); await wait(gap); }
      for (const p of fx.presets) { const r = await fx.cinematic(p, {text: '星砂 · 流转', sub: fx.presetLabel[p], kicker: DEMO_FORM.name, palette: DEMO_FORM.palette, particle: 'stars'}); log.push(p + ':' + (r.played ? 'ok' : r.reason)); await wait(cineGap); }
      for (const lv of ['small', 'medium', 'big']) await fx.playAward({id: 'all-' + lv + Date.now(), kind: 'stars', amount: 12, reason: '演示', fx: lv}, {from: target});
      return log;
    }
    window.__pinkieGameDemo = {playAll, target, center, hud, form: DEMO_FORM};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
})();
