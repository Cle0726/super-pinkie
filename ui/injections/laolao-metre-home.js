/* laolao-metre-home —— Metre 的空状态引导语（PLAN 6.3，批 4）
 *
 * Metre 的新会话还没说话时，输入框上方一句引导语（不是「有什么可以帮你」）。
 * 题库：laolao-metre-prompts.js（五类各 24 句，原样来自 ref/metre-prompts.json）。
 * 换句：9–12、14–18 点每 25 秒；12–14、18–23 点每 45 秒；23 点到 9 点每 90 秒。鼠标停在句子上不换，页面不可见不换。
 * 类别按时段加权（早上多启发式、强有力、点火、微行动；下午多苏格拉底、拖延、第一性原理；晚上多反思、复盘、冷暖；深夜多机锋、暗夜、禅意），同一句 24 小时内不重复。
 * 彩蛋（有数据才出，不编）：时段问候、节气、节日、法定假日、最近的项目记忆；比例不超过三成，同一天同一类最多一次。
 * 节日 / 放假当天：第一句就是节日彩蛋，之后节日彩蛋机会是其它彩蛋的 3 倍、一天可出多次，但不连着出。
 *   数据来自 pinkie.metre.today（后端纯计算、不联网）。天气：App 里没有现成的天气数据，不做，也不为它发请求。
 * 动画：只动 opacity / transform；新句逐字浮现（每字 18 毫秒，最长 1.2 秒）；「减少动效」直接换字。
 * 句子只是看的，点了不会放进输入框；右边「换一句」换下一句。 */
