/* 碧琪上岸记 · 战斗舞台带（v4，11-12 Windows 侧重做）。
   作答页上方的一条「场景带」：区域背景 + 碧琪（全身立绘，活的）+ 对面的怪 + 血条 / 气势槽 / 连击 / 本组进度点。
   题目仍是第一视觉，舞台只占上面一条；一次出手从起手到落点 ≤ 400 ms，不挡下一步操作。
   同时提供作答页共用的 SVG 控件：选项框、出手键、× 键、评级徽章、进度点。
   谁用：laolao-game-practice.js（真题刷题）。接口见文末 window.__pinkieGameStage。 */
(() => {
  'use strict';
  if (window.__pinkieGameStage) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (markup, cls) => { const t = document.createElement('template'); t.innerHTML = `<svg xmlns="${NS}" ${cls ? `class="${cls}"` : ''} aria-hidden="true" focusable="false" ${markup}</svg>`; return t.content.firstChild; };
  const reduced = () => Boolean(desk()?.motion?.reduced) || fx()?.settings?.().tier === 'quiet';
  const sfx = (name, opts) => { try { return fx()?.sfx?.(name, opts); } catch { return false; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 重放一段一次性动画：加类 → 播完摘掉。不摘的话，留在身上的类会盖住后面别的动画（答错一次以后「起手」就不播了），受击的染色也会一直留着。
  const again = (node, cls, ms = 1500) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); clearTimeout(node['__pkq_' + cls]); node['__pkq_' + cls] = setTimeout(() => node.classList.remove(cls), ms); };

  // 区域 → 背景槽位 / 默认怪。背景图没到时用渐变兜底（CSS）。
  const SCENES = {training: '训练场', vocab: '词汇森林', grammar: '语法工坊', reading: '阅读图书馆', translation: '翻译桥', writing: '写作塔', listening: '听力港', boss: '巴别塔', exam: '考场'};
  const SPECIES = {
    listening: [['echo-bat', '回声蝙蝠'], ['shell-crab', '海螺小蟹']],
    vocab: [['block-golem', '字母积木魔像'], ['sticky-ghost', '便利贴幽灵'], ['quiz-shroom', '题目蘑菇']],
    grammar: [['ink-slime', '迷糊史莱姆'], ['tangle-yarn', '时态毛线团'], ['clock-beetle', '时钟甲虫']],
    reading: [['bookworm', '书虫'], ['paper-fox', '纸狐']],
    translation: [['lost-crane', '迷路纸鹤'], ['bridge-troll', '小桥怪']],
    writing: [['inkpot-imp', '墨水瓶小鬼'], ['eraser-gnome', '橡皮小精灵'], ['shaving-hog', '卷笔刀刺猬']],
    training: [['fog-puff', '迷雾团']],
  };
  const QKIND_SCENE = {choice: 'grammar', 'word-form': 'vocab', 'passage-choice': 'reading', 'practical-fill': 'reading', 'passage-short': 'reading', 'term-match': 'reading',
    'translate-choice': 'translation', 'translate-passage': 'translation', writing: 'writing', 'listen-response': 'listening', 'listen-dialogue': 'listening', 'listen-conversation': 'listening', 'listen-dictation': 'listening'};
  const VOCAB_POINT = /词义|搭配|短语|代词|冠词|变名词|变形容词|变副词/;
  function sceneOf(item) {
    if (!item) return 'training';
    if (item.qkind === 'choice') return VOCAB_POINT.test(item.point || '') ? 'vocab' : 'grammar';
    return QKIND_SCENE[item.qkind] || 'training';
  }
  // 精英：一组最后一波出场，每个区域一只（v4 新画的）。图没到就退回普通怪。
  const ELITE = {listening: ['elite-siren-conch', '留声海螺'], vocab: ['elite-dictionary-mimic', '词典宝箱怪'], grammar: ['elite-gear-knight', '齿轮骑士'], reading: ['elite-tome-owl', '书页猫头鹰'],
    translation: ['elite-twin-mask', '双面译灵'], writing: ['elite-quill-dragon', '羽笔小龙'], training: ['elite-tome-owl', '书页猫头鹰']};
  function speciesOf(scene, seed = 0, elite = false) {
    if (elite) { const e = ELITE[scene] || ELITE.training; if (G()?.art?.(`monster/${e[0]}`)) return e; }
    const list = SPECIES[scene] || SPECIES.training; return list[Math.abs(seed) % list.length];
  }
  // 一组题切成几波：每波一只怪，血量 = 这一波的题数。10 题 → 3 / 3 / 4，最后一只是精英。
  function waves(items) {
    const n = items.length; if (!n) return [];
    const count = n <= 4 ? 1 : n <= 8 ? 2 : Math.min(4, Math.round(n / 3.4));
    const out = []; let at = 0;
    for (let w = 0; w < count; w++) {
      const size = w === count - 1 ? n - at : Math.floor(n / count);
      const first = items[at], scene = sceneOf(first), sp = speciesOf(scene, (first?.no || 0) + w * 7 + String(first?.itemId || '').length, count > 1 && w === count - 1);
      const topic = first?.point && first.point !== '未分类' ? first.point : '';
      out.push({index: w, from: at, size, scene, species: sp[0], speciesName: sp[1], name: topic ? `${topic} · ${sp[1]}` : sp[1], level: Math.min(5, w + 1 + (count > 1 && w === count - 1 ? 1 : 0)), elite: count > 1 && w === count - 1});
      at += size;
    }
    return out;
  }

  // ───────────── SVG 控件 ─────────────
  const ICON = {
    x: 'viewBox="0 0 24 24"><path class="a" d="M6 6l12 12"/><path class="b" d="M18 6L6 18"/>',
    check: 'viewBox="0 0 24 24"><path pathLength="1" d="M4.5 12.5l5 5L19.5 7"/>',
    cross: 'viewBox="0 0 24 24"><path pathLength="1" d="M6 6l12 12"/><path pathLength="1" d="M18 6L6 18"/>',
    spark: 'viewBox="0 0 24 24"><path d="M12 1.5c.9 5.6 3.9 8.600 10.5 10.5-6.6 1.9-9.6 4.900-10.5 10.500C11.100 16.900 8.100 13.900 1.500 12 8.100 10.100 11.100 7.100 12 1.500z"/>',
    chev: 'viewBox="0 0 30 24"><path d="M4 5l7 7-7 7"/><path d="M12 5l7 7-7 7"/><path d="M20 5l7 7-7 7"/>',
    star: 'viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.500.900-4.700 4.600 1.100 6.500L12 17.400 6.200 20.500l1.100-6.500L2.600 9.400l6.500-.9z"/>',
    sound: 'viewBox="0 0 24 24"><path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path class="w1" d="M15.500 9.200a4 4 0 0 1 0 5.600"/><path class="w2" d="M18 6.800a7.400 7.400 0 0 1 0 10.400"/><path class="mute" d="M15.500 9.500l5 5M20.500 9.500l-5 5"/>',
    heart: 'viewBox="0 0 24 24"><path d="M12 20.500S3.500 15.300 3.500 9.300A4.300 4.300 0 0 1 12 7.600a4.300 4.300 0 0 1 8.500 1.700c0 6-8.500 11.200-8.500 11.200z"/>',
    book: 'viewBox="0 0 24 24"><path d="M4 5.500C6.500 4.500 9.500 4.500 12 6v13c-2.500-1.500-5.500-1.500-8-.5zM20 5.500C17.500 4.500 14.500 4.500 12 6v13c2.500-1.500 5.500-1.500 8-.5z"/>',
    flag: 'viewBox="0 0 24 24"><path d="M6 21V4"/><path d="M6 5c4-2 7 2 12 0v8c-5 2-8-2-12 0"/>',
    bolt: 'viewBox="0 0 24 24"><path d="M13.500 2.500L5 13.500h6l-1 8 8.500-11h-6z"/>',
    shield: 'viewBox="0 0 24 24"><path d="M12 2.800l7.500 2.700v6c0 4.600-3.100 8-7.500 9.700-4.400-1.700-7.500-5.100-7.500-9.700v-6z"/><path class="in" d="M8.600 12l2.500 2.500 4.500-5"/>',
    lens: 'viewBox="0 0 24 24"><circle cx="10.500" cy="10.500" r="6"/><path d="M15 15l5.500 5.500"/><path class="in" d="M8 10.500h5"/>',
    twin: 'viewBox="0 0 24 24"><path d="M8 3.500l1.500 3.200 3.500.5-2.500 2.500.6 3.500L8 11.500 4.900 13.200l.6-3.500L3 7.200l3.500-.5z"/><path d="M16.500 10.500l1.200 2.500 2.800.4-2 2 .5 2.800-2.500-1.300-2.500 1.300.5-2.800-2-2 2.800-.4z"/>',
    skull: 'viewBox="0 0 24 24"><path d="M5 11a7 7 0 0 1 14 0c0 2.600-1.300 4.300-3 5.300V19H8v-2.700C6.300 15.300 5 13.600 5 11z"/><circle cx="9.300" cy="11.500" r="1.400"/><circle cx="14.700" cy="11.500" r="1.400"/>',
  };
  const icon = (name, cls = '') => svg(ICON[name] || ICON.spark, `pkq-ico pkq-ico--${name} ${cls}`.trim());

  // × 键：两笔，悬停时各自转开，按下收拢
  function closeButton(label) {
    const b = el('button', 'pkq-x'); b.type = 'button'; b.setAttribute('aria-label', label || '退出'); b.title = label || '退出';
    b.append(svg('viewBox="0 0 40 40"><circle class="ring" cx="20" cy="20" r="17" pathLength="1"/><path class="a" d="M14 14l12 12"/><path class="b" d="M26 14L14 26"/>', 'pkq-x__svg'));
    b.addEventListener('pointerenter', () => sfx('ui-hover'));
    return b;
  }
  // 选项框：圆角描边沿边缘画出来；键帽是一颗切角小牌；选中后右侧出一枚指示箭头。
  function optionButton(key, text, {wide = false} = {}) {
    const b = el('button', 'pkq-opt' + (wide ? ' is-wide' : '')); b.type = 'button'; b.dataset.key = key; b.setAttribute('aria-pressed', 'false');
    b.append(
      svg('preserveAspectRatio="none"><rect class="pkq-opt__bg" x="1" y="1" rx="13" ry="13"/><rect class="pkq-opt__line" x="1" y="1" rx="13" ry="13" pathLength="100"/>', 'pkq-opt__frame'),
      (() => { const k = el('span', 'pkq-opt__key'); k.append(svg('viewBox="0 0 36 36"><path class="plate" d="M9 2.500h18l6.500 6.500v18L27 33.500H9L2.500 27V9z"/><path class="glint" d="M9 2.500h18l6.500 6.500" />', 'pkq-opt__keysvg'), el('b', '', key)); return k; })(),
      el('span', 'pkq-opt__text', text),
      (() => { const m = el('span', 'pkq-opt__mark'); m.append(icon('chev', 'pkq-opt__chev'), icon('check', 'pkq-opt__ok'), icon('cross', 'pkq-opt__no')); return m; })(),
    );
    b.addEventListener('pointerenter', () => { if (!b.disabled) sfx('ui-hover'); });
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%'); b.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%'); });
    return b;
  }
  // 出手键 / 下一题键：左边四芒星，右边三道行进的箭头；ready 时外圈呼吸。
  function actionButton(text, {kind = 'fire', hint = ''} = {}) {
    const b = el('button', 'pkq-act'); b.type = 'button'; b.dataset.kind = kind;
    b.append(svg('preserveAspectRatio="none"><rect class="pkq-act__bg" x="1.500" y="1.500" rx="24" ry="24"/><rect class="pkq-act__line" x="1.500" y="1.500" rx="24" ry="24" pathLength="100"/>', 'pkq-act__frame'),
      icon(kind === 'next' ? 'bolt' : 'spark', 'pkq-act__spark'), el('span', 'pkq-act__text', text), icon('chev', 'pkq-act__chev'));
    if (hint) b.append(el('kbd', 'pkq-act__kbd', hint));
    b.addEventListener('pointerenter', () => { if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') sfx('ui-hover'); });
    b.addEventListener('pointerdown', () => { b.classList.add('is-down'); });
    for (const ev of ['pointerup', 'pointerleave', 'blur']) b.addEventListener(ev, () => b.classList.remove('is-down'));
    return b;
  }
  function ghostButton(text) { const b = el('button', 'pkq-ghost'); b.type = 'button'; b.append(el('span', '', text), svg('viewBox="0 0 100 4" preserveAspectRatio="none"><path d="M0 2h100" pathLength="1"/>', 'pkq-ghost__line')); return b; }
  // 评级徽章：六边盾 + 月桂 + 字母，落下时盖章
  const RANK_TONE = {S: ['#FFE08A', '#E9A93B', '#8A5A12'], A: ['#FFB7D5', '#DB1F74', '#7A1242'], B: ['#BFD4FF', '#5B7FE0', '#263E86'], D: ['#E7C9CF', '#A2586A', '#55202E'], C: ['#D9D2DB', '#8E8294', '#4B4252']};
  function rankBadge(rank) {
    const [hi, mid, lo] = RANK_TONE[rank] || RANK_TONE.C; const id = 'pkq-rk-' + Math.random().toString(36).slice(2, 8);
    const w = el('div', 'pkq-rank'); w.dataset.rank = rank;
    w.append(svg(`viewBox="0 0 200 200"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
      <g class="rays">${Array.from({length: 12}, (_, i) => `<path d="M100 100L${(100 + Math.cos(i * Math.PI / 6 - .09) * 98).toFixed(1)} ${(100 + Math.sin(i * Math.PI / 6 - .09) * 98).toFixed(1)}L${(100 + Math.cos(i * Math.PI / 6 + .09) * 98).toFixed(1)} ${(100 + Math.sin(i * Math.PI / 6 + .09) * 98).toFixed(1)}Z" fill="${hi}" opacity=".5"/>`).join('')}</g>
      <path class="shield" d="M100 22l62 34v60c0 28-26 48-62 62-36-14-62-34-62-62V56z" fill="url(#${id})" stroke="${lo}" stroke-width="3"/>
      <path class="inner" d="M100 36l50 27v52c0 22-21 38-50 50-29-12-50-28-50-50V63z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.500" pathLength="1"/>
      <path class="gloss" d="M100 22l62 34v14C140 58 120 50 100 44 80 50 60 58 38 70V56z" fill="#fff" opacity=".22"/>
      <g class="laurel" fill="none" stroke="${lo}" stroke-width="2.200" stroke-linecap="round" opacity=".7"><path d="M50 150c-16-14-22-34-18-56"/><path d="M150 150c16-14 22-34 18-56"/>${[0, 1, 2, 3].map(i => `<path d="M${34 + i * 4} ${104 + i * 13}c-7-3-10-8-10-14"/><path d="M${166 - i * 4} ${104 + i * 13}c7-3 10-8 10-14"/>`).join('')}</g>
      <text class="letter" x="100" y="128" text-anchor="middle" font-size="84" font-weight="900" fill="#fff" stroke="${lo}" stroke-width="2.500" paint-order="stroke" font-family="Georgia, 'Times New Roman', serif" font-style="italic">${rank}</text>`, 'pkq-rank__svg'));
    return w;
  }

  // ───────────── 舞台带 ─────────────
  function create({form, scene = 'training', compact = false, total = 0} = {}) {
    const g = G();
    const root = el('div', 'pkq-band' + (compact ? ' is-compact' : '')); root.dataset.scene = scene;
    const pal = form?.palette || ['#F7A8C8', '#DB1F74', '#FFE36E'];
    root.style.setProperty('--pkq-a', pal[0]); root.style.setProperty('--pkq-b', pal[1]); root.style.setProperty('--pkq-c', pal[2]);
    const bgA = el('div', 'pkq-bg'), bgB = el('div', 'pkq-bg is-back'); // 交叉淡入换景
    const haze = el('i', 'pkq-haze'), motes = el('i', 'pkq-motes');
    const world = el('div', 'pkq-world');
    // 碧琪
    const hero = el('div', 'pkq-hero'); const heroImg = el('img'); heroImg.alt = ''; heroImg.decoding = 'async'; heroImg.draggable = false;
    const heroAura = el('i', 'pkq-hero__aura'); hero.append(el('i', 'pkq-shadow'), heroAura, heroImg);
    const artOf = (id, pose) => g?.art?.(`form/${id}/${pose}`) || (pose === 'portrait' ? g?.portrait?.(id) : null);
    let formId = form?.id || 'daily', poseTimer = 0;
    const setPose = (pose, hold = 900) => { clearTimeout(poseTimer); const src = artOf(formId, pose) || artOf(formId, 'portrait'); if (src && heroImg.getAttribute('src') !== src) heroImg.src = src; hero.dataset.pose = pose; if (pose !== 'portrait' && hold) poseTimer = setTimeout(() => setPose('portrait'), hold); };
    setPose('portrait');
    for (const pose of ['cheer', 'hurt']) { const s = artOf(formId, pose); if (s) { const i = new Image(); i.src = s; } }
    // 怪
    const foe = el('div', 'pkq-foe'); const foeBody = el('div', 'pkq-foe__body'); foe.append(el('i', 'pkq-shadow'), foeBody);
    const pops = el('div', 'pkq-pops');
    world.append(hero, foe, pops);
    // 名牌：左 = 碧琪 + 气势槽；右 = 怪 + 血条
    const hp = el('div', 'pkq-plate is-hero'); const hpName = el('b', '', form?.name || '碧琪');
    const gauge = el('div', 'pkq-gauge'); const gaugeFill = el('i'); gauge.append(gaugeFill); const gaugeTag = el('small', '', '气势');
    const hearts = el('div', 'pkq-hearts'); hearts.hidden = true; hearts.setAttribute('role', 'img');
    hp.append(el('span', 'pkq-plate__row'), hearts, gauge); hp.firstChild.append(hpName, gaugeTag);
    // 技能键：一颗切角宝石，外圈是攒了多少（stroke 画出来），攒满后呼吸、可按
    const SK_ICON = {eliminate: 'lens', heal: 'heart', shield: 'shield', double: 'twin'};
    const skill = el('button', 'pkq-skill'); skill.type = 'button'; skill.hidden = true; skill.setAttribute('aria-disabled', 'true');
    const skillIco = el('span', 'pkq-skill__ico'); const skillName = el('b', '', ''); const skillSub = el('small', '', '');
    const skillTxt = el('span', 'pkq-skill__t'); skillTxt.append(skillName, skillSub);
    skill.append(svg('viewBox="0 0 48 48"><path class="gem" d="M14 3.500h20L44.500 14v20L34 44.500H14L3.500 34V14z"/><path class="ring" d="M14 3.500h20L44.500 14v20L34 44.500H14L3.500 34V14z" pathLength="100"/><path class="glint" d="M14 3.500h20L44.500 14"/>', 'pkq-skill__svg'), skillIco, skillTxt, el('kbd', '', 'Q'));
    const buffs = el('div', 'pkq-buffs');
    const fp = el('div', 'pkq-plate is-foe'); const fName = el('b', '', ''); const fLv = el('small', '', '');
    const life = el('div', 'pkq-life'); fp.append(el('span', 'pkq-plate__row'), life); fp.firstChild.append(fLv, fName);
    // 连击
    const combo = el('div', 'pkq-combo'); const comboN = el('b', '', '0'); combo.append(comboN, el('small', '', 'COMBO')); combo.dataset.on = '0';
    // 顶栏：× · 标题 · 进度点 · 本组星星 · 声音
    const top = el('div', 'pkq-top');
    const title = el('div', 'pkq-title'); const kicker = el('small', '', ''); const name = el('b', '', ''); title.append(kicker, name);
    const pips = el('div', 'pkq-pips'); pips.setAttribute('role', 'img');
    const gain = el('div', 'pkq-gain'); const gainN = el('b', '', '0'); gain.append(icon('star'), gainN); gain.title = '这一组拿到的星星';
    const snd = el('button', 'pkq-snd'); snd.type = 'button'; snd.append(icon('sound'));
    const soundOn = () => { try { const raw = JSON.parse(localStorage.getItem('pinkie.study.sound.v1') || 'null'); return !(raw && raw.on === false); } catch { return true; } };
    const paintSnd = () => { const on = soundOn(); snd.dataset.on = on ? '1' : '0'; snd.setAttribute('aria-label', on ? '关掉音效' : '打开音效'); snd.title = snd.getAttribute('aria-label'); };
    snd.addEventListener('click', () => { const on = !soundOn(); try { localStorage.setItem('pinkie.study.sound.v1', JSON.stringify({on})); } catch { /* 无痕 */ } paintSnd(); if (on) sfx('ui-pick'); });
    paintSnd();
    top.append(title, pips, gain, snd);
    const banner = el('div', 'pkq-banner'); banner.hidden = true;
    const flash = el('i', 'pkq-flash');
    root.append(bgB, bgA, haze, motes, world, hp, fp, skill, buffs, combo, top, banner, flash);
    let onSkill = null, skillState = null;
    skill.addEventListener('pointerenter', () => { if (skill.getAttribute('aria-disabled') !== 'true') sfx('ui-hover'); });
    skill.addEventListener('click', () => { if (skill.getAttribute('aria-disabled') === 'true' || skill.dataset.busy) { if (!reduced()) again(skill, 'is-nope', 400); return; } onSkill?.(); });
    // 心：max 颗，left 颗亮着。掉心 = 那一颗裂开；回心 = 弹回来。
    let heartEls = [], heartsLeft = null;
    function setHearts(hpState, {instant = false} = {}) {
      if (!hpState) { hearts.hidden = true; return; }
      hearts.hidden = false;
      while (heartEls.length < hpState.max) { const h = el('i', 'pkq-heart'); h.append(svg('viewBox="0 0 24 22"><path class="back" d="M12 20.500S2.500 14.800 2.500 8.300A5 5 0 0 1 12 6a5 5 0 0 1 9.500 2.300c0 6.500-9.500 12.200-9.500 12.200z"/><path class="fill" d="M12 20.500S2.500 14.800 2.500 8.300A5 5 0 0 1 12 6a5 5 0 0 1 9.500 2.300c0 6.500-9.500 12.200-9.500 12.200z"/><path class="crack" d="M12 6.500l-2 4 3.500 2.500-2 4.500" pathLength="1"/><path class="shine" d="M6 7.500c.5-1.200 1.500-2 2.800-2"/>')); hearts.append(h); heartEls.push(h); }
      heartEls.forEach((h, k) => { const on = k < hpState.left; const was = h.dataset.on; h.dataset.on = on ? '1' : '0'; if (instant || was === undefined || was === h.dataset.on || reduced()) return; again(h, on ? 'is-heal' : 'is-break', 700); });
      hearts.dataset.low = hpState.left === 1 ? '1' : '0'; root.dataset.danger = hpState.left === 1 && !hpState.failed ? '1' : '0';
      hearts.setAttribute('aria-label', `碧琪还有 ${hpState.left} / ${hpState.max} 颗心`);
      if (heartsLeft != null && !instant) { if (hpState.left > heartsLeft) { sfx('heal'); pop('+1', {at: 'hero', small: 'HEART'}); } }
      heartsLeft = hpState.left;
    }
    function setSkill(sk, {onUse} = {}) {
      if (onUse) onSkill = onUse;
      if (!sk) { skill.hidden = true; skillState = null; return; }
      const was = skillState; skillState = sk; skill.hidden = false; skill.dataset.kind = sk.kind;
      if (skillIco.dataset.k !== sk.kind) { skillIco.dataset.k = sk.kind; skillIco.replaceChildren(icon(SK_ICON[sk.kind] || 'spark')); }
      skillName.textContent = sk.name || '技能'; skillSub.textContent = sk.ready ? '可以放了' : `${sk.charge} / ${sk.cost}`;
      skill.style.setProperty('--k', String(Math.min(1, sk.charge / sk.cost)));
      skill.setAttribute('aria-disabled', String(!sk.ready)); skill.dataset.ready = sk.ready ? '1' : '0';
      skill.title = sk.text || ''; skill.setAttribute('aria-label', `技能 ${sk.name}，${sk.ready ? '可以放了，按 Q' : `攒了 ${sk.charge} / ${sk.cost}`}`);
      if (sk.ready && !(was?.ready) && !reduced()) { again(skill, 'is-full', 900); sfx('skill-ready'); }
    }
    function setBuffs({guard = false, double = false} = {}) {
      buffs.replaceChildren();
      if (guard) { const b = el('span', 'pkq-buff'); b.dataset.k = 'shield'; b.append(icon('shield'), el('em', '', '护盾')); buffs.append(b); }
      if (double) { const b = el('span', 'pkq-buff'); b.dataset.k = 'double'; b.append(icon('twin'), el('em', '', '下一题 ×2')); buffs.append(b); }
      hero.dataset.guard = guard ? '1' : '0';
    }
    // 放技能的一下：碧琪亮一下 + 一圈波纹 + 技能名
    function castSkill(sk) { setPose('cheer', 900); if (!reduced()) { again(hero, 'is-skill', 800); again(flash, 'is-skill', 600); } sfx('skill'); pop(sk?.name || '技能', {at: 'hero', small: 'SKILL'}); }
    function guarded() { if (!reduced()) again(hero, 'is-guard', 700); sfx('guard'); pop('挡住了', {at: 'hero', small: 'GUARD'}); }
    function knockdown() { clearTimeout(poseTimer); setPose('hurt', 0); hero.dataset.down = '1'; root.dataset.down = '1'; sfx('down'); }
    function rise() { hero.dataset.down = '0'; root.dataset.down = '0'; setPose('cheer', 1000); if (!reduced()) again(hero, 'is-rise', 800); sfx('heal'); }

    // 背景：槽位 battle/<scene>；轻微视差跟鼠标
    let sceneNow = '';
    function setScene(id) {
      id = SCENES[id] ? id : 'training'; if (id === sceneNow) return; sceneNow = id; root.dataset.scene = id;
      const url = g?.art?.(`battle/${id}`) || g?.art?.('battle/training');
      bgB.style.backgroundImage = bgA.style.backgroundImage; bgB.style.opacity = '1';
      bgA.style.backgroundImage = url ? `url("${url}")` : ''; bgA.classList.toggle('is-empty', !url);
      if (!reduced()) { bgA.animate([{opacity: 0}, {opacity: 1}], {duration: 520, easing: 'ease-out'}); }
    }
    setScene(scene);
    const onMove = e => { if (reduced()) return; const r = root.getBoundingClientRect(); if (!r.width) return; const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; root.style.setProperty('--px', (x * -10).toFixed(2) + 'px'); root.style.setProperty('--py', (y * -4).toFixed(2) + 'px'); };
    root.addEventListener('pointermove', onMove);

    // 进度点
    const pipEls = [];
    function setProgress(states, current) { // states: 'right' | 'wrong' | undefined
      while (pipEls.length < states.length) { const p = el('i', 'pkq-pip'); p.append(svg('viewBox="0 0 16 16"><path d="M8 1.500l6.500 6.500L8 14.500 1.500 8z"/>')); pips.append(p); pipEls.push(p); }
      states.forEach((s, i) => { const p = pipEls[i]; const next = s || (i === current ? 'now' : 'todo'); if (p.dataset.s !== next) { p.dataset.s = next; if (s && !reduced()) again(p, 'is-pop'); } });
      const done = states.filter(Boolean).length; pips.setAttribute('aria-label', `第 ${Math.min(current + 1, states.length)} / ${states.length} 题，已答 ${done}`);
    }
    if (total) setProgress(Array.from({length: total}), 0);
    function setWaveMarks(list) { list.forEach(w => { const p = pipEls[w.from + w.size - 1]; if (p) p.dataset.end = w.elite ? 'elite' : '1'; }); }

    // 怪
    let enemy = null, lifeEls = [];
    function setEnemy(next, {instant = false} = {}) {
      enemy = next ? {...next} : null; foe.classList.remove('is-down', 'is-flee', 'is-hurt', 'is-crit', 'is-strike');
      foeBody.replaceChildren(); life.replaceChildren(); lifeEls = [];
      if (!enemy) { fp.hidden = true; return; }
      fp.hidden = false; foe.dataset.elite = enemy.elite ? '1' : '0';
      const src = enemy.species ? g?.art?.(`monster/${enemy.species}`) : null;
      if (src) { const i = el('img'); i.alt = ''; i.decoding = 'async'; i.draggable = false; i.src = src; foeBody.append(i); } else foeBody.append(el('span', 'pkq-foe__ghost', (enemy.name || '?').slice(0, 1)));
      fName.textContent = enemy.name || ''; fLv.textContent = `${enemy.elite ? 'ELITE' : 'LV'}.${enemy.level || 1}`;
      for (let i = 0; i < (enemy.hp || 1); i++) { const s = el('i', 'pkq-life__seg'); s.append(el('i')); life.append(s); lifeEls.push(s); }
      setEnemyHp(enemy.left ?? enemy.hp, {instant: true});
      if (!instant && !reduced()) { again(foe, 'is-enter'); again(fp, 'is-enter'); sfx('whoosh'); }
    }
    function setEnemyHp(left, {instant = false} = {}) {
      if (!enemy) return; enemy.left = Math.max(0, left);
      lifeEls.forEach((s, i) => { const on = i < enemy.left; if (s.dataset.on === String(on)) return; s.dataset.on = String(on); if (!on && !instant && !reduced()) again(s, 'is-break'); });
    }
    function pop(text, {crit = false, miss = false, at = 'foe', small = ''} = {}) {
      const p = el('div', 'pkq-pop' + (crit ? ' is-crit' : '') + (miss ? ' is-miss' : '')); p.dataset.at = at;
      if (small) p.append(el('small', '', small)); p.append(el('b', '', String(text)));
      p.style.setProperty('--dx', (Math.random() * 36 - 18).toFixed(0) + 'px');
      pops.append(p); setTimeout(() => p.remove(), 1200);
    }
    // 一发光弹：从碧琪胸口到怪身上（DOM，不依赖 WebGL）
    function bolt(crit) {
      if (reduced()) return Promise.resolve();
      const w = world.getBoundingClientRect(), a = heroImg.getBoundingClientRect(), b = foeBody.getBoundingClientRect();
      const x0 = a.left + a.width * .62 - w.left, y0 = a.top + a.height * .42 - w.top, x1 = b.left + b.width * .5 - w.left, y1 = b.top + b.height * .5 - w.top;
      const n = el('i', 'pkq-bolt' + (crit ? ' is-crit' : '')); n.style.left = x0 + 'px'; n.style.top = y0 + 'px';
      const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI; n.style.setProperty('--ang', ang + 'deg');
      world.append(n);
      const an = n.animate([{transform: `translate(0,0) rotate(${ang}deg) scaleX(.4)`, opacity: .2}, {transform: `translate(${(x1 - x0) * .5}px,${(y1 - y0) * .5 - 18}px) rotate(${ang}deg) scaleX(1.3)`, opacity: 1, offset: .5}, {transform: `translate(${x1 - x0}px,${y1 - y0}px) rotate(${ang}deg) scaleX(.7)`, opacity: 1}], {duration: crit ? 230 : 190, easing: 'cubic-bezier(.5,0,.9,.6)'});
      return an.finished.catch(() => {}).then(() => n.remove());
    }
    // 答对：起手 → 光弹 → 落点（怪受击、掉一格血、伤害数字）
    async function strike({crit = false, damage = 100, kill = false, keepHp = false} = {}) {
      const target = enemy; // 这一下打的是谁；演到一半换了怪，后面的受击 / 击破就不演了
      setPose('cheer', 1100);
      if (!reduced()) again(hero, 'is-cast');
      sfx('whoosh');
      await bolt(crit);
      // 装了命中特效用装备的（自己的粒子 / 配色 / 声音），没装用形态自带的
      try { const lo = window.__pinkieLoadout; if (!(lo ? lo.hit(foeBody, {form, crit, size: compact ? .8 : 1.1}) : fx()?.hit?.(form?.hit || 'sparkle', foeBody, {crit, palette: pal, form: g?.fxForm?.(form), size: compact ? .8 : 1.1}))) sfx(crit ? 'crit' : 'hit'); } catch { sfx(crit ? 'crit' : 'hit'); }
      if (!reduced()) { again(foe, crit ? 'is-crit' : 'is-hurt'); if (crit) again(root, 'is-quake'); again(flash, 'is-hit'); }
      if (enemy !== target) return;
      pop(damage, {crit, small: crit ? 'CRITICAL' : ''});
      if (enemy && !keepHp) setEnemyHp(enemy.left - 1);
      if (kill) { await wait(reduced() ? 0 : 260); if (enemy === target) defeat(); }
    }
    // 答错：怪扑过来，碧琪一缩
    async function counter() {
      if (!reduced()) again(foe, 'is-strike');
      await wait(reduced() ? 0 : 170);
      setPose('hurt', 1200); sfx('hurt');
      if (!reduced()) { again(hero, 'is-hit'); again(flash, 'is-hurt'); again(root, 'is-quake'); }
      pop(hearts.hidden ? 'MISS' : '-1', {miss: true, at: 'hero', small: hearts.hidden ? '' : 'HEART'});
    }
    function defeat() {
      foe.classList.add('is-down'); sfx('defeat');
      try { const lo = window.__pinkieLoadout; if (lo) lo.burst(foeBody, {form, scale: compact ? .8 : 1.1}); else fx()?.burst?.(form?.particle || 'sparkle', foeBody, {palette: pal, scale: compact ? .8 : 1.1}); } catch { /* 无引擎 */ }
      pop('击破', {at: 'foe', small: 'DEFEATED'});
    }
    function flee(n) { foe.classList.add('is-flee'); sfx('flee'); pop(n > 1 ? `带着 ${n} 道错题溜了` : '带着错题溜了', {miss: true, at: 'foe'}); }
    function setCombo(n) {
      const prev = Number(combo.dataset.n || 0); combo.dataset.n = String(n); combo.dataset.on = n > 1 ? '1' : '0'; combo.dataset.hot = n >= 5 ? '1' : '0'; comboN.textContent = String(n);
      hero.dataset.hot = n >= 5 ? '1' : '0';
      if (n > prev && n > 1) { if (!reduced()) again(combo, 'is-bump'); sfx('combo', {n}); }
    }
    function setGauge(frac, {full = false} = {}) { gaugeFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`; gauge.dataset.full = full ? '1' : '0'; }
    function setTitle(k, t) { kicker.textContent = k || ''; name.textContent = t || ''; }
    function addGain(n) { if (!(n > 0)) return; const to = Number(gainN.textContent || 0) + n; gainN.textContent = String(to); gain.dataset.on = '1'; if (!reduced()) again(gain, 'is-bump'); }
    function showBanner(kick, text, ms = 1100) {
      banner.replaceChildren(el('small', '', kick), el('b', '', text)); banner.hidden = false;
      if (reduced()) { setTimeout(() => { banner.hidden = true; }, ms); return wait(0); }
      again(banner, 'is-show'); setTimeout(() => { banner.hidden = true; banner.classList.remove('is-show'); }, ms);
      return wait(Math.min(ms, 520));
    }
    function intro() { if (!reduced()) again(root, 'is-intro'); }
    // 美术清单晚到（不经营地直接进作答页）时补一次图
    function refreshArt() { const s = sceneNow; sceneNow = ''; setScene(s); setPose('portrait'); if (enemy) setEnemy(enemy, {instant: true}); }
    function victory(on = true) { root.classList.toggle('is-victory', on); if (on) setPose('cheer', 0); }
    return {root, top, hero: heroImg, foe: foeBody, gain, skillButton: skill, setHearts, setSkill, setBuffs, castSkill, guarded, knockdown, rise, setScene, setEnemy, setEnemyHp, strike, counter, defeat, flee, setCombo, setGauge, setProgress, setWaveMarks, setTitle, addGain, banner: showBanner, intro, victory, setPose, refreshArt,
      get enemy() { return enemy; }, destroy() { clearTimeout(poseTimer); root.removeEventListener('pointermove', onMove); }};
  }

  window.__pinkieGameStage = {create, waves, sceneOf, speciesOf, SCENES, optionButton, actionButton, ghostButton, closeButton, rankBadge, icon, sfx, reduced};
})();
