/* laolao-metre-home —— Metre 的空状态引导语（PLAN 6.3，批 4）
 *
 * Metre 的新会话还没说话时，输入框上方一句引导语（不是「有什么可以帮你」）。
 * 题库：laolao-metre-prompts.js（五类各 24 句，原样来自 ref/metre-prompts.json）。
 * 换句：9–12、14–18 点每 25 秒；12–14、18–23 点每 45 秒；23 点到 9 点每 90 秒。鼠标停在句子上不换，页面不可见不换。
 * 类别按时段加权（早上多启发式、强有力；下午多苏格拉底；晚上多反思；深夜多机锋），同一句 24 小时内不重复。
 * 彩蛋（有数据才出，不编）：时段问候、节气、节日、法定假日、最近的项目记忆；比例不超过三成，同一天同一类最多一次。
 *   数据来自 pinkie.metre.today（后端纯计算、不联网）。天气：App 里没有现成的天气数据，不做，也不为它发请求。
 * 动画：只动 opacity / transform；新句逐字浮现（每字 18 毫秒，最长 1.2 秒）；「减少动效」直接换字。
 * 点句子：放进输入框当开头；右边小箭头换下一句。 */
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
  function weightsFor(hour) {
    const w = {heuristic: 1, socratic: 1, reflective: 1, powerful: 1, koan: 1};
    if (hour >= 5 && hour < 12) { w.heuristic = 3; w.powerful = 3; }
    else if (hour >= 12 && hour < 18) w.socratic = 3;
    else if (hour >= 18 && hour < 23) w.reflective = 3;
    else w.koan = 3;
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
    early: ['早，{name}。天刚亮，今天第一件想落位的事是什么？', '早上好，{name}。先喝口水，再决定今天从哪一小步开始。'],
    morning: ['上午好，{name}。脑子最清楚的这几个小时，想留给哪件事？', '上午好，{name}。今天要是只做成一件事，你希望是哪一件？'],
    afternoon: ['午后好，{name}。上午走到哪了，下午还要接着走同一条路吗？', '午后好，{name}。困意上来的时候，先挑一件最小的事做完。'],
    dusk: ['傍晚了，{name}。今天哪件事已经可以放下了？', '傍晚好，{name}。天色暗下来之前，还有哪一句话想说完？'],
    night: ['晚上好，{name}。今天哪个瞬间，你想记得久一点？', '夜里好，{name}。白天没说完的那件事，现在想说说吗？'],
    late: ['深夜了，{name}。还醒着的话，是什么事放不下？', '这么晚了，{name}。今天先到这里，还是还差最后一小段？'],
  };
  const SEASON_NAMES = {spring: '春', summer: '夏', autumn: '秋', winter: '冬'};

  const stripMarks = (text) => String(text).replace(/\[\[|\]\]/g, '');
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
      for (const text of [...(category.user || []), ...(category.fable || [])]) out.push({category: category.id, en: category.en, zh: category.zh, text});
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
    const usable = allPrompts(data).map((item) => ({...item, shown: personalize(item.text, name, hour)})).filter((item) => item.shown);
    const category = weightedCategory(weightsFor(hour), random);
    let pool = usable.filter((item) => item.category === category && fresh(item));
    if (!pool.length) pool = usable.filter(fresh);
    if (!pool.length) pool = [...usable].sort((a, b) => (history[a.text] || 0) - (history[b.text] || 0)).slice(0, 1);
    const item = pool[Math.floor(random() * pool.length) % pool.length];
    return {kind: 'prompt', category: item.category, en: item.en, zh: item.zh, text: item.shown, key: item.text};
  }

  // 彩蛋候选：今天还没出过的类，有数据才有。
  function eggCandidates({today, now, name = '', eggsToday = {}}) {
    const hour = new Date(now).getHours();
    const out = [];
    const greet = GREETINGS[bucketOf(hour)];
    if (!eggsToday.greeting) out.push({type: 'greeting', text: withName(greet[Math.floor(now / 60_000) % greet.length], name)});
    if (today) {
      const holiday = today.holiday;
      const festival = (today.festivals || []).find((item) => item.kind === 'big' || item.kind === 'term') || (today.festivals || [])[0];
      if (festival && !eggsToday.festival) out.push({type: 'festival', text: `今天是${festival.name}。忙完手上这一段，留一点时间给自己和身边的人。`});
      else if (holiday && !eggsToday.festival) out.push({type: 'festival', text: `今天放${holiday}的假。要做的事挑最小的一件做完就好，剩下的交给明天。`});
      if (today.term && !eggsToday.term) out.push({type: 'term', text: `今天${today.term}。节气换了一格，手上的事要不要也换一换节奏？`});
      else if (today.season && !eggsToday.season && !today.term) {
        out.push({type: 'season', text: `${SEASON_NAMES[today.season] || ''}天了。这个季节里，你最想做完的是哪一件事？`});
      }
      const recent = today.recent;
      if (recent && recent.text && !eggsToday.memory) {
        const where = recent.folderName ? `在 ${recent.folderName} ` : '';
        out.push({type: 'memory', text: recent.category === 'open'
          ? `上次你${where}停在了「${recent.text}」，今天要先把它落位吗？`
          : `上次${where}定下了「${recent.text}」，今天还照这个走吗？`});
      }
    }
    return out;
  }

  // 这一次出不出彩蛋：出了之后彩蛋占比不超过三成，且有候选。
  function shouldEgg({shownToday = 0, eggsCount = 0, candidates = [], random = Math.random}) {
    if (!candidates.length) return false;
    if ((eggsCount + 1) / (shownToday + 1) > EGG_SHARE) return false;
    return random() < EGG_SHARE;
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

  const model = {intervalFor, weightsFor, bucketOf, personalize, pickPrompt, eggCandidates, shouldEgg, tokens, charDelay, allPrompts, stripMarks, withName, EGG_SHARE};

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
    line.tabIndex = 0;
    line.setAttribute('role', 'button');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pk-metre-prompt__next';
    next.setAttribute('aria-label', '换一句');
    next.title = '换一句';
    next.textContent = '→';
    const row = document.createElement('div');
    row.className = 'pk-metre-prompt__row';
    row.append(line, next);
    box.append(label, row);
    box.addEventListener('mouseenter', () => { hovering = true; });
    box.addEventListener('mouseleave', () => { hovering = false; arm(); });
    line.addEventListener('click', use);
    line.addEventListener('keydown', (event) => { if (event.key === 'Enter') use(); });
    next.addEventListener('click', () => { show(); });
    return box;
  }

  function use() {
    if (!current) return;
    const ta = document.querySelector('.agent-chat__composer-combobox textarea');
    if (!ta) return;
    const text = stripMarks(current.text);
    ta.value = text + (ta.value ? ' ' + ta.value : '');
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function render(item) {
    const label = box.querySelector('.pk-metre-prompt__kind');
    const line = box.querySelector('.pk-metre-prompt__text');
    label.textContent = item.kind === 'egg' ? '' : item.en;
    label.title = item.kind === 'egg' ? '' : CATEGORY_NOTES[item.category] || item.zh;
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
    const candidates = eggCandidates({today, now, name, eggsToday: day.types});
    let item;
    if (shouldEgg({shownToday: day.shown, eggsCount: day.count, candidates})) {
      const egg = candidates[Math.floor(Math.random() * candidates.length)];
      item = {kind: 'egg', text: egg.text};
      day.types[egg.type] = true;
      day.count += 1;
    } else {
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

  function sync() {
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
  window.addEventListener('laolao:modechange', () => setTimeout(sync, 0));
  setInterval(() => { try { sync(); } catch (error) { console.error('[metre-home]', error); } }, 700);

  window.__pinkieMetreHome = {...model, show: () => box && show(), get current() { return current; }};
})();
