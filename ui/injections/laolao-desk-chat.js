/* 碧琪手账 v2 · 聊天这一侧（briefs/study-desk-v2/PLAN.md §3）。只在学习模式聊天里工作：
   今晚条、碧琪消息页边的「收」和小章、learning_desk 工具的手账卡片、带条目问的用户气泡、回到出处。
   不轮询：今晚条只在换会话、学习状态变化、离开学习台时刷新；页面变化靠 MutationObserver，合并成一次处理。 */
(() => {
  'use strict';
  if (window.__pinkieDeskChat) return;
  const doc = document.documentElement;
  const CARD_KINDS = new Set(['desk_card', 'desk_receipt', 'desk_plan']);
  const MARKER = /\[\[DESK_REF_V1((?:\s+[a-z]+:[^\s\]]{1,200}){1,8})\s*\]\]/g;
  const TARGETS = [['note', '笔记'], ['word', '生词本'], ['wrong', '错题'], ['plan', '明天计划']];
  const SHORT = {note: '笔记', word: '生词', wrong: '错题', plan: '计划'};
  const kit = () => window.__pinkieDeskKit;
  const desk = () => window.__pinkieStudyDesk;
  const reduced = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const conversation = () => window.__pinkieStudyConversation;
  const sessionKey = () => conversation()?.sessionKey() || '';
  const inLearning = () => Boolean(conversation()?.active());
  // 页面刚打开时请求可能抢在 connect 握手前；这类请求网关没处理过，稍等重试是安全的（和学习台的 request 一样）。
  const CONNECTING = /invalid handshake|first request must be connect|gateway socket unavailable|正在连接/i;
  const request = async (method, params = {}, timeout = 20000) => {
    if (desk()?.request) return desk().request(method, {sessionKey:sessionKey(),...params}, timeout);
    for (let attempt = 0; ; attempt++) {
      try {
        const gateway = window.__laolaoSidebar?.gwRequest;
        if (typeof gateway !== 'function') throw new Error('正在连接，请稍后再试');
        return await gateway(method, {sessionKey: sessionKey(), ...params}, timeout);
      } catch (error) {
        if (attempt >= 4 || !CONNECTING.test(error?.message || '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  };
  const refsIn = text => {
    const refs = new Set();
    for (const match of String(text || '').matchAll(MARKER)) for (const part of match[1].trim().split(/\s+/)) if (refs.size < 8) refs.add(part);
    return [...refs];
  };

  // ---------- 小提示条：收完、撤销、找不到出处，都在聊天底部冒一下 ----------
  let toastNode = null, toastTimer = 0;
  function toast(content, {ms = 6000} = {}) {
    toastNode?.remove(); clearTimeout(toastTimer);
    const host = conversation()?.root() || document.body;
    toastNode = el('div', 'pk-ink pk-chat-toast');
    toastNode.append(typeof content === 'string' ? el('span', '', content) : content);
    host.append(toastNode);
    toastTimer = setTimeout(() => { toastNode?.remove(); toastNode = null; }, ms);
  }
  function receiptToast(receipt) {
    const k = kit(); if (!k) return;
    const text = `收进${receipt.targetLabel || '手账'}：${receipt.title || ''}`;
    toast(k.receipt(text, {label: '收', onUndo: async () => { await request('pinkie.learning.ref.undo', {receiptId: receipt.receiptId}); await loadReceipts(); }}), {ms: 9000});
  }

  // ---------- 打开学习台的某一页：聊天留在右边的便签栏 ----------
  function openDesk(open = {}) {
    const d = desk(); if (!d) return;
    d.go(open.view || 'today', open.params);
    window.__pinkieDeskSplit?.open?.();
  }
  // 回到出处：滚到那条消息，用荧光笔扫一下。消息太老没加载时，先给引文。
  function reveal(origin) {
    const quote = origin?.quote ? `「${origin.quote.slice(0, 120)}」` : '';
    if (!origin?.messageId) { toast(quote ? `出处是这句话：${quote}` : '这一条没有记下出处'); return false; }
    const locate = () => {
      const node = [...document.querySelectorAll('.chat-bubble[data-message-id]')].find(n => n.dataset.messageId === String(origin.messageId));
      if (!node) return false;
      node.scrollIntoView({block:'center',behavior:reduced()?'auto':'smooth'});node.setAttribute('data-pk-sweep','');setTimeout(()=>node.removeAttribute('data-pk-sweep'),1800);return true;
    };
    const find = () => {
      desk()?.go('chat');
      if (origin.sessionKey && origin.sessionKey !== sessionKey()) window.__laolaoSidebar?.navigateSession?.(origin.sessionKey);
      let tries=0;const attempt=()=>{if(locate())return;if(++tries<12)setTimeout(attempt,250);else toast('已打开出处对话；这条消息还在更早的记录里。'+quote);};setTimeout(attempt,100);
    };
    if (origin.sessionKey === sessionKey() || !origin.sessionKey) { window.__pinkieDeskSplit?.open?.(); if (locate()) return true; }
    const row=el('span');row.append(document.createTextNode((origin.sessionKey !== sessionKey()?'出处在另一段对话里：':'这条消息还没加载出来：')+quote));
    row.append(kit().button('在对话里找',find,{kind:'link'}));toast(row,{ms:12000});return false;
  }

  // ---------- 碧琪的手账卡片（learning_desk 工具结果，经 laolao-learning-inline 的 bind 递过来） ----------
  const cardCache = new Map(); // `${kind}:${id}` → Promise
  const slots = new WeakMap();
  const once = (key, load) => { if (!cardCache.has(key)) cardCache.set(key, load().catch(error => { cardCache.delete(key); throw error; })); return cardCache.get(key); };
  function deskCard(ref) {
    const k = kit(), parsed = k.parseRef(ref.id) || {kind: ''};
    const box = el('div', 'pk-desk-item');
    const paint = card => box.replaceChildren(k.refCard({kind: card.kind || parsed.kind, title: card.title || ref.title, subtitle: card.subtitle || card.status || ''}, {onOpen: () => openDesk(card.open)}));
    paint({title: ref.title});
    once('card:' + ref.id, () => request('pinkie.learning.ref.resolve', {refs: [ref.id]}).then(r => r.cards?.[0])).then(card => {
      if (!card?.ok) { box.dataset.gone = ''; box.replaceChildren(el('small', 'pk-desk-gone', `这个条目已经不在了：${ref.title || ref.id}`)); return; }
      paint(card);
      if (card.state) box.querySelector('.pk-card small')?.prepend(k.star(card.state, {label: k.STATE_LABEL[card.state]}), ' ');
    }).catch(() => {});
    return box;
  }
  function deskReceipt(ref) {
    const k = kit(), box = el('div', 'pk-desk-item');
    const paint = receipt => {
      const who = receipt.by === 'biqi' ? '碧琪' : '先生';
      const text = receipt.action === 'regrade' ? `${who}更正了判分：${receipt.title}` : `${who}收进了${receipt.targetLabel || '手账'}：${receipt.title}`;
      const node = k.receipt(text, {label: receipt.action === 'regrade' ? '改' : '收', onUndo: receipt.undoable ? async () => {
        await request('pinkie.learning.ref.undo', {receiptId: receipt.receiptId}); cardCache.delete('receipt:' + ref.id); await loadReceipts();
      } : null});
      if (receipt.undone) node.dataset.undone = '';
      box.replaceChildren(node);
    };
    box.append(k.receipt(ref.title || '收进手账', {label: '收'}));
    once('receipt:' + ref.id, () => request('pinkie.learning.ref.receipts', {id: ref.id}).then(r => r.receipt)).then(paint).catch(() => {});
    return box;
  }
  function deskPlan(ref) {
    const k = kit(), box = el('div', 'pk-desk-item pk-desk-plan');
    const paint = plan => {
      box.replaceChildren();
      const head = el('div', 'pk-plan-head');
      head.append(el('small', '', `碧琪提的计划 · ${plan.date || '明天'}`));
      if (plan.adopted) head.append(k.stamp('已采纳', {size: 'sm'}));
      const list = el('ol', 'pk-plan-list'); for (const label of plan.labels || []) list.append(el('li', '', label));
      box.append(head, list);
      if (plan.text) box.append(k.note(plan.text, {by: ''}));
      if (!plan.adopted) {
        const adopt = k.button('采纳，写进明天', async () => {
          adopt.disabled = true;
          try {
            const result = await request('pinkie.learning.ref.plan.adopt', {id: ref.id});
            cardCache.delete('plan:' + ref.id); paint({...plan, adopted: true});
            if (result.receipt) { const stamp = box.querySelector('.pk-stamp'); stamp?.classList.add('pk-anim'); receiptToast({...result.receipt, targetLabel: '明天计划'}); }
          } catch (error) { adopt.disabled = false; toast('没采纳上：' + error.message); }
        }, {kind: 'go', size: 'sm'});
        box.append(adopt);
      }
    };
    box.append(el('small', '', '碧琪提的计划…'));
    once('plan:' + ref.id, () => request('pinkie.learning.ref.plan.get', {id: ref.id}).then(r => r.plan)).then(paint)
      .catch(error => box.replaceChildren(el('small', 'pk-desk-gone', error.message)));
    return box;
  }
  function bind(slot, supplied, session) {
    if (!inLearning() || !conversation()?.root()?.contains(slot)) return;
    if (!kit()) return;
    const refs = (Array.isArray(supplied) ? supplied : []).filter(ref => ref?.v === 1 && CARD_KINDS.has(ref.kind) && typeof ref.id === 'string' && ref.id && ref.sessionKey === session);
    let entry = slots.get(slot);
    if (!refs.length) { if (entry) { entry.box.remove(); slots.delete(slot); } return; }
    if (!entry) { entry = {box: el('div', 'pk-ink pk-desk-cards'), items: new Map()}; slots.set(slot, entry); }
    if (entry.box.parentNode !== slot) slot.append(entry.box);
    const keys = new Set(refs.map(ref => `${ref.kind}:${ref.id}`));
    for (const [key, node] of entry.items) if (!keys.has(key)) { node.remove(); entry.items.delete(key); }
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`; if (entry.items.has(key)) continue;
      const node = ref.kind === 'desk_card' ? deskCard(ref) : ref.kind === 'desk_receipt' ? deskReceipt(ref) : deskPlan(ref);
      entry.items.set(key, node); entry.box.append(node);
    }
  }

  // ---------- 收进手账：碧琪消息悬停时页边出现「收」，收完盖小章 ----------
  let receipts = new Map(), receiptSession = '';
  async function loadReceipts() {
    const key = sessionKey(); if (!/^agent:learning:/.test(key)) return;
    try {
      const {receipts: list = []} = await request('pinkie.learning.ref.receipts', {sessionKey: key});
      if (key !== sessionKey()) return;
      const next = new Map();
      for (const r of list) if (!r.undone && r.origin?.messageId && r.origin.sessionKey === key) {
        const labels = next.get(r.origin.messageId) || new Set(); labels.add(SHORT[r.target] || '手账'); next.set(r.origin.messageId, labels);
      }
      receipts = next; receiptSession = key; schedule();
    } catch {}
  }
  function stampBubbles() {
    for (const bubble of conversation()?.root()?.querySelectorAll('.chat-group.assistant .chat-bubble[data-message-id]') || []) {
      const labels = receiptSession === sessionKey() ? receipts.get(bubble.dataset.messageId) : null;
      let stamp = bubble.querySelector(':scope > .pk-collected');
      if (!labels) { stamp?.remove(); continue; }
      const text = '已收 · ' + [...labels].join('、');
      if (stamp?.dataset.text === text) continue;
      stamp?.remove();
      stamp = el('span', 'pk-ink pk-collected'); stamp.dataset.text = text; stamp.append(kit().stamp(text, {size: 'sm'}));
      bubble.setAttribute('data-pk-collected', ''); bubble.append(stamp);
    }
  }
  const hover = {button: null, menu: null, bubble: null};
  function collectable(node) {
    const bubble = node?.closest?.('.chat-group.assistant .chat-bubble[data-message-id]');
    if (!conversation()?.root()?.contains(bubble)) return null;
    if (!bubble || bubble.classList.contains('streaming') || bubble.classList.contains('chat-bubble--tool-shell') || bubble.classList.contains('chat-reading-indicator')) return null;
    return (bubble.dataset.messageText || '').trim() ? bubble : null;
  }
  function placeHover(bubble) {
    if (!hover.button) {
      hover.button = el('button', 'pk-ink pk-collect-btn', '收'); hover.button.type = 'button';
      hover.button.setAttribute('aria-label', '收进手账');
      hover.button.addEventListener('mousedown', event => event.preventDefault()); // 不打断选中的文字
      hover.button.addEventListener('click', () => openMenu(hover.bubble));
      document.body.append(hover.button);
    }
    hover.bubble = bubble;
    const r = bubble.getBoundingClientRect(), main = document.querySelector('.chat-main')?.getBoundingClientRect();
    const left = Math.max((main?.left ?? 0) + 4, r.left - 34);
    hover.button.style.transform = `translate(${Math.round(left)}px, ${Math.round(r.top + 6)}px)`;
    hover.button.hidden = false;
  }
  function hideHover() { if (hover.button && !hover.menu) hover.button.hidden = true; }
  function selectionIn(bubble) {
    const s = window.getSelection?.(); if (!s || s.isCollapsed || !s.rangeCount) return '';
    const range = s.getRangeAt(0); return bubble.contains(range.commonAncestorContainer) ? s.toString().trim() : '';
  }
  function closeMenu() { hover.menu?.remove(); hover.menu = null; document.removeEventListener('pointerdown', outside, true); }
  const outside = event => { if (!hover.menu?.contains(event.target) && event.target !== hover.button) closeMenu(); };
  function openMenu(bubble) {
    if (!bubble?.isConnected || !kit()) return;
    closeMenu();
    const picked = selectionIn(bubble), text = picked || bubble.dataset.messageText.trim();
    const menu = hover.menu = el('div', 'pk-ink pk-collect-menu'); menu.setAttribute('role', 'menu');
    menu.append(el('small', '', picked ? `收选中的 ${[...picked].length} 个字` : '收这条消息'));
    for (const [target, label] of TARGETS) {
      const english = /[A-Za-z]/.test(picked);
      const item = el('button', '', `收进${label}`); item.type = 'button'; item.setAttribute('role', 'menuitem');
      if (target === 'word' && !english) { item.disabled = true; item.title = '先选中要记的英文单词'; item.append(el('em', '', '先选中单词')); }
      item.addEventListener('click', () => void collect(bubble, target, target === 'word' ? picked : text));
      menu.append(item);
    }
    const r = hover.button.getBoundingClientRect();
    menu.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.bottom + 6)}px)`;
    document.body.append(menu);
    document.addEventListener('pointerdown', outside, true);
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  async function collectText(target, text, origin) {
    const key = sessionKey();
    const result = await request('pinkie.learning.ref.collect', {target, text, origin});
    if (result.duplicate) { toast(`生词本里已经有 ${result.receipt?.title || '这个词'} 了`); return result; }
    receiptToast(result.receipt); await loadReceipts();
    window.dispatchEvent(new CustomEvent('pinkie:desk-collected', {detail: {sessionKey: key, receipt: result.receipt}}));
    return result;
  }
  async function collectSelection(selected, target = 'note') {
    if (!inLearning()) return;
    const text = String(selected?.text || '').trim(); if (!text) return;
    const bubble = selected.anchor?.closest?.('.chat-bubble[data-message-id]') || selected.assistant?.querySelector('.chat-bubble[data-message-id]');
    const origin = {sessionKey: sessionKey(), messageId: bubble?.dataset.messageId || '', quote: text.replace(/\s+/g, ' ').slice(0, 120), at: Date.now()};
    try { return await collectText(target, text, origin); } catch (error) { toast('没收进去：' + error.message); throw error; }
  }
  async function collect(bubble, target, text) {
    closeMenu(); hideHover();
    try {
      await collectText(target, text, {sessionKey: sessionKey(), messageId: bubble.dataset.messageId, quote: text.replace(/\s+/g, ' ').slice(0, 120), at: Date.now()});
      bubble.querySelector(':scope > .pk-collected .pk-stamp')?.classList.add('pk-anim');
    } catch (error) { toast('没收进去：' + error.message); }
  }

  // ---------- 带条目问：用户气泡里藏起标记，换成小条目卡 ----------
  function paintRefBubbles() {
    for (const bubble of conversation()?.root()?.querySelectorAll('.chat-group.user .chat-bubble[data-message-text*="[[DESK_REF_V1"]') || []) {
      const refs = refsIn(bubble.dataset.messageText); if (!refs.length) continue;
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.includes('[[DESK_REF_V1')) node.nodeValue = node.nodeValue.replace(MARKER, '').replace(/\s+$/, '');
      const sig = refs.join(' ');
      let row = bubble.querySelector(':scope > .pk-ref-row');
      if (row?.dataset.refs === sig) continue;
      row?.remove(); row = el('div', 'pk-ink pk-ref-row'); row.dataset.refs = sig;
      bubble.prepend(row);
      once('refs:' + sig, () => request('pinkie.learning.ref.resolve', {refs})).then(({cards = []}) => {
        row.replaceChildren(...cards.map(card => card.ok ? kit().refChip(card, {onOpen: () => openDesk(card.open)}) : kit().refChip({kind: card.kind, title: '已不在'})));
      }).catch(() => {});
    }
  }

  // ---------- 今晚条：学习模式聊天顶部一条胶带纸条 ----------
  let strip = null, stripData = null, stripAt = 0, stripLoading = null;
  function hm(hours) { const h = Math.floor(hours) % 24, m = Math.round((hours % 1) * 60); return `${h}:${String(m).padStart(2, '0')}`; }
  function paintStrip() {
    const thread = conversation()?.thread();
    if (!inLearning() || !thread) { strip?.remove(); return; }
    if (!strip) {
      strip = el('section', 'pk-ink pk-tonight'); strip.setAttribute('aria-label', '今日学习');
      const main = el('button', 'pk-tonight-main'); main.type = 'button'; main.addEventListener('click', () => openDesk({view: 'today'}));
      const lesson = el('div', 'pk-tonight-lesson'); strip.append(main, lesson);
    }
    const d = stripData || {}, hero = d.almanac?.protagonist, night = (d.almanac?.hour ?? 20) >= 17 || (d.almanac?.hour ?? 20) < 5;
    const parts = [d.focus?.title || '今日练习', `题 ${d.progress?.questions ?? 0}/${d.goals?.questions ?? 20}`, `${d.progress?.minutes ?? 0}/${d.goals?.minutes ?? 30} 分钟`];
    const vocab = (d.quiet || []).find(item => item.kind === 'vocab'); if (vocab?.count) parts.push(`生词 ${vocab.count}`);
    const lateAfter = d.almanac?.period?.id === 'late' ? null : d.rhythmLateAfter;
    if (hero?.late) parts.push('很晚了，早点睡'); else if (lateAfter && night) parts.push(`${hm(lateAfter - 1)} 收工`);
    const label = hero?.late ? '夜深了' : night ? '今晚' : '今天';
    strip.dataset.tape = hero?.tape || d.almanac?.season || '';
    const main = strip.querySelector('.pk-tonight-main');
    const row=el('span','pk-tonight-progress'), total=d.focus?.payload?.size||d.goals?.questions||6,done=Math.min(total,d.progress?.questions||0);
    row.append(el('span','pk-tonight-topic',(d.focus?.title||'今日练习').split('·').at(-1).trim()));
    const stars=el('span','pk-tonight-stars');for(let i=0;i<Math.min(total,6);i++)stars.append(kit().star(i<done?'full':''));row.append(stars,el('span','pk-tonight-number',`${done}/${total}`));
    if(vocab?.count)row.append(el('small','',`生词 ${vocab.count}`));const notes=(d.quiet||[]).find(item=>item.kind==='notes');if(notes?.count)row.append(el('small','',`闪卡 ${notes.count}`));
    main.replaceChildren(el('b', '', label+(lateAfter&&night?' · '+hm(lateAfter-1)+' 收工':'')), row, el('i', '', '翻到今日 →'));
    main.setAttribute('aria-label', `${label}：${parts.join('，')}。打开今日页`);
    if (strip.nextElementSibling !== thread) thread.parentElement.insertBefore(strip, thread);
    strip.classList.toggle('pk-tonight--lesson', Boolean(strip.querySelector('.lesson-bar')));
  }
  function loadStrip({force = false} = {}) {
    if (!inLearning() || stripLoading) return stripLoading;
    if (!force && stripData && stripData.session === sessionKey() && Date.now() - stripAt < 60_000) return null;
    const key = sessionKey();
    stripLoading = request('pinkie.learning.desk.today', {sessionKey: key}).then(today => {
      if (key !== sessionKey()) return;
      stripData = {...today, session: key, rhythmLateAfter: today.rhythm?.lateAfter}; stripAt = Date.now(); paintStrip();
    }).catch(() => {}).finally(() => { stripLoading = null; });
    return stripLoading;
  }

  // ---------- 页面变化合并成一次处理（一次性的 16ms 延时；不用 rAF：窗口在后台时 rAF 不跑，回复到了也补不上章） ----------
  let frame = 0, lastSession = '';
  function schedule() { if (!frame) frame = setTimeout(run, 16); }
  function run() {
    frame = 0;
    if (!inLearning()) { strip?.remove(); closeMenu(); hideHover(); lastSession=''; return; }
    const key = sessionKey();
    if (key !== lastSession) {
      lastSession = key; receipts = new Map(); receiptSession = ''; stripData = null; strip?.remove(); closeMenu(); hideHover();
      if (/^agent:learning:/.test(key)) { void loadReceipts(); void loadStrip({force: true}); }
    }
    if (!/^agent:learning:/.test(key) || !kit()) { strip?.remove(); return; }
    stampBubbles(); paintRefBubbles(); paintStrip();
    // 互动组件脚本比本文件先加载，页面一打开就绑过的槽不会再叫我；这里自己补一遍（bind 对同一张卡不重复画）。
    for (const slot of conversation()?.root()?.querySelectorAll('[data-pinkie-learning-slot]') || []) {
      const cards = slot.pinkieLearningCards;
      if (Array.isArray(cards) && cards.some(ref => CARD_KINDS.has(ref?.kind)) || slots.has(slot)) bind(slot, cards, slot.pinkieLearningSession || key);
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target;
      if (target.nodeType === 1 && target.closest?.('.pk-collected, .pk-ref-row, .pk-tonight, .pk-desk-cards, .pk-chat-toast')) continue;
      schedule(); return;
    }
  });
  observer.observe(conversation()?.root() || document.body, {childList: true, subtree: true});
  document.addEventListener('pointerover', event => {
    if (!inLearning()) return;
    if (event.target === hover.button || hover.menu?.contains(event.target)) return;
    const bubble = collectable(event.target);
    if (bubble) placeHover(bubble); else if (!event.target.closest?.('.chat-group.assistant')) hideHover();
  }, {passive: true});
  document.addEventListener('scroll', () => { closeMenu(); hideHover(); }, {capture: true, passive: true});
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && hover.menu) { event.preventDefault(); closeMenu(); } });
  // 学习状态变了（作答、上课、复习）才刷新今晚条；离开学习台回到聊天时也刷新一次。
  let stateTimer = 0;
  window.addEventListener('pinkie:desk-changed', () => { clearTimeout(stateTimer); stateTimer = setTimeout(() => void loadStrip({force: true}), 300); });
  let activityId = null;
  window.addEventListener('pinkie:learning-state', event => { const next = event.detail?.current?.id || null; if (!next && !activityId) return; activityId = next; clearTimeout(stateTimer); stateTimer = setTimeout(() => void loadStrip({force: true}), 1500); });
  window.addEventListener('pinkie:study-desk-view', event => { if (event.detail?.view === 'chat') void loadStrip(); });
  for (const name of ['pinkie:desk-conversation-ready','pinkie:desk-conversation-rendered','pinkie:study-desk-view','pinkie:desk-split-changed']) window.addEventListener(name, schedule);
  window.addEventListener('pinkie:desk-collected', () => void loadStrip({force: true}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadStrip(); });
  schedule();

  window.__pinkieDeskChat = {bind, reveal, openDesk, refsIn, collectSelection, active:inLearning, send:text=>conversation().send(text), open:()=>conversation().open(), messageColumn:()=>conversation()?.thread(),
    lessonHost: () => strip?.querySelector('.pk-tonight-lesson'), reload: () => { void loadReceipts(); void loadStrip({force: true}); },
    stats: () => ({receipts: receipts.size, strip: Boolean(strip?.isConnected), cards: cardCache.size})};
  window.dispatchEvent(new Event('pinkie:desk-chat-ready'));
})();
