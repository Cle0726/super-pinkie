/* 碧琪上岸记 · 考场（学习台视图 gameexam）。
   - 考场大厅：巴别兽状态（离稳过线还差几分）、卷子列表（exam.papers / generate，生成中自动刷新）、B 级五部分说明、真分数录入（boss.realScore）。
   - 真考场：盖满学习台的安静考卷。倒计时（endsAt）、五部分导航、答题卡、标记待检查、15 秒自动保存 + 本地草稿、关掉再开接着考（exam.start 的 resumed/answers）、
     听力用系统 TTS 朗读 item.tts（对话按 W:/M: 换声音，听写读 repeat 遍）。**考试中零特效**：不调 fx、不播音效、HUD 隐藏。
   - 交卷：exam.submit → 阅卷等待（轮询 exam.result）→ Boss 结算（每部分一击，≥90% 暴击，血条 bossBefore → bossAfter，破防 = 天光过场）→ 成绩报告。
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
    const items = []; paper.sections.forEach((sec, si) => sec.items.forEach(it => items.push({...it, sec: sec.id, si, no: items.length + 1}))); const noOf = new Map(items.map(it => [it.id, it.no]));
    const latin = (node, text) => { if (/^[\x00-\x7F\u2018-\u201D\u2013\u2014\u2026]*$/.test(String(text || ''))) node.lang = 'en'; return node; };
    r.dataset.exam = 'on'; tts.stop();
    const hall = el('section', 'pke-hall'); hall.setAttribute('role', 'dialog'); hall.setAttribute('aria-label', '考场');
    // 顶栏
    const top = el('header', 'pke-top');
    const id = el('div', 'pke-top__id'); id.append(el('small', 'pkb-kicker', `PRETCO-B · ${start.resumed ? 'RESUMED' : 'IN SESSION'}`), el('b', '', start.title || '英语 B 级 · 仿真卷'));
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
    const cells = items.map(it => { const c = btn(String(it.no), 'pke-cell pkg-num', () => { show(it.si); requestAnimationFrame(() => sheet.querySelector(`[data-item="${it.id}"]`)?.scrollIntoView({block: 'center'})); }); c.dataset.item = it.id; grid.append(c); return c; });
    const legend = el('div', 'pke-card__legend'); legend.innerHTML = '<span><i class="is-done"></i>已答</span><span><i class="is-flag"></i>待检查</span><span><i></i>未答</span>';
    side.append(cardHead, cardStat, grid, legend);
    const answered = it => answers[it.id] != null && answers[it.id] !== '';
    function refreshCard() {
      for (const [i, it] of items.entries()) { cells[i].classList.toggle('is-done', answered(it)); cells[i].classList.toggle('is-flag', flags.has(it.id)); cells[i].classList.toggle('is-here', it.si === cur); }
      paper.sections.forEach((sec, i) => { const n = sec.items.filter(answered).length; tabBtns[i].querySelector('em').textContent = `${n}/${sec.items.length}`; tabBtns[i].setAttribute('aria-selected', String(i === cur)); });
      const n = items.filter(answered).length; cardStat.textContent = `已答 ${n} / ${items.length}　待检查 ${flags.size}`;
    }
    function setAnswer(it, v) { if (v === '' || v == null) delete answers[it.id]; else answers[it.id] = v; dirty = true; store.set(draftKey, {answers, flags: [...flags], at: Date.now()}); refreshCard(); }
    // 一部分的题
    function show(i) {
      cur = i; tts.stop(); sheet.replaceChildren(); sheet.scrollTop = 0;
      const sec = paper.sections[i];
      const head = el('header', 'pke-sec'); head.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]} · ${sec.timeMin} MIN`), el('h2', '', sec.title.replace(/^Part [IVX]+\s*/, '')), el('p', 'pke-sec__zh', `${PART_ZH[sec.id] || ''} · ${sec.items.reduce((n, it) => n + it.points, 0)} 分`));
      sheet.append(head);
      const notes = String(sec.instructions || '').split('；');
      const parts = []; for (const it of sec.items) { let p = parts.find(x => x.id === it.part); if (!p) parts.push(p = {id: it.part, items: []}); p.items.push(it); }
      parts.forEach((p, pi) => {
        const g = el('section', 'pke-part'); const ph = el('div', 'pke-part__head'); ph.append(el('b', 'pkg-num', /^T\d/.test(p.id) ? `Task ${p.id.slice(1)}` : `Section ${p.id}`), el('span', '', notes[pi] || ''));
        g.append(ph);
        const first = p.items[0];
        if (first.kind === 'listen-dictation' && first.tts) g.append(listenBar(first.tts, '短文（读三遍）'));
        if (first.material) { const m = el('div', 'pke-material'); if (first.kind === 'term-match') { m.classList.add('is-terms'); for (const line of first.material.split('\n').filter(Boolean)) m.append(latin(el('div', '', line), line)); } else { m.textContent = first.material; latin(m, first.material); } g.append(m); }
        for (const it of p.items) g.append(itemView(it));
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
    function itemView(it) {
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
        it.options.forEach((o, k) => { const b = btn('', 'pke-opt'); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(answers[it.id] === k)); b.append(el('i', '', LETTERS[k]), latin(el('span', '', o), o)); b.addEventListener('click', () => { const on = answers[it.id] === k; setAnswer(it, on ? null : k); ol.querySelectorAll('.pke-opt').forEach((x, j) => x.setAttribute('aria-checked', String(!on && j === k))); }); ol.append(b); });
        main.append(ol);
      } else if (it.kind === 'term-match') {
        const row = el('div', 'pke-letters');
        for (const L of LETTERS) { const b = btn(L, 'pke-letter', () => { const on = answers[it.id] === L; setAnswer(it, on ? null : L); row.querySelectorAll('.pke-letter').forEach(x => x.setAttribute('aria-pressed', String(!on && x.textContent === L))); }); b.setAttribute('aria-pressed', String(answers[it.id] === L)); row.append(b); }
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
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
    hall.addEventListener('keydown', onKey, true);
    function close(leaving) {
      if (closed) return; closed = true; tts.stop(); clearInterval(saveTimer); clearInterval(tickTimer); document.removeEventListener('visibilitychange', onHide);
      hall.remove(); delete r.dataset.exam;
      if (leaving) { dirty = true; closed = false; flush().finally(() => { closed = true; }); onLeave?.(); }
    }
    function confirmBox(title, text, ok, onOk, extra) {
      const m = el('div', 'pke-modal'); const c = el('div', 'pke-modal__card'); c.append(el('h3', '', title), el('p', '', text)); if (extra) c.append(extra);
      const row = el('div', 'pke-modal__act'); row.append(btn('再看看', 'pks-pull pke-nav', () => m.remove()), btn(ok, 'pkg-btn', () => { m.remove(); onOk(); })); c.append(row); m.append(c); hall.append(m); row.lastChild.focus();
    }
    function askSubmit() {
      const blank = items.filter(it => !answered(it)).length;
      const ex = el('p', 'pke-modal__meta pkg-num', `未答 ${blank} 题 · 待检查 ${flags.size} 题 · 剩余 ${mmss(start.endsAt - Date.now())}`);
      confirmBox('交卷？', '交了就不能再改。客观题马上判，翻译和作文碧琪按评分细则逐条看。', '交卷', () => doSubmit(false), ex);
    }
    async function doSubmit(timeUp) {
      dirty = true; await flush().catch(() => {});
      try { await G().call('exam.submit', {attemptId}); } catch (e) { if (!timeUp) { save.textContent = e.message || '交卷失败，再点一次'; save.dataset.err = '1'; return; } }
      store.del(draftKey); store.set('pinkie.exam.last', {attemptId, at: Date.now(), seen: false});
      close(false); onDone?.(attemptId, timeUp);
    }
    show(0);
    return {close: () => close(true)};
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
    await wait(60); ov.classList.add('is-in'); await pause(900);
    const secs = result.sections || []; const total = secs.reduce((n, s) => n + s.score, 0) || 1; let hpNow = before;
    for (const [i, s] of secs.entries()) {
      if (skipped) break;
      const row = el('div', 'pke-strike'); row.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[s.id] || s.id), el('em', 'pkg-num', `${fmtScore(s.score)} / ${s.max}`)); if (s.crit) row.append(el('strong', '', 'CRITICAL'));
      log.append(row);
      try { engine?.hit(form?.hit || 'sparkle', art, {crit: s.crit, palette: form?.palette, form: g.fxForm?.(form)}); } catch { /* 只有数字 */ }
      try { art.animate([{transform: 'translate(-50%,-50%) scale(1)', filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6))'}, {transform: `translate(calc(-50% + ${s.crit ? 22 : 12}px),-50%) scale(.985)`, filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6)) brightness(1.6) saturate(.6)', offset: .12}, {transform: 'translate(-50%,-50%) scale(1)', filter: 'drop-shadow(0 40px 60px rgba(0,0,0,.6))'}], {duration: s.crit ? 520 : 380, easing: 'cubic-bezier(.16,1,.3,1)'}); } catch { /* ignore */ }
      const dmg = el('div', `pke-dmg pkg-num${s.crit ? ' is-crit' : ''}`, `−${fmtScore(s.score)}`); dmg.style.left = `${46 + (i % 2 ? 9 : -7) + i * 2}%`; ov.append(dmg);
      hpNow = before - (before - after) * (secs.slice(0, i + 1).reduce((n, x) => n + x.score, 0) / total); setHp(hpNow);
      setTimeout(() => { hpGhost.style.transform = `scaleX(${Math.max(0, hpNow) / 100})`; }, 520);
      await pause(s.crit ? 1150 : 820);
    }
    setHp(after); hpGhost.style.transform = `scaleX(${Math.max(0, after) / 100})`;
    if (broken && !skipped) {
      art.src = g.art('boss/babel/broken') || art.src;
      try { await engine?.cinematic('beam', {text: '破防', sub: 'THE BABEL BEAST IS BROKEN', kicker: '巴别兽', art: g.art('boss/babel/broken'), palette: ['#FFE9B0', '#C99A3E', '#FFF6DC'], particle: 'gold', form: g.fxForm?.(form)}); } catch { /* ignore */ }
    } else await pause(700);
    ov.classList.add('is-out'); await wait(420); ov.remove();
    try { g.play?.(result.awards || []); } catch { /* ignore */ }
  }

  // ───────────── 成绩报告 ─────────────
  function report(host, result, {onMap, onHunt, onAgain}) {
    const box = el('section', 'pke-report');
    const head = el('div', 'pke-report__head');
    const big = el('div', 'pke-score'); big.append(el('small', 'pkb-kicker', 'SCORE'), el('b', 'pkg-num', fmtScore(result.score)), el('span', 'pkg-num', '/ 100'));
    const verdict = result.score >= 70 ? '稳过线以上' : result.score >= 60 ? '过了及格线，离稳过线还差一点' : `离及格线还差 ${fmtScore(60 - result.score)} 分`;
    const line = el('div', 'pke-line'); const bar = el('div', 'pke-line__bar'); const fill = el('i'); fill.style.transform = `scaleX(${Math.min(100, result.score) / 100})`; bar.append(fill);
    for (const [v, label] of [[60, '及格 60'], [70, '稳过 70']]) { const m = el('span', 'pke-line__mark'); m.style.left = `${v}%`; m.append(el('em', 'pkg-num', label)); bar.append(m); }
    line.append(bar, el('p', '', `${verdict} · 预估分 ${fmtScore(result.predicted ?? result.score)}`));
    head.append(big, line); box.append(head);
    const rows = el('div', 'pke-rows');
    (result.sections || []).forEach((s, i) => { const r = el('div', 'pke-row'); const b = el('div', 'pke-row__bar'); const f = el('i'); f.style.transform = `scaleX(${s.max ? s.score / s.max : 0})`; b.append(f); r.append(el('small', 'pkb-kicker', `PART ${ROMAN[i]}`), el('b', '', PART_ZH[s.id] || s.id), b, el('em', 'pkg-num', `${fmtScore(s.score)} / ${s.max}`)); if (s.crit) r.dataset.crit = '1'; rows.append(r); });
    box.append(rows);
    const notes = Object.entries(result.notes || {});
    if (notes.length) { const n = el('div', 'pke-notes'); n.append(el('small', 'pkb-kicker', 'MARKER’S NOTES')); for (const [id, v] of notes) { const it = el('div', 'pke-note'); it.append(el('b', '', /^writing/.test(id) ? '作文' : '翻译段落'), el('em', 'pkg-num', `${v.score} 分`), el('p', '', v.reason || '')); if (v.source === 'local') it.append(el('small', '', '碧琪稍后会再细看一遍')); n.append(it); } box.append(n); }
    if (result.review?.text) { const rv = el('blockquote', 'pke-review'); rv.append(el('p', '', result.review.text), el('cite', '', '— 碧琪')); box.append(rv); }
    const act = el('div', 'pke-report__act'); const mons = (result.monstersSpawned || []).length;
    if (mons) { act.append(el('span', 'pke-mons', `${mons} 道错题变成了错题怪，回到了地图上`), btn('去地图看看', 'pkg-btn', onMap), btn('去讨伐', 'pks-pull pke-nav', onHunt)); }
    act.append(btn('再考一份', mons ? 'pkb-link' : 'pkg-btn', onAgain));
    box.append(act); host.append(box); return box;
  }

  // ───────────── 大厅 ─────────────
  async function mountExam(host, ctx) {
    host.classList.add('pke-page');
    const g = G(); let alive = true, pollT = 0, hall = null;
    const head = el('header', 'pkb-page__head pks-head');
    const x = btn('×', 'pkb-x', () => desk()?.go('today')); x.setAttribute('aria-label', '回营地');
    const t = el('div'); t.append(el('small', 'pkb-kicker', 'EXAMINATION HALL · PRETCO-B'), el('h2', '', '考场'));
    const hudBox = el('div', 'pkb-page__hud'); head.append(x, t, hudBox); host.append(head);
    const main = el('div', 'pke-lobby'); host.append(main);
    try { await Promise.all([g.manifest(), g.forms(), g.state()]); g.hud(hudBox, {compact: true}); } catch { /* HUD 可选 */ }
    const call = (m, p) => g.call(m, p);

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
      // 卷子
      const pc = el('section', 'pke-papers'); pc.append(el('small', 'pkb-kicker', 'PAPERS'), el('h3', '', '仿真卷'));
      const ul = el('div', 'pke-plist');
      const last = store.get('pinkie.exam.last');
      if (!list.papers.length) ul.append(el('p', 'pkb-empty', '还没有卷子。点下面「出一份新卷」，碧琪按 B 级官方题型出整套。'));
      const hasReady = list.papers.some(p => p.status === 'ready'); let failedShown = false;
      for (const p of list.papers) {
        if (p.status === 'failed') { if (hasReady || failedShown) continue; failedShown = true; }
        const row = el('div', 'pke-prow'); row.dataset.status = p.status;
        const meta = el('div'); meta.append(el('b', '', p.title), el('small', 'pkg-num', p.status === 'generating' ? '出卷中 · 大约几分钟' : p.status === 'failed' ? '碧琪离线，这份没出成；联网后点「出一份新卷」' : `${new Date(p.createdAt).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})} · 考过 ${p.attempts} 次`));
        row.append(meta);
        if (p.status === 'ready') row.append(btn(p.attempts ? '再考 / 接着考' : '开考', p.attempts ? 'pks-pull pke-nav' : 'pkg-btn', ev => begin(p, ev.currentTarget)));
        else if (p.status === 'generating') row.append(el('span', 'pke-spin', '出卷中'));
        ul.append(row);
      }
      pc.append(ul);
      const gen = btn('出一份新卷', 'pkb-link', async () => { gen.disabled = true; try { await call('exam.generate', {exam: EXAM}); } catch (e) { g.toast?.(e.message); } lobby(); });
      const prow = el('div', 'pke-papers__act'); prow.append(gen); if (last?.attemptId) prow.append(btn('上一次的成绩', 'pkb-link', () => showResult(last.attemptId, {replay: !last.seen}))); pc.append(prow);
      // 题型
      const fm = el('section', 'pke-format'); fm.append(el('small', 'pkb-kicker', 'FORMAT · 120 MIN · 100 PTS'));
      const tbl = el('div', 'pke-ftable');
      (list.format?.sections || []).forEach((s, i) => { const r = el('div', 'pke-frow'); r.append(el('small', 'pkg-num', ROMAN[i]), el('b', '', PART_ZH[s.id] || s.title), el('span', '', s.parts.map(p => p.note.split('，')[0].split('（')[0]).join(' · ')), el('em', 'pkg-num', `${s.points} 分 · ${s.timeMin}′`)); tbl.append(r); });
      fm.append(tbl, el('p', 'pke-format__tip', '考试中没有提示、碧琪不说话、没有特效。每 15 秒自动保存，关掉再开能接着考。'));
      // 真分数
      const real = el('section', 'pke-real'); real.append(el('small', 'pkb-kicker', 'THE REAL ONE'), el('h3', '', '真实成绩'));
      if ((boss.daysLeft ?? 1) > 0) real.append(el('p', '', `12 月 13 日考完，成绩出来以后填在这里。还有 ${boss.daysLeft} 天。`));
      else {
        const inp = el('input', 'pke-fill pkg-num'); inp.type = 'number'; inp.min = '0'; inp.max = '100'; inp.placeholder = '0–100';
        const go = btn('填好了', 'pkg-btn', async () => { const v = Number(inp.value); if (!(v >= 0 && v <= 100)) return; go.disabled = true; try { const res = await call('boss.realScore', {exam: EXAM, score: v}); await finale(res); } catch (e) { g.toast?.(e.message); go.disabled = false; } });
        const row = el('div', 'pke-real__row'); row.append(inp, go); real.append(el('p', '', '把成绩单上的总分填进来。'), row);
      }
      main.append(bp, pc, fm, real);
      if (list.papers.some(p => p.status === 'generating')) pollT = setTimeout(() => { if (alive && !hall) lobby(); }, 8000);
    }
    async function begin(p, b) {
      if (b) b.disabled = true;
      let start; try { start = await call('exam.start', {paperId: p.paperId}); } catch (e) { g.toast?.(e.message || '开不了考'); if (b) b.disabled = false; return; }
      start.title = p.title; clearTimeout(pollT);
      hall = openHall({start, onLeave: () => { hall = null; lobby(); }, onDone: attemptId => { hall = null; showResult(attemptId, {replay: true}); }});
    }
    async function showResult(attemptId, {replay}) {
      clearTimeout(pollT); main.replaceChildren(); main.classList.add('is-report');
      const wait1 = el('div', 'pke-grading'); wait1.append(el('small', 'pkb-kicker', 'GRADING'), el('h3', '', '阅卷中'), el('p', '', '客观题已经判完，碧琪在按评分细则看翻译和作文。'), el('i', 'pke-grading__rule'));
      main.append(wait1);
      let res = null; const t0 = Date.now();
      while (alive) { try { res = await call('exam.result', {attemptId}); } catch (e) { wait1.querySelector('p').textContent = e.message || '成绩取不到'; return; } if (res.status === 'done' || res.status === 'open') break; await wait(Date.now() - t0 < 20000 ? 1500 : 4000); }
      if (!alive || !res || res.status !== 'done') { if (res?.status === 'open') lobby(); return; }
      main.replaceChildren();
      const last = store.get('pinkie.exam.last');
      if (replay) { await bossSettle(root() || host, res); if (last?.attemptId === attemptId) store.set('pinkie.exam.last', {...last, seen: true}); }
      if (!alive) return;
      report(main, res, {onMap: () => desk()?.go('gamemap'), onHunt: () => desk()?.go('gamehunt'), onAgain: () => lobby()});
      try { g.refresh?.(); } catch { /* ignore */ }
    }
    async function finale(res) {
      try { await fx()?.cinematic(res.passed ? 'curtain' : 'ink', {text: res.passed ? '上岸' : '辛苦了', sub: `PRETCO-B · ${res.score}`, kicker: '碧琪', art: g.ultArt?.('graduate') || g.portrait?.('graduate'), palette: ['#FBE3C0', '#C99A3E', '#FFFFFF'], particle: 'gold'}); } catch { /* ignore */ }
      try { g.play?.(res.awards || []); } catch { /* ignore */ }
      lobby();
    }
    await lobby();
    window.__pinkieGameExam._page = {lobby, begin, showResult, hall: () => hall};
    return {unmount() { alive = false; clearTimeout(pollT); hall?.close(); tts.stop(); }};
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gameexam', {title: '考场', wide: true, mount: (h, c) => mountExam(h, c)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }
  window.__pinkieGameExam = {tts, bossSettle, report};
})();
