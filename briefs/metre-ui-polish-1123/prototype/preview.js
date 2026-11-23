// 预览面板（只在预览页有，不是产品界面）：一键重放几个整页动画的时刻。
(() => {
  const q = new URLSearchParams(location.search);
  const go = (k, v) => { q.set(k, v); location.search = q.toString(); };
  const box = document.createElement('div');
  box.setAttribute('data-preview-panel', '');
  Object.assign(box.style, {position: 'fixed', right: '12px', top: '48px', zIndex: 2147483600, display: 'flex', flexDirection: 'column', gap: '6px',
    padding: '10px', borderRadius: '10px', background: 'rgba(20,20,20,.82)', color: '#fff', font: '12px/1.3 system-ui, sans-serif', boxShadow: '0 4px 18px rgba(0,0,0,.25)'});
  const isV2 = document.documentElement.hasAttribute('data-pv3');
  const title = document.createElement('div'); title.textContent = '预览面板（不是产品界面）· 现在是' + (isV2 ? '新版（总谱）' : '旧版'); title.style.opacity = '.7'; box.append(title);
  const btn = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    Object.assign(b.style, {all: 'unset', cursor: 'pointer', padding: '6px 10px', borderRadius: '6px', background: 'rgba(255,255,255,.12)'});
    b.onmouseenter = () => b.style.background = 'rgba(255,255,255,.22)'; b.onmouseleave = () => b.style.background = 'rgba(255,255,255,.12)';
    b.onclick = fn; box.append(b); };
  btn('▶ 切进 Metre（预备拍 → 谱纸翻开）', async () => {
    const t = window.PinkieMetreTransition?.play?.(); if (!t) { alert('现在是「减少动态效果」，转场不放。'); return; }
    await t.ready; await t.covered; t.finish();
  });
  btn(isV2 ? '▶ 换会话（翻到下一小节）' : '▶ 换会话（竖条显出 + 指挥线）', () => window.dispatchEvent(new CustomEvent('pinkie:session-selected', {detail: {}})));
  btn('▶ 重放首页 / 对话页进场', () => window.dispatchEvent(new CustomEvent('pinkie:metre-sweep', {detail: {ms: 420}})));
  btn(q.get('empty') === '1' ? '→ 换到对话页' : '→ 换到首页', () => go('empty', q.get('empty') === '1' ? '0' : '1'));
  btn(isV2 ? '↺ 换回旧版对比' : '★ 换成新版（总谱）', () => go('v', isV2 ? '1' : '3'));
  btn(q.get('night') === '1' ? '☀ 换成日间' : '☾ 换成夜间', () => go('night', q.get('night') === '1' ? '0' : '1'));
  const reduce = () => document.documentElement.hasAttribute('data-pinkie-reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const warn = document.createElement('div'); warn.style.cssText = 'color:#f3c66b;display:none'; warn.textContent = '注意：现在是「减少动态效果」，整页动画按规矩不放。'; box.append(warn);
  setTimeout(() => { warn.style.display = reduce() ? 'block' : 'none'; }, 1500);
  const mount = () => document.body ? document.body.append(box) : setTimeout(mount, 50); mount();
})();
