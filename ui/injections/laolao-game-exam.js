/* 碧琪上岸记 · 考场（学习台视图 gameexam）。
   - 考场大厅：卷架（左「历年真题」按年份 + 官方模拟卷，右「仿真卷」；U 盘备卷进度）、巴别兽状态（离稳过线还差几分）、卷子列表（exam.papers / generate，生成中自动刷新）、B 级五部分说明、真分数录入（boss.realScore）。考过的卷子可直接回看整卷与解析，或再考一次。
   - 真考场：盖满学习台的安静考卷。倒计时（endsAt）、五部分导航、答题卡、标记待检查、15 秒自动保存 + 本地草稿、关掉再开接着考（exam.start 的 resumed/answers）、
     真题听力放原录音（start.audio.url，整场一个播放条）；仿真卷听力用系统 TTS 朗读 item.tts（对话按 W:/M: 换声音，听写读 repeat 遍）。术语配对动态识别卷面字母（A–Q）。**考试中零特效**：不调 fx、不播音效、HUD 隐藏。
   - 交卷：exam.submit → 客观题瞬间出答案、主观题并发阅卷（不再逐题调模型等几分钟）→ Boss 结算（可跳过）→ 成绩报告 → 一键「预览整卷 & 挑题解析」（全卷对错高亮、官方答案与解析、听力原文 + 原录音，任意一题按需点「讲给我听」/「带读+搭配」，与刷题完全同一套渲染和字号）。
   视觉语言：VFX.md（衬线标题、拉丁窄体小字、等宽数字、发丝线；纸面 / 夜间玻璃）。 */
