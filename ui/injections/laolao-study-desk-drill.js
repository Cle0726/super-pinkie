/* 背一背播放器。题型按 PLAN §4.2 渲染，判题在本地；write 交给 drill.judge。 */
(() => {
  'use strict';
  if (window.__pinkieDrill) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const reward = () => window.__pinkieDeskReward;
  const lines = () => reward().lines;
  const CHOICE_MODES = new Set(['choice', 'truefalse', 'word2meaning', 'meaning2word', 'listen']);
  const MODE_LABEL = {choice: '单选', truefalse: '判断', word2meaning: '看词选义', meaning2word: '看义选词', listen: '听音选择', cloze: '填空', collocation: '搭配', pairs: '配对', homophonePairs: '谐音配对', order: '排序', write: '默写', spell: '拼写', dictate: '听写', flip: '回想', look: '认识一下', meet: '认识一下'};
  let pending = null, registered = false, restId = 0;

  function distance(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;
    const dp = Array.from({length: a.length + 1}, () => []);
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  function restTicker() {
    clearTimeout(restId);
    restId = setTimeout(() => {
      const gsap = window.__pinkieDeskVendors?.gsap;
      if (!gsap) return;
      const kids = gsap.globalTimeline.getChildren(true, true, true);
      if (!kids.some(t => t.isActive?.())) gsap.ticker.sleep();
    }, 800);
  }
  function speak(text) {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US'; utter.rate = .9;
    const voice = synth.getVoices?.().find(item => /^en[-_]US/i.test(item.lang));
    if (voice) utter.voice = voice;
    synth.speak(utter);
  }
  function hi(text, reduced) { return `<span class="pk-hl${reduced ? '' : ' pk-anim'}">${esc(text)}</span>`; }
  function scopeKey(scope) { try { return JSON.stringify(scope || null); } catch { return ''; } }

  const base = (mode, fields) => ({itemId: mode, cardRef: {book: mode === 'look' || mode === 'flip' || mode === 'choice' || mode === 'truefalse' || mode === 'cloze' || mode === 'pairs' || mode === 'order' || mode === 'write' ? 'notes' : 'vocab', noteId: 'n-' + mode, wordId: 'w-' + mode, recallId: 'r-' + mode}, mode, strength: 1, answer: '', reveal: {question: '', answer: ''}, ...fields, itemId: mode});
  const FIXTURES = {
    look: base('look', {strength: 0, prompt: 'TCP 三次握手的第二步是什么？', reveal: {question: 'TCP 三次握手的第二步是什么？', answer: '服务器回 SYN-ACK。'}}),
    flip: base('flip', {prompt: 'sizeof 一个字符串为什么比 strlen 大 1？', reveal: {question: 'sizeof 一个字符串为什么比 strlen 大 1？', answer: '末尾还有一个 \\0。'}}),
    choice: base('choice', {prompt: 'do-while 的循环体至少执行几次？', options: ['可能一次也不执行', '至少一次', '必须是偶数次', '和 while 完全一样'], answer: 1, reveal: {question: 'do-while 的循环体至少执行几次？', answer: '至少一次'}}),
    truefalse: base('truefalse', {prompt: 'int a[10] 的合法下标是 0 到 9。', options: ['对', '错'], answer: 0, reveal: {answer: '对。下标从 0 到 9。'}}),
    cloze: base('cloze', {prompt: 'be used to {{1}} 表示习惯于，这里的 to 是介词。', answer: ['doing'], bank: ['doing', 'do', 'done', 'to do'], reveal: {answer: 'doing'}}),
    pairs: base('pairs', {prompt: '把左边的问题和右边的答案配上', pairs: {left: ['avoid 后面', 'do-while', '数组下标', 'sizeof 字符串'], right: ['接 doing', '至少一次', '从 0 开始', '比长度多 1']}, answer: [[0, 0], [1, 1], [2, 2], [3, 3]], reveal: {answer: '按左边顺序对应右边。'}}),
    order: base('order', {strength: 3, prompt: '把 TCP 三次握手排成正确顺序', steps: ['客户端发送 SYN', '服务器回复 SYN-ACK', '客户端发送 ACK'], reveal: {answer: 'SYN → SYN-ACK → ACK'}}),
    write: base('write', {strength: 3, prompt: '用一句话写出 do-while 和 while 的差别', judge: 'model', answer: 'do-while 至少执行一次', reveal: {answer: 'do-while 先执行再判断，循环体至少一次；while 先判断，可能一次也不执行。'}}),
    meet: base('meet', {strength: 0, prompt: 'ambulance', speak: 'ambulance', reveal: {question: 'ambulance', answer: '救护车', extra: '/ˈæmbjələns/ · 谐音：俺不能死'}}),
    word2meaning: base('word2meaning', {prompt: 'ambulance', options: ['救护车', '大使馆', '雄心', '含糊的'], answer: 0, reveal: {answer: '救护车'}}),
    meaning2word: base('meaning2word', {prompt: '救护车', speak: 'ambulance', options: ['ambulance', 'embassy', 'ambition', 'ambiguous'], answer: 0, reveal: {answer: 'ambulance'}}),
    listen: base('listen', {prompt: '听发音，选出听到的词', speak: 'ambition', options: ['ambition', 'ambulance', 'ambiguous', 'embassy'], answer: 0, reveal: {answer: 'ambition'}}),
    collocation: base('collocation', {prompt: 'have an impact {{1}} the result', answer: ['on'], bank: ['on', 'in', 'to', 'at'], reveal: {answer: 'on'}}),
    homophonePairs: base('homophonePairs', {prompt: '单词对上碧琪编的谐音', pairs: {left: ['ambulance', 'ambition', 'embassy'], right: ['俺不能死', '俺必胜', '安倍喜']}, answer: [[0, 0], [1, 1], [2, 2]], reveal: {answer: '谐音只帮你记，考试别照着念。'}}),
    spell: base('spell', {strength: 3, prompt: '救护车', speak: 'ambulance', answer: 'ambulance', reveal: {answer: 'ambulance'}}),
    dictate: base('dictate', {strength: 3, prompt: '听写这个词', speak: 'embassy', answer: 'embassy', reveal: {answer: 'embassy'}}),
  };

  function start(opts = {}) {
    pending = {...opts};
    const desk = window.__pinkieStudyDesk;
    const pane = desk?.pane?.();
    if (pane?.state) pane.state.drillRoute = {...opts};
    if (desk?.go) desk.go('drill', opts);
  }

  function mount(root, ctx) {
    const local = ctx.local?.() || {};
    const route = {...(local.drillRoute || pending || {})};
    pending = null;
    local.drillRoute = null;
    const R = reward();
    let alive = true, busy = false, phase = 'load', index = 0, combo = 0, maxCombo = 0, stars = 0, shownAt = 0, startedAt = Date.now();
    let queue = [], sessionId = '', pendingN = 0, original = 0, sheetApi = null, holdFinish = Boolean(route.demo);
    const correctIds = new Set(), firstDone = new Set(), firstRight = new Set();
    let pickAt = () => {}, selectedEl = null, selection = null, filled = null, typed = null, hinted = false, ready = false, judgeApply = () => {};
    root.classList.add('pk-drill');
    root.replaceChildren();
    const top = el('header', 'pk-drill-top');
    const exit = el('button', 'pk-drill-exit', '×'); exit.type = 'button'; exit.setAttribute('aria-label', '退出背一背');
    const prog = el('div', 'pk-drill-progress');
    prog.setAttribute('role', 'progressbar'); prog.setAttribute('aria-valuemin', '0'); prog.setAttribute('aria-valuemax', '1'); prog.setAttribute('aria-valuenow', '0'); prog.setAttribute('aria-label', '本组进度');
    const ink = el('span', 'pk-drill-ink');
    const nib = el('i', 'pk-drill-nib'); nib.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6 L7 2.5 L11 6 L7 9.5 Z" fill="currentColor"/></svg>';
    prog.append(ink, nib);
    const comboHost = el('div', 'pk-drill-combo');
    const count = el('span', 'pk-drill-count', ''); count.setAttribute('aria-hidden', 'true');
    // 星星用矢量小星，不用 emoji（VFX.md）。
    const starLabel = el('span', 'pk-drill-stars'); starLabel.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2l1.9 4.3 4.7.4-3.6 3.1 1.1 4.6L8 11.2l-4.1 2.4 1.1-4.6L1.4 5.9l4.7-.4z"/></svg><b>0</b>';
    const starNum = starLabel.querySelector('b'); starLabel.setAttribute('aria-label', '这组星星 0');
    top.append(exit, prog, count, comboHost, starLabel);
    const pendingLine = el('p', 'pk-drill-pending'); pendingLine.hidden = true;
    // 题目是第一视觉：一栏（最宽 760）从上往下 = 题型小字 → 题干 → 选项 → 检查 / 反馈卡。反馈卡就落在选项下面，不盖题、不推走题。
    const stage = el('div', 'pk-drill-stage');
    const col = el('div', 'pk-drill-col');
    const q = el('div', 'pk-drill-q');
    const stickerHost = el('div', 'pk-drill-sticker pk-react-host');
    const bar = el('footer', 'pk-drill-bar');
    const keys = el('span', 'pk-drill-keys');
    const check = el('button', 'pk-drill-check'); check.type = 'button';
    const checkLabel = el('span', 'pk-drill-check-label', '检查');
    check.append(checkLabel); check.setAttribute('aria-disabled', 'true');
    bar.append(keys, check);
    col.append(q, bar);
    stage.append(col, stickerHost);
    const live = el('div', 'pk-sr'); live.setAttribute('aria-live', 'polite');
    root.append(top, pendingLine, stage, live);
    R.sticker(stickerHost, 'focus');
    exit.addEventListener('click', () => { askLeave(); });
    // 碧琪上岸记：战斗层（laolao-game-battle.js）。没有游戏层时是 null，播放器照旧。
    let battle = null; try { battle = window.__pinkieGameBattle?.attach(root, {route, top, stage}) || null; } catch { battle = null; }
    check.addEventListener('click', () => onCheck());
    check.addEventListener('pointerdown', () => { if (ready && !ctx.motion?.reduced) { check.classList.remove('pk-press'); void check.offsetWidth; check.classList.add('pk-press'); } });

    function paintCount() { count.textContent = original ? `${Math.min(correctIds.size, original)} / ${original}` : ''; }
    function focused() { return !ctx.desk?.isFocused || ctx.desk.isFocused(); }
    function fx(name, opts) { if (focused()) R.sound(name, opts); }
    function setReady(on, label) {
      ready = Boolean(on);
      if (label) checkLabel.textContent = label;
      check.classList.toggle('is-ready', ready);
      check.setAttribute('aria-disabled', String(!ready));
    }
    function shake(node) {
      if (!node || ctx.motion?.reduced) return;
      node.classList.remove('pk-shake'); void node.offsetWidth; node.classList.add('pk-shake');
      node.addEventListener('animationend', () => node.classList.remove('pk-shake'), {once: true});
    }
    function enter(node) {
      if (!node) return;
      const name = ctx.motion?.reduced ? 'pk-fade' : 'pk-enter';
      node.classList.add(name);
      node.addEventListener('animationend', () => node.classList.remove(name), {once: true});
    }
    function stem(node, text) {
      node.textContent = text || '';
      if ((text || '').length <= 40) ctx.motion?.splitIn?.(node, {duration: .35, stagger: .016});
      else if (!ctx.motion?.reduced) node.classList.add('pk-fade');
      restTicker();
    }
    const RETURN_LABEL = {today: '回营地', gamemap: '回地图', gamehunt: '回讨伐', gameexam: '回考场', vocab: '回生词本', notes: '回笔记本', stage: '回舞台'};
    function destination() {
      if (route.returnTo) return route.returnTo;
      const remembered = local.returnView;
      if (remembered && remembered !== 'drill') return remembered;
      if (route.source === 'vocab') return 'vocab';
      if (route.source === 'mixed') return 'today';
      return 'notes';
    }
    function backLabel() { return RETURN_LABEL[destination()] || '返回'; }
    function snapshot() {
      local.drillSaved = {source: route.source, scope: route.scope, size: route.size, returnTo: route.returnTo, task: route.task, sessionId, queue, index, combo, maxCombo, stars, pendingN, original, startedAt, correct: [...correctIds], first: [...firstDone], firstRight: [...firstRight]};
    }
    async function rpc(name, params, timeout) {
      try { return await ctx.request('pinkie.learning.drill.' + name, params || {}, timeout || 20000); }
      catch (error) {
        if (!/unknown method|method not found|未知方法/i.test(error?.message || '')) throw error;
        return localRpc(name, params);
      }
    }
    function localRpc(name, params) {
      if (name === 'session') {
        const id = params.scope?.ids?.[0];
        const items = id && FIXTURES[id] ? [structuredClone(FIXTURES[id])] : Object.values(FIXTURES).map(item => structuredClone(item));
        return {sessionId: 'local-drill', items, pending: 0, dueLeft: items.length, settings: {soundDefault: true}};
      }
      if (name === 'answer') return {rating: params.correct ? (params.hinted ? 'fuzzy' : 'remembered') : 'forgot', stars: params.correct && params.firstTry ? 1 : 0, requeue: !params.correct};
      if (name === 'learned') return {ok: true};
      if (name === 'judge') {
        const text = String(params.text || '');
        if (!text.trim()) return {verdict: 'wrong', missing: ['关键词'], comment: '先写下你记得的'};
        if (text.includes('部分')) return {verdict: 'partial', missing: ['一个要点'], comment: '差在这一处'};
        return {verdict: 'correct', missing: [], comment: '意思对了'};
      }
      // 结算没有后端就不能编成绩：交给失败分支，用本地真数据。
      if (name === 'finish') throw new Error('结算没记上');
      if (name === 'cheer') return {line: '这一页先放进手账，明天再遇见会更熟。'};
      if (name === 'settings.get') return {size: 10, jarGoal: 30, flipOnly: false};
      return {ok: true};
    }
    function demoSummary() {
      return {stars: stars + 5, accuracy: original ? correctIds.size / original : 1, ms: 252000, maxCombo: Math.max(combo, 10), firstFinishToday: true, streak: {current: 4, best: 4, stampedToday: true, leaveUsedYesterday: false, week: [true, true, true, true, false, false, false]}, jar: {today: 2, goal: 2, unit: 'sets', filledNow: true}, leaveNotes: 1, quiet: Boolean(route.quiet), backLabel: backLabel(), nextSuggestion: {source: 'notes', scope: {kind: 'more'}, label: '再背一组'}};
    }
    // 结算接口失败时只用这一组在本地真实发生的数：首答答对的比例、实际用时、星星、最大连对。不盖章、不动罐子。
    function localSummary() {
      const scored = firstDone.size;
      return {failed: true, stars, accuracy: scored ? firstRight.size / scored : 0, ms: Math.max(0, Date.now() - startedAt), maxCombo, firstFinishToday: false, quiet: Boolean(route.quiet), backLabel: backLabel()};
    }

    function choiceCorrect(item, i) {
      if (typeof item.answer === 'number') return i === item.answer;
      if (typeof item.answer === 'boolean') return (i === 0) === item.answer;
      return norm(item.options?.[i]) === norm(item.answer);
    }
    // 答完把选项定格：选错的那项变灰加删除线，正确那项用荧光笔刷一下（PLAN §3.4）。
    function markChoices(item, correct) {
      const buttons = [...q.querySelectorAll('.pk-drill-options .pk-choice')];
      buttons.forEach((button, i) => {
        button.disabled = true;
        button.classList.remove('is-on');
        if (choiceCorrect(item, i)) {
          button.classList.add('is-answer');
          const text = button.querySelector('span');
          if (text && !correct) text.className = 'pk-hl' + (ctx.motion?.reduced ? '' : ' pk-anim');
        } else if (i === selection) button.classList.add('is-wrong');
      });
    }
    function revealText(item) { return item.reveal?.answer || item.reveal?.question || ''; }

    function renderChoice(item) {
      const box = el('div', 'pk-drill-options');
      const buttons = (item.options || ['对', '错']).map((text, i) => {
        const b = el('button', 'pk-choice'); b.type = 'button';
        b.append(el('kbd', '', 'ABCDEFGHI'[i] || String(i + 1)), el('span', '', text));
        b.addEventListener('pointerdown', () => { if (!ctx.motion?.reduced) { b.classList.remove('pk-press'); void b.offsetWidth; b.classList.add('pk-press'); } });
        b.addEventListener('click', () => {
          selection = i; selectedEl = b;
          box.querySelectorAll('.pk-choice').forEach(n => { n.classList.toggle('is-on', n === b); n.setAttribute('aria-pressed', String(n === b)); });
          setReady(true, '检查'); fx('tick');
        });
        box.append(b); return b;
      });
      pickAt = i => buttons[i]?.click();
      return box;
    }
    function renderCloze(item) {
      const bank = [...(item.bank || [])];
      const slots = [];
      const prompt = el('div', 'pk-drill-cloze');
      String(item.prompt || '').split(/(\{\{\d+\}\}|\{\{blank\}\})/).forEach(part => {
        if (/^\{\{/.test(part)) {
          const slot = el('button', 'pk-blank', '____'); slot.type = 'button'; slot.dataset.i = String(slots.length);
          slot.setAttribute('aria-label', '第 ' + (slots.length + 1) + ' 空');
          slot.addEventListener('click', () => { if (slot.dataset.word) { bank.push(slot.dataset.word); slot.dataset.word = ''; slot.textContent = '____'; drawBank(); sync(); } });
          slots.push(slot); prompt.append(slot);
        } else prompt.append(document.createTextNode(part));
      });
      const bankHost = el('div', 'pk-bank');
      const drawBank = () => {
        bankHost.replaceChildren();
        bank.forEach((word, i) => {
          const chip = el('button', 'pk-chip', word); chip.type = 'button';
          chip.addEventListener('click', () => {
            const slot = slots.find(s => !s.dataset.word);
            if (!slot) return;
            slot.dataset.word = word; slot.textContent = word; bank.splice(i, 1); drawBank(); sync(); fx('tick');
          });
          bankHost.append(chip);
        });
      };
      const sync = () => { filled = slots.map(s => s.dataset.word || ''); setReady(filled.every(Boolean), '检查'); };
      drawBank(); filled = slots.map(() => '');
      pickAt = () => {};
      q.dataset.slots = String(slots.length);
      const wrap = el('div'); wrap.append(prompt, bankHost);
      wrap.grade = () => {
        const expect = [].concat(item.answer || []);
        const correct = expect.length === filled.length && expect.every((word, i) => norm(filled[i]) === norm(word));
        return {correct, answerHtml: hi(expect.join('、'), ctx.motion?.reduced), shake: correct ? null : prompt};
      };
      return wrap;
    }
    function renderPairs(item) {
      const left = item.pairs?.left || [], right = item.pairs?.right || [];
      const pairs = Array.isArray(item.answer) ? item.answer : left.map((_, i) => [i, i]);
      const map = new Map(pairs.map(([l, r]) => [l, r]));
      const matched = new Set();
      let side = null;
      const box = el('div', 'pk-pairs');
      const colL = el('div', 'pk-pair-col'), colR = el('div', 'pk-pair-col');
      let misses = 0;
      const homophone = item.mode === 'homophonePairs';
      colL.append(el('p', 'pk-pair-head', homophone ? '单词' : '问'));
      colR.append(el('p', 'pk-pair-head', homophone ? '谐音' : '答'));
      left.forEach((text, i) => {
        const b = el('button', 'pk-choice pk-pair', text); b.type = 'button'; b.setAttribute('aria-label', '左 ' + (i + 1) + ' ' + text);
        b.addEventListener('click', () => {
          if (matched.has('L' + i)) return;
          side = {i, el: b};
          colL.querySelectorAll('.is-on').forEach(n => n.classList.remove('is-on'));
          b.classList.add('is-on'); fx('tick');
        });
        colL.append(b);
      });
      right.forEach((text, i) => {
        const b = el('button', 'pk-choice pk-pair', text); b.type = 'button'; b.setAttribute('aria-label', '右 ' + (i + 1) + ' ' + text);
        b.addEventListener('click', () => {
          if (!side || matched.has('R' + i)) return;
          if (map.get(side.i) === i) {
            matched.add('L' + side.i); matched.add('R' + i);
            side.el.disabled = true; b.disabled = true; side.el.classList.add('is-lock'); b.classList.add('is-lock');
            fx('tick');
            if (matched.size >= left.length * 2) setReady(true, '检查');
          } else { hinted = true; misses += 1; side.el.dataset.miss = '1'; b.dataset.miss = '1'; fx('wrong'); shake(side.el); shake(b); }
          side = null; colL.querySelectorAll('.is-on').forEach(n => n.classList.remove('is-on'));
        });
        colR.append(b);
      });
      box.append(colL, colR);
      // 连错过也算配完，但记成「差一点点」（rating 模糊），反馈条说清连错了几次。
      box.grade = () => ({correct: matched.size >= left.length * 2, hinted, answerHtml: hi(revealText(item), ctx.motion?.reduced),
        ...(misses ? {kind: 'partial', line: `连错了 ${misses} 次，记一下标了灰的那几组`} : {})});
      return box;
    }
    function renderOrder(item) {
      const steps = item.steps || [];
      const pool = steps.length > 1 ? [...steps.slice(1), steps[0]] : steps.slice();
      const picked = [];
      const slots = el('div', 'pk-order-slots');
      const bank = el('div', 'pk-order-bank');
      const paint = () => {
        slots.replaceChildren(...(picked.length ? picked.map((text, i) => {
          const b = el('button', 'pk-chip', (i + 1) + '. ' + text); b.type = 'button';
          b.addEventListener('click', () => { pool.push(text); picked.splice(i, 1); paint(); });
          return b;
        }) : [el('p', 'pk-drill-extra', '按正确顺序点下面的步骤')]));
        bank.replaceChildren(...pool.map((text, i) => {
          const b = el('button', 'pk-choice', text); b.type = 'button';
          b.append(el('kbd', '', String(i + 1)));
          b.addEventListener('click', () => { picked.push(text); pool.splice(i, 1); paint(); fx('tick'); });
          return b;
        }));
        filled = picked.slice();
        setReady(picked.length === steps.length, '检查');
      };
      pickAt = i => bank.querySelectorAll('.pk-choice')[i]?.click();
      paint();
      const wrap = el('div'); wrap.append(slots, bank);
      wrap.grade = () => {
        const correct = steps.length === picked.length && steps.every((step, i) => step === picked[i]);
        return {correct, answerHtml: hi(steps.join(' → '), ctx.motion?.reduced), shake: correct ? null : bank};
      };
      return wrap;
    }
    function renderTyped(item, {rows = 1, placeholder = '写下你的答案'} = {}) {
      const input = rows > 1 ? el('textarea') : el('input');
      input.className = 'pk-drill-input'; input.placeholder = placeholder; input.setAttribute('aria-label', '答案');
      if (rows > 1) input.rows = rows;
      input.addEventListener('input', () => { typed = input.value; setReady(Boolean(input.value.trim()), phase === 'judge' ? '我自己判' : '检查'); });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (rows === 1 || event.metaKey || event.ctrlKey)) { event.preventDefault(); onCheck(); }
      });
      typed = '';
      const wrap = el('div'); wrap.append(input);
      if (item.speak) wrap.append(hear(item.speak));
      wrap.focus = () => input.focus();
      wrap.grade = () => ({text: input.value, node: input});
      return wrap;
    }
    function hear(text) {
      const b = el('button', 'pk-drill-hear'); b.type = 'button'; b.setAttribute('aria-label', '再听一遍');
      b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5.2v9.6L14.6 10z"/></svg><span>再听一遍</span><i aria-hidden="true"></i>';
      b.addEventListener('click', () => speak(text));
      return b;
    }
    function renderLook(item, meet) {
      const box = el('div');
      const title = el('h3', 'pk-drill-stem', item.prompt || item.reveal?.question || '');
      box.append(title);
      if (meet && item.reveal?.extra) box.append(el('p', 'pk-drill-extra', item.reveal.extra));
      box.append(el('p', 'pk-drill-extra', item.reveal?.answer || ''));
      if (item.speak) box.append(hear(item.speak));
      setReady(true, '记住了');
      box.grade = () => ({learned: true});
      return box;
    }
    function renderFlip(item) {
      // 题面由 show() 的 head 负责，这里只放答案和打分，不再多一个空标题。
      const box = el('div');
      const answer = el('div', 'pk-drill-extra pk-drill-answer'); answer.hidden = true;
      box.append(answer);
      let open = false;
      const flip = () => {
        if (open) return;
        open = true; answer.hidden = false; answer.textContent = revealText(item);
        check.hidden = true;
        const rate = el('div', 'pk-rate');
        for (const [rating, label, key] of [['forgot', '忘了', '1'], ['fuzzy', '模糊', '2'], ['remembered', '记得', '3']]) {
          const b = el('button', '', label); b.type = 'button'; b.dataset.rating = rating; b.append(el('kbd', '', key));
          b.addEventListener('click', () => gradeFlip(rating));
          rate.append(b);
        }
        box.append(rate);
        // 翻面后 1 / 2 / 3 就是忘了 / 模糊 / 记得。
        pickAt = i => rate.querySelectorAll('button')[i]?.click();
      };
      box.flip = flip;
      setReady(true, '翻面');
      return box;
    }
    async function gradeFlip(rating) {
      if (busy || phase !== 'ask') return;
      const item = queue[index];
      const correct = rating !== 'forgot';
      await settle({correct, hinted: rating === 'fuzzy', kind: correct ? (rating === 'fuzzy' ? 'partial' : 'right') : 'wrong', line: rating === 'fuzzy' ? '记个大概，等会儿再对一次。' : undefined, answerHtml: hi(revealText(item), ctx.motion?.reduced)});
    }

    function show(item = queue[index]) {
      if (!alive || !item) return maybeFinish();
      phase = 'ask'; selection = null; selectedEl = null; filled = null; typed = null; hinted = false; sheetApi = null;
      pickAt = () => {};
      setReady(false, '检查');
      shownAt = performance.now();
      q.replaceChildren();
      const head = el('h3', 'pk-drill-stem');
      const mode = item.mode;
      const choice = ['choice', 'truefalse', 'word2meaning', 'meaning2word', 'listen'].includes(mode);
      let body;
      if (mode === 'look' || mode === 'meet') body = renderLook(item, mode === 'meet');
      else if (mode === 'flip') body = renderFlip(item);
      else if (choice) body = renderChoice(item);
      else if (mode === 'cloze' || mode === 'collocation') body = renderCloze(item);
      else if (mode === 'pairs' || mode === 'homophonePairs') body = renderPairs(item);
      else if (mode === 'order') body = renderOrder(item);
      else if (mode === 'write') body = renderTyped(item, {rows: 3, placeholder: '凭记忆写下来。⌘↩ 也可以检查'});
      else if (mode === 'spell' || mode === 'dictate') body = renderTyped(item, {placeholder: mode === 'dictate' ? '听到的词' : '拼出这个词'});
      else body = renderFlip(item);
      if (mode === 'look' || mode === 'meet' || mode === 'cloze' || mode === 'collocation') q.append(body);
      else q.append(head, body);
      // 听力：播放控件放在题干的位置（题干上方），不是选项下面的小链接。
      if (item.speak) { if (mode !== 'meet' && mode !== 'look') { const h = hear(item.speak); const s0 = q.querySelector('.pk-drill-stem, .pk-drill-cloze'); if (s0) s0.before(h); else q.prepend(h); } speak(item.speak); }
      const stemNode = q.querySelector('.pk-drill-stem');
      if (stemNode && mode !== 'cloze' && mode !== 'collocation') stem(stemNode, stemNode.textContent || item.prompt || '');
      if (choice || mode === 'write' || mode === 'spell' || mode === 'dictate') setReady(false, '检查');
      const topic = item.point || item.topic || item.monster?.topic || '';
      q.prepend(el('p', 'pk-drill-kicker', [MODE_LABEL[mode] || '作答', topic].filter(Boolean).join(' · ')));
      if (stemNode && (stemNode.textContent || '').length > 90) {
        // 长题干在自己的框里滚；全露出来了就去掉下沿淡出。
        stemNode.classList.add('is-long');
        const fit = () => stemNode.classList.toggle('is-fit', stemNode.scrollHeight - stemNode.clientHeight < 2 || stemNode.scrollTop + stemNode.clientHeight >= stemNode.scrollHeight - 2);
        stemNode.addEventListener('scroll', fit, {passive: true}); setTimeout(fit, 60);
        try { const ro = new ResizeObserver(fit); ro.observe(stemNode); stemNode._ro = ro; } catch { /* 老 WebKit */ }
      }
      const nOpt = Math.min(9, (item.options || [0, 0]).length);
      keys.textContent = choice ? `${nOpt > 1 ? `1–${nOpt} 或 A–${'ABCDEFGHI'[nOpt - 1]} 选择 · ` : ''}Enter 检查` : (mode === 'flip' ? '空格翻面' : mode === 'look' || mode === 'meet' ? 'Enter 记住了' : 'Enter 检查');
      paintCount();
      if (index > 0) enter(q);
      check.hidden = false;
      R.sticker(stickerHost, 'focus');
      q._body = body;
      try { battle?.show(item, {total: original}); } catch { /* 游戏层出错不影响背一背 */ }
      bar.hidden = false;
      if (body?.focus) setTimeout(() => { if (alive && phase === 'ask') body.focus(); }, 40);
    }

    async function onCheck() {
      if (!alive || busy) return;
      if (phase === 'sheet') { root.querySelector('.pk-sheet .pk-btn')?.click(); return; }
      const item = queue[index]; if (!item) return;
      if (item.mode === 'flip') { q._body?.flip?.(); return; }
      if (item.mode === 'look' || item.mode === 'meet') return settle({learned: true, correct: true, silent: true, title: '记住了', line: '等会儿再考这一条。', kind: 'right'});
      if (!ready && item.mode !== 'write') return;
      if (item.mode === 'write') return judgeWrite(item);
      const body = q._body;
      let result;
      if (body?.grade && !['choice', 'truefalse', 'word2meaning', 'meaning2word', 'listen'].includes(item.mode)) result = body.grade();
      else if (item.mode === 'spell' || item.mode === 'dictate') {
        const text = typed || '';
        const d = distance(text, item.answer);
        const verdict = d === 0 ? 'correct' : d === 1 ? 'partial' : 'wrong';
        result = {correct: verdict === 'correct', verdict, yours: text, kind: verdict === 'partial' ? 'partial' : verdict === 'correct' ? 'right' : 'wrong', line: verdict === 'partial' ? '差一个字母。' : undefined, answerHtml: hi(String(item.answer), ctx.motion?.reduced), shake: verdict === 'correct' ? null : body};
      } else {
        const correct = choiceCorrect(item, selection);
        result = {correct, yours: item.options?.[selection] || '', answerHtml: hi(item.options?.[item.answer] || revealText(item), ctx.motion?.reduced), shake: correct ? null : selectedEl, after: () => markChoices(item, correct)};
      }
      if (hinted) result.hinted = true;
      await settle(result);
    }
    async function judgeWrite(item) {
      if (phase === 'judge') {
        if (q.querySelector('.pk-rate')) return;
        const self = el('div', 'pk-rate');
        for (const [verdict, label] of [['correct', '我对了'], ['partial', '部分对'], ['wrong', '我错了']]) {
          const b = el('button', '', label); b.type = 'button';
          b.addEventListener('click', () => judgeApply({verdict, missing: [], comment: verdict === 'partial' ? '先记最关键的那个词。' : verdict === 'wrong' ? '先记荧光笔那几个字。' : '是这个意思。'}));
          self.append(b);
        }
        q.append(self);
        return;
      }
      phase = 'judge'; setReady(true, '我自己判');
      const note = el('p', 'pk-drill-extra', lines().judging); q.append(note);
      R.sticker(stickerHost, 'focus');
      let settled = false;
      judgeApply = verdict => { if (settled) return; settled = true; q.querySelector('.pk-rate')?.remove(); note.remove(); finishWrite(item, verdict); };
      try {
        const judged = await rpc('judge', {sessionId, itemId: item.itemId, text: typed || ''}, 26000);
        judgeApply(judged || {verdict: 'wrong', missing: [], comment: '碧琪没来得及细看，按关键词判的'});
      } catch { /* 自己判的按钮还在 */ }
    }
    function finishWrite(item, judged) {
      const verdict = judged?.verdict || 'wrong';
      const correct = verdict === 'correct';
      settle({correct, verdict, yours: typed || '', kind: verdict === 'partial' ? 'partial' : correct ? 'right' : 'wrong', line: judged?.comment || '', missing: judged?.missing || [], answerHtml: hi(revealText(item), ctx.motion?.reduced)});
    }
    async function settle(result) {
      if (!alive) return;
      busy = true;
      const item = queue[index];
      const firstTry = !firstDone.has(item.itemId);
      const ms = Math.max(0, Math.round(performance.now() - shownAt));
      let response = {stars: 0, requeue: !result.correct};
      try { battle?.strike({correct: Boolean(result.correct), firstTry, learned: Boolean(result.learned), partial: result.verdict === 'partial', ms}); } catch { /* 同上 */ }
      try {
        if (route.demo) response = {stars: result.correct && firstTry && !result.learned ? 1 : 0, requeue: !result.correct && !result.learned};
        else if (result.learned) await rpc('learned', {sessionId, itemId: item.itemId});
        else response = await rpc('answer', {sessionId, itemId: item.itemId, correct: Boolean(result.correct), firstTry, hinted: Boolean(result.hinted), ms, ...(result.verdict ? {verdict: result.verdict} : {})}) || response;
      } catch (error) { busy = false; live.textContent = error.message || '没记上'; return; }
      if (!alive) return;
      result.after?.();
      if (!result.learned && firstTry) { firstDone.add(item.itemId); if (result.correct && !result.hinted && result.verdict !== 'partial') firstRight.add(item.itemId); }
      if (result.correct) correctIds.add(item.itemId);
      if (result.correct && !result.learned) { combo += 1; maxCombo = Math.max(maxCombo, combo); if (firstTry) stars += response.stars || (route.demo ? 1 : 0); }
      else if (!result.learned) { combo = 0; if (!route.demo && response.requeue !== false) queue.push({...item, replay: true}); }
      starNum.textContent = String(stars); starLabel.setAttribute('aria-label', '这组星星 ' + stars); paintCount();
      R.paintProgress(prog, original ? correctIds.size / original : 0);
      if (!result.learned) R.comboBadge(comboHost, combo);
      try { if (!result.learned) battle?.settled({response, combo, ok: Boolean(result.correct), correctCount: correctIds.size, total: original}); } catch { /* 同上 */ }
      R.sticker(stickerHost, result.correct ? (combo >= 3 ? 'combo' : 'cheer') : 'oops');
      if (result.shake) shake(result.shake);
      phase = 'sheet'; busy = false; check.hidden = true; bar.hidden = true;
      const kind = result.kind || (result.correct ? 'right' : 'wrong');
      sheetApi = R.feedbackSheet(col, {kind, title: result.title, line: result.line, answerHtml: result.answerHtml, missing: result.missing, silent: result.silent, onContinue: advance});
      attachExplain(sheetApi?.sheet, item, result);
      live.textContent = (result.title || (result.correct ? '对啦' : '差一点')) + '。' + (result.line || '');
    }
    function attachExplain(sheet, item, result) {
      if (!sheet || route.demo || result.learned) return;
      const copy = sheet.querySelector('.pk-sheet-copy');
      if (!copy) return;
      const known = item.reveal?.extra || '';
      const p = el('p', 'pk-sheet-explain', known || '碧琪在按标准答案讲…');
      copy.append(p);
      rpc('explain', {sessionId, itemId: item.itemId, yours: result.yours || ''}, 30000).then(r => {
        if (!p.isConnected) return;
        if (r?.text) p.textContent = r.text;
        else if (!known) p.remove();
      }).catch(() => { if (p.isConnected && !known) p.remove(); });
    }
    function advance() {
      sheetApi = null; index += 1;
      if (index >= queue.length) return maybeFinish();
      check.hidden = false; show();
    }
    async function maybeFinish() {
      if (holdFinish) { root.dataset.demo = 'hold'; return; }
      if (!alive || phase === 'over') return;
      phase = 'over'; check.hidden = true; bar.hidden = true;
      let summary;
      try { summary = route.demo ? demoSummary() : await rpc('finish', {sessionId}); }
      catch (error) { summary = localSummary(); live.textContent = (error.message || '') + '。' + lines().failed; }
      local.drillSaved = null;
      try { battle?.finish(summary); } catch { /* 同上 */ }
      showDone(summary);
    }
    function showDone(raw) {
      if (!alive) return;
      const summary = {...raw, backLabel: backLabel(), quiet: route.quiet || raw.quiet};
      const cheer = summary.failed ? null : route.demoCheer || (route.demo ? new Promise(resolve => setTimeout(() => resolve('计算机网络这组，握手的顺序你已经能自己排了。'), 2200)) : rpc('cheer', {sessionId}).then(r => r?.line || '').catch(() => ''));
      R.completeScreen(root, summary, {cheer, requireSuggestion: true, onAgain: () => again(summary), onBack: () => leave(summary),
        onRetry: async () => {
          const done = await rpc('finish', {sessionId});
          if (!alive || !done) return false;
          // 先关掉失败版，再按真结果重放一遍（这回才盖章、进罐）。
          setTimeout(() => showDone(done), 0);
          return true;
        }});
    }
    function again(summary) {
      const next = summary?.nextSuggestion;
      // 后端说没有下一组时结算页不显示这个按钮；这里再守一道，不去开一组注定落空的。
      if (!next) { leave(summary); return; }
      local.drillRoute = {source: next.source, scope: next.scope, size: route.size, returnTo: route.returnTo, task: route.task};
      ctx.go?.('drill');
    }
    function goBack(summary) {
      const to = destination();
      if (summary && to === 'today') local.drillJustFinished = {task: route.task || route.source, stars: summary.stars || stars};
      ctx.go?.(to);
    }
    function leave(summary) { goBack(summary); }
    async function askLeave() {
      if (phase === 'over') { leave(); return; }
      const n = Math.max(0, original - correctIds.size);
      const dialog = el('dialog', 'lesson-dialog pk-drill-ask');
      dialog.setAttribute('aria-label', '先放着');
      dialog.append(el('p', '', lines().exit(n)));
      const row = el('div', 'pk-done-actions');
      const stay = el('button', 'pk-btn', '接着背'); stay.type = 'button'; stay.dataset.kind = 'go'; stay.setAttribute('aria-label', '接着背');
      const quit = el('button', 'pk-link', '先放着'); quit.type = 'button'; quit.setAttribute('aria-label', '先放着');
      stay.addEventListener('click', () => dialog.close('stay'));
      quit.addEventListener('click', () => dialog.close('leave'));
      row.append(stay, quit); dialog.append(row); root.append(dialog); dialog.showModal();
      dialog.addEventListener('close', () => {
        const go = dialog.returnValue === 'leave'; dialog.remove();
        if (go) { snapshot(); goBack(); }
      }, {once: true});
    }
    function sameSaved(saved) { return saved && saved.source === route.source && scopeKey(saved.scope) === scopeKey(route.scope); }
    function resume(saved) {
      sessionId = saved.sessionId; queue = saved.queue || []; index = saved.index || 0; combo = saved.combo || 0; maxCombo = saved.maxCombo || combo; stars = saved.stars || 0;
      pendingN = saved.pendingN || 0; original = saved.original || queue.length; startedAt = saved.startedAt || Date.now();
      saved.correct?.forEach(id => correctIds.add(id)); saved.first?.forEach(id => firstDone.add(id)); saved.firstRight?.forEach(id => firstRight.add(id));
      prog.setAttribute('aria-valuemax', String(original || 1));
      starNum.textContent = String(stars); paintCount();
      R.paintProgress(prog, original ? correctIds.size / original : 0);
      R.comboBadge(comboHost, combo);
      if (pendingN > 0) { pendingLine.hidden = false; pendingLine.textContent = lines().pending(pendingN); }
      root.dataset.demo = route.demo ? 'ready' : '';
      show();
    }
    function askResume(saved) {
      phase = 'ask';
      q.replaceChildren(el('h3', 'pk-drill-stem', '接着上次那组？'), el('p', 'pk-drill-extra', '进度还在这一页上。'));
      const row = el('div', 'pk-done-actions');
      const yes = el('button', 'pk-btn', '接着背'); yes.type = 'button'; yes.dataset.kind = 'go';
      const no = el('button', 'pk-link', '重新开始'); no.type = 'button';
      yes.addEventListener('click', () => resume(saved));
      no.addEventListener('click', () => { local.drillSaved = null; openFresh(); });
      row.append(yes, no); q.append(row); check.hidden = true;
    }
    async function openFresh() {
      phase = 'load'; q.replaceChildren(el('p', 'pk-drill-empty', '碧琪在翻这一组…'));
      try {
        let settings = {};
        try { settings = await rpc('settings.get', {}); } catch { settings = {}; }
        const size = route.size || settings.size || 10;
        const data = route.session ? route.session : route.items ? {sessionId: 'demo', items: route.items, pending: route.pending || 0, dueLeft: route.items.length} : await rpc('session', {source: route.source || 'mixed', scope: route.scope || {kind: 'due'}, size});
        if (!alive) return;
        sessionId = data.sessionId; pendingN = data.pending || 0; startedAt = Date.now();
        settings = {...settings, ...(data.settings || {})};
        queue = (data.items || []).map(item => settings.flipOnly && !['look', 'meet', 'flip'].includes(item.mode) ? {...item, mode: 'flip'} : item);
        original = queue.length; index = 0;
        prog.setAttribute('aria-valuemax', String(original || 1));
        if (pendingN > 0) { pendingLine.hidden = false; pendingLine.textContent = lines().pending(pendingN); }
        if (!queue.length) { q.replaceChildren(el('p', 'pk-drill-empty', '这组暂时没有可背的。')); check.hidden = true; return; }
        root.dataset.demo = route.demo ? 'ready' : '';
        show();
        if (route.demo && route.auto !== false) autorun();
      } catch (error) {
        if (!alive) return;
        // 打不开时（没有可背的、回忆卡还在拆）不留一个点不动的「检查」，给一个再试一次。
        check.hidden = true;
        const retry = el('button', 'pk-link', '再试一次'); retry.type = 'button'; retry.setAttribute('aria-label', '再试一次');
        retry.addEventListener('click', () => { check.hidden = false; openFresh(); });
        const box = el('div', 'pk-drill-empty');
        box.append(el('p', '', error.message || '这组没有打开'), retry);
        q.replaceChildren(box);
      }
    }
    async function autorun() {
      root.dataset.demo = 'playing';
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const clickSheet = () => root.querySelector('.pk-sheet .pk-btn')?.click();
      await wait(700); pickAt(1); await wait(280); await onCheck(); await wait(1600); clickSheet();
      await wait(600); pickAt(0); await wait(280); await onCheck(); await wait(1700); clickSheet();
      await wait(500); R.comboBadge(root, 3); await wait(1500); R.comboBadge(root, 5); await wait(1300); R.comboBadge(root, 10); await wait(1600);
      holdFinish = false; await maybeFinish(); await wait(4200); if (alive) root.dataset.demo = 'done';
    }
    function onKey(event) {
      if (!alive || !focused()) return;
      if (event.key === 'Escape') { event.preventDefault(); askLeave(); return; }
      // 结算页上的按钮（再背一组 / 回去）用键盘按下时让按钮自己响应，不当成「检查」。
      if ((event.key === 'Enter' || event.code === 'Space') && event.target?.closest?.('.pk-done')) return;
      if (event.key === 'Enter') { event.preventDefault(); onCheck(); return; }
      if (event.code === 'Space') { event.preventDefault(); if (queue[index]?.mode === 'flip' && phase === 'ask') q._body?.flip?.(); return; }
      if (phase === 'ask' && /^[1-9]$/.test(event.key)) { event.preventDefault(); pickAt(Number(event.key) - 1); return; }
      // A–D 也能选（只在选择题，且焦点不在输入框里）。
      if (phase === 'ask' && /^[a-i]$/i.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && CHOICE_MODES.has(queue[index]?.mode) && !event.target?.closest?.('input,textarea')) { event.preventDefault(); pickAt('abcdefghi'.indexOf(event.key.toLowerCase())); }
    }
    const saved = local.drillSaved;
    if (route.demo) {
      route.items = route.items || [structuredClone(FIXTURES.choice), {...structuredClone(FIXTURES.choice), itemId: 'choice-2', prompt: 'for 循环里 continue 会怎样？', options: ['结束整个循环', '跳过这一次', '从头再来', '什么也不做'], answer: 1}];
      openFresh();
    } else if (!route.force && sameSaved(saved)) askResume(saved);
    else openFresh();

    return {unmount() { alive = false; try { battle?.detach(); } catch { /* 同上 */ } clearTimeout(restId); window.speechSynthesis?.cancel(); root.querySelectorAll('dialog').forEach(d => { d.close(); d.remove(); }); R.stop?.(); },
      keydown: onKey,
      pause() { window.speechSynthesis?.cancel(); },
      resume() {}};
  }

  function register() {
    const desk = window.__pinkieStudyDesk;
    if (registered || !desk?.registerView) return false;
    desk.registerView('drill', {title: '背一背', mount});
    registered = true; return true;
  }
  window.__pinkieDrill = {start, fixtures: FIXTURES};
  if (!register()) {
    const timer = window.setInterval(() => { if (register()) window.clearInterval(timer); }, 200);
    window.addEventListener('pagehide', () => window.clearInterval(timer), {once: true});
  }
})();
