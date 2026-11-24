/* laolao-metre-stash —— T3#2 草稿暂存（11-24 T3 第一批）。只在 Metre 里起作用。
 * 「写一半不丢」碧琪已经有了（patch/apply-composer-drafts.mjs 按会话把输入框存进 localStorage）；这里补的是「先收起来、等会儿再取」：
 *   输入框底排、引擎条后面一颗「Rest」（休止）：把输入框里写的收进本会话的暂存，输入框清空；输入框空着时不可点。
 *   有暂存时旁边多一个数字，点开小菜单：每条可「取回」「删除」。取回时输入框里要是有字，先把那段也收进暂存，什么都不丢。
 * 暂存只存在本机（localStorage「pinkie.metreStash.v1:<会话>」，每个会话最多 20 条），不发给后台。
 * 写回输入框走原生的 handleChatDraftChange（laolao-metre-queue.js 的「编辑」也是这样），碧琪的草稿补丁跟着同步。
 * 重挂时机：pinkie:composer-chips（引擎条也靠它）、pinkie:run-view、换会话、换模式、输入框打字（只更新可不可点）。不加循环定时器和观察器。 */
(() => {
  'use strict';
  if (window.PinkieMetreStash) return;
  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const pane = () => document.querySelector('.chat-main')?.closest('openclaw-chat-pane') || document.querySelector('openclaw-chat-pane');
  const textarea = (p) => p?.querySelector('.agent-chat__composer-combobox textarea');
  const sessionOf = (p) => p?.state?.sessionKey || '';
  const KEY = 'pinkie.metreStash.v1:', MAX = 20;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return [...t].length > n ? [...t].slice(0, n).join('') + '…' : t; };
  let menu = null;

  const load = (sk) => { try { const v = JSON.parse(localStorage.getItem(KEY + sk) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.text === 'string' && x.text) : []; } catch { return []; } };
  // 存满了（或本机存储不可用）就返回 false：调用方不清空输入框，原文原样留着
  const save = (sk, list) => { try { if (list.length) localStorage.setItem(KEY + sk, JSON.stringify(list.slice(0, MAX))); else localStorage.removeItem(KEY + sk); return true; } catch { return false; } };
  const method = (p, name) => { for (const o of [p?.state, p, p?.controller]) if (typeof o?.[name] === 'function') return o[name].bind(o); return null; };
  function setDraft(p, text) {
    const set = method(p, 'handleChatDraftChange');
    if (set) set(text); else if (p?.state) p.state.chatMessage = text;
    const ta = textarea(p); if (ta && ta.value !== text) ta.value = text;
    p?.state?.requestUpdate?.(); p?.requestUpdate?.();
  }
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return '刚才'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前'; if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function stashNow(p = pane()) {
    const sk = sessionOf(p), text = textarea(p)?.value || '';
    if (!sk || !text.trim()) return false;
    const list = load(sk);
    list.unshift({id: newId(), text, at: Date.now()});
    if (!save(sk, list)) return false;
    setDraft(p, '');
    paint();
    requestAnimationFrame(() => textarea(p)?.focus());
    return true;
  }
  function restore(id, p = pane()) {
    const sk = sessionOf(p); let list = load(sk);
    const item = list.find((x) => x.id === id); if (!item) return false;
    list = list.filter((x) => x.id !== id);
    const cur = textarea(p)?.value || '';
    if (cur.trim()) list.unshift({id: newId(), text: cur, at: Date.now()});
    if (!save(sk, list)) return false;
    setDraft(p, item.text);
    closeMenu(false); paint();
    requestAnimationFrame(() => { const ta = textarea(p); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } });
    return true;
  }
  function drop(id, p = pane()) {
    const sk = sessionOf(p), list = load(sk).filter((x) => x.id !== id);
    save(sk, list); paint();
    if (menu) { if (list.length) openMenu(); else closeMenu(true); }
  }

  function closeMenu(refocus) {
    if (!menu) return;
    menu.remove(); menu = null;
    const c = document.querySelector('.pk-stash__count'); c?.setAttribute('aria-expanded', 'false');
    if (refocus) (c && !c.hidden ? c : document.querySelector('.pk-stash__btn'))?.focus();
  }
  function openMenu() {
    const p = pane(), list = load(sessionOf(p)), anchor = document.querySelector('.pk-stash__count');
    if (!anchor || !list.length) { closeMenu(false); return; }
    menu?.remove();
    menu = el('div', 'pk-stash-menu'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '暂存的草稿');
    menu.append(el('div', 'pk-stash-menu__head', `暂存 ${list.length}`));
    const ol = el('ol', 'pk-stash-menu__list');
    for (const x of list) {
      const li = el('li', 'pk-stash-menu__row');
      const body = el('span', 'pk-stash-menu__text', clip(x.text, 60)); body.title = x.text.slice(0, 400);
      const when = el('span', 'pk-stash-menu__when', ago(Number(x.at) || Date.now()));
      const take = el('button', 'pk-stash-menu__btn pk-stash-menu__btn--take', '取回'); take.type = 'button'; take.dataset.act = 'take'; take.dataset.id = x.id; take.setAttribute('aria-label', '取回到输入框：' + clip(x.text, 20));
      const del = el('button', 'pk-stash-menu__btn pk-stash-menu__btn--drop', '×'); del.type = 'button'; del.dataset.act = 'drop'; del.dataset.id = x.id; del.setAttribute('aria-label', '删除这条暂存'); del.dataset.pinkieTooltip = '删除这条暂存';
      li.append(body, when, take, del); ol.append(li);
    }
    menu.append(ol);
    document.body.append(menu);
    const r = anchor.getBoundingClientRect(), w = Math.min(360, innerWidth - 16);
    menu.style.width = w + 'px';
    menu.style.left = Math.max(8, Math.min(Math.round(r.left), innerWidth - w - 8)) + 'px';
    menu.style.bottom = Math.round(innerHeight - r.top + 6) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }

  function paint() {
    const p = pane(), controls = p?.querySelector('.agent-chat__composer-controls') || document.querySelector('.chat-main .agent-chat__composer-controls');
    let box = controls?.querySelector(':scope > .pk-stash');
    const sk = sessionOf(p);
    if (!controls || !isMetre() || !sk) { document.querySelectorAll('.pk-stash').forEach((n) => n.remove()); closeMenu(false); return; }
    if (!box) {
      box = el('span', 'pk-stash');
      const btn = el('button', 'pk-stash__btn', 'Rest'); btn.type = 'button'; btn.dataset.act = 'stash';
      btn.setAttribute('aria-label', '暂存：把输入框里写的先收起来');
      const count = el('button', 'pk-stash__count'); count.type = 'button'; count.dataset.act = 'menu'; count.setAttribute('aria-haspopup', 'dialog'); count.setAttribute('aria-expanded', 'false');
      box.append(btn, count);
    }
    const chipEl = controls.querySelector(':scope > .pk-eng-chip');
    if (chipEl) { if (chipEl.nextElementSibling !== box) chipEl.after(box); } else if (box.parentElement !== controls) controls.append(box);
    const n = load(sk).length, btn = box.querySelector('.pk-stash__btn'), count = box.querySelector('.pk-stash__count');
    const empty = !(textarea(p)?.value || '').trim();
    btn.disabled = empty;
    btn.dataset.pinkieTooltip = empty ? '暂存：输入框是空的，写点什么再收起来' : '暂存：把输入框里写的先收起来，等会儿再取回';
    count.hidden = n === 0; count.textContent = String(n);
    count.setAttribute('aria-label', `查看暂存的 ${n} 条草稿`); count.dataset.pinkieTooltip = `暂存的 ${n} 条草稿`;
    if (!n) closeMenu(false);
  }

  document.addEventListener('click', (event) => {
    const b = event.target.closest?.('.pk-stash button, .pk-stash-menu button');
    if (b && isMetre()) {
      event.preventDefault(); event.stopPropagation();
      const act = b.dataset.act;
      if (act === 'stash') stashNow();
      else if (act === 'menu') { if (menu) closeMenu(true); else openMenu(); }
      else if (act === 'take') restore(b.dataset.id);
      else if (act === 'drop') drop(b.dataset.id);
      return;
    }
    if (menu && !menu.contains(event.target)) closeMenu(false);
  }, true);
  document.addEventListener('keydown', (event) => { if (menu && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); } }, true);
  document.addEventListener('input', (event) => { if (isMetre() && event.target?.closest?.('.agent-chat__composer-combobox')) paint(); }, true);
  for (const type of ['pinkie:composer-chips', 'pinkie:run-view', 'laolao:modechange']) window.addEventListener(type, () => paint());
  window.addEventListener('resize', () => { closeMenu(false); paint(); });
  window.addEventListener('pinkie:session-selected', () => { closeMenu(false); for (const ms of [0, 200]) setTimeout(paint, ms); });
  paint();
  window.PinkieMetreStash = Object.freeze({paint, stashNow, restore, drop});
})();