(() => {
  'use strict';
  if (window.__pinkieGameExam) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const root = () => document.getElementById('pinkie-study-desk');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, cls, on) => { const b = el('button', cls, label); b.type = 'button'; if (on) b.addEventListener('click', on); return b; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const store = {get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 无痕 */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }};
  const EXAM = 'pretco-b';
  const PART_ZH = {listening: '听力', vocab: '词汇与结构', reading: '阅读', translation: '翻译', writing: '写作'};
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const LETTERS = 'ABCDEFGHIJ';
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const clock = t => new Date(t).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
  const fmtScore = n => (Math.round(n * 10) / 10).toString();
  const latin = (node, text) => { if (/^[\x00-\x7F\u2018-\u201D\u2013\u2014\u2026]*$/.test(String(text || ''))) node.lang = 'en'; return node; };

  // 术语配对：从卷面术语表（A — ... 到 Q/T — ...）解析英文术语列表与真实可选字母
  function parseTermList(material) {
    const out = [];
    for (const line of String(material || '').split(/\n+/)) {
      const m = /^\s*([A-Z])\s*[—\-–:：.)）]\s*(.+)$/.exec(line);
      if (m && !out.some(x => x.letter === m[1])) out.push({letter: m[1], text: m[2].trim()});
    }
    return out;
  }
  function termLetters(material) {
    const parsed = parseTermList(material).map(x => x.letter);
    return parsed.length >= 4 ? parsed : [...LETTERS];
  }
  function groupTermRows(list, noOf) {
    const rows = [];
    for (let idx = 0; idx < list.length; idx++) {
      const it = list[idx];
      const no = noOf ? noOf.get(it.id) : it.no;
      const prev = rows[rows.length - 1];
      if (prev && no != null && prev.no === no && prev.slots.length < 2) {
        prev.slots.push({it, idx, no});
      } else {
        rows.push({no, slots: [{it, idx, no}]});
      }
    }
    return rows;
  }

  // 原录音播放条：考场和整卷回看共用
  function makeRecordBar(audio, subtitle = '听力原录音 · 和考场里放的一样') {
    const bar = el('div', 'pke-record'); bar.dataset.on = audio.paused ? '' : '1';
    const b = btn('', 'pke-play'); b.setAttribute('aria-label', '播放原录音');
    const icon = () => {
      b.innerHTML = audio.paused
        ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';
      b.setAttribute('aria-label', audio.paused ? '播放原录音' : '暂停');
    };
    const meta = el('div', 'pke-record__meta'); meta.append(el('small', 'pkb-kicker', 'ORIGINAL RECORDING'), el('b', '', subtitle));
    const track = el('div', 'pke-record__track'); const fill = el('i'); track.append(fill); track.setAttribute('role', 'slider'); track.setAttribute('aria-label', '录音进度'); track.tabIndex = 0;
    const time = el('span', 'pke-record__time pkg-num', '00:00 / --:--');
    const paint = () => {
      const d = audio.duration;
      fill.style.transform = `scaleX(${Number.isFinite(d) && d > 0 ? audio.currentTime / d : 0})`;
      time.textContent = `${mmss(audio.currentTime * 1000)} / ${Number.isFinite(d) ? mmss(d * 1000) : '--:--'}`;
      track.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
      bar.dataset.on = audio.paused ? '' : '1';
      icon();
    };
    b.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => { time.textContent = '录音放不了，请检查声音输出'; }); else audio.pause(); });
    const seek = x => { const r = track.getBoundingClientRect(); if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * audio.duration; };
    track.addEventListener('pointerdown', e => { seek(e.clientX); track.setPointerCapture?.(e.pointerId); const mv = ev => seek(ev.clientX); track.addEventListener('pointermove', mv); track.addEventListener('pointerup', () => track.removeEventListener('pointermove', mv), {once: true}); });
    track.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); } });
    for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended']) audio.addEventListener(ev, () => { if (bar.isConnected) paint(); });
    audio.addEventListener('error', () => { if (bar.isConnected) { time.textContent = '录音没加载上（重开页面会重新取）'; bar.dataset.err = '1'; } });
    paint(); bar.append(b, meta, track, time); return bar;
  }

  function renderLectureNode(text, mode) {
    const render = window.__pinkieGamePractice?.lectureNode;
    const node = render ? render(text) : el('div', 'pkp-fb__lecture');
    if (!render) {
      const p = el('p', 'pkp-say', text);
      p.style.whiteSpace = 'pre-line';
      node.append(p);
    }
    node.dataset.mode = mode;
    return node;
  }

  // ───────────── 听力朗读 ─────────────
  const tts = {
    voices() { try { return speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang)); } catch { return []; } },
    pick(gender) {
      const vs = this.voices(); if (!vs.length) return null;
      const F = ['Samantha', 'Ava', 'Allison', 'Susan', 'Zoe', 'Microsoft Aria', 'Microsoft Jenny', 'Google US English', 'Karen', 'Serena'], M = ['Alex', 'Tom', 'Evan', 'Nathan', 'Daniel', 'Microsoft Guy', 'Microsoft Davis', 'Aaron', 'Fred'];
      const pref = gender === 'm' ? M : F;
      for (const name of pref) { const v = vs.find(x => x.name.includes(name) && /premium|enhanced/i.test(x.name)) || vs.find(x => x.name.includes(name)); if (v) return v; }
      return vs.find(v => /en-US/i.test(v.lang)) || vs[0];
    },
    stop() { try { speechSynthesis.cancel(); } catch { /* ignore */ } },
    say(text, voice) { return new Promise(res => { try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = .9; if (voice) u.voice = voice; u.onend = u.onerror = () => res(); speechSynthesis.speak(u); setTimeout(res, 4000 + text.length * 120); } catch { res(); } }); },
    async play(spec, onLine) {
      this.stop(); const text = String(spec?.text || ''); if (!text || !('speechSynthesis' in window)) return false;
      const lines = text.split(/\n|(?=\b[WM]\s*[:：])/).map(s => s.trim()).filter(Boolean);
      const w = this.pick('f'), m = this.pick('m');
      for (let r = 0; r < (spec.repeat || 1); r++) {
        if (r) await wait(1600);
        for (const line of lines) { const who = /^M\s*[:：]/.test(line) ? m : w; onLine?.(r); await this.say(line.replace(/^[WM]\s*[:：]\s*/, ''), who); if (this.cancelled) { this.cancelled = false; return true; } }
      }
      return true;
    },
  };

  // ───────────── 真考场 ─────────────
  function openHall({start, onDone, onLeave}) {
    const r = root(); if (!r) return;
    const paper = start.paper; const attemptId = start.attemptId; const draftKey = `pinkie.exam.draft.${attemptId}`;
    const answers = {...(start.answers || {}), ...(store.get(draftKey)?.answers || {})};
    const flags = new Set(store.get(draftKey)?.flags || []);
    let dirty = Object.keys(store.get(draftKey)?.answers || {}).length > 0, savedAt = 0, saving = false, closed = false;
    const items = []; paper.sections.forEach((sec, si) => sec.items.forEach(it => items.push({...it, sec: sec.id, si, no: it.no || items.length + 1}))); const noOf = new Map(items.map(it => [it.id, it.no]));
    const realPaper = paper.kind === 'real' || paper.kind === 'mock';
    // 真题原录音：整场一个播放器，切部分不断；考完 / 暂离就停
    const audio = realPaper && start.audio?.url ? new Audio(start.audio.url) : null;
    if (audio) { audio.preload = 'metadata'; }
    r.dataset.exam = 'on'; tts.stop();
    const hall = el('section', 'pke-hall'); hall.setAttribute('role', 'dialog'); hall.setAttribute('aria-label', '考场');
    // 顶栏
    const top = el('header', 'pke-top');
    const id = el('div', 'pke-top__id'); id.append(el('small', 'pkb-kicker', `PRETCO-B · ${realPaper ? (paper.kind === 'mock' ? 'MOCK · ' : 'PAST PAPER · ') : ''}${start.resumed ? 'RESUMED' : 'IN SESSION'}`), el('b', '', start.title || '英语 B 级 · 仿真卷'));
    const tabs = el('nav', 'pke-tabs'); tabs.setAttribute('aria-label', '部分');
    const timer = el('div', 'pke-timer'); const tVal = el('b', 'pkg-num', '--:--'); timer.append(el('small', 'pkb-kicker', 'REMAINING'), tVal);
    const save = el('div', 'pke-save', start.resumed ? '已恢复上次的答案' : '自动保存 · 每 15 秒');
    const leave = btn('暂离', 'pkb-link', () => confirmBox('暂时离开考场？', '倒计时不会停。答案已经保存，回来点「接着考」。', '离开', () => close(true)));
    const submit = btn('交卷', 'pkg-btn pke-submit', () => askSubmit());
    top.append(id, tabs, timer, save, leave, submit);
    const body = el('div', 'pke-body'); const sheet = el('main', 'pke-paper'); const side = el('aside', 'pke-card'); body.append(sheet, side);
    hall.append(top, body); r.append(hall);
    let cur = 0;
    const tabBtns = paper.sections.map((sec, i) => { const b = btn('', 'pke-tab', () => show(i)); b.append(el('small', '', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[sec.id] || sec.title), el('em', 'pkg-num', '')); tabs.append(b); return b; });
    // 答题卡
    const cardHead = el('div', 'pke-card__head'); cardHead.append(el('small', 'pkb-kicker', 'ANSWER SHEET'), el('b', '', '答题卡'));
    const cardStat = el('div', 'pke-card__stat');
    const grid = el('div', 'pke-grid');
    const cells = items.map(it => { const c = btn(String(it.no), 'pke-cell pkg-num', () => { show(it.si); requestAnimationFrame(() => { const target = sheet.querySelector(`[data-item="${it.id}"]`); target?.scrollIntoView({block: 'center'}); target?.dispatchEvent(new CustomEvent('pke:focus-slot')); }); }); c.dataset.item = it.id; grid.append(c); return c; });
    const legend = el('div', 'pke-card__legend'); legend.innerHTML = '<span><i class="is-done"></i>已答</span><span><i class="is-flag"></i>待检查</span><span><i></i>未答</span>';
    side.append(cardHead, cardStat, grid, legend);
    const answered = it => answers[it.id] != null && answers[it.id] !== '';
    function refreshCard() {
      for (const [i, it] of items.entries()) { cells[i].classList.toggle('is-done', answered(it)); cells[i].classList.toggle('is-flag', flags.has(it.id)); cells[i].classList.toggle('is-here', it.si === cur); }
      paper.sections.forEach((sec, i) => { const n = sec.items.filter(answered).length; tabBtns[i].querySelector('em').textContent = sec.items.length ? `${n}/${sec.items.length}` : '—'; tabBtns[i].setAttribute('aria-selected', String(i === cur)); });
      const n = items.filter(answered).length; cardStat.textContent = `已答 ${n} / ${items.length}　待检查 ${flags.size}`;
    }
    function setAnswer(it, v) { if (v === '' || v == null) delete answers[it.id]; else answers[it.id] = v; dirty = true; store.set(draftKey, {answers, flags: [...flags], at: Date.now()}); refreshCard(); }
    // 一部分的题
    function show(i) {
      cur = i; tts.stop(); sheet.replaceChildren(); sheet.scrollTop = 0;
      const sec = paper.sections[i];
      const secPts = sec.items.reduce((n, it) => n + it.points, 0);
      const head = el('header', 'pke-sec'); head.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]} · ${sec.timeMin} MIN`), el('h2', '', sec.title.replace(/^Part [IVX]+\s*/, '')), el('p', 'pke-sec__zh', `${PART_ZH[sec.id] || ''} · ${fmtScore(secPts)} 分`));
      sheet.append(head);
      const notes = String(sec.instructions || '').split('；');
      const parts = []; for (const it of sec.items) { let p = parts.find(x => x.id === it.part); if (!p) parts.push(p = {id: it.part, items: []}); p.items.push(it); }
      if (audio && sec.id === 'listening') sheet.append(makeRecordBar(audio));
      else if (realPaper && sec.id === 'listening' && sec.items.length) sheet.append(el('p', 'pke-notice', '本套卷本机暂未导入原录音，可直接跳到下一部分；交卷后进「预览整卷」可看全部听力原文和答案。'));
      if (!parts.length) {
        sheet.append(el('p', 'pke-notice', sec.instructions || '本套卷暂未收录这一部分，直接切到下一部分作答即可。'));
      }
      parts.forEach((p, pi) => {
        const g = el('section', 'pke-part'); const ph = el('div', 'pke-part__head');
        const note = (sec.parts || []).find(x => x.id === p.id)?.note ?? notes[pi] ?? '';
        const label = /^(section|task)\b/i.test(p.id) ? p.id.replace(/^(\w)/, c => c.toUpperCase()) : /^T\d/.test(p.id) ? `Task ${p.id.slice(1)}` : `Section ${p.id}`;
        ph.append(el('b', 'pkg-num', label), el('span', '', note));
        g.append(ph);
        const first = p.items[0];
        if (first.kind === 'term-match') {
          g.append(termMatchHallView(p.items, first.material));
        } else {
          if (first.kind === 'listen-dictation' && first.tts) g.append(listenBar(first.tts, '短文（读三遍）'));
          if (first.material) { const m = el('div', 'pke-material'); m.textContent = first.material; latin(m, first.material); g.append(m); }
          for (const it of p.items) g.append(itemView(it, null));
        }
        sheet.append(g);
      });
      const foot = el('footer', 'pke-foot');
      if (i > 0) foot.append(btn(`← PART ${ROMAN[i - 1]}`, 'pks-pull pke-nav', () => show(i - 1)));
      foot.append(el('span'));
      if (i < paper.sections.length - 1) foot.append(btn(`PART ${ROMAN[i + 1]} →`, 'pks-pull pke-nav', () => show(i + 1)));
      else foot.append(btn('检查完了，交卷', 'pkg-btn', () => askSubmit()));
      sheet.append(foot);
      refreshCard();
    }
    function listenBar(spec, label) {
      const bar = el('div', 'pke-listen'); let plays = 0;
      const b = btn('', 'pke-play'); b.setAttribute('aria-label', `播放${label}`); b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>';
      const t = el('span', '', `${label} · 点播放`);
      b.addEventListener('click', async () => {
        if (bar.dataset.on) { tts.cancelled = true; tts.stop(); delete bar.dataset.on; t.textContent = `${label} · 已播 ${plays} 次`; return; }
        sheet.querySelectorAll('.pke-listen[data-on]').forEach(x => delete x.dataset.on); bar.dataset.on = '1'; plays++;
        const ok = await tts.play(spec, rep => { t.textContent = `${label} · 第 ${rep + 1} 遍`; });
        delete bar.dataset.on; t.textContent = ok ? `${label} · 已播 ${plays} 次` : '这台电脑没有英文朗读声音';
      });
      bar.append(b, t); return bar;
    }
    const crossedByPart = new Map();
    function termMatchHallView(partItems, material) {
      const terms = parseTermList(material);
      const validLetters = new Set(terms.map(x => x.letter));
      const rows = groupTermRows(partItems, noOf);
      const stepV = rows.some(r => r.slots.length > 1) ? 2 : 1;
      const crossKey = partItems[0]?.id || 't4';
      let crossed = crossedByPart.get(crossKey);
      if (!crossed) { crossed = new Set(); crossedByPart.set(crossKey, crossed); }

      let activeIdx = partItems.findIndex(it => !answered(it));
      if (activeIdx < 0) activeIdx = 0;

      const board = el('div', 'pke-tm');
      const bank = el('div', 'pke-tm-bank');
      const bankHead = el('div', 'pke-tm-bank__head');
      const rangeText = terms.length ? `${terms[0].letter}–${terms[terms.length - 1].letter}` : '';
      const bankTitle = el('b', '', '英文术语表');
      if (rangeText) bankTitle.append(el('span', 'pke-tm-range pkg-num', rangeText));
      const bankStat = el('span', 'pke-tm-stat');
      bankHead.append(bankTitle, bankStat);
      const bankList = el('div', 'pke-tm-bank__list');
      bank.append(bankHead, bankList);

      const right = el('div', 'pke-tm-right');
      const tip = el('p', 'pke-tm-tip', '试卷原版排布：点任意括号后点左侧英文或直接按字母键填入，可先易后难；已选字母自动灰显排除（右键英文可划掉干扰项）。');
      const table = el('div', 'pke-tm-sheet');
      const foot = el('div', 'pke-tm-foot');
      const footStat = el('span', 'pke-tm-foot__stat');
      const ptsInfo = partItems[0]?.points ? el('small', 'pke-pts pkg-num', `每空 ${fmtScore(partItems[0].points)} 分 · 共 ${fmtScore(partItems.reduce((n, x) => n + x.points, 0))} 分`) : null;
      const clearAll = btn('清空本大题', 'pkb-link pke-tm-clearall', () => {
        for (const it of partItems) setAnswer(it, null);
        activeIdx = 0;
        paint();
      });
      foot.append(footStat);
      if (ptsInfo) foot.append(ptsInfo);
      foot.append(clearAll);
      right.append(tip, table, foot);
      board.append(bank, right);

      const termBtns = new Map();
      const slotNodes = [];
      let hoverLetter = '';
      let hoverSlotIdx = -1;

      const syncHover = () => {
        for (const [L, b] of termBtns) {
          let on = hoverLetter === L;
          if (!on && hoverSlotIdx >= 0) on = answers[partItems[hoverSlotIdx].id] === L;
          b.classList.toggle('is-hover-link', on);
        }
        slotNodes.forEach((s, idx) => {
          let on = hoverSlotIdx === idx;
          if (!on && hoverLetter) on = answers[partItems[idx].id] === hoverLetter;
          s.root.classList.toggle('is-hover-link', on);
        });
      };

      const pickNextEmpty = fromIdx => {
        for (let step = 1; step <= partItems.length; step++) {
          const cand = (fromIdx + step) % partItems.length;
          if (!answered(partItems[cand])) return cand;
        }
        return fromIdx;
      };

      const assignLetter = (letter, {advance = true, toggle = false} = {}) => {
        const it = partItems[activeIdx];
        if (!it) return;
        if (toggle && answers[it.id] === letter) {
          setAnswer(it, null);
        } else {
          setAnswer(it, letter);
          crossed.delete(letter);
          if (advance) activeIdx = pickNextEmpty(activeIdx);
        }
        paint();
        slotNodes[activeIdx]?.root.focus({preventScroll: true});
      };

      for (const L of terms) {
        const b = btn('', 'pke-tm-term');
        b.dataset.letter = L.letter;
        const k = el('kbd', 'pke-tm-term__key pkg-num', L.letter);
        const en = latin(el('span', 'pke-tm-term__en', L.text), L.text);
        const tag = el('em', 'pke-tm-term__tag');
        tag.hidden = true;
        b.append(k, en, tag);
        b.addEventListener('click', () => assignLetter(L.letter, {advance: true, toggle: true}));
        b.addEventListener('contextmenu', e => {
          e.preventDefault();
          if (crossed.has(L.letter)) crossed.delete(L.letter);
          else crossed.add(L.letter);
          paint();
        });
        b.addEventListener('mouseenter', () => { hoverLetter = L.letter; hoverSlotIdx = -1; syncHover(); });
        b.addEventListener('mouseleave', () => { hoverLetter = ''; hoverSlotIdx = -1; syncHover(); });
        bankList.append(b);
        termBtns.set(L.letter, b);
      }

      for (const row of rows) {
        const rowEl = el('div', 'pke-tm-row' + (row.slots.length === 1 ? ' is-single' : ''));
        rowEl.append(el('span', 'pke-tm-no pkg-num', String(row.no ?? '')));
        const slotsWrap = el('div', 'pke-tm-slots');
        for (const s of row.slots) {
          const it = s.it;
          const idx = s.idx;
          const slotEl = el('div', 'pke-tm-slot');
          slotEl.dataset.item = it.id;
          slotEl.dataset.kind = it.kind;
          slotEl.setAttribute('role', 'button');
          slotEl.tabIndex = 0;
          const blankEl = el('span', 'pke-tm-blank pkg-num');
          const zhEl = el('span', 'pke-tm-zh', it.prompt || '');
          const dupEl = el('em', 'pke-tm-dup', '重复');
          dupEl.hidden = true;
          const clearBtn = btn('×', 'pke-tm-clear', e => {
            e.stopPropagation();
            setAnswer(it, null);
            activeIdx = idx;
            paint();
            slotEl.focus({preventScroll: true});
          });
          clearBtn.setAttribute('aria-label', `清除 ${it.prompt || ''}`);
          clearBtn.title = '清除这一空';
          clearBtn.hidden = true;
          const flag = btn('', 'pke-flag pke-tm-flag', e => {
            e.stopPropagation();
            flags.has(it.id) ? flags.delete(it.id) : flags.add(it.id);
            flag.setAttribute('aria-pressed', String(flags.has(it.id)));
            store.set(draftKey, {answers, flags: [...flags], at: Date.now()});
            refreshCard();
          });
          flag.setAttribute('aria-pressed', String(flags.has(it.id)));
          flag.setAttribute('aria-label', '标记待检查');
          flag.title = '标记待检查';
          flag.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 14V2.5h8l-1.6 3 1.6 3h-8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
          slotEl.append(blankEl, zhEl, dupEl, clearBtn, flag);
          const activate = () => { activeIdx = idx; paint(); slotEl.focus({preventScroll: true}); };
          slotEl.addEventListener('click', activate);
          slotEl.addEventListener('pke:focus-slot', activate);
          slotEl.addEventListener('mouseenter', () => { hoverLetter = ''; hoverSlotIdx = idx; syncHover(); });
          slotEl.addEventListener('mouseleave', () => { hoverLetter = ''; hoverSlotIdx = -1; syncHover(); });
          slotsWrap.append(slotEl);
          slotNodes[idx] = {root: slotEl, blank: blankEl, dup: dupEl, clear: clearBtn, flag};
        }
        rowEl.append(slotsWrap);
        table.append(rowEl);
      }

      board.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = String(e.key || '');
        const upper = k.toUpperCase();
        if (/^[A-Z]$/.test(upper) && validLetters.has(upper)) {
          e.preventDefault();
          assignLetter(upper, {advance: true});
          return;
        }
        if (k === 'Backspace' || k === 'Delete') {
          e.preventDefault();
          const curIt = partItems[activeIdx];
          if (curIt && answers[curIt.id]) {
            setAnswer(curIt, null);
          } else {
            activeIdx = (activeIdx - 1 + partItems.length) % partItems.length;
          }
          paint();
          slotNodes[activeIdx]?.root.focus({preventScroll: true});
          return;
        }
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(k)) {
          e.preventDefault();
          const delta = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? stepV : -stepV;
          activeIdx = (activeIdx + delta + partItems.length) % partItems.length;
          paint();
          slotNodes[activeIdx]?.root.focus({preventScroll: true});
        }
      });

      function paint() {
        const usage = new Map();
        let filled = 0;
        partItems.forEach((it, idx) => {
          const val = answers[it.id] ? String(answers[it.id]).trim().toUpperCase() : '';
          if (val) {
            filled++;
            if (!usage.has(val)) usage.set(val, []);
            usage.get(val).push({it, idx});
          }
        });
        const activeVal = answers[partItems[activeIdx]?.id] ? String(answers[partItems[activeIdx].id]).trim().toUpperCase() : '';
        let usedCount = 0;
        for (const L of terms) {
          const b = termBtns.get(L.letter);
          const list = usage.get(L.letter) || [];
          const used = list.length > 0;
          if (used) usedCount++;
          const tag = b.querySelector('.pke-tm-term__tag');
          b.classList.toggle('is-used', used);
          b.classList.toggle('is-dup', list.length > 1);
          b.classList.toggle('is-crossed', !used && crossed.has(L.letter));
          b.classList.toggle('is-linked', Boolean(activeVal) && activeVal === L.letter);
          if (used) {
            const first = list[0];
            const no = noOf.get(first.it.id);
            const pre = no != null ? `${no} ` : '';
            tag.textContent = list.length > 1 ? `${pre}${first.it.prompt} 等${list.length}处` : `${pre}${first.it.prompt}`;
            tag.hidden = false;
          } else if (crossed.has(L.letter)) {
            tag.textContent = '已排除';
            tag.hidden = false;
          } else {
            tag.textContent = '';
            tag.hidden = true;
          }
        }
        bankStat.textContent = `已用 ${usedCount} · 剩 ${Math.max(0, terms.length - usedCount)} 项`;

        let hasDup = false;
        partItems.forEach((it, idx) => {
          const node = slotNodes[idx];
          const val = answers[it.id] ? String(answers[it.id]).trim().toUpperCase() : '';
          const dup = Boolean(val) && (usage.get(val)?.length || 0) > 1;
          if (dup) hasDup = true;
          node.root.classList.toggle('is-active', idx === activeIdx);
          node.root.classList.toggle('is-filled', Boolean(val));
          node.root.classList.toggle('is-dup', dup);
          node.blank.textContent = val ? `（ ${val} ）` : '（　）';
          node.dup.hidden = !dup;
          node.clear.hidden = !val;
        });
        footStat.textContent = `已配 ${filled} / ${partItems.length}` + (hasDup ? ' · 有重复字母，请检查' : '');
        footStat.classList.toggle('is-warn', hasDup);
        clearAll.hidden = filled === 0;
        syncHover();
      }

      paint();
      return board;
    }

    function itemView(it, partLetters) {
      const box = el('article', 'pke-item'); box.dataset.item = it.id; box.dataset.kind = it.kind;
      const no = el('span', 'pke-item__no pkg-num', String(noOf.get(it.id)));
      const flag = btn('', 'pke-flag', () => { flags.has(it.id) ? flags.delete(it.id) : flags.add(it.id); flag.setAttribute('aria-pressed', String(flags.has(it.id))); store.set(draftKey, {answers, flags: [...flags], at: Date.now()}); refreshCard(); });
      flag.setAttribute('aria-pressed', String(flags.has(it.id))); flag.setAttribute('aria-label', '标记待检查'); flag.title = '标记待检查';
      flag.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 14V2.5h8l-1.6 3 1.6 3h-8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      const main = el('div', 'pke-item__main');
      if (it.tts && it.kind !== 'listen-dictation') main.append(listenBar(it.tts, it.kind === 'listen-dialogue' ? '对话' : '问话'));
      const prompt = String(it.prompt || '').replace(/^\(听录音选答案\)$/, '');
      if (prompt) { const p = latin(el('p', 'pke-item__q'), prompt); p.textContent = prompt; if (it.base) p.append(el('span', 'pke-base', `（${it.base}）`)); main.append(p); }
      main.append(el('small', 'pke-pts pkg-num', `${fmtScore(it.points)} 分`));
      if (it.options) {
        const ol = el('div', 'pke-opts'); ol.setAttribute('role', 'radiogroup');
        it.options.forEach((o, k) => { const b = btn('', 'pke-opt'); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(answers[it.id] === k)); b.append(el('i', '', LETTERS[k] || String(k + 1)), latin(el('span', '', o), o)); b.addEventListener('click', () => { const on = answers[it.id] === k; setAnswer(it, on ? null : k); ol.querySelectorAll('.pke-opt').forEach((x, j) => x.setAttribute('aria-checked', String(!on && j === k))); }); ol.append(b); });
        main.append(ol);
      } else if (it.kind === 'term-match') {
        const row = el('div', 'pke-letters');
        for (const L of (partLetters || [...LETTERS])) { const b = btn(L, 'pke-letter', () => { const on = answers[it.id] === L; setAnswer(it, on ? null : L); row.querySelectorAll('.pke-letter').forEach(x => x.setAttribute('aria-pressed', String(!on && x.textContent === L))); }); b.setAttribute('aria-pressed', String(answers[it.id] === L)); row.append(b); }
        main.append(row);
      } else if (['translate-passage', 'writing'].includes(it.kind)) {
        const ta = el('textarea', 'pke-write'); ta.rows = it.kind === 'writing' ? 12 : 8; ta.value = answers[it.id] || ''; ta.placeholder = it.kind === 'writing' ? '在这里写（80–100 词）' : '在这里写译文';
        const cnt = el('small', 'pke-count pkg-num'); const upd = () => { const v = ta.value.trim(); cnt.textContent = it.kind === 'writing' ? `${v ? v.split(/\s+/).length : 0} 词` : `${v.replace(/\s/g, '').length} 字`; };
        ta.addEventListener('input', () => { setAnswer(it, ta.value); upd(); }); upd(); main.append(ta, cnt);
      } else {
        const inp = el('input', 'pke-fill'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.value = answers[it.id] || ''; inp.placeholder = it.kind === 'word-form' ? '正确形式' : '答案（1–3 词）';
        inp.addEventListener('input', () => setAnswer(it, inp.value.trim())); main.append(inp);
      }
      box.append(no, main, flag); return box;
    }
    // 保存 + 计时
    async function flush() {
      if (!dirty || saving || closed) return; saving = true; const snap = {...answers}; dirty = false;
      try { const res = await G().call('exam.save', {attemptId, answers: snap}); savedAt = res?.savedAt || Date.now(); save.textContent = `已保存 ${clock(savedAt)}`; save.removeAttribute('data-err'); }
      catch (e) { dirty = true; save.textContent = '没存上，答案先留在这台电脑里'; save.dataset.err = '1'; }
      saving = false;
    }
    const saveTimer = setInterval(flush, 15000);
    const tick = () => { const left = start.endsAt - Date.now(); tVal.textContent = mmss(left); timer.dataset.low = left < 5 * 60000 ? '1' : ''; if (left <= 0 && !closed) { clearInterval(tickTimer); doSubmit(true); } };
    const tickTimer = setInterval(tick, 1000); tick();
    const onHide = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', onHide);
    const escape = () => { const m = hall.querySelector('.pke-modal'); if (m) m.querySelector('.pke-nav')?.click(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); if (!e.defaultPrevented) { e.preventDefault(); escape(); } } };
    hall.addEventListener('keydown', onKey, true);
    function close(leaving) {
      if (closed) return; closed = true; tts.stop(); try { audio?.pause(); } catch { /* ignore */ } clearInterval(saveTimer); clearInterval(tickTimer); document.removeEventListener('visibilitychange', onHide);
      hall.remove(); delete r.dataset.exam;
      if (leaving) { dirty = true; closed = false; flush().finally(() => { closed = true; }); onLeave?.(); }
    }
    function confirmBox(title, text, ok, onOk, extra) {
      const m = el('div', 'pke-modal'); const c = el('div', 'pke-modal__card'); c.append(el('h3', '', title), el('p', '', text)); if (extra) c.append(extra);
      const back = document.activeElement;
      const row = el('div', 'pke-modal__act'); row.append(btn('再看看', 'pks-pull pke-nav', () => { m.remove(); if (back?.isConnected) back.focus({preventScroll: true}); }), btn(ok, 'pkg-btn', () => { m.remove(); onOk(); })); c.append(row); m.append(c); hall.append(m); row.lastChild.focus();
    }
    function askSubmit() {
      const blank = items.filter(it => !answered(it)).length;
      const ex = el('p', 'pke-modal__meta pkg-num', `已答 ${items.length - blank} / ${items.length} · 未答 ${blank} 题 · 待检查 ${flags.size} 题 · 剩余 ${mmss(start.endsAt - Date.now())}`);
      confirmBox('交卷？', '交卷后立即出标准答案与对错，可以预览整卷并自由挑选任意一题点击「讲给我听」或「带读+搭配」。', '交卷', () => doSubmit(false), ex);
    }
    async function doSubmit(timeUp) {
      dirty = true; await flush().catch(() => {});
      try { await G().call('exam.submit', {attemptId}); } catch (e) { if (!timeUp) { save.textContent = e.message || '交卷失败，再点一次'; save.dataset.err = '1'; return; } }
      store.del(draftKey); store.set('pinkie.exam.last', {attemptId, at: Date.now(), seen: false});
      close(false); onDone?.(attemptId, timeUp);
    }
    // 如果第一部分为空（例如 2025.06 无听力），默认落到第一个有题的部分
    const firstNonEmpty = paper.sections.findIndex(s => s.items.length > 0);
    show(firstNonEmpty >= 0 ? firstNonEmpty : 0);
    sheet.tabIndex = -1; sheet.focus({preventScroll: true});
    return {close: () => close(true), escape};
  }

  // ───────────── 整卷预览 & 按需挑题解析 ─────────────
  function openReview({review, filter = 'all', jumpId = null, onReport, onLeave}) {
    const r = root(); if (!r) return;
    const attemptId = review.attemptId;
    let onlyWrong = filter === 'wrong';
    let closed = false;
    const items = [];
    review.sections.forEach((sec, si) => sec.items.forEach(it => items.push({...it, sec: sec.id, si, no: it.no || items.length + 1})));
    const noOf = new Map(items.map(it => [it.id, it.no]));
    const isMiss = it => !it.subjective && !it.correct;
    const wrongTotal = items.filter(isMiss).length;
    const rightTotal = items.filter(it => !it.subjective && it.correct).length;
    const blankTotal = items.filter(it => !it.subjective && it.blank).length;
    const audio = review.audio?.url ? new Audio(review.audio.url) : null;
    if (audio) audio.preload = 'metadata';

    r.dataset.exam = 'on'; tts.stop();
    const hall = el('section', 'pke-hall is-review');
    hall.setAttribute('role', 'dialog');
    hall.setAttribute('aria-label', '整卷预览与解析');

    const top = el('header', 'pke-top pke-rev-top');
    const idBox = el('div', 'pke-top__id');
    idBox.append(el('small', 'pkb-kicker', `REVIEW · ${fmtScore(review.score)} / 100 分`), el('b', '', review.title || '模拟卷'));
    const tabs = el('nav', 'pke-tabs'); tabs.setAttribute('aria-label', '部分');
    const filterBox = el('div', 'pke-rev-filter');
    const btnAll = btn('看整卷', 'pke-rev-fbtn', () => { if (!onlyWrong) return; onlyWrong = false; syncFilter(); show(cur); });
    const btnWrong = btn(`只看错题 (${wrongTotal})`, 'pke-rev-fbtn', () => { if (onlyWrong) return; onlyWrong = true; syncFilter(); const target = review.sections[cur]?.items.some(isMiss) ? cur : review.sections.findIndex(s => s.items.some(isMiss)); show(target >= 0 ? target : cur); });
    btnWrong.disabled = wrongTotal === 0;
    filterBox.append(btnAll, btnWrong);
    const toReport = btn('成绩总览', 'pks-pull pke-nav', () => { close(); onReport?.(); });
    const quit = btn('退出', 'pkb-link', () => { close(); onLeave?.(); });
    top.append(idBox, tabs, filterBox, toReport, quit);

    const body = el('div', 'pke-body');
    const sheet = el('main', 'pke-paper pke-rev-paper');
    const side = el('aside', 'pke-card');
    body.append(sheet, side);
    hall.append(top, body);
    r.append(hall);

    let cur = 0;
    const tabBtns = review.sections.map((sec, i) => {
      const b = btn('', 'pke-tab', () => show(i));
      const secScore = (review.result?.sections || []).find(s => s.id === sec.id);
      const stat = secScore ? `${fmtScore(secScore.score)}/${fmtScore(secScore.max)}` : `${sec.items.length}`;
      b.append(el('small', '', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[sec.id] || sec.title), el('em', 'pkg-num', stat));
      tabs.append(b);
      return b;
    });

    const cardHead = el('div', 'pke-card__head');
    cardHead.append(el('small', 'pkb-kicker', 'PAPER MAP · CLICK TO JUMP'), el('b', '', '整卷题卡'));
    const cardStat = el('div', 'pke-card__stat pkg-num', `对 ${rightTotal} · 错 ${wrongTotal - blankTotal} · 未答 ${blankTotal}`);
    const grid = el('div', 'pke-grid');
    const cells = items.map(it => {
      const cls = ['pke-cell', 'pkg-num', it.subjective ? 'is-subj' : it.correct ? 'is-right' : it.blank ? 'is-blank' : 'is-wrong'].join(' ');
      const c = btn(String(it.no), cls, () => jumpTo(it.id));
      c.dataset.item = it.id;
      c.title = it.subjective ? `第 ${it.no} 题（主观题 ${fmtScore(it.grade?.score ?? 0)}/${fmtScore(it.points)}）` : it.correct ? `第 ${it.no} 题（答对）` : it.blank ? `第 ${it.no} 题（未答）` : `第 ${it.no} 题（答错）`;
      grid.append(c);
      return c;
    });
    const legend = el('div', 'pke-card__legend');
    legend.innerHTML = '<span><i class="is-right"></i>对</span><span><i class="is-wrong"></i>错</span><span><i class="is-blank"></i>未答</span><span><i class="is-subj"></i>主观</span>';
    side.append(cardHead, cardStat, grid, legend);

    function syncFilter() {
      btnAll.setAttribute('aria-pressed', String(!onlyWrong));
      btnWrong.setAttribute('aria-pressed', String(onlyWrong));
    }
    function refreshCard() {
      items.forEach((it, idx) => { cells[idx].classList.toggle('is-here', it.si === cur); });
      tabBtns.forEach((b, idx) => b.setAttribute('aria-selected', String(idx === cur)));
    }
    function jumpTo(itemId) {
      const target = items.find(x => x.id === itemId);
      if (!target) return;
      if (onlyWrong && !isMiss(target)) { onlyWrong = false; syncFilter(); }
      show(target.si);
      requestAnimationFrame(() => {
        const node = sheet.querySelector(`[data-item="${target.id}"]`);
        if (node) {
          node.dispatchEvent(new CustomEvent('pke:focus-slot'));
          node.scrollIntoView({block: 'center', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
          node.classList.remove('is-pulse');
          void node.offsetWidth;
          node.classList.add('is-pulse');
        }
      });
    }

    function show(i) {
      cur = i; tts.stop(); sheet.replaceChildren(); sheet.scrollTop = 0;
      const sec = review.sections[i];
      const secScore = (review.result?.sections || []).find(s => s.id === sec.id);
      const secRight = sec.items.filter(it => !it.subjective && it.correct).length;
      const secMiss = sec.items.filter(isMiss).length;
      const head = el('header', 'pke-sec');
      const subText = secScore
        ? `${PART_ZH[sec.id] || ''} · 得 ${fmtScore(secScore.score)} / ${fmtScore(secScore.max)} 分${sec.items.some(x => !x.subjective) ? `（对 ${secRight} · 错/未答 ${secMiss}）` : ''}`
        : `${PART_ZH[sec.id] || ''}`;
      head.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]} · REVIEW`), el('h2', '', sec.title.replace(/^Part [IVX]+\s*/, '')), el('p', 'pke-sec__zh', subText));
      sheet.append(head);

      if (audio && sec.id === 'listening') sheet.append(makeRecordBar(audio, '听力原录音 · 边听边对照原文'));

      const notes = String(sec.instructions || '').split('；');
      const parts = [];
      for (const it of sec.items) {
        let p = parts.find(x => x.id === it.part);
        if (!p) parts.push(p = {id: it.part, items: []});
        p.items.push(it);
      }
      let shownCount = 0;
      parts.forEach((p, pi) => {
        const visible = onlyWrong ? p.items.filter(isMiss) : p.items;
        if (!visible.length) return;
        shownCount += visible.length;
        const g = el('section', 'pke-part');
        const ph = el('div', 'pke-part__head');
        const note = (sec.parts || []).find(x => x.id === p.id)?.note ?? notes[pi] ?? '';
        const label = /^(section|task)\b/i.test(p.id) ? p.id.replace(/^(\w)/, c => c.toUpperCase()) : /^T\d/.test(p.id) ? `Task ${p.id.slice(1)}` : `Section ${p.id}`;
        ph.append(el('b', 'pkg-num', label), el('span', '', note));
        g.append(ph);
        const first = p.items[0];
        if (first.kind === 'term-match') {
          g.append(termMatchReviewView(p.items, visible, first.material));
        } else {
          if (first.material) {
            const m = el('div', 'pke-material');
            m.textContent = first.material;
            latin(m, first.material);
            g.append(m);
          }
          for (const it of visible) g.append(reviewItemView(it, null));
        }
        sheet.append(g);
      });

      if (!shownCount) {
        const empty = el('p', 'pke-notice', onlyWrong ? '这一部分没有错题，全部答对啦。可以切到「看整卷」浏览全部题目，或点其他部分。' : '本套卷暂无该部分题目。');
        sheet.append(empty);
      }

      const foot = el('footer', 'pke-foot');
      if (i > 0) foot.append(btn(`← PART ${ROMAN[i - 1]}`, 'pks-pull pke-nav', () => show(i - 1)));
      foot.append(el('span'));
      if (i < review.sections.length - 1) foot.append(btn(`PART ${ROMAN[i + 1]} →`, 'pks-pull pke-nav', () => show(i + 1)));
      else foot.append(btn('回成绩总览', 'pkg-btn', () => { close(); onReport?.(); }));
      sheet.append(foot);
      refreshCard();
    }

    function termMatchReviewView(allItems, visibleItems, material) {
      const terms = parseTermList(material);
      const termMap = new Map(terms.map(x => [x.letter, x.text]));
      const visibleIds = new Set(visibleItems.map(x => x.id));
      const rows = groupTermRows(allItems, noOf);
      const wrongIdxs = allItems.map((it, idx) => (isMiss(it) ? idx : -1)).filter(x => x >= 0);
      let inspectIdx = wrongIdxs.length ? wrongIdxs[0] : 0;

      const wrap = el('div', 'pke-tm-rev-wrap');
      const board = el('div', 'pke-tm is-review');

      const bank = el('div', 'pke-tm-bank');
      const bankHead = el('div', 'pke-tm-bank__head');
      const rangeText = terms.length ? `${terms[0].letter}–${terms[terms.length - 1].letter}` : '';
      const bankTitle = el('b', '', '英文术语表');
      if (rangeText) bankTitle.append(el('span', 'pke-tm-range pkg-num', rangeText));
      const rightCount = allItems.filter(x => x.correct).length;
      const bankStat = el('span', 'pke-tm-stat', `对 ${rightCount} / ${allItems.length}`);
      bankHead.append(bankTitle, bankStat);
      const bankList = el('div', 'pke-tm-bank__list');
      bank.append(bankHead, bankList);

      const right = el('div', 'pke-tm-right');
      const tip = el('p', 'pke-tm-tip', '点击任意中文词可对照左侧英文，并在下方查看官方答案或按需点「讲给我听」/「带读+搭配」。');
      const table = el('div', 'pke-tm-sheet');
      const inspector = el('div', 'pke-tm-inspector');
      right.append(tip, table);
      board.append(bank, right);
      wrap.append(board, inspector);

      const ansByLetter = new Map();
      allItems.forEach((it, idx) => {
        const a = String(it.answer || it.key || '').trim().toUpperCase();
        if (a) {
          if (!ansByLetter.has(a)) ansByLetter.set(a, []);
          ansByLetter.get(a).push({it, idx});
        }
      });

      const termBtns = new Map();
      const slotNodes = [];
      let hoverLetter = '';
      let hoverSlotIdx = -1;

      const syncHover = () => {
        for (const [L, b] of termBtns) {
          let on = hoverLetter === L;
          if (!on && hoverSlotIdx >= 0) {
            const it = allItems[hoverSlotIdx];
            const ans = String(it.answer || it.key || '').trim().toUpperCase();
            const giv = it.given ? String(it.given).trim().toUpperCase() : '';
            on = ans === L || giv === L;
          }
          b.classList.toggle('is-hover-link', on);
        }
        slotNodes.forEach((s, idx) => {
          let on = hoverSlotIdx === idx;
          if (!on && hoverLetter) {
            const it = allItems[idx];
            const ans = String(it.answer || it.key || '').trim().toUpperCase();
            const giv = it.given ? String(it.given).trim().toUpperCase() : '';
            on = ans === hoverLetter || giv === hoverLetter;
          }
          s.root.classList.toggle('is-hover-link', on);
        });
      };

      for (const L of terms) {
        const b = btn('', 'pke-tm-term');
        b.dataset.letter = L.letter;
        const k = el('kbd', 'pke-tm-term__key pkg-num', L.letter);
        const en = latin(el('span', 'pke-tm-term__en', L.text), L.text);
        const tag = el('em', 'pke-tm-term__tag');
        const hits = ansByLetter.get(L.letter) || [];
        if (hits.length) {
          const first = hits[0];
          const no = noOf.get(first.it.id);
          const pre = no != null ? `${no} ` : '';
          tag.textContent = `${pre}${first.it.prompt || ''}`;
          b.classList.add(hits.every(x => x.it.correct) ? 'is-graded-right' : 'is-graded-wrong');
        } else {
          tag.hidden = true;
        }
        b.append(k, en, tag);
        b.addEventListener('click', () => {
          const hit = hits[0]?.idx ?? allItems.findIndex(x => String(x.given || '').trim().toUpperCase() === L.letter);
          if (hit >= 0) { inspectIdx = hit; paintReview(); }
        });
        b.addEventListener('mouseenter', () => { hoverLetter = L.letter; hoverSlotIdx = -1; syncHover(); });
        b.addEventListener('mouseleave', () => { hoverLetter = ''; hoverSlotIdx = -1; syncHover(); });
        bankList.append(b);
        termBtns.set(L.letter, b);
      }

      for (const row of rows) {
        const rowEl = el('div', 'pke-tm-row' + (row.slots.length === 1 ? ' is-single' : ''));
        rowEl.append(el('span', 'pke-tm-no pkg-num', String(row.no ?? '')));
        const slotsWrap = el('div', 'pke-tm-slots');
        for (const s of row.slots) {
          const it = s.it;
          const idx = s.idx;
          const slotEl = el('div', 'pke-tm-slot');
          slotEl.dataset.item = it.id;
          slotEl.dataset.kind = it.kind;
          slotEl.dataset.state = it.correct ? 'right' : it.blank ? 'blank' : 'wrong';
          slotEl.setAttribute('role', 'button');
          slotEl.tabIndex = 0;
          if (onlyWrong && !visibleIds.has(it.id)) slotEl.classList.add('is-muted');
          const ansL = String(it.answer || it.key || '').trim().toUpperCase();
          const givL = it.given ? String(it.given).trim().toUpperCase() : '';
          const blankText = it.correct ? `✓ ${ansL}` : it.blank ? `未填 → ${ansL}` : `✗ ${givL} → ${ansL}`;
          const blankEl = el('span', 'pke-tm-blank pkg-num', blankText);
          const zhEl = el('span', 'pke-tm-zh', it.prompt || '');
          slotEl.append(blankEl, zhEl);
          slotEl.classList.add(it.correct ? 'is-right' : it.blank ? 'is-blank' : 'is-wrong');
          const selectSlot = () => { inspectIdx = idx; paintReview(); };
          slotEl.addEventListener('click', selectSlot);
          slotEl.addEventListener('pke:focus-slot', selectSlot);
          slotEl.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectSlot(); } });
          slotEl.addEventListener('mouseenter', () => { hoverLetter = ''; hoverSlotIdx = idx; syncHover(); });
          slotEl.addEventListener('mouseleave', () => { hoverLetter = ''; hoverSlotIdx = -1; syncHover(); });
          slotsWrap.append(slotEl);
          slotNodes[idx] = {root: slotEl};
        }
        rowEl.append(slotsWrap);
        table.append(rowEl);
      }

      function renderInspector(it) {
        inspector.replaceChildren();
        inspector.dataset.itemId = it.id;
        const fb = el('div', 'pkp-fb pke-rev-fb pke-tm-rev-fb');
        fb.dataset.kind = it.correct ? 'right' : 'wrong';

        const topRow = el('div', 'pke-tm-rev-head');
        topRow.append(
          el('b', 'pke-tm-rev-title', `第 ${noOf.get(it.id)} 题 · ${it.prompt || ''}`),
          el('span', `pke-badge is-${it.correct ? 'right' : it.blank ? 'blank' : 'wrong'}`, it.correct ? '对' : it.blank ? '未答' : '错')
        );
        if (wrongIdxs.length > 1) {
          const nw = btn(`下一错题 (${wrongIdxs.length})`, 'pkb-link pke-tm-nextwrong', () => {
            const pos = wrongIdxs.indexOf(inspectIdx);
            inspectIdx = wrongIdxs[(pos + 1) % wrongIdxs.length];
            paintReview();
          });
          topRow.append(nw);
        }
        fb.append(topRow);

        const ansL = String(it.answer || it.key || '').trim().toUpperCase();
        const ansEn = termMap.get(ansL);
        const givL = it.given ? String(it.given).trim().toUpperCase() : '';
        const givEn = termMap.get(givL);
        const k = el('p', 'pkp-fb__key');
        k.append(el('small', '', '官方答案'), el('b', '', ansEn ? `${ansL} — ${ansEn}` : (it.key || ansL)));
        if (!it.correct && !it.blank && givL) {
          k.append(el('span', 'pke-rev-yours', `　·　你填了：${givEn ? `${givL} — ${givEn}` : givL}`));
        }
        fb.append(k);
        if (it.why) {
          const w = el('p', 'pkp-fb__why');
          w.append(el('small', '', '官方解析'), document.createTextNode(it.why));
          fb.append(w);
        }

        const actRow = el('div', 'pkp-row pke-rev-act');
        const explainBtn = btn('讲给我听', 'pkb-link');
        explainBtn.title = '完整讲解：考点、秒杀、逐词带读、翻译、选项扫盲、搭配';
        const readBtn = btn('带读+搭配', 'pkb-link pkp-read-btn');
        readBtn.title = '只看逐词带读、整句翻译，再补充 B 级高频固定搭配';
        const foldBtn = btn('收起讲解', 'pkb-link pke-rev-fold');
        foldBtn.hidden = true;
        let notice = null;
        let lectureEl = null;
        const modeButtons = [
          {mode: 'full', el: explainBtn, label: '讲给我听', retry: '再讲一次', busy: '碧琪在按标准答案讲…'},
          {mode: 'read', el: readBtn, label: '带读+搭配', retry: '重试带读', busy: '碧琪在准备带读和搭配…'},
        ];
        const resetLabels = activeMode => {
          for (const item of modeButtons) {
            item.el.disabled = false;
            item.el.textContent = item.label;
            item.el.setAttribute('aria-pressed', activeMode === item.mode ? 'true' : 'false');
          }
          foldBtn.hidden = !activeMode;
        };
        const showLecture = (text, mode, {scroll = true} = {}) => {
          lectureEl?.remove();
          lectureEl = renderLectureNode(text, mode);
          actRow.after(lectureEl);
          resetLabels(mode);
          if (scroll) lectureEl.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
        };
        foldBtn.addEventListener('click', () => {
          lectureEl?.remove(); lectureEl = null; it._collapsed = true; resetLabels(null);
        });
        const askMode = async item => {
          notice?.remove(); notice = null;
          it._collapsed = false;
          for (const other of modeButtons) { other.el.disabled = true; other.el.textContent = other === item ? item.busy : other.label; }
          const failed = message => {
            if (!inspector.isConnected || inspector.dataset.itemId !== it.id) return;
            for (const other of modeButtons) { other.el.disabled = false; other.el.textContent = other === item ? item.retry : other.label; }
            notice = el('p', 'pkp-fb__mon', message || '这次没有生成讲解，请检查内置模型后重试。');
            const switchModel = btn('切换模型', 'pkb-link', () => desk()?.openBuiltinModel?.());
            notice.append(document.createTextNode(' '), switchModel);
            actRow.after(notice);
          };
          try {
            const payload = item.mode === 'read' ? {attemptId, itemId: it.id, mode: 'read'} : {attemptId, itemId: it.id};
            const res = await G().call('exam.explain', payload, 260000);
            if (res?.text) {
              it.lectures = {...(it.lectures || {}), [item.mode]: res.text};
              it._lastMode = item.mode;
            }
            if (!inspector.isConnected || inspector.dataset.itemId !== it.id) return;
            if (res?.text) { showLecture(res.text, item.mode, {scroll: true}); return; }
            failed(res?.error);
          } catch (e) {
            failed(e.message || '讲解暂时没连上，请重试。');
          }
        };
        for (const item of modeButtons) {
          item.el.setAttribute('aria-pressed', 'false');
          item.el.addEventListener('click', () => void askMode(item));
        }
        actRow.append(explainBtn, readBtn, foldBtn);
        fb.append(actRow);

        if (!it._collapsed && it.lectures) {
          const mode = it._lastMode && it.lectures[it._lastMode] ? it._lastMode : (it.lectures.full ? 'full' : it.lectures.read ? 'read' : null);
          if (mode) showLecture(it.lectures[mode], mode, {scroll: false});
        }
        inspector.append(fb);
      }

      function paintReview() {
        const curIt = allItems[inspectIdx] || allItems[0];
        if (!curIt) return;
        const ansL = String(curIt.answer || curIt.key || '').trim().toUpperCase();
        const givL = !curIt.correct && curIt.given ? String(curIt.given).trim().toUpperCase() : '';
        for (const [L, b] of termBtns) {
          b.classList.toggle('is-linked', L === ansL);
          b.classList.toggle('is-linked-wrong', Boolean(givL) && L === givL);
        }
        slotNodes.forEach((s, idx) => s.root.classList.toggle('is-inspect', idx === inspectIdx));
        renderInspector(curIt);
        syncHover();
      }

      paintReview();
      return wrap;
    }

    function reviewItemView(it, partLetters) {
      const box = el('article', 'pke-item is-review-item');
      box.dataset.item = it.id;
      box.dataset.kind = it.kind;
      box.dataset.state = it.subjective ? 'subj' : it.correct ? 'right' : it.blank ? 'blank' : 'wrong';

      const noCol = el('div', 'pke-item__side');
      noCol.append(el('span', 'pke-item__no pkg-num', String(noOf.get(it.id))));
      const badgeText = it.subjective
        ? `${fmtScore(it.grade?.score ?? 0)}/${fmtScore(it.points)}`
        : it.correct ? '对' : it.blank ? '未答' : '错';
      noCol.append(el('span', `pke-badge is-${box.dataset.state}`, badgeText));

      const main = el('div', 'pke-item__main');
      const prompt = String(it.prompt || '').replace(/^\(听录音选答案\)$/, '');
      if (prompt) {
        const p = latin(el('p', 'pke-item__q'), prompt);
        p.textContent = prompt;
        if (it.base) p.append(el('span', 'pke-base', `（${it.base}）`));
        main.append(p);
      }

      if (it.options) {
        const ol = el('div', 'pke-opts is-review');
        const givenIdx = it.given != null && it.given !== '' && Number.isInteger(Number(it.given)) ? Number(it.given) : -1;
        const altSet = new Set(Array.isArray(it.alt) ? it.alt : []);
        it.options.forEach((o, k) => {
          const row = el('div', 'pke-opt is-static');
          const isAns = k === it.answer || altSet.has(k);
          const isPicked = k === givenIdx;
          if (isAns) row.classList.add('is-answer');
          if (isPicked && !isAns) row.classList.add('is-wrong');
          if (isPicked) row.classList.add('is-picked');
          row.append(el('i', '', LETTERS[k] || String(k + 1)), latin(el('span', '', o), o));
          if (isAns) row.append(el('em', 'pke-opt__tag is-ans', isPicked ? '你的选择 · 正确' : '正确答案'));
          else if (isPicked) row.append(el('em', 'pke-opt__tag is-bad', '你的选择'));
          ol.append(row);
        });
        main.append(ol);
      } else if (it.kind === 'term-match') {
        const row = el('div', 'pke-letters is-review');
        const givenL = it.given ? String(it.given).trim().toUpperCase() : '';
        for (const L of (partLetters || [...LETTERS])) {
          const b = el('span', 'pke-letter is-static', L);
          if (L === it.answer) b.classList.add('is-answer');
          if (L === givenL && L !== it.answer) b.classList.add('is-wrong');
          if (L === givenL) b.classList.add('is-picked');
          row.append(b);
        }
        main.append(row);
      } else {
        const mine = el('div', 'pke-rev-mine');
        mine.append(el('small', '', '你的作答'), el('p', it.blank ? 'is-empty' : '', it.blank ? '（未作答）' : String(it.given)));
        main.append(mine);
      }

      // 答案与解析卡：完全对齐外面刷题逻辑（先给官方答案/解析/原文，按需点「讲给我听」/「带读+搭配」）
      const fb = el('div', 'pkp-fb pke-rev-fb');
      fb.dataset.kind = it.subjective ? 'right' : it.correct ? 'right' : 'wrong';
      if (it.subjective && it.grade) {
        const gHead = el('p', 'pkp-fb__key');
        gHead.append(el('small', '', '阅卷得分'), el('b', 'pkg-num', `${fmtScore(it.grade.score)} / ${fmtScore(it.grade.max)} 分`));
        fb.append(gHead);
        if (it.grade.reason) {
          const gr = el('p', 'pkp-fb__why');
          gr.append(el('small', '', '评分理由'), document.createTextNode(it.grade.reason));
          fb.append(gr);
        }
        if (it.reference) {
          const ref = el('details', 'pkp-fb__ref');
          ref.open = true;
          ref.append(el('summary', '', '参考答案 / 范文'), el('p', '', it.reference));
          fb.append(ref);
        }
      } else {
        const k = el('p', 'pkp-fb__key');
        k.append(el('small', '', '官方答案'), el('b', '', it.key || ''));
        if (!it.correct && !it.blank && it.givenText) {
          k.append(el('span', 'pke-rev-yours', `　·　你填了：${it.givenText}`));
        }
        fb.append(k);
        if (it.why) {
          const w = el('p', 'pkp-fb__why');
          w.append(el('small', '', '官方解析'), document.createTextNode(it.why));
          fb.append(w);
        }
        if (it.script) {
          const s = el('p', 'pkp-fb__why');
          s.append(el('small', '', '录音原文'), document.createTextNode(it.script));
          fb.append(s);
        }
      }

      // 两个按需解析按键（与刷题完全同一套逻辑）
      const actRow = el('div', 'pkp-row pke-rev-act');
      const explainBtn = btn('讲给我听', 'pkb-link');
      explainBtn.title = '完整讲解：考点、秒杀、逐词带读、翻译、选项扫盲、搭配';
      const readBtn = btn('带读+搭配', 'pkb-link pkp-read-btn');
      readBtn.title = '只看逐词带读、整句翻译，再补充 B 级高频固定搭配';
      const foldBtn = btn('收起讲解', 'pkb-link pke-rev-fold');
      foldBtn.hidden = true;
      let notice = null;
      let lectureEl = null;
      const modeButtons = [
        {mode: 'full', el: explainBtn, label: '讲给我听', retry: '再讲一次', busy: '碧琪在按标准答案讲…'},
        {mode: 'read', el: readBtn, label: '带读+搭配', retry: '重试带读', busy: '碧琪在准备带读和搭配…'},
      ];
      const resetLabels = activeMode => {
        for (const item of modeButtons) {
          item.el.disabled = false;
          item.el.textContent = item.label;
          item.el.setAttribute('aria-pressed', activeMode === item.mode ? 'true' : 'false');
        }
        foldBtn.hidden = !activeMode;
      };
      const showLecture = (text, mode, {scroll = true} = {}) => {
        lectureEl?.remove();
        lectureEl = renderLectureNode(text, mode);
        actRow.after(lectureEl);
        resetLabels(mode);
        if (scroll) {
          lectureEl.scrollIntoView({block: 'nearest', behavior: desk()?.motion?.reduced ? 'auto' : 'smooth'});
        }
      };
      foldBtn.addEventListener('click', () => {
        lectureEl?.remove();
        lectureEl = null;
        it._collapsed = true;
        resetLabels(null);
      });
      const askMode = async item => {
        notice?.remove(); notice = null;
        it._collapsed = false;
        for (const other of modeButtons) { other.el.disabled = true; other.el.textContent = other === item ? item.busy : other.label; }
        const failed = message => {
          if (!fb.isConnected) return;
          for (const other of modeButtons) { other.el.disabled = false; other.el.textContent = other === item ? item.retry : other.label; }
          notice = el('p', 'pkp-fb__mon', message || '这次没有生成讲解，请检查内置模型后重试。');
          const switchModel = btn('切换模型', 'pkb-link', () => desk()?.openBuiltinModel?.());
          notice.append(document.createTextNode(' '), switchModel);
          actRow.after(notice);
        };
        try {
          const payload = item.mode === 'read' ? {attemptId, itemId: it.id, mode: 'read'} : {attemptId, itemId: it.id};
          const res = await G().call('exam.explain', payload, 260000);
          if (res?.text) {
            it.lectures = {...(it.lectures || {}), [item.mode]: res.text};
            it._lastMode = item.mode;
          }
          if (!fb.isConnected) return;
          if (res?.text) {
            showLecture(res.text, item.mode, {scroll: true});
            return;
          }
          failed(res?.error);
        } catch (e) {
          failed(e.message || '讲解暂时没连上，请重试。');
        }
      };
      for (const item of modeButtons) {
        item.el.setAttribute('aria-pressed', 'false');
        item.el.addEventListener('click', () => void askMode(item));
      }
      actRow.append(explainBtn, readBtn, foldBtn);
      fb.append(actRow);

      // 若本题已有缓存讲解且未被用户收起，直接展示
      if (!it._collapsed && it.lectures) {
        const mode = it._lastMode && it.lectures[it._lastMode] ? it._lastMode : (it.lectures.full ? 'full' : it.lectures.read ? 'read' : null);
        if (mode) showLecture(it.lectures[mode], mode, {scroll: false});
      }

      main.append(fb);
      box.append(noCol, main);
      return box;
    }

    const onKey = e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!e.defaultPrevented) { e.preventDefault(); close(); onReport?.(); }
      }
    };
    hall.addEventListener('keydown', onKey, true);
    function close() {
      if (closed) return;
      closed = true;
      tts.stop();
      try { audio?.pause(); } catch { /* ignore */ }
      hall.remove();
      delete r.dataset.exam;
    }

    syncFilter();
    if (jumpId) {
      jumpTo(jumpId);
    } else {
      const startIdx = onlyWrong
        ? review.sections.findIndex(s => s.items.some(isMiss))
        : review.sections.findIndex(s => s.items.length > 0);
      show(startIdx >= 0 ? startIdx : 0);
    }
    sheet.tabIndex = -1; sheet.focus({preventScroll: true});
    return {close, escape: () => { close(); onReport?.(); }};
  }

  // ───────────── Boss 结算 ─────────────
  async function bossSettle(host, result) {
    const g = G(), engine = fx(); const form = g.equippedForm?.();
    const before = result.bossBefore?.hpPercent ?? 100, after = result.bossAfter?.hpPercent ?? before; const broken = result.bossAfter?.phase === 'broken' && result.bossBefore?.phase !== 'broken';
    const ov = el('div', 'pke-boss'); ov.dataset.broken = broken ? '1' : '';
    const art = el('img', 'pke-boss__art'); art.alt = '巴别兽'; art.src = g.art('boss/babel/full') || g.art('boss/babel/portrait') || '';
    const plate = el('div', 'pke-boss__plate'); const name = el('div', 'pke-boss__name'); name.append(el('small', 'pkb-kicker', 'BOSS · THE BABEL BEAST'), el('b', '', '巴别兽'));
    const hp = el('div', 'pke-hp'); const hpFill = el('i'); const hpGhost = el('u'); hp.append(hpGhost, hpFill); const hpVal = el('span', 'pkg-num', `${Math.round(before)}%`);
    plate.append(name, hp, hpVal);
    const log = el('div', 'pke-boss__log'); const skip = btn('跳过', 'pkb-link pke-boss__skip');
    ov.append(art, plate, log, skip); host.append(ov);
    const setHp = v => { hpFill.style.transform = `scaleX(${Math.max(0, v) / 100})`; hpVal.textContent = `${Math.round(Math.max(0, v))}%`; };
    setHp(before); hpGhost.style.transform = `scaleX(${before / 100})`;
    let skipped = false; skip.addEventListener('click', () => { skipped = true; });
    const pause = async ms => { const t0 = Date.now(); while (!skipped && Date.now() - t0 < ms) await wait(40); };
    await wait(60); ov.classList.add('is-in'); await pause(700);
    const secs = result.sections || []; const total = secs.reduce((n, s) => n + s.score, 0) || 1; let hpNow = before;
    for (const [i, s] of secs.entries()) {
      if (skipped) break;
      const row = el('div', 'pke-strike'); row.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[s.id] || s.id), el('em', 'pkg-num', `${fmtScore(s.score)} / ${fmtScore(s.max)}`)); if (s.crit) row.append(el('strong', '', 'CRITICAL'));
      log.append(row);
      try { engine?.hit(form?.hit || 'sparkle', art, {crit: s.crit, palette: form?.palette, form: g.fxForm?.(form)}); } catch { /* 只有数字 */ }
      try { art.animate([{transform: 'translate(-50%,-50%) scale(1)', filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6))'}, {transform: `translate(calc(-50% + ${s.crit ? 22 : 12}px),-50%) scale(.985)`, filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6)) brightness(1.6) saturate(.6)', offset: .12}, {transform: 'translate(-50%,-50%) scale(1)', filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6))'}], {duration: s.crit ? 520 : 380, easing: 'cubic-bezier(.16,1,.3,1)'}); } catch { /* ignore */ }
      const dmg = el('div', `pke-dmg pkg-num${s.crit ? ' is-crit' : ''}`, `−${fmtScore(s.score)}`); dmg.style.left = `${46 + (i % 2 ? 9 : -7) + i * 2}%`; ov.append(dmg);
      hpNow = before - (before - after) * (secs.slice(0, i + 1).reduce((n, x) => n + x.score, 0) / total); setHp(hpNow);
      setTimeout(() => { hpGhost.style.transform = `scaleX(${Math.max(0, hpNow) / 100})`; }, 520);
      await pause(s.crit ? 950 : 680);
    }
    setHp(after); hpGhost.style.transform = `scaleX(${Math.max(0, after) / 100})`;
    if (broken && !skipped) {
      art.src = g.art('boss/babel/broken') || art.src;
      try { await engine?.cinematic('beam', {text: '破防', sub: 'THE BABEL BEAST IS BROKEN', kicker: '巴别兽', art: g.art('boss/babel/broken'), palette: ['#FFE9B0', '#C99A3E', '#FFF6DC'], particle: 'gold', form: g.fxForm?.(form)}); } catch { /* ignore */ }
    } else await pause(500);
    ov.classList.add('is-out'); await wait(360); ov.remove();
    try { g.play?.(result.awards || []); } catch { /* ignore */ }
  }

  // ───────────── 成绩报告 ─────────────
  function report(host, result, {onReview, onMap, onHunt, onAgain}) {
    const box = el('section', 'pke-report');
    const head = el('div', 'pke-report__head');
    const big = el('div', 'pke-score');
    big.append(el('small', 'pkb-kicker', result.title ? `SCORE · ${result.title}` : 'SCORE'), el('b', 'pkg-num', fmtScore(result.score)), el('span', 'pkg-num', '/ 100'));
    const verdict = result.score >= 70 ? '稳过线以上' : result.score >= 60 ? '过了及格线，离稳过线还差一点' : `离及格线还差 ${fmtScore(60 - result.score)} 分`;
    const line = el('div', 'pke-line'); const bar = el('div', 'pke-line__bar'); const fill = el('i'); fill.style.transform = `scaleX(${Math.min(100, result.score) / 100})`; bar.append(fill);
    for (const [v, label] of [[60, '及格 60'], [70, '稳过 70']]) { const m = el('span', 'pke-line__mark'); m.style.left = `${v}%`; m.append(el('em', 'pkg-num', label)); bar.append(m); }
    const sum = result.summary;
    const sumText = sum ? ` · 客观题 对 ${sum.right} / 错 ${sum.wrong} / 未答 ${sum.blank}` : '';
    line.append(bar, el('p', '', `${verdict} · 预估分 ${fmtScore(result.predicted ?? result.score)}${sumText}`));
    head.append(big, line); box.append(head);

    // 顶部主入口：直接进「预览整卷 & 挑题解析」，不用在列表里干看
    const misses = result.explained || [];
    if (onReview) {
      const quick = el('div', 'pke-report__quick');
      quick.append(
        btn('预览整卷 & 挑题解析', 'pkg-btn pke-rev-launch', () => onReview({filter: 'all'})),
        ...(misses.length ? [btn(`只看错题解析（${misses.length} 题）`, 'pks-pull pke-nav', () => onReview({filter: 'wrong'}))] : []),
        el('span', 'pke-report__hint', '全部标准答案和官方解析已就绪，进整卷后想听哪题再点「讲给我听」或「带读+搭配」。'),
      );
      box.append(quick);
    }

    const rows = el('div', 'pke-rows');
    (result.sections || []).forEach((s, i) => { const r = el('div', 'pke-row'); const b = el('div', 'pke-row__bar'); const f = el('i'); f.style.transform = `scaleX(${s.max ? s.score / s.max : 0})`; b.append(f); r.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[s.id] || s.id), b, el('em', 'pkg-num', `${fmtScore(s.score)} / ${fmtScore(s.max)}`)); if (s.crit) r.dataset.crit = '1'; rows.append(r); });
    box.append(rows);

    const notes = Object.entries(result.notes || {});
    if (misses.length) {
      const block = el('div', 'pke-misses');
      block.append(el('small', 'pkb-kicker', `ANSWER KEY · 错题与未答（${misses.length} 题，点任意一题直接进卷精讲）`));
      for (const m of misses) {
        const it = el('article', 'pke-miss');
        const topRow = el('div', 'pke-miss__top');
        topRow.append(el('b', '', `${m.no ? `第 ${m.no} 题` : (PART_ZH[m.section] || '这题')}${m.blank ? ' · 未答' : ''}`));
        if (onReview && m.id) {
          topRow.append(btn('进卷看解析 →', 'pkb-link pke-miss__go', () => onReview({filter: 'all', jumpId: m.id})));
        }
        it.append(topRow);
        if (m.stem) it.append(el('p', '', m.stem));
        if (m.yours) it.append(el('p', '', `你的答案：${m.yours}`));
        it.append(el('p', 'pke-miss__key', `标准答案：${m.standard}`));
        if (m.text) it.append(el('p', 'pke-miss__why', m.text));
        block.append(it);
      }
      box.append(block);
    }
    if (notes.length) {
      const n = el('div', 'pke-notes');
      n.append(el('small', 'pkb-kicker', 'MARKER’S NOTES'));
      for (const [id, v] of notes) {
        const it = el('div', 'pke-note');
        it.append(el('b', '', /^writing/.test(id) ? '作文' : '翻译段落'), el('em', 'pkg-num', `${fmtScore(v.score)} 分`));
        if (v.standard) it.append(el('p', 'pke-miss__key', `参考答案：${v.standard}`));
        it.append(el('p', '', v.reason || ''));
        if (v.source === 'local') it.append(el('small', '', '可在整卷预览中对照参考答案，或点击「讲给我听」细看'));
        n.append(it);
      }
      box.append(n);
    }
    if (result.review?.text) { const rv = el('blockquote', 'pke-review'); rv.append(el('p', '', result.review.text), el('cite', '', '— 碧琪')); box.append(rv); }
    const act = el('div', 'pke-report__act'); const mons = (result.monstersSpawned || []).length;
    const backView = (() => { const v = desk()?.pane?.()?.state?.returnView; return v && v !== 'gameexam' ? v : 'today'; })();
    const backName = desk()?.backName?.(backView) || '返回';
    if (onReview) act.append(btn('预览整卷 & 挑题解析', 'pkg-btn', () => onReview({filter: 'all'})));
    if (mons) { act.append(el('span', 'pke-mons', `${mons} 道错题变成了错题怪，回到了地图上`), btn('去地图看看', 'pks-pull pke-nav', onMap), btn('去讨伐', 'pks-pull pke-nav', onHunt)); }
    act.append(btn('回考场选卷', 'pkb-link', onAgain), btn(backName, 'pkb-link', () => desk()?.go(backView)));
    box.append(act); host.append(box); return box;
  }

  // ───────────── 大厅 ─────────────
  async function mountExam(host, ctx) {
    host.classList.add('pke-page');
    const g = G(); let alive = true, pollT = 0, hall = null;
    const head = el('header', 'pkb-page__head pks-head');
    const x = btn('×', 'pkb-x', () => (g.goBack ? g.goBack() : desk()?.go('today'))); x.setAttribute('aria-label', g.backLabel?.() || '回营地'); x.title = x.getAttribute('aria-label');
    const t = el('div'); t.append(el('small', 'pkb-kicker', 'EXAMINATION HALL · PRETCO-B'), el('h2', '', '考场'));
    const hudBox = el('div', 'pkb-page__hud'); head.append(x, t, hudBox); host.append(head);
    const main = el('div', 'pke-lobby'); host.append(main);
    try { await Promise.all([g.manifest(), g.forms(), g.state()]); g.hud(hudBox, {compact: true}); } catch { /* HUD 可选 */ }
    const call = (m, p, timeout) => g.call(m, p, timeout);

    // 考过的卷子点开时：直接选择「预览上次答卷与解析」还是「再考一次」
    function choosePaperAction(p, b) {
      const m = el('div', 'pke-modal pke-lobby-modal');
      const c = el('div', 'pke-modal__card');
      c.append(
        el('h3', '', p.title || '真题卷'),
        el('p', '', `这套卷考过 ${p.attempts} 次${p.best != null ? `（最高 ${fmtScore(p.best)} 分）` : ''}。要回看上次的整卷答案与解析，还是重新开考？`),
      );
      const row = el('div', 'pke-modal__act');
      row.append(
        btn('取消', 'pkb-link', () => m.remove()),
        btn('再考一次', 'pks-pull pke-nav', () => { m.remove(); begin(p, b); }),
        btn('预览整卷与解析', 'pkg-btn', () => { m.remove(); openPaperReview(p.lastAttemptId, {filter: 'all'}); }),
      );
      c.append(row); m.append(c);
      m.addEventListener('click', ev => { if (ev.target === m) m.remove(); });
      (root() || host).append(m);
      row.lastChild.focus();
    }

    async function lobby() {
      clearTimeout(pollT); main.replaceChildren(); main.classList.remove('is-report');
      let boss = null, list = {papers: [], format: null};
      try { [boss, list] = await Promise.all([call('boss.state', {exam: EXAM}), call('exam.papers', {exam: EXAM})]); } catch (e) { main.append(el('p', 'pkb-empty', e.message || '考场打不开')); return; }
      if (!alive) return;
      // 巴别兽
      const bp = el('section', 'pke-bosscard'); bp.dataset.phase = boss.phase || 'normal';
      const img = el('img', 'pke-bosscard__art'); img.alt = ''; img.src = g.art(boss.phase === 'broken' || boss.phase === 'done' ? 'boss/babel/broken' : 'boss/babel/portrait') || '';
      const info = el('div', 'pke-bosscard__info');
      info.append(el('small', 'pkb-kicker', `BOSS · ${boss.daysLeft > 0 ? `D−${boss.daysLeft}` : boss.daysLeft === 0 ? 'EXAM DAY' : 'AFTER'}`), el('h3', '', boss.name || '巴别兽'));
      const hp = el('div', 'pke-hp is-static'); const f = el('i'); f.style.transform = `scaleX(${(boss.hpPercent ?? 100) / 100})`; hp.append(f); info.append(hp);
      const facts = el('dl', 'pke-facts');
      for (const [k, v] of [['离稳过线', boss.gap > 0 ? `${fmtScore(boss.gap)} 分` : '已经稳了'], ['预估分', boss.bestPredicted ? fmtScore(boss.bestPredicted) : '—'], ['考试日', `${String(boss.examDate || '2026-12-13').slice(5).replace('-', ' 月 ')} 日`]]) { facts.append(el('dt', '', k), el('dd', 'pkg-num', v)); }
      info.append(facts, el('p', 'pke-bosscard__tip', boss.phase === 'broken' ? '巴别兽已经破防。安心上考场。' : '每交一份卷，五个部分各打它一下；某部分拿到 90% 以上是暴击。'));
      bp.append(img, info);
      // 卷子：左「历年真题」（按年份），右「仿真卷」
      const pc = el('section', 'pke-papers');
      const realCol = el('div', 'pke-shelf pke-shelf--real'); const simCol = el('div', 'pke-shelf pke-shelf--sim');
      const rs = list.realStatus || {};
      realCol.append(el('small', 'pkb-kicker', `PAST PAPERS · ${list.real?.length || 0} SETS`), el('h3', '', '历年真题'));
      const prep = el('p', 'pke-prep pkg-num');
      const found = Math.max(rs.found || 0, list.real?.length || 0);
      prep.textContent = rs.state === 'preparing' ? `U 盘里找到 ${found} 套卷，已备好 ${rs.ready} 套 · 正在整理 ${rs.preparing || ''}` : found ? `已备好 ${rs.ready} 套真题（含 2025–2013 年）${rs.ready < found ? (rs.mounted ? ' · 剩下的碧琪会接着整理' : ' · 插上 U 盘碧琪接着整理') : ''}` : (rs.mounted ? 'U 盘插着，碧琪在找卷子…' : '插上放着 B 级真题的 U 盘，碧琪会把每一套整理成考场整卷。');
      if (found) { const bar = el('i', 'pke-prep__bar'); const f = el('u'); f.style.transform = `scaleX(${found ? Math.min(1, rs.ready / found) : 0})`; bar.append(f); prep.append(bar); }
      realCol.append(prep);
      const years = new Map(); const mocks = [];
      for (const p of list.real || []) { if (p.kind === 'mock') mocks.push(p); else { if (!years.has(p.year)) years.set(p.year, []); years.get(p.year).push(p); } }
      const chip = p => {
        const c = btn('', 'pke-chip'); c.dataset.done = p.attempts ? '1' : '';
        c.title = `${p.title}${p.audio ? ' · 原录音' : ' · 无录音'}${p.lastAttemptId ? ' · 点击可回看整卷或重考' : ''}`;
        c.append(el('b', 'pkg-num', p.kind === 'mock' ? `0${p.title.replace(/\D/g, '')}`.slice(-2) : `${String(p.month).padStart(2, '0')}`), el('small', '', p.kind === 'mock' ? '模拟' : '月'));
        c.append(el('em', 'pkg-num', p.open ? '接着考' : p.best != null ? `${fmtScore(p.best)}分` : p.attempts ? '已考' : p.audio ? '' : '无录音'));
        c.addEventListener('click', () => {
          if (!p.open && p.lastAttemptId) choosePaperAction(p, c);
          else begin(p, c);
        });
        return c;
      };
      const ylist = el('div', 'pke-years');
      for (const [y, ps] of [...years.entries()].sort((a, b) => b[0] - a[0])) { const row = el('div', 'pke-year'); row.append(el('b', 'pkg-num', String(y))); const cs = el('div', 'pke-chips'); for (const p of ps.sort((a, b) => b.month - a.month)) cs.append(chip(p)); row.append(cs); ylist.append(row); }
      if (mocks.length) { const row = el('div', 'pke-year is-mock'); row.append(el('b', '', '模拟卷')); const cs = el('div', 'pke-chips'); for (const p of mocks) cs.append(chip(p)); row.append(cs); ylist.append(row); }
      if (!years.size && !mocks.length) ylist.append(el('p', 'pkb-empty', '还没有整理好的真题。'));
      realCol.append(ylist);
      if (rs.mounted && rs.state !== 'preparing' && (rs.ready < found || !found)) realCol.append(btn('再扫一遍 U 盘', 'pkb-link', async ev => { ev.currentTarget.disabled = true; try { await call('exam.realSync', {}); } catch (e) { g.toast?.(e.message); } setTimeout(() => { if (alive && !hall) lobby(); }, 1200); }));
      simCol.append(el('small', 'pkb-kicker', 'SIMULATED · BY 碧琪'), el('h3', '', '仿真卷'));
      const ul = el('div', 'pke-plist');
      const last = store.get('pinkie.exam.last');
      const lastAttemptId = last?.attemptId || list.latestAttemptId || null;
      if (!list.papers.length) ul.append(el('p', 'pkb-empty', '还没有仿真卷。点下面「出一份新卷」，碧琪按 B 级官方题型出整套。'));
      const hasReady = list.papers.some(p => p.status === 'ready'); let failedShown = false;
      for (const p of list.papers) {
        if (p.status === 'failed') { if (hasReady || failedShown) continue; failedShown = true; }
        const row = el('div', 'pke-prow'); row.dataset.status = p.status;
        const meta = el('div'); meta.append(el('b', '', p.title), el('small', 'pkg-num', p.status === 'generating' ? '出卷中 · 大约几分钟' : p.status === 'failed' ? '碧琪离线，这份没出成；联网后点「出一份新卷」' : `${new Date(p.createdAt).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})} · 考过 ${p.attempts} 次${p.best != null ? ` · 最好 ${fmtScore(p.best)}` : ''}`));
        row.append(meta);
        if (p.status === 'ready') {
          const acts = el('div', 'pke-prow__act');
          if (!p.open && p.lastAttemptId) acts.append(btn('看卷子', 'pkb-link', () => openPaperReview(p.lastAttemptId, {filter: 'all'})));
          acts.append(btn(p.open ? '接着考' : p.attempts ? '再考' : '开考', p.attempts && !p.open ? 'pks-pull pke-nav' : 'pkg-btn', ev => begin(p, ev.currentTarget)));
          row.append(acts);
        } else if (p.status === 'generating') row.append(el('span', 'pke-spin', '出卷中'));
        ul.append(row);
      }
      simCol.append(ul);
      const gen = btn('出一份新卷', 'pkb-link', async () => { gen.disabled = true; try { await call('exam.generate', {exam: EXAM}); } catch (e) { g.toast?.(e.message); } lobby(); });
      const prow = el('div', 'pke-papers__act'); prow.append(gen);
      if (lastAttemptId) {
        prow.append(
          btn('上一次的成绩', 'pkb-link', () => showResult(lastAttemptId, {replay: Boolean(last?.attemptId === lastAttemptId && !last.seen)})),
          btn('回看上次整卷', 'pkb-link', () => openPaperReview(lastAttemptId, {filter: 'all'})),
        );
      }
      simCol.append(prow);
      pc.append(realCol, simCol);
      // 题型
      const fm = el('section', 'pke-format'); fm.append(el('small', 'pkb-kicker', 'FORMAT · 120 MIN · 100 PTS'));
      const tbl = el('div', 'pke-ftable');
      (list.format?.sections || []).forEach((s, i) => { const r = el('div', 'pke-frow'); r.append(el('small', 'pkg-num', ROMAN[i]), el('b', '', PART_ZH[s.id] || s.title), el('span', '', s.parts.map(p => p.note.split('，')[0].split('（')[0]).join(' · ')), el('em', 'pkg-num', `${s.points} 分 · ${s.timeMin}′`)); tbl.append(r); });
      fm.append(tbl, el('p', 'pke-format__tip', '考试中安静无提示、每 15 秒自动保存。交卷后立即出标准答案，进「预览整卷」可自由挑题点「讲给我听」或「带读+搭配」。'));
      // 真分数
      const real = el('section', 'pke-real'); real.append(el('small', 'pkb-kicker', 'THE REAL ONE'), el('h3', '', '真实成绩'));
      if ((boss.daysLeft ?? 1) > 0) real.append(el('p', '', `12 月 13 日考完，成绩出来以后填在这里。还有 ${boss.daysLeft} 天。`));
      else {
        const inp = el('input', 'pke-fill pkg-num'); inp.type = 'number'; inp.min = '0'; inp.max = '100'; inp.placeholder = '0–100';
        const go = btn('填好了', 'pkg-btn', async () => { const v = Number(inp.value); if (!(v >= 0 && v <= 100)) return; go.disabled = true; try { const res = await call('boss.realScore', {exam: EXAM, score: v}); await finale(res); } catch (e) { g.toast?.(e.message); go.disabled = false; } });
        const row = el('div', 'pke-real__row'); row.append(inp, go); real.append(el('p', '', '把成绩单上的总分填进来。'), row);
      }
      main.append(pc, bp, fm, real);
      if (list.papers.some(p => p.status === 'generating') || list.realStatus?.state === 'preparing') pollT = setTimeout(() => { if (alive && !hall) lobby(); }, 8000);
    }
    async function begin(p, b) {
      if (b) b.disabled = true;
      let start; try { start = await call('exam.start', {paperId: p.paperId}); } catch (e) { g.toast?.(e.message || '开不了考'); if (b) b.disabled = false; return; }
      start.title = p.title; clearTimeout(pollT);
      hall = openHall({start, onLeave: () => { hall = null; lobby(); }, onDone: attemptId => { hall = null; showResult(attemptId, {replay: true}); }});
    }
    async function openPaperReview(attemptId, {filter = 'all', jumpId = null} = {}) {
      let rv;
      try { rv = await call('exam.review', {attemptId}); } catch (e) { g.toast?.(e.message || '整卷打不开'); return; }
      if (!alive) return;
      if (rv?.status !== 'done') { showResult(attemptId, {replay: false}); return; }
      clearTimeout(pollT);
      hall?.close?.();
      hall = openReview({
        review: rv,
        filter,
        jumpId,
        onReport: () => { hall = null; showResult(attemptId, {replay: false}); },
        onLeave: () => { hall = null; lobby(); },
      });
    }
    async function showResult(attemptId, {replay}) {
      clearTimeout(pollT); main.replaceChildren(); main.classList.add('is-report');
      if (!main.contains(document.activeElement)) { main.tabIndex = -1; main.focus({preventScroll: true}); }
      const wait1 = el('div', 'pke-grading'); wait1.append(el('small', 'pkb-kicker', 'GRADING'), el('h3', '', '正在核对答案'), el('p', '', '客观题立即出分；如果写了翻译段落或作文，正在按细则评分。'), el('i', 'pke-grading__rule'));
      const backView = (() => { const v = desk()?.pane?.()?.state?.returnView; return v && v !== 'gameexam' ? v : 'today'; })();
      wait1.append(btn('先' + (desk()?.backName?.(backView) || '返回'), 'pkb-link', () => desk()?.go(backView)));
      main.append(wait1);
      let res = null; const t0 = Date.now();
      while (alive) { try { res = await call('exam.result', {attemptId}); } catch (e) { wait1.querySelector('p').textContent = e.message || '成绩取不到'; return; } if (res.status === 'done' || res.status === 'open') break; await wait(Date.now() - t0 < 12000 ? 600 : 2000); }
      if (!alive || !res || res.status !== 'done') { if (res?.status === 'open') lobby(); return; }
      main.replaceChildren();
      const last = store.get('pinkie.exam.last');
      if (replay) { await bossSettle(root() || host, res); if (last?.attemptId === attemptId) store.set('pinkie.exam.last', {...last, seen: true}); }
      if (!alive) return;
      report(main, res, {
        onReview: opts => openPaperReview(attemptId, opts),
        onMap: () => desk()?.go('gamemap'),
        onHunt: () => desk()?.go('gamehunt'),
        onAgain: () => lobby(),
      });
      try { g.refresh?.(); } catch { /* ignore */ }
    }
    async function finale(res) {
      try { await fx()?.cinematic(res.passed ? 'curtain' : 'ink', {text: res.passed ? '上岸' : '辛苦了', sub: `PRETCO-B · ${res.score}`, kicker: '碧琪', art: g.ultArt?.('graduate') || g.portrait?.('graduate'), palette: ['#FBE3C0', '#C99A3E', '#FFFFFF'], particle: 'gold'}); } catch { /* ignore */ }
      try { g.play?.(res.awards || []); } catch { /* ignore */ }
      lobby();
    }
    await lobby();
    window.__pinkieGameExam._page = {lobby, begin, showResult, openPaperReview, hall: () => hall};
    return {unmount() { alive = false; clearTimeout(pollT); hall?.close(); tts.stop(); }, keydown(e) { if (e.key === 'Escape' && hall) { e.preventDefault(); hall.escape?.(); } }};
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gameexam', {title: '考场', wide: true, mount: (h, c) => mountExam(h, c)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }
  window.__pinkieGameExam = {tts, bossSettle, report, openReview, termLetters};
})();
