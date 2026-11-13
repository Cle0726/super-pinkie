/* 碧琪上岸记 · 商店 / 扭蛋 / 衣橱 / 图鉴 / 心愿单（学习台视图 gameshop / gamegacha / gamewardrobe / gamecodex）。
   - 价格、库存、扭蛋结果全部来自后端；前端只播放（PLAN §12-3）。
   - 扭蛋机是 fx 引擎里的 3D 场景（registerScene('gacha')）：漆面机身 + 玻璃罩 + 胶囊，真实灯光和软阴影；扭把手 → 胶囊落下 → 按稀有度发光 → 开蛋；SSR 走大招切入。
     WebGL 起不来时用平面版（同样的结果卡片）。
   视觉：VFX.md（衬线展示字、拉丁窄体小字、等宽数字、发丝线、纸片 3D 翻转、不回弹）。 */
(() => {
  'use strict';
  if (window.__pinkieGameShop) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = n => (Number(n) || 0).toLocaleString('en-US');
  const RARITY = {N: {label: 'N', tone: '#B9AEA4', name: '普通'}, R: {label: 'R', tone: '#6F8FD6', name: '稀有'}, SR: {label: 'SR', tone: '#C2569A', name: '超稀有'}, SSR: {label: 'SSR', tone: '#D9A441', name: '传说'},
    limited: {label: '限定', tone: '#5BA7B5', name: '节气限定'}, exclusive: {label: '专属', tone: '#8E6BD8', name: '专属'}};
  const KIND = {form: ['FORM', '形态'], fx: ['HIT FX', '命中特效'], hit: ['HIT FX', '命中特效'], particles: ['PARTICLES', '粒子主题'], ult: ['ULTIMATE', '大招过场'], result: ['RESULT', '结算动画'], cover: ['COVER', '书封'], stickers: ['STICKERS', '贴纸'], title: ['TITLE', '称号']};
  const SPECIES = [['echo-bat', '回声蝙蝠', 'listening'], ['shell-crab', '海螺小蟹', 'listening'], ['block-golem', '字母积木魔像', 'vocab'], ['sticky-ghost', '便利贴幽灵', 'vocab'], ['quiz-shroom', '题目蘑菇', 'vocab'],
    ['ink-slime', '迷糊史莱姆', 'grammar'], ['tangle-yarn', '时态毛线团', 'grammar'], ['clock-beetle', '时钟甲虫', 'grammar'], ['bookworm', '书虫', 'reading'], ['paper-fox', '纸狐', 'reading'],
    ['lost-crane', '迷路纸鹤', 'translation'], ['bridge-troll', '小桥怪', 'translation'], ['inkpot-imp', '墨水瓶小鬼', 'writing'], ['eraser-gnome', '橡皮小精灵', 'writing'], ['shaving-hog', '卷笔刀刺猬', 'writing'], ['fog-puff', '迷雾团', 'other']];
  function price(p = {}) {
    const parts = [];
    if (p.stars) parts.push([fmt(p.stars), 'stars']); if (p.seals) parts.push([fmt(p.seals), 'seals']); if (p.shards) parts.push([fmt(p.shards), 'shards']);
    const n = el('span', 'pks-price'); for (const [v, k] of parts) { const c = el('span', 'pks-price__c'); c.append(G().glyph(k), el('b', 'pkg-num', v)); n.append(c); }
    return n;
  }
  function pageHead(host, {kicker, title, back = 'today', sub}) {
    const head = el('header', 'pkb-page__head pks-head');
    const x = el('button', 'pkb-x', '×'); x.type = 'button'; const g0 = G(); const useStack = back === 'today' && g0?.goBack;
    x.setAttribute('aria-label', useStack ? g0.backLabel() : '返回'); x.addEventListener('click', () => (useStack ? g0.goBack() : desk()?.go(back)));
    const t = el('div'); t.append(el('small', 'pkb-kicker', kicker), el('h2', '', title)); if (sub) t.append(el('p', 'pks-sub', sub));
    const hud = el('div', 'pkb-page__hud'); head.append(x, t, hud); host.append(head);
    try { G().hud(hud, {compact: true}); } catch { /* HUD 可选 */ }
    return head;
  }
  // 商品 / 收藏品的预览：形态用立绘，其它用排版小卡（类型拉丁字 + 中文名），不画卡通图标。
  function preview(entry) {
    const box = el('div', 'pks-pv'); box.dataset.kind = entry.kind;
    if (entry.kind === 'form') { const i = el('img'); i.alt = ''; i.decoding = 'async'; const scene = window.__pinkieFormStage?.has(entry.itemId) ? G().art(`form/${entry.itemId}/ult`) : null; i.src = scene || G().portrait(entry.itemId); if (scene) box.classList.add('is-scene'); box.append(i); return box; }
    // 特效 / 书封：每件一个自己的徽记（形状分类别，图案和配色分单品），货架上悬停出「试一下」，点了真的播一遍。
    const lo = window.__pinkieLoadout, st = entry.itemId ? lo?.styleOf(entry.itemId) : null;
    if (st) {
      box.classList.add('is-fx'); if (st.pal) box.style.setProperty('--pv-a', st.pal[0]);
      const em = lo.emblem(entry.itemId); box.append(em);
      if (lo.canDemo(entry.itemId)) {
        const t = el('button', 'pkl-try'); t.type = 'button'; t.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.500v9l7.500-4.500z"/></svg>'; t.append(el('span', '', '试一下')); t.setAttribute('aria-label', `试一下 ${entry.name || itemName(entry.itemId)}`);
        t.addEventListener('click', e => { e.stopPropagation(); lo.demo(entry.itemId, em); });
        box.append(t);
      }
      return box;
    }
    // 碎片：一颗切面水晶；贴纸：那一包的贴纸原画；称号：月桂 + 绶带，名字写在绶带上。都是自己画的 SVG，不再是一个字。
    const svgOf = markup => { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstChild; };
    const name = entry.name || (entry.kind === 'shards' ? '通用碎片' : itemName(entry.itemId || ''));
    const [en] = entry.kind === 'shards' ? ['SHARDS'] : (KIND[entry.kind] || ['ITEM']);
    const card = el('div', 'pks-pv__card');
    if (entry.kind === 'shards') {
      card.append(el('small', '', en), svgOf('<svg class="pks-gem" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="pks-gem-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#BFD4FF"/><stop offset="1" stop-color="#8E6BD8"/></linearGradient></defs><path d="M32 4l20 18-20 38L12 22z" fill="url(#pks-gem-g)" stroke="#fff" stroke-width="1.500" stroke-linejoin="round"/><path d="M12 22h40M32 4l-8 18 8 38 8-38z" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.200" stroke-linejoin="round"/><path class="glint" d="M20 20l8-10" stroke="#fff" stroke-width="2.400" stroke-linecap="round"/></svg>'), el('span', 'pks-pv__name', name));
    } else if (entry.kind === 'stickers') {
      const ART = {pack1: 'cheer', pack2: 'combo', pack3: 'finish', pack4: 'focus', pack5: 'jar', pack6: 'leave', pack7: 'oops', pack8: 'finish'};
      const src = G().art?.(`sticker/${ART[String(entry.itemId || '').split(':')[1]] || 'cheer'}`);
      if (src) { const im = el('img', 'pks-pv__sticker'); im.alt = ''; im.decoding = 'async'; im.loading = 'lazy'; im.src = src; card.append(el('small', '', en), im, el('span', 'pks-pv__name', name)); }
      else card.append(el('small', '', en), el('b', 'pks-pv__glyph', [...name][0] || '贴'), el('span', 'pks-pv__name', name));
    } else if (entry.kind === 'title') {
      const short = [...name].slice(0, 5).join('');
      card.append(el('small', '', en), svgOf(`<svg class="pks-ribbon" viewBox="0 0 120 84" aria-hidden="true"><g class="laurel" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M36 58C22 48 18 30 26 14"/><path d="M84 58c14-10 18-28 10-44"/>${[0, 1, 2, 3].map(i => `<path d="M${25 + i * 3} ${22 + i * 10}c-8-1-11-6-12-12 7 0 11 4 12 12z" fill="currentColor" fill-opacity=".25"/><path d="M${95 - i * 3} ${22 + i * 10}c8-1 11-6 12-12-7 0-11 4-12 12z" fill="currentColor" fill-opacity=".25"/>`).join('')}</g><path class="star" d="M60 8l4.200 8.500 9.400 1.400-6.800 6.600 1.600 9.300L60 29.400l-8.400 4.400 1.600-9.300-6.800-6.600 9.400-1.400z" fill="currentColor"/><path class="tail" d="M10 50l12 4v22l-12-6 5-8zM110 50l-12 4v22l12-6-5-8z" fill="currentColor" fill-opacity=".55"/><path class="band" d="M18 46h84v24H18z" fill="currentColor"/><text x="60" y="63.500" text-anchor="middle" font-size="${short.length > 4 ? 12.500 : 14.500}" font-weight="900" fill="#fff" letter-spacing="1.500">${short.replace(/[<&>]/g, '')}</text></svg>`));
    } else card.append(el('small', '', en), el('b', 'pks-pv__glyph', [...name][0] || '藏'), el('span', 'pks-pv__name', name));
    box.append(card); return box;
  }

  // ───────────── 商店 ─────────────
  async function mountShop(host, ctx) {
    host.classList.add('pks-page', 'pks-shop');
    pageHead(host, {kicker: 'SHOP', title: '商店'});
    const g = G(); const body = el('div', 'pks-shelves'); host.append(body);
    body.append(el('p', 'pkb-empty', '正在摆货…'));
    let cat, s;
    try { [cat, s] = await Promise.all([g.call('shop.catalog'), g.refresh(), g.forms(), g.manifest()]).then(r => [r[0], r[1]]); }
    catch (e) { body.replaceChildren(el('p', 'pkb-empty', e.message || '商店暂时打不开')); return; }
    if (!host.isConnected) return;
    for (const list of Object.values(cat.shelves || {})) learnNames(list);
    paint();
    function paint() {
      body.replaceChildren();
      const refresh = new Date(cat.refreshAt); const hours = Math.max(0, Math.ceil((refresh - Date.now()) / 3600000));
      const shelves = [
        ['daily', '每日货架', 'DAILY', `北京 00:00 刷新 · 还有 ${hours} 小时`],
        ['limited', s.season?.name ? `${s.season.name} · 节气限定` : '节气限定', 'SEASONAL', s.quiet ? '考前一周不上限定' : s.season?.until ? `上架到 ${s.season.until.slice(5).replace('-', ' 月 ')} 日` : ''],
        ['permanent', '常驻货架', 'PERMANENT', '形态 · 命中特效 · 粒子主题 · 大招过场 · 结算动画（悬停可以试）'],
        ['seal', '金印专柜', 'SEAL COUNTER', '传说形态 · 过季复刻（万能碎片）'],
      ];
      for (const [key, title, en, note] of shelves) {
        const list = cat.shelves?.[key] || []; if (!list.length) continue;
        const sec = el('section', 'pks-shelf'); sec.dataset.shelf = key;
        const h = el('header', 'pkg-sec'); h.append(el('h3', '', title), el('span', 'pkg-sec__meta', note), el('small', 'pkg-kicker', en)); sec.append(h);
        const grid = el('div', 'pks-grid'); for (const it of list) grid.append(skuCard(it)); sec.append(grid); body.append(sec);
      }
    }
    function skuCard(it) {
      const c = el('article', 'pks-sku'); c.dataset.kind = it.kind; c.toggleAttribute('data-owned', Boolean(it.owned));
      const form = it.kind === 'form' ? g.formOf(it.itemId) : null;
      if (form) { c.dataset.rarity = form.rarity; c.style.setProperty('--tone', RARITY[form.rarity]?.tone || '#B9AEA4'); c.style.setProperty('--fa', form.palette?.[0] || '#F7A8C8'); }
      c.append(preview(it));
      const info = el('div', 'pks-sku__info');
      const tag = el('small', 'pkg-kicker', form ? `${RARITY[form.rarity]?.label || form.rarity} · ${KIND.form[1]}` : (KIND[String(it.itemId || '').split(':')[0]] || KIND[it.kind] || ['', ''])[1]);
      info.append(tag, el('b', 'pks-sku__name', it.name));
      if (it.desc) info.append(el('span', 'pks-sku__desc', it.desc));
      const feel = it.itemId ? window.__pinkieLoadout?.tagOf(it.itemId) : ''; if (feel && !it.desc) info.append(el('span', 'pkl-tag', feel));
      const foot = el('div', 'pks-sku__foot');
      if (it.owned) foot.append(el('span', 'pks-owned', '已拥有'));
      else {
        const pr = price(it.price); if (it.discount) c.append(el('em', 'pks-off', `${Math.round(it.discount * 10)} 折`));
        foot.append(pr);
        const wish = el('button', 'pks-pin'); wish.type = 'button'; const pinned = s.wishlist?.sku === it.sku; wish.setAttribute('aria-pressed', String(pinned)); wish.title = pinned ? '从心愿单取下' : '钉到心愿单';
        wish.append(el('span', '', pinned ? '已钉' : '钉住'));
        wish.addEventListener('click', async () => { try { await g.call('wishlist.set', {sku: pinned ? null : it.sku}); s = await g.refresh(); paint(); } catch (e) { g.toast(e.message); } });
        const buy = el('button', 'pkg-btn pks-buy', '购买'); buy.type = 'button'; let armed = false;
        buy.addEventListener('click', async () => {
          if (!armed) { armed = true; buy.textContent = '确认购买'; buy.classList.add('is-armed'); setTimeout(() => { if (armed && buy.isConnected) { armed = false; buy.textContent = '购买'; buy.classList.remove('is-armed'); } }, 3200); return; }
          buy.disabled = true; buy.textContent = '…';
          try {
            const r = await g.call('shop.buy', {sku: it.sku});
            await g.play(r.awards || [], {from: c});
            [cat, s] = await Promise.all([g.call('shop.catalog'), g.refresh()]); paint();
          } catch (e) { buy.disabled = false; armed = false; buy.textContent = '购买'; buy.classList.remove('is-armed'); g.toast(e.message || '没买成'); const why = c.querySelector('.pks-why') || el('p', 'pks-why'); why.textContent = g.plain?.(e.message) ?? (e.message || ''); c.append(why); }
        });
        foot.append(wish, buy);
      }
      c.append(info, foot);
      return c;
    }
  }

  // ───────────── 衣橱 ─────────────
  async function mountWardrobe(host, ctx) {
    host.classList.add('pks-page', 'pks-wardrobe');
    pageHead(host, {kicker: 'FORMS', title: '衣橱'});
    const g = G(); const wrap = el('div', 'pks-wr'); host.append(wrap);
    wrap.append(el('p', 'pkb-empty', '正在打开衣橱…'));
    let forms, s;
    try { [forms, s] = await Promise.all([g.forms(true), g.refresh(), g.manifest()]); } catch (e) { wrap.replaceChildren(el('p', 'pkb-empty', e.message)); return; }
    if (!host.isConnected) return;
    const local = ctx.local?.() || {}; let pick = local.wardrobePick || s.form.equipped;
    paint();
    function paint() {
      wrap.replaceChildren();
      const detail = el('section', 'pks-wr__detail'), grid = el('section', 'pks-wr__grid');
      const shown = forms.filter(f => !f.retired || f.owned), owned = shown.filter(f => f.owned).length;
      const gh = el('header', 'pkg-sec'); gh.append(el('h3', '', '全部形态'), el('span', 'pkg-sec__meta', `${owned} / ${shown.length}`), el('small', 'pkg-kicker', 'COLLECTION')); grid.append(gh);
      // v3：衣橱分两栏——变身（身体 / 物种变了）和时装（穿戴，发型跟着变）。退场的旧换装只给拥有的人看，排在时装最后。
      const tile = f => {
        const b = el('button', 'pks-tile'); b.type = 'button'; b.dataset.rarity = f.rarity; b.dataset.form = f.id; b.toggleAttribute('data-owned', f.owned); b.toggleAttribute('data-equipped', f.equipped); b.setAttribute('aria-pressed', String(f.id === pick));
        b.style.setProperty('--tone', RARITY[f.rarity]?.tone || '#B9AEA4'); b.style.setProperty('--fa', f.palette?.[0] || '#F7A8C8');
        const real = g.cache.manifest?.[`form/${f.id}/portrait`] || g.avatarArt?.(f.id); if (f.owned || real) { const i = el('img'); i.alt = ''; i.decoding = 'async'; i.src = g.iconArt(f.id); if (g.avatarArt?.(f.id)) i.classList.add('is-avatar'); b.append(i); } else b.append(el('span', 'pks-tile__q', '？'));
        b.append(el('small', 'pks-tile__r', RARITY[f.rarity]?.label || f.rarity), el('span', 'pks-tile__n', f.owned || window.__pinkieFormStage?.has(f.id) || !f.retired ? f.name : '？？？'));
        if (f.equipped) b.append(el('em', 'pks-tile__on', '装备中'));
        b.setAttribute('aria-label', f.owned ? f.name : `${f.name}，未获得：${f.howToGet || ''}`);
        b.addEventListener('click', () => { pick = f.id; local.wardrobePick = f.id; paint(); });
        return b;
      };
      const cols = el('div', 'pks-wr__cols');
      for (const [look, zh, en] of [['transform', '变身', 'TRANSFORM'], ['outfit', '时装', 'OUTFIT']]) {
        const mine = forms.filter(f => (f.retired ? look === 'outfit' && f.owned : (f.look || 'transform') === look));
        if (!mine.length) continue;
        const col = el('div', 'pks-wr__col'); col.dataset.look = look;
        const ch = el('header', 'pks-wr__colhead'); ch.append(el('small', 'pkg-kicker', en), el('b', '', zh), el('span', 'pkg-num', `${mine.filter(f => f.owned).length} / ${mine.length}`));
        const list = el('div', 'pks-wr__list');
        for (const f of mine) list.append(tile(f));
        col.append(ch, list); cols.append(col);
      }
      grid.append(cols);
      // 套装
      const sets = el('div', 'pks-sets');
      for (const st of [['v2', '八面碧琪', ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious']]]) {
        const have = st[2].filter(id => forms.find(f => f.id === id)?.owned).length;
        const row = el('div', 'pks-set'); row.append(el('b', '', st[1]), el('span', 'pkg-num', `${have} / ${st[2].length}`), el('i', 'pks-set__bar')); row.querySelector('i').style.setProperty('--p', (have / st[2].length * 100) + '%'); sets.append(row);
      }
      grid.append(sets);
      wrap.append(detail, grid);
      paintDetail(detail, forms.find(f => f.id === pick) || forms[0]);
    }
    function paintDetail(box, f) {
      if (!f) return;
      box.style.setProperty('--fa', f.palette?.[0]); box.style.setProperty('--fb', f.palette?.[1]); box.style.setProperty('--fc', f.palette?.[2]);
      box.dataset.owned = String(f.owned);
      const art = el('div', 'pks-wr__art'); const img = el('img'); img.alt = f.name; img.decoding = 'async'; img.src = g.portrait(f.id);
      const FS = window.__pinkieFormStage; let live = null;
      wrap.__pkFormStage?.destroy?.(); wrap.__pkFormStage = null;
      if (FS?.has(f.id)) {
        // 形态 v2：没拥有的也能看到活的样子（剪影不再藏），这才想要
        art.classList.add('is-live'); live = FS.mount(art, f.id, {focus: .5, still: fx()?.settings?.().biqi === false}); wrap.__pkFormStage = live;
        const form = el('p', 'pks-wr__form', f.form || ''); if (f.form) art.append(form);
      } else { art.append(img); if (f.owned) g.ambient?.(art, f); }
      if (!f.owned && !live) art.append(el('span', 'pks-wr__q', '？'));
      const info = el('div', 'pks-wr__info');
      info.append(el('small', 'pkg-kicker', `${RARITY[f.rarity]?.label || f.rarity} · ${f.series === 'mode' ? 'MODE' : f.season ? 'SEASONAL' : 'FORM'}`), el('h3', 'pks-wr__name', f.owned || live ? f.name : '还没遇见'));
      { const b = el('p', 'pks-wr__bonus'); b.append(g.bonusText ? g.bonusText(f.bonus?.text) : document.createTextNode(f.bonus?.text || '')); info.append(b); }
      if (f.skill) { const sk = el('p', 'pks-wr__skill'); const S = window.__pinkieGameStage; if (S) sk.append(S.icon(({eliminate: 'lens', heal: 'heart', shield: 'shield', double: 'twin'})[f.skill.kind] || 'spark')); sk.append(el('b', '', `战斗技能 · ${f.skill.name}`), el('span', '', f.skill.text)); info.append(sk); }
      const pal = el('div', 'pks-wr__pal'); for (const c of f.palette || []) { const d = el('i'); d.style.background = c; pal.append(d); } info.append(pal);
      if (f.owned) {
        const lv = f.level || {lv: 1, xp: 0, next: 100};
        const aff = el('div', 'pks-meter'); aff.append(el('span', '', `亲密度 Lv.${lv.lv}`), el('em', 'pkg-num', lv.next ? `${fmt(lv.xp)} / ${fmt(lv.next)}` : 'MAX'), el('i', 'pks-meter__bar'));
        aff.querySelector('i').style.setProperty('--p', (lv.next ? Math.min(100, lv.xp / lv.next * 100) : 100) + '%'); info.append(aff);
        const aw = f.awaken || {};
        const awBox = el('div', 'pks-awaken'); awBox.toggleAttribute('data-done', f.awakened);
        awBox.append(el('small', 'pkg-kicker', 'AWAKENING'), el('b', '', f.awakened ? '已觉醒' : aw.text || '觉醒挑战'));
        if (!f.awakened) {
          const steps = el('ul', 'pks-awaken__steps');
          const li = (ok, text) => { const n = el('li', '', text); n.dataset.ok = String(Boolean(ok)); steps.append(n); };
          li(lv.lv >= 10, `亲密度 Lv.10（现在 Lv.${lv.lv}）`); li((aw.progress || 0) >= (aw.count || 1), `${aw.text || '挑战'}（${aw.progress || 0} / ${aw.count || 1}）`);
          const shards = (s.wallet.shards?.[f.id] || 0) + (s.wallet.shards?.any || 0); li(shards >= (aw.shards || 20), `${aw.shards || 20} 碎片（有 ${shards}）`);
          awBox.append(steps);
          const go = el('button', 'pkg-btn', '觉醒'); go.type = 'button'; go.disabled = !aw.ready || shards < (aw.shards || 20);
          go.addEventListener('click', async () => { go.disabled = true; try { const r = await g.call('forms.awaken', {formId: f.id}); await g.play(r.awards || []); forms = await g.forms(true); s = await g.refresh(); paint(); } catch (e) { go.disabled = false; g.toast(e.message); } });
          awBox.append(go);
        }
        info.append(awBox);
        const act = el('div', 'pks-wr__act');
        const eq = el('button', 'pkg-btn', f.equipped ? '装备中' : '装备这个形态'); eq.type = 'button'; eq.disabled = f.equipped;
        eq.addEventListener('click', async () => { eq.disabled = true; const prev = s.form.equipped; try { await g.call('forms.equip', {formId: f.id}); try { fx()?.sfx('sparkle', {form: g.fxForm(f)}); } catch { /* ignore */ } if (live && prev && prev !== f.id) await live.play?.(prev); else if (!live) { try { fx()?.burst(f.particle || 'sparkle', img, {palette: f.palette, scale: .9}); } catch { /* ignore */ } } forms = await g.forms(true); s = await g.refresh(); paint(); } catch (e) { eq.disabled = false; g.toast(e.message); } });
        const demo = el('button', 'pkb-link', '看一眼大招'); demo.type = 'button';
        demo.addEventListener('click', () => fx()?.cinematic(f.ult || 'burst', {text: f.name, sub: String(f.bonus?.text || '').replace(/\s*(⭐|🟡|💎)\s*/gu, m => ({'⭐': ' 星星 ', '🟡': ' 金印 ', '💎': ' 碎片 '})[m.trim()] || ' ').replace(/\s+/g, ' ').trim(), kicker: f.name, art: g.ultArt(f.id) || g.portrait(f.id), palette: f.palette, particle: f.particle, form: g.fxForm(f)}));
        act.append(eq, demo); info.append(act);
      } else {
        const how = el('div', 'pks-how'); how.append(el('small', 'pkg-kicker', 'HOW TO GET'), el('p', '', f.howToGet || '商店 / 扭蛋'));
        const go = el('button', 'pkb-link', /扭蛋/.test(f.howToGet || '') ? '去扭蛋' : '去商店'); go.type = 'button'; go.addEventListener('click', () => g.open(/扭蛋/.test(f.howToGet || '') ? 'gacha' : 'shop'));
        how.append(go); info.append(how);
      }
      // 外观装备（特效包 / 书封 / 称号）
      const items = s.items?.owned || [];
      if (items.length) {
        const eqBox = el('div', 'pks-items'); eqBox.append(el('small', 'pkg-kicker', 'LOADOUT'));
        const groups = {};
        for (const id of items) { const slot = id.split(':')[0]; (groups[slot] ||= []).push(id); }
        for (const [slot, ids] of Object.entries(groups)) {
          if (slot === 'stickers') continue;
          const lo = window.__pinkieLoadout;
          if (lo && lo.tables[slot]) {
            // 一排徽记：点一下装上并当场播一遍，再点「跟随」卸下
            const row = el('div', 'pkl-slot'); row.append(el('span', '', (KIND[slot] || ['', slot])[1]));
            const list = el('div', 'pkl-slot__list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', (KIND[slot] || ['', slot])[1]);
            const now = el('p', 'pkl-slot__now');
            const paintRow = () => { const on = s.items?.equipped?.[slot] || ''; list.querySelectorAll('.pkl-pick').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.id || '') === on))); now.textContent = on ? `${itemName(on)} · ${lo.tagOf(on)}` : '跟随形态：用现在这个形态自带的'; };
            const pickBtn = id => {
              const b = el('button', 'pkl-pick' + (id ? '' : ' is-auto')); b.type = 'button'; b.dataset.id = id; b.title = id ? itemName(id) : '跟随形态'; b.setAttribute('aria-label', b.title);
              if (id) b.append(lo.emblem(id, {size: 'sm'})); else b.textContent = '跟随';
              b.addEventListener('click', async () => { try { await g.call('items.equip', {slot, itemId: id || null}); s = await g.refresh(); paintRow(); if (id) lo.demo(id, b); } catch (e) { g.toast(e.message); } });
              return b;
            };
            list.append(pickBtn('')); for (const id of ids) list.append(pickBtn(id));
            row.append(list, now); eqBox.append(row); paintRow();
            continue;
          }
          const row = el('div', 'pks-items__row'); row.append(el('span', '', (KIND[slot] || ['', slot])[1]));
          const sel = el('select'); sel.setAttribute('aria-label', (KIND[slot] || ['', slot])[1]);
          sel.append(new Option('跟随形态', ''));
          for (const id of ids) sel.append(new Option(itemName(id), id, false, s.items?.equipped?.[slot] === id));
          sel.addEventListener('change', async () => { try { await g.call('items.equip', {slot, itemId: sel.value || null}); s = await g.refresh(); } catch (e) { g.toast(e.message); } });
          row.append(sel); eqBox.append(row);
        }
        info.append(eqBox);
      }
      box.append(art, info);
    }
  }
  // 收藏品名字：后端带回的 name 优先（扭蛋结果 / 奖池 / 货架都会记下来），没有时用类型名，不显示英文 id。
  function itemName(id) { const names = G().cache.itemNames || {}; if (names[id]) return names[id]; const slot = String(id || '').split(':')[0]; return (KIND[slot] || [null, '收藏品'])[1]; }
  function learnNames(list) { const names = G().cache.itemNames ||= {}; for (const it of list || []) if (it?.itemId && it.name && it.kind !== 'form') names[it.itemId] = it.name; }

  // ───────────── 图鉴 ─────────────
  async function mountCodex(host, ctx) {
    host.classList.add('pks-page', 'pks-codex');
    pageHead(host, {kicker: 'CODEX', title: '图鉴'});
    const g = G(); const local = ctx.local?.() || {}; let tab = local.codexTab || 'monsters';
    const tabs = el('div', 'pkg-seg'); const body = el('div', 'pks-codex__body'); host.append(tabs, body);
    for (const [id, label] of [['monsters', '错题怪'], ['forms', '形态'], ['items', '收藏品']]) { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-selected', String(id === tab)); b.addEventListener('click', () => { tab = id; local.codexTab = id; tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); load(); }); tabs.append(b); }
    await Promise.all([g.manifest(), g.forms().catch(() => []), g.state().catch(() => null)]);
    load();
    async function load() {
      body.replaceChildren(el('p', 'pkb-empty', '翻开图鉴…'));
      if (tab === 'monsters') {
        let caught = [], active = [];
        try { [caught, active] = await Promise.all([g.call('monsters.list', {filter: 'captured'}).then(r => r.monsters || []), g.call('monsters.list', {filter: 'active'}).then(r => r.monsters || [])]); } catch { /* 空图鉴 */ }
        body.replaceChildren();
        const seen = new Set([...caught, ...active].map(m => m.species)), got = new Set(caught.map(m => m.species));
        body.append(el('p', 'pks-codex__lede', `收服 ${caught.length} 只 · 见过 ${seen.size} / ${SPECIES.length} 种。每收服 10 只得 1 金印。`));
        const grid = el('div', 'pks-dex');
        for (const [sp, name, region] of SPECIES) {
          const c = el('article', 'pks-dex__card'); c.dataset.state = got.has(sp) ? 'caught' : seen.has(sp) ? 'seen' : 'unknown';
          const pic = el('div', 'pks-dex__art'); const src = g.art(`monster/${sp}`); if (src) { const i = el('img'); i.alt = ''; i.decoding = 'async'; i.src = src; pic.append(i); }
          const n = caught.filter(m => m.species === sp).length;
          c.append(pic, el('small', 'pkg-kicker', region.toUpperCase()), el('b', '', seen.has(sp) ? name : '？？？'), el('em', '', got.has(sp) ? `收服 ${n}` : seen.has(sp) ? '遇见过' : '没遇见'));
          grid.append(c);
        }
        body.append(grid);
      } else if (tab === 'forms') {
        const forms = await g.forms(true).catch(() => []);
        body.replaceChildren(el('p', 'pks-codex__lede', `${forms.filter(f => f.owned).length} / ${forms.length} 个形态 · ${forms.filter(f => f.awakened).length} 个觉醒`));
        const grid = el('div', 'pks-dex is-forms');
        for (const f of forms) { const c = el('article', 'pks-dex__card'); c.dataset.state = f.awakened ? 'caught' : f.owned ? 'seen' : 'unknown'; c.style.setProperty('--tone', RARITY[f.rarity]?.tone); const pic = el('div', 'pks-dex__art'); const i = el('img'); i.alt = ''; i.decoding = 'async'; i.src = g.iconArt(f.id); if (g.avatarArt?.(f.id)) i.classList.add('is-avatar'); pic.append(i); c.append(pic, el('small', 'pkg-kicker', RARITY[f.rarity]?.label || f.rarity), el('b', '', f.owned ? f.name : '？？？'), el('em', '', f.awakened ? '已觉醒' : f.owned ? `Lv.${f.level?.lv || 1}` : f.howToGet || '')); grid.append(c); }
        body.append(grid);
      } else {
        const s = await g.refresh().catch(() => null); const owned = new Set(s?.items?.owned || []);
        let cat = null; try { cat = await g.call('shop.catalog'); } catch { /* 没货架也能看已有的 */ }
        const names = G().cache.itemNames ||= {};
        for (const list of Object.values(cat?.shelves || {})) for (const it of list) if (it.kind !== 'form') names[it.itemId] = it.name;
        body.replaceChildren(el('p', 'pks-codex__lede', `收藏品 ${owned.size} 件（命中特效、粒子主题、大招过场、结算动画、书封、贴纸、称号）。`));
        const grid = el('div', 'pks-dex is-items');
        const ids = [...owned]; if (!ids.length) grid.append(el('p', 'pkb-empty', '还没有收藏品。商店每日货架和扭蛋会掉。'));
        for (const id of ids) { const slot = id.split(':')[0]; const c = el('article', 'pks-dex__card'); c.dataset.state = 'caught'; c.append(preview({kind: slot, itemId: id}), el('small', 'pkg-kicker', (KIND[slot] || ['ITEM'])[0]), el('b', '', itemName(id)), el('em', '', s?.items?.equipped?.[slot] === id ? '装备中' : '')); grid.append(c); }
        body.append(grid);
      }
    }
  }

  // ───────────── 扭蛋 ─────────────
  const CAPSULE = {N: ['#D8CFC5', '#EFE8DF', 0], R: ['#5E7FC8', '#EEF0F6', .25], SR: ['#B4417F', '#F6ECF2', .55], SSR: ['#D49A2F', '#FFF4DC', 1]};
  function registerGachaScene() {
    const engine = fx(); if (!engine?.registerScene || registerGachaScene.done) return; registerGachaScene.done = true;
    engine.registerScene('gacha', async ({THREE, addons, host, opts, settings}) => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, .1, 60); camera.position.set(0, 2.25, 8.2); camera.lookAt(0, 1.65, 0);
      const palette = opts.palette || ['#F7A8C8', '#DB1F74', '#FFE36E'];
      // 背景：深色天鹅绒 + 一圈顶光，画在画布上做成贴图（不透明场景，跟页面主题无关）。
      const bgc = document.createElement('canvas'); bgc.width = 16; bgc.height = 256; const bx = bgc.getContext('2d');
      const grad = bx.createLinearGradient(0, 0, 0, 256); grad.addColorStop(0, '#1A1220'); grad.addColorStop(.55, '#2A1A2C'); grad.addColorStop(1, '#120C16'); bx.fillStyle = grad; bx.fillRect(0, 0, 16, 256);
      const bgTex = new THREE.CanvasTexture(bgc); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
      // 环境贴图：暗房间 + 三块柔光箱（PMREM），给漆面和玻璃真实的反射。
      const envScene = new THREE.Scene(); envScene.background = new THREE.Color('#0d0a10');
      const box = (w, h, x, y, z, ry, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: c, side: THREE.DoubleSide})); m.position.set(x, y, z); m.rotation.y = ry; m.lookAt(0, 0, 0); envScene.add(m); };
      box(6, 3, -6, 5, 4, 0, new THREE.Color(3.2, 3.0, 2.8)); box(3, 6, 7, 2, -2, 0, new THREE.Color(.8, .9, 1.4)); box(10, 1.2, 0, 8, -3, 0, new THREE.Color(1.4, 1.3, 1.25));
      const pmrem = new THREE.PMREMGenerator(engineRenderer()); const envRT = pmrem.fromScene(envScene, .035); scene.environment = envRT.texture; pmrem.dispose();
      // 灯：主光（软阴影）+ 冷色轮廓光 + 很暗的天光。
      const key = new THREE.SpotLight('#fff1e2', 160, 30, .55, .75, 1.6); key.position.set(-3.6, 7.2, 5.4); key.target.position.set(0, 1.2, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -.0004; key.shadow.radius = 6; scene.add(key, key.target);
      const rim = new THREE.DirectionalLight('#9fb4ff', 1.6); rim.position.set(4, 3.5, -4); scene.add(rim);
      scene.add(new THREE.HemisphereLight('#3b2a3f', '#0a070c', .6));
      const glowLight = new THREE.PointLight('#ffffff', 0, 6, 1.6); glowLight.position.set(0, .6, 1.6); scene.add(glowLight);
      // 地面接影子
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({opacity: .45})); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshBasicMaterial({color: '#3a2638', transparent: true, opacity: .55, depthWrite: false})); pool.rotation.x = -Math.PI / 2; pool.position.y = .002; scene.add(pool);
      // 机身：漆面圆角盒 + 金色描边 + 铭牌 + 把手 + 出口
      const deep = new THREE.Color(palette[1]).lerp(new THREE.Color('#1a0b14'), .35);
      const lacquer = new THREE.MeshPhysicalMaterial({color: deep, roughness: .32, metalness: .05, clearcoat: 1, clearcoatRoughness: .12, envMapIntensity: 1.1});
      const gold = new THREE.MeshStandardMaterial({color: '#d8b06a', metalness: 1, roughness: .28, envMapIntensity: 1.3});
      const dark = new THREE.MeshStandardMaterial({color: '#140d12', roughness: .6, metalness: .2});
      const RB = addons?.RoundedBoxGeometry;
      const bodyGeo = RB ? new RB(1.9, 1.7, 1.55, 5, .16) : new THREE.BoxGeometry(1.9, 1.7, 1.55);
      const machine = new THREE.Group(); scene.add(machine);
      const body = new THREE.Mesh(bodyGeo, lacquer); body.position.y = .85; body.castShadow = true; body.receiveShadow = true; machine.add(body);
      const plinth = new THREE.Mesh(RB ? new RB(2.1, .18, 1.75, 4, .06) : new THREE.BoxGeometry(2.1, .18, 1.75), dark); plinth.position.y = .09; plinth.castShadow = true; plinth.receiveShadow = true; machine.add(plinth);
      const band = new THREE.Mesh(RB ? new RB(1.96, .06, 1.61, 3, .03) : new THREE.BoxGeometry(1.96, .06, 1.61), gold); band.position.y = 1.62; machine.add(band);
      // 铭牌（画布贴图：衬线中文 + 拉丁窄体小字）
      const plateC = document.createElement('canvas'); plateC.width = 512; plateC.height = 160; const px = plateC.getContext('2d');
      px.fillStyle = '#1b1117'; px.fillRect(0, 0, 512, 160); px.strokeStyle = 'rgba(216,176,106,.75)'; px.lineWidth = 2; px.strokeRect(10, 10, 492, 140); px.strokeStyle = 'rgba(216,176,106,.3)'; px.strokeRect(18, 18, 476, 124);
      px.fillStyle = '#f2e3c4'; px.font = '900 56px "Songti SC","STSong","Noto Serif SC",serif'; px.textAlign = 'center'; px.fillText(opts.title || '星星扭蛋', 256, 92);
      px.fillStyle = 'rgba(216,176,106,.85)'; px.font = '600 18px "Avenir Next Condensed","DIN Condensed",sans-serif'; px.fillText((opts.kicker || 'STAR GACHA').split('').join(String.fromCharCode(8202)), 256, 128);
      const plateTex = new THREE.CanvasTexture(plateC); plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 4;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .39), new THREE.MeshStandardMaterial({map: plateTex, roughness: .45, metalness: .1})); plate.position.set(0, 1.28, .777); machine.add(plate);
      const knob = new THREE.Group(); knob.position.set(-.42, .62, .79); machine.add(knob);
      const knobDisk = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .1, 48), gold); knobDisk.rotation.x = Math.PI / 2; knobDisk.castShadow = true; knob.add(knobDisk);
      const knobBar = new THREE.Mesh(RB ? new RB(.46, .1, .1, 2, .04) : new THREE.BoxGeometry(.46, .1, .1), gold); knobBar.position.z = .08; knob.add(knobBar);
      const chute = new THREE.Mesh(RB ? new RB(.52, .42, .2, 3, .08) : new THREE.BoxGeometry(.52, .42, .2), dark); chute.position.set(.42, .5, .72); machine.add(chute);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(.58, .04, .22), gold); lip.position.set(.42, .29, .82); machine.add(lip);
      // 玻璃罩 + 金色颈圈
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(.72, .78, .16, 64), gold); collar.position.y = 1.78; collar.castShadow = true; machine.add(collar);
      const glass = new THREE.MeshPhysicalMaterial({color: '#ffffff', roughness: .04, metalness: 0, transparent: true, opacity: .16, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 2.2, depthWrite: false});
      const dome = new THREE.Mesh(new THREE.SphereGeometry(.98, 64, 48, 0, Math.PI * 2, 0, Math.PI * .8), glass); dome.position.y = 2.62; dome.renderOrder = 2; machine.add(dome);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .12, 32), gold); cap.position.y = 3.62; machine.add(cap);
      // 胶囊：两个半球（上色 + 下奶白），实例化，罩子里堆着。
      const half = new THREE.SphereGeometry(.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const tones = ['#B4417F', '#5E7FC8', '#D49A2F', '#4E9A8E', '#8E6BD8', '#D8CFC5', palette[1]];
      const N = 30, tops = new THREE.InstancedMesh(half, new THREE.MeshPhysicalMaterial({roughness: .25, clearcoat: .8, clearcoatRoughness: .2}), N), bottoms = new THREE.InstancedMesh(half, new THREE.MeshPhysicalMaterial({color: '#f3ece4', roughness: .3, clearcoat: .6}), N);
      tops.castShadow = bottoms.castShadow = true; machine.add(tops, bottoms);
      const rest = []; const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      for (let i = 0; i < N; i++) { const layer = Math.floor(i / 10), a = (i % 10) / 10 * Math.PI * 2 + layer * .4, r = (.62 - layer * .14) * (.6 + rng() * .4); rest.push({p: new THREE.Vector3(Math.cos(a) * r, 2.0 + layer * .27 + rng() * .06, Math.sin(a) * r), q: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6), c: new THREE.Color(tones[i % tones.length])}); tops.setColorAt(i, rest[i].c); }
      const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), one = new THREE.Vector3(1, 1, 1);
      function layoutPile(j = 0, t = 0) {
        for (let i = 0; i < N; i++) { const r = rest[i]; const p = r.p.clone(); if (j) { p.x += Math.sin(t * 31 + i) * .03 * j; p.y += Math.abs(Math.sin(t * 23 + i * 1.7)) * .05 * j; } tmpQ.setFromEuler(new THREE.Euler(r.q.x + j * Math.sin(t * 9 + i) * .6, r.q.y, r.q.z)); tmpM.compose(p, tmpQ, one); tops.setMatrixAt(i, tmpM); tmpM.compose(p, tmpQ.clone().multiply(flip), one); bottoms.setMatrixAt(i, tmpM); }
        tops.instanceMatrix.needsUpdate = bottoms.instanceMatrix.needsUpdate = true;
      }
      layoutPile(); tops.instanceColor.needsUpdate = true;
      // 光晕贴图（径向渐变，叠加混合）
      const haloC = document.createElement('canvas'); haloC.width = haloC.height = 128; const hx = haloC.getContext('2d'); const hg = hx.createRadialGradient(64, 64, 0, 64, 64, 64); hg.addColorStop(0, 'rgba(255,255,255,1)'); hg.addColorStop(.25, 'rgba(255,255,255,.45)'); hg.addColorStop(1, 'rgba(255,255,255,0)'); hx.fillStyle = hg; hx.fillRect(0, 0, 128, 128);
      const haloTex = new THREE.CanvasTexture(haloC);
      const bloom = Math.max(.25, settings.bloom ?? 1);
      // 动画系统
      const tasks = []; let jiggle = 0, knobSpin = 0, time = 0; const caps = new THREE.Group(); scene.add(caps);
      const ease = {io: k => k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2, out: k => 1 - (1 - k) ** 4};
      // 每加一段动画就叫醒引擎（引擎只在有东西要动时跑 rAF）。
      function tween(dur, fn, delay = 0) { return new Promise(res => { tasks.push({t0: time + delay, dur, fn, res}); fx()?._kick?.(); }); }
      function makeCapsule(rarity) {
        const [c1, c2, glow] = CAPSULE[rarity] || CAPSULE.N;
        const g = new THREE.Group();
        const topM = new THREE.MeshPhysicalMaterial({color: c1, roughness: .22, clearcoat: 1, clearcoatRoughness: .12, emissive: new THREE.Color(c1), emissiveIntensity: glow * .35});
        const top = new THREE.Mesh(half, topM), bot = new THREE.Mesh(half, new THREE.MeshPhysicalMaterial({color: c2, roughness: .3, clearcoat: .7})); bot.rotation.x = Math.PI; top.castShadow = bot.castShadow = true;
        const seam = new THREE.Mesh(new THREE.TorusGeometry(.17, .008, 8, 48), gold); seam.rotation.x = Math.PI / 2;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: haloTex, color: new THREE.Color(c1).lerp(new THREE.Color('#ffffff'), .3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0}));
        halo.scale.setScalar(.01);
        g.add(top, bot, seam, halo); g.userData = {top, halo, rarity, glow}; g.scale.setScalar(1.25); caps.add(g); return g;
      }
      async function dropOne(rarity, slot, total) {
        const g = makeCapsule(rarity); const start = new THREE.Vector3(.42, .5, .82);
        const cols = total > 1 ? 5 : 1, row = Math.floor(slot / cols), col = slot % cols;
        const end = total > 1 ? new THREE.Vector3((col - 2) * .5, .22, 1.55 + row * .5) : new THREE.Vector3(0, .22, 1.7);
        g.position.copy(start);
        await tween(.62, k => {
          const x = start.x + (end.x - start.x) * ease.out(k), z = start.z + (end.z - start.z) * ease.out(k);
          // 下落 + 两次轻弹（有阻尼的抛物线，不夸张）
          const fall = k < .45 ? 1 - (k / .45) ** 2 : k < .75 ? .14 * Math.sin((k - .45) / .3 * Math.PI) : .04 * Math.sin((k - .75) / .25 * Math.PI);
          g.position.set(x, end.y + Math.max(0, fall) * (start.y - end.y + .1), z); g.rotation.x = -k * 7; g.rotation.z = k * 2;
        });
        try { fx()?.sfx('coin'); } catch { /* ignore */ }
        return g;
      }
      async function glowUp(g, i = 0) {
        const {halo, glow, rarity} = g.userData; if (!glow) return;
        const c = new THREE.Color(CAPSULE[rarity][0]);
        await tween(.5, k => { halo.material.opacity = k * (.5 + glow * .5) * bloom; halo.scale.setScalar(.6 + k * (.6 + glow * 1.4)); if (rarity === 'SSR' || rarity === 'SR') { glowLight.color.copy(c); glowLight.intensity = Math.max(glowLight.intensity, k * glow * 9); glowLight.position.copy(g.position).add(new THREE.Vector3(0, .5, .4)); } }, i * .05);
      }
      async function openOne(g) {
        const {top, halo, glow} = g.userData; const y0 = top.position.y;
        await tween(.42, k => { const e = ease.out(k); top.position.y = y0 + e * .42; top.rotation.x = -e * 1.1; top.position.z = -e * .1; halo.material.opacity = Math.min(1, halo.material.opacity + k * .3) * (1 - k * .6); halo.scale.setScalar(halo.scale.x + k * .05 * (1 + glow)); });
      }
      const inst = {
        opaque: false,
        animating: () => tasks.length > 0,
        resize(w, h) { camera.aspect = w / h; camera.fov = w / h < 1.1 ? 40 : 30; camera.updateProjectionMatrix(); },
        update(dt) {
          time += dt;
          for (let i = tasks.length - 1; i >= 0; i--) { const t = tasks[i]; if (time < t.t0) continue; const k = Math.min(1, (time - t.t0) / t.dur); t.fn(k); if (k >= 1) { tasks.splice(i, 1); t.res(); } }
          if (jiggle > 0) layoutPile(jiggle, time);
          knob.rotation.z = -knobSpin;
        },
        render(r) {
          const prev = {tm: r.toneMapping, cs: r.outputColorSpace, sh: r.shadowMap.enabled, exp: r.toneMappingExposure};
          r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
          r.render(scene, camera);
          r.toneMapping = prev.tm; r.outputColorSpace = prev.cs; r.shadowMap.enabled = prev.sh; r.toneMappingExposure = prev.exp;
        },
        async pull(results) {
          // 把手转一圈，罩子里的胶囊跟着晃。
          for (const c of [...caps.children]) caps.remove(c); glowLight.intensity = 0;
          try { fx()?.sfx('whoosh'); } catch { /* ignore */ }
          await tween(.95, k => { knobSpin = ease.io(k) * Math.PI * 2; jiggle = Math.sin(k * Math.PI); });
          jiggle = 0; layoutPile();
          const total = results.length, made = [];
          for (let i = 0; i < total; i++) { made.push(dropOne(results[i].rarity, i, total)); await tween(total > 1 ? .16 : .01, () => {}); }
          const caps2 = await Promise.all(made);
          await Promise.all(caps2.map((g, i) => glowUp(g, i)));
          await tween(.35, () => {});
          return {open: async () => { await Promise.all(caps2.map((g, i) => tween(.01, () => {}, i * .06).then(() => openOne(g)))); }};
        },
        dispose() { envRT.dispose(); bgTex.dispose(); plateTex.dispose(); haloTex.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()); }); },
      };
      inst.resize(host.clientWidth || 800, host.clientHeight || 600);
      return inst;
    });
  }
  // 引擎没有暴露 renderer：PMREM 需要它，从画布上取（同一个上下文）。
  function engineRenderer() { return fx()?._renderer?.() || window.__pinkieGameFxRenderer; }

  async function mountGacha(host, ctx) {
    host.classList.add('pks-page', 'pks-gacha');
    pageHead(host, {kicker: 'GACHA', title: '扭蛋'});
    const g = G(); const local = ctx.local?.() || {};
    const wrap = el('div', 'pks-ga'); host.append(wrap);
    const stage = el('div', 'pks-ga__stage'); const alcove = el('div', 'pks-ga__alcove'); stage.append(alcove);
    const panel = el('aside', 'pks-ga__panel');
    wrap.append(stage, panel);
    let banners = [], s, handle = null, busy = false, bannerId = local.gachaBanner || 'star';
    try { [banners, s] = await Promise.all([g.call('gacha.banners'), g.refresh(), g.forms(), g.manifest()]); } catch (e) { panel.append(el('p', 'pkb-empty', e.message)); return; }
    for (const b of banners) for (const list of Object.values(b.pools || {})) learnNames(list);
    g.call('shop.catalog').then(c => { for (const list of Object.values(c?.shelves || {})) learnNames(list); }).catch(() => {});
    if (!host.isConnected) return;
    const tabs = el('div', 'pkg-seg pks-ga__tabs'); stage.append(tabs);
    for (const b of banners) { const t = el('button', '', b.name); t.type = 'button'; t.setAttribute('aria-selected', String(b.id === bannerId)); t.addEventListener('click', () => { if (busy || bannerId === b.id) return; bannerId = b.id; local.gachaBanner = b.id; tabs.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === t))); openMachine(); paintPanel(); }); tabs.append(t); }
    async function openMachine() {
      registerGachaScene();
      const b = banners.find(x => x.id === bannerId) || banners[0]; const form = g.equippedForm();
      alcove.dataset.mode = 'loading';
      try {
        handle?.close?.();
        handle = fx() ? await fx().scene('gacha', {host: alcove, palette: bannerId === 'seal' ? ['#E2C07A', '#5a3a12', '#FFF4DC'] : form?.palette, title: b?.name || '扭蛋', kicker: bannerId === 'seal' ? 'SEAL GACHA' : 'STAR GACHA'}) : null;
      } catch (e) { console.warn('[gacha] 3D', e); handle = null; }
      alcove.dataset.mode = handle ? '3d' : 'flat';
      if (!handle) flatMachine(alcove, b);
    }
    function flatMachine(box, b) {
      box.querySelector('.pks-ga__flat')?.remove();
      const f = el('div', 'pks-ga__flat'); f.innerHTML = `<svg viewBox="0 0 240 320" aria-hidden="true"><defs><radialGradient id="pks-dome" cx="40%" cy="35%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".06"/></radialGradient></defs><ellipse cx="120" cy="306" rx="96" ry="10" fill="#000" opacity=".35"/><rect x="34" y="170" width="172" height="130" rx="16" fill="#5a1838"/><rect x="34" y="170" width="172" height="130" rx="16" fill="none" stroke="#d8b06a" stroke-opacity=".6"/><rect x="64" y="190" width="112" height="34" rx="3" fill="#1b1117" stroke="#d8b06a" stroke-opacity=".7"/><text x="120" y="213" text-anchor="middle" font-family="Songti SC,serif" font-weight="900" font-size="16" fill="#f2e3c4">${b?.name || '扭蛋'}</text><circle cx="88" cy="256" r="18" fill="#d8b06a"/><rect x="74" y="252" width="28" height="8" rx="3" fill="#b88d48"/><rect x="134" y="242" width="40" height="32" rx="6" fill="#140d12"/><rect x="60" y="160" width="120" height="14" rx="5" fill="#d8b06a"/><circle cx="120" cy="96" r="72" fill="url(#pks-dome)" stroke="#fff" stroke-opacity=".35"/>${[[96, 120, '#B4417F'], [130, 128, '#5E7FC8'], [112, 140, '#D49A2F'], [146, 108, '#4E9A8E'], [84, 104, '#8E6BD8'], [120, 104, '#D8CFC5']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="13" fill="${c}"/><path d="M${x - 13} ${y}a13 13 0 0 0 26 0z" fill="#f3ece4"/>`).join('')}</svg>`;
      box.append(f);
    }
    // 每一档里实际放了什么（后端 formShare）：形态只占一小份，照实写出来。
    const rateText = (r, b) => {
      const fs = b.formShare?.[r], pc = fs != null ? Math.round(fs * 100) : null;
      if (r === 'SSR') return '传说形态';
      if (r === 'N') return '贴纸 / 称号 / 碎片';
      const things = r === 'SR' ? '粒子 / 大招演出 / 碎片' : '封面 / 命中特效 / 结算动画 / 碎片';
      return pc != null ? `${things}，其中形态约 ${pc}%` : `${RARITY[r]?.name || r}形态或特效`;
    };
    function paintPanel() {
      panel.replaceChildren();
      const b = banners.find(x => x.id === bannerId) || banners[0]; if (!b) return;
      panel.append(el('small', 'pkg-kicker', b.id === 'seal' ? 'SEAL GACHA' : 'STAR GACHA'), el('h3', 'pks-ga__name', b.name));
      const rates = el('div', 'pks-rates'); rates.append(el('small', 'pkg-kicker', 'RATES'));
      for (const [r, p] of Object.entries(b.rates || {})) { const row = el('div', 'pks-rate'); row.dataset.r = r; row.style.setProperty('--tone', RARITY[r]?.tone || '#B9AEA4'); row.append(el('b', '', RARITY[r]?.label || r), el('span', '', rateText(r, b)), el('em', 'pkg-num', (p * 100).toFixed(p < .1 ? 1 : 0) + '%')); rates.append(row); }
      // 含保底的综合概率也公示（后端按同一套规则算）。
      if (b.firstTenForm) rates.append(el('p', 'pks-note is-gift', '这个池子的第一次十连，必出 1 个 SR 形态。'));
      if (b.effectiveSSR) rates.append(el('p', 'pks-note', `含保底，SSR 综合约 ${(b.effectiveSSR * 100).toFixed(1)}%（平均 ${Math.round(1 / b.effectiveSSR)} 抽一个）。`));
      panel.append(rates);
      const pity = el('div', 'pks-pity'); pity.append(el('small', 'pkg-kicker', 'PITY'));
      const meter = (label, cur, max) => { if (!max) return; const m = el('div', 'pks-meter'); m.append(el('span', '', label), el('em', 'pkg-num', `${cur} / ${max}`), el('i', 'pks-meter__bar')); m.querySelector('i').style.setProperty('--p', Math.min(100, cur / max * 100) + '%'); pity.append(m); };
      meter(`${b.pity?.sr || 10} 抽内必出 SR 以上`, b.pity?.count?.sr || 0, b.pity?.sr);
      meter(`${b.pity?.ssr} 抽内必出 SSR`, b.pity?.count?.ssr || 0, b.pity?.ssr);
      if (b.pity?.softStart) pity.append(el('p', 'pks-note', `第 ${b.pity.softStart} 抽起每抽 SSR 概率再 +5%。保底计数各池分开，一直保存。重复的变成碎片（R 5 / SR 15 / SSR 40）。`));
      else pity.append(el('p', 'pks-note', '保底计数一直保存。重复的变成碎片。'));
      panel.append(pity);
      const act = el('div', 'pks-ga__act');
      const btn = (n, cost, extra) => { const x = el('button', 'pks-pull' + (n === 10 ? ' is-ten' : '')); x.type = 'button'; x.append(el('b', '', n === 10 ? '十连' : '单抽'), price(cost)); if (extra) x.append(el('em', 'pks-pull__tag', extra)); x.addEventListener('click', () => pull(n)); act.append(x); return x; };
      btn(1, b.cost.single); if (b.cost.ten) btn(10, b.cost.ten, b.cost.firstTen ? '首次十连半价' : '');
      panel.append(act);
      const w = el('p', 'pks-note pks-ga__wallet'); w.textContent = `持有 ${fmt(s.wallet.stars)} 星 · ${fmt(s.wallet.seals)} 金印`; panel.append(w);
    }
    async function pull(n) {
      if (busy) return; busy = true; panel.classList.add('is-busy');
      const b = banners.find(x => x.id === bannerId);
      let r;
      try { r = await g.call('gacha.pull', {banner: bannerId, count: n}); }
      catch (e) { busy = false; panel.classList.remove('is-busy'); g.toast(e.message || '没扭成'); const why = panel.querySelector('.pks-why') || el('p', 'pks-why'); why.textContent = g.plain?.(e.message) ?? (e.message || ''); panel.append(why); return; }
      learnNames(r.results);
      // 后端的 awards 里有同一批结果（source.type==='gacha'），开蛋动画已经播了：只 ack，不再播一遍。
      const shown = (r.awards || []).filter(a => a.source?.type === 'gacha'), other = (r.awards || []).filter(a => a.source?.type !== 'gacha');
      try {
        if (handle?.instance?.pull) { const seq = await handle.instance.pull(r.results); await seq.open(); }
        const best = r.results.reduce((m, x) => (['N', 'R', 'SR', 'SSR'].indexOf(x.rarity) > ['N', 'R', 'SR', 'SSR'].indexOf(m.rarity) ? x : m), r.results[0]);
        try { fx()?.sfx('open', {rarity: best.rarity}); } catch { /* ignore */ }
        const ssr = r.results.find(x => x.rarity === 'SSR' && x.kind === 'form' && !x.dup);
        if (ssr) { const f = g.formOf(ssr.itemId); await fx()?.cinematic(f?.ult || 'curtain', {text: f?.name || '传说', sub: 'SSR · 新形态', kicker: 'SSR', art: g.ultArt(ssr.itemId) || g.portrait(ssr.itemId), palette: f?.palette, particle: f?.particle, form: g.fxForm(f)}); }
        await showResults(r.results);
      } catch (e) { console.warn('[gacha]', e); await showResults(r.results); }
      g.markSeen(shown.map(a => a.id));
      await g.call('awards.ack', {ids: shown.map(a => a.id)}).catch(() => {});
      if (other.length) await g.play(other);
      [banners, s] = await Promise.all([g.call('gacha.banners'), g.refresh()]);
      busy = false; panel.classList.remove('is-busy'); paintPanel();
    }
    function showResults(results) {
      return new Promise(resolve => {
        const sheet = el('div', 'pks-results'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', '扭蛋结果');
        const grid = el('div', 'pks-results__grid' + (results.length > 1 ? ' is-ten' : ''));
        results.forEach((x, i) => {
          const card = el('article', 'pks-card'); card.dataset.rarity = x.rarity; card.style.setProperty('--tone', RARITY[x.rarity]?.tone || '#B9AEA4'); card.style.setProperty('--i', i);
          const f = x.kind === 'form' ? g.formOf(x.itemId) : null;
          const face = el('div', 'pks-card__face');
          face.append(preview({kind: x.kind === 'form' ? 'form' : x.kind === 'shards' ? 'shards' : (x.itemId || '').split(':')[0], itemId: x.itemId, name: f?.name || x.name || itemName(x.itemId)}));
          face.append(el('small', 'pks-card__r', RARITY[x.rarity]?.label || x.rarity), el('b', 'pks-card__n', f?.name || x.name || itemName(x.itemId)), el('em', 'pks-card__d', x.kind === 'shards' ? `碎片 +${x.shards}` : x.dup ? `重复 · 碎片 +${x.shards}` : x.kind === 'form' ? '新形态' : 'NEW'));
          card.append(face); grid.append(card);
        });
        const close = el('button', 'pkg-btn pks-results__ok', '收下'); close.type = 'button';
        const done = () => { sheet.classList.add('is-out'); setTimeout(() => { sheet.remove(); resolve(); }, 260); };
        close.addEventListener('click', done); sheet.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') done(); });
        sheet.append(el('small', 'pkg-kicker', results.length > 1 ? 'RESULTS · ×10' : 'RESULT'), grid, close);
        wrap.append(sheet); setTimeout(() => close.focus(), 60);
      });
    }
    paintPanel(); openMachine();
    return {unmount() { handle?.close?.(); }};
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gameshop', {title: '商店', wide: true, mount: (h, c) => mountShop(h, c)});
    d.registerView('gamegacha', {title: '扭蛋', wide: true, mount: (h, c) => mountGacha(h, c)});
    d.registerView('gamewardrobe', {title: '衣橱', wide: true, mount: (h, c) => mountWardrobe(h, c)});
    d.registerView('gamecodex', {title: '图鉴', wide: true, mount: (h, c) => mountCodex(h, c)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }
  addEventListener('pinkie:gamefx-ready', registerGachaScene); registerGachaScene();
  window.__pinkieGameShop = {RARITY, preview};
})();