(() => {
  'use strict';
  if (window.__pinkieMetreHome) return;

  const DAY = 24 * 3600_000;
  const HISTORY_KEY = 'pinkie-metre-prompt-history-v1';
  const EGG_KEY = 'pinkie-metre-prompt-eggs-v1';
  const NAME_KEY = 'pinkie-metre-name';
  const EGG_SHARE = 0.3;
  const CATEGORY_NOTES = {
    heuristic: '启发式提问：不催促、不施压，帮你从复杂局面里找到最核心的抓手',
    socratic: '苏格拉底式提问：温和而锋利，追问前提，拆盲区和执念',
    reflective: '反思性提示：按下一秒暂停键，看看自己此刻真实的状态',
    powerful: '强有力提问：一个画面感很强的假设，把视野从琐碎拉到高处',
    koan: '顿悟式提问 / 机锋：化进乐团与独奏的隐喻和人间烟火，让人停一秒',
  };

  // ---------- 纯函数 ----------
  function intervalFor(hour) {
    if ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) return 25_000;
    if ((hour >= 12 && hour < 14) || (hour >= 18 && hour < 23)) return 45_000;
    return 90_000;
  }
  // 每个时段多出几类（×3），其余各 1；题库里有的类都能轮到。
  const BOOSTS = [
    [(h) => h >= 5 && h < 12, ['heuristic', 'powerful', 'ignition', 'microaction']],
    [(h) => h >= 12 && h < 18, ['socratic', 'friction', 'firstprinciples']],
    [(h) => h >= 18 && h < 23, ['reflective', 'review', 'warmth']],
    [() => true, ['koan', 'latenight', 'zen']],
  ];
  function weightsFor(hour, ids) {
    const w = {};
    for (const id of ids || ['heuristic', 'socratic', 'reflective', 'powerful', 'koan']) w[id] = 1;
    const boosted = BOOSTS.find(([test]) => test(hour))[1];
    for (const id of boosted) if (id in w || !ids) w[id] = 3;
    return w;
  }
  // 时段：早、上午、午后、傍晚、夜里、深夜
  function bucketOf(hour) {
    if (hour >= 5 && hour < 9) return 'early';
    if (hour >= 9 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 19) return 'dusk';
    if (hour >= 19 && hour < 23) return 'night';
    return 'late';
  }
  const GREETINGS = {
    early: ['早，{name}。天刚亮，今天[[第一件想落位的事]]是什么？', '早上好，{name}。先喝口水，再决定今天从[[哪一小步]]开始。'],
    morning: ['上午好，{name}。[[脑子最清楚]]的这几个小时，想留给哪件事？', '上午好，{name}。今天要是[[只做成一件事]]，你希望是哪一件？'],
    afternoon: ['午后好，{name}。上午走到哪了，下午还要接着走[[同一条路]]吗？', '午后好，{name}。困意上来的时候，先挑一件[[最小的事]]做完。'],
    dusk: ['傍晚了，{name}。今天哪件事已经[[可以放下]]了？', '傍晚好，{name}。天色暗下来之前，还有[[哪一句话]]想说完？'],
    night: ['晚上好，{name}。今天哪个瞬间，你想[[记得久一点]]？', '夜里好，{name}。[[白天没说完]]的那件事，现在想说说吗？'],
    late: ['深夜了，{name}。还醒着的话，是什么事[[放不下]]？', '这么晚了，{name}。今天先到这里，还是还差[[最后一小段]]？'],
  };
  const SEASON_NAMES = {spring: '春', summer: '夏', autumn: '秋', winter: '冬'};

  const stripMarks = (text) => String(text).replace(/\[\[|\]\]/g, '');
  // 句子里的英文注释「（Blocking I/O）」只留在题库里，首页不显示。
  const dropGlosses = (text) => String(text).replace(/（[^（）]*[A-Za-z][^（）]*）/g, '');
  // 「下午好，C.le. 此时此刻……」：只在 12–18 点出；称呼换成设置里的名字，没有名字时从「此时此刻」开始。
  const GREETED = /^下午好，C\.le\.\s*/;
  function personalize(text, name, hour) {
    if (!GREETED.test(text)) return text;
    if (hour < 12 || hour >= 18) return null;
    return name ? text.replace(GREETED, `下午好，${name}。`) : text.replace(GREETED, '');
  }
  function withName(template, name) {
    return name ? template.replace('{name}', name) : template.replace(/[，,]\s*\{name\}/, '').replace('{name}', '');
  }

  function allPrompts(data) {
    const out = [];
    for (const category of (data && data.categories) || []) {
      for (const text of [...(category.user || []), ...(category.fable || [])]) out.push({category: category.id, en: category.en, zh: category.zh, note: category.note, text});
    }
    return out;
  }

  function weightedCategory(weights, random) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = random() * total;
    for (const [id, w] of entries) { roll -= w; if (roll < 0) return id; }
    return entries[entries.length - 1][0];
  }

  // 选下一句。history: {text → 上次显示的时间}；24 小时内出过的不再出（全出过了就选最久以前的）。
  function pickPrompt({data, now, history = {}, random = Math.random, name = ''}) {
    const date = new Date(now);
    const hour = date.getHours();
    const fresh = (item) => !history[item.text] || now - history[item.text] >= DAY;
    const usable = allPrompts(data).map((item) => ({...item, shown: personalize(dropGlosses(item.text), name, hour)})).filter((item) => item.shown);
    const category = weightedCategory(weightsFor(hour, [...new Set(usable.map((item) => item.category))]), random);
    let pool = usable.filter((item) => item.category === category && fresh(item));
    if (!pool.length) pool = usable.filter(fresh);
    if (!pool.length) pool = [...usable].sort((a, b) => (history[a.text] || 0) - (history[b.text] || 0)).slice(0, 1);
    const item = pool[Math.floor(random() * pool.length) % pool.length];
    return {kind: 'prompt', category: item.category, en: item.en, zh: item.zh, note: item.note, text: item.shown, key: item.text};
  }

  // 彩蛋候选：今天还没出过的类，有数据才有。节日 / 放假当天节日彩蛋不限一次，只是不连着出两次（lastType）。
  function eggCandidates({today, now, name = '', eggsToday = {}, lastType = ''}) {
    const hour = new Date(now).getHours();
    const out = [];
    const greet = GREETINGS[bucketOf(hour)];
    if (!eggsToday.greeting) out.push({type: 'greeting', text: withName(greet[Math.floor(now / 60_000) % greet.length], name)});
    if (today) {
      const holiday = today.holiday;
      const festival = (today.festivals || []).find((item) => item.kind === 'big' || item.kind === 'term') || (today.festivals || [])[0];
      const festivalOpen = lastType !== 'festival';
      if (festival && festivalOpen) out.push({type: 'festival', text: `今天是[[${festival.name}]]。忙完手上这一段，留一点时间给自己和身边的人。`});
      else if (holiday && festivalOpen) out.push({type: 'festival', text: `今天放${holiday}的假。要做的事挑[[最小的一件]]做完就好，剩下的交给明天。`});
      if (today.term && !eggsToday.term) out.push({type: 'term', text: `今天[[${today.term}]]。节气换了一格，手上的事要不要也换一换节奏？`});
      else if (today.season && !eggsToday.season && !today.term) {
        out.push({type: 'season', text: `${SEASON_NAMES[today.season] || ''}天了。这个季节里，你[[最想做完]]的是哪一件事？`});
      }
      const recent = today.recent;
      if (recent && recent.text && !eggsToday.memory) {
        const plain = (t) => String(t).replace(/\[\[|\]\]/g, '');
        const where = recent.folderName ? `在 ${recent.folderName} ` : '';
        out.push({type: 'memory', text: recent.category === 'open'
          ? `上次你${where}停在了「[[${plain(recent.text)}]]」，今天要先把它落位吗？`
          : `上次${where}定下了「[[${plain(recent.text)}]]」，今天还照这个走吗？`});
      }
    }
    return out;
  }

  // 这一次出不出彩蛋：出了之后彩蛋占比不超过三成，且有候选。
  // 节日当天第一句就是节日彩蛋。
  const FESTIVAL_WEIGHT = 3;
  function shouldEgg({shownToday = 0, eggsCount = 0, candidates = [], random = Math.random}) {
    if (!candidates.length) return false;
    if (shownToday === 0 && candidates.some((egg) => egg.type === 'festival')) return true;
    if ((eggsCount + 1) / (shownToday + 1) > EGG_SHARE) return false;
    return random() < EGG_SHARE;
  }

  // 挑哪一个彩蛋：当天第一句有节日就是节日；之后节日的机会是其它的 3 倍。
  function pickEgg(candidates, random = Math.random, {first = false} = {}) {
    const festival = candidates.find((egg) => egg.type === 'festival');
    if (first && festival) return festival;
    const weight = (egg) => (egg.type === 'festival' ? FESTIVAL_WEIGHT : 1);
    let roll = random() * candidates.reduce((sum, egg) => sum + weight(egg), 0);
    for (const egg of candidates) { roll -= weight(egg); if (roll < 0) return egg; }
    return candidates[candidates.length - 1];
  }

  function tokens(text) {
    // [[关键词]] → 强调；其余逐字。返回 [{ch, kw}]
    const out = [];
    const parts = String(text).split(/(\[\[[^\]]+\]\])/);
    for (const part of parts) {
      const kw = /^\[\[/.test(part);
      for (const ch of kw ? part.slice(2, -2) : part) out.push({ch, kw});
    }
    return out;
  }
  const charDelay = (length) => Math.min(18, 1200 / Math.max(1, length));

  const model = {intervalFor, weightsFor, bucketOf, personalize, pickPrompt, eggCandidates, shouldEgg, pickEgg, tokens, charDelay, allPrompts, stripMarks, dropGlosses, withName, EGG_SHARE};

  // ---------- 存取（只在本机浏览器，坏了就当没有） ----------
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const todayStamp = (now) => new Date(now).toDateString();
  const userName = () => { try { return String(localStorage.getItem(NAME_KEY) || '').trim().slice(0, 24); } catch { return ''; } };

  // ---------- 画面 ----------
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const reduced = () => document.documentElement.hasAttribute('data-pinkie-reduce-motion')
    || Boolean(window.__pinkieMotion?.reduce) || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const rpc = (method, params) => typeof window.__laolaoSidebar?.gwRequest === 'function'
    ? window.__laolaoSidebar.gwRequest(method, params, 6000) : Promise.reject(new Error('offline'));
  const sessionKey = () => { try { return new URL(location.href).searchParams.get('session') || ''; } catch { return ''; } };

  let box = null, timer = 0, hovering = false, current = null, today = null, todayFor = '', todayAt = 0;

  function build() {
    box = document.createElement('div');
    box.className = 'pk-metre-prompt';
    const label = document.createElement('span');
    label.className = 'pk-metre-prompt__kind';
    const line = document.createElement('p');
    line.className = 'pk-metre-prompt__text';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pk-metre-prompt__next';
    next.setAttribute('aria-label', '换一句');
    next.title = '换一句';
    next.textContent = '换一句 →';
    // 第六版：上面一行是「速度记号」——类别、♩ = 72、四个拍点（背景点阵每拍把 data-beat 改一次），右边「换一句」。
    const tempo = document.createElement('span');
    tempo.className = 'pk-metre-tempo';
    tempo.setAttribute('aria-hidden', 'true');
    tempo.dataset.beat = '0';
    tempo.innerHTML = '<span class="pk-metre-tempo__mark">♩ = 72</span><i></i><i></i><i></i><i></i>';
    const head = document.createElement('div');
    head.className = 'pk-metre-prompt__head';
    head.append(label, tempo, next);
    const row = document.createElement('div');
    row.className = 'pk-metre-prompt__row';
    row.append(line);
    box.append(head, row);
    box.addEventListener('mouseenter', () => { hovering = true; });
    box.addEventListener('mouseleave', () => { hovering = false; arm(); });
    next.addEventListener('click', () => { show(); });
    return box;
  }

  function render(item) {
    const label = box.querySelector('.pk-metre-prompt__kind');
    const line = box.querySelector('.pk-metre-prompt__text');
    label.textContent = item.kind === 'egg' ? '' : item.en;
    label.title = item.kind === 'egg' ? '' : CATEGORY_NOTES[item.category] || (item.note ? `${item.zh}：${item.note}` : item.zh);
    label.hidden = item.kind === 'egg';
    line.setAttribute('aria-label', stripMarks(item.text));
    const list = tokens(item.text);
    const step = charDelay(list.length);
    const animate = !reduced();
    const write = () => {
      // 逐字一个 span（浮现用）；同一个关键词的字包在一个 .pk-metre-kw 里（下划线连成一条）。
      const nodes = [];
      let group = null;
      list.forEach(({ch, kw}, index) => {
        const span = document.createElement('span');
        span.className = 'pk-metre-ch';
        span.textContent = ch;
        if (animate) span.style.animationDelay = `${Math.round(index * step)}ms`;
        if (kw) {
          if (!group) { group = document.createElement('span'); group.className = 'pk-metre-kw'; nodes.push(group); }
          group.append(span);
        } else { group = null; nodes.push(span); }
      });
      line.replaceChildren(...nodes);
      line.classList.toggle('is-enter', animate);
      line.classList.remove('is-leave');
    };
    if (animate && line.childNodes.length) {
      line.classList.add('is-leave');
      setTimeout(write, 220);
    } else write();
  }

  function show() {
    const now = Date.now();
    const history = load(HISTORY_KEY, {});
    const stamp = todayStamp(now);
    const eggs = load(EGG_KEY, {});
    const day = eggs.day === stamp ? eggs : {day: stamp, shown: 0, count: 0, types: {}};
    const name = userName();
    const candidates = eggCandidates({today, now, name, eggsToday: day.types, lastType: day.last});
    let item;
    if (shouldEgg({shownToday: day.shown, eggsCount: day.count, candidates})) {
      const egg = pickEgg(candidates, Math.random, {first: day.shown === 0});
      item = {kind: 'egg', text: egg.text};
      day.types[egg.type] = true;
      day.count += 1;
      day.last = egg.type;
    } else {
      day.last = '';
      item = pickPrompt({data: window.LaolaoMetrePrompts, now, history, name});
      history[item.key] = now;
      for (const [text, at] of Object.entries(history)) if (now - at >= DAY) delete history[text];
      save(HISTORY_KEY, history);
    }
    day.shown += 1;
    save(EGG_KEY, day);
    current = item;
    render(item);
    arm();
  }

  function arm() {
    clearTimeout(timer);
    timer = 0;
    if (!box || !box.isConnected || document.hidden || hovering) return;
    timer = setTimeout(() => { timer = 0; if (!hovering && !document.hidden && box?.isConnected) show(); }, intervalFor(new Date().getHours()));
  }

  async function refreshToday() {
    const key = sessionKey();
    if (today && todayFor === key && Date.now() - todayAt < 30 * 60_000) return;
    todayFor = key; todayAt = Date.now();
    try {
      const result = await rpc('pinkie.metre.today', /^agent:metre:/.test(key) ? {sessionKey: key} : {});
      if (result && result.ok !== false) today = result;
    } catch { /* 没数据就不出那几类彩蛋 */ }
  }

  // 对话页左上角的会话标题（照 Claude 对话页：内容区顶上左边是这次会话的名字）。
  // 名字直接取侧栏里选中的那一行，不另发请求；首页和没有选中会话时不出现。
  let titleEl = null;
  function syncTitle() {
    const root = document.documentElement;
    const header = isMetre() && root.getAttribute('data-laolao-startup-home') !== '1' ? document.querySelector('.dashboard-header') : null;
    const name = header ? ([...document.querySelectorAll('aside.sidebar .sidebar-recent-session--active .sidebar-recent-session__name')].find((node) => node.getClientRects().length)?.textContent || '').trim() : '';
    if (!name) { if (titleEl?.isConnected) titleEl.remove(); return; }
    if (!titleEl) { titleEl = document.createElement('span'); titleEl.className = 'pk-metre-title'; }
    if (titleEl.textContent !== name) { titleEl.textContent = name; titleEl.title = name; }
    if (titleEl.parentElement !== header) header.prepend(titleEl);
  }

  function sync() {
    syncTitle();
    const welcome = isMetre() ? [...document.querySelectorAll('.agent-chat__welcome')].find((node) => node.getClientRects().length) : null;
    if (!welcome) {
      if (box?.isConnected) { box.remove(); clearTimeout(timer); timer = 0; }
      return;
    }
    if (!box) build();
    if (box.parentElement !== welcome) {
      welcome.append(box);
      // 第一句马上出；今天的数据（彩蛋用）回来后从下一句起才可能用上。
      void refreshToday();
      show();
    } else if (!timer && !hovering && !document.hidden) arm();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = 0; } else arm(); });
  let syncQueued = false;
  const queueSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    setTimeout(() => { syncQueued = false; sync(); }, 0);
  };
  window.addEventListener('laolao:modechange', queueSync);
  window.addEventListener('pinkie:session-selected', queueSync);
  window.addEventListener('laolao:sessions-changed', queueSync);
  if (typeof MutationObserver === 'function') {
    const mountSelector = '.agent-chat__welcome, .dashboard-header, .sidebar-recent-session--active, .sidebar-recent-session__name';
    const root = document.documentElement;
    new MutationObserver(records => {
      if (!isMetre() && !box?.isConnected && !titleEl?.isConnected) return;
      if (records.some(rec => rec.type === 'attributes'
        ? rec.target === root || rec.target.matches?.('.sidebar-recent-session')
        : rec.target.closest?.('.sidebar-recent-session--active') || [...rec.addedNodes, ...rec.removedNodes].some(
          node => node.matches?.(mountSelector) || node.querySelector?.(mountSelector)
        ))) queueSync();
    }).observe(root, {childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'data-laolao-startup-home', 'data-laolao-mode']});
  }
  queueSync();

  window.__pinkieMetreHome = {...model, show: () => box && show(), get current() { return current; }};
})();
