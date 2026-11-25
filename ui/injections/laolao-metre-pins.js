/* Metre 置顶消息（「以后」S 级 M3）：消息页脚行加「置顶」键，对话顶上一条「已置顶 N 条」折叠条（列表、跳到这条、取消置顶）。
 *
 * 原生有「N pinned」折叠条（.agent-chat__pinned），但没有任何「置顶这条」的入口；它的存储（localStorage openclaw:pinned:<会话>）
 * 按消息序号记、读进模块里的缓存后不再重读，外面写进去它看不到、它下次保存还会盖掉。所以不和原生共用：
 * 这里只在 Metre 下、按消息自己的 id 存一份（pinkie.metre.pins:<会话>），历史分页 / 压缩以后序号变了也对得上。
 *   - 原生 data-message-id 是「msg:<消息 id>」或「msg:<角色>:<时间戳>:<当前窗口里的序号>」；后一种去掉序号，只留角色 + 时间戳。
 *   - 每条存 {id, role, text（前 140 字）, at}，列表直接用存下的摘要，不在当前加载的记录里也能看、能取消。
 * 只用 textContent，不拼 HTML。不新增观察器、定时器和 window 全局名：页面变化走 window.Pinkie.domWatch.watch。 */
(() => {
  'use strict';
  const PREFIX = 'pinkie.metre.pins:';
  const MAX = 50;
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const sessionKey = () => { try { const k = new URL(location.href).searchParams.get('session') || ''; return /^agent:metre:/.test(k) ? k : ''; } catch { return ''; } };
  const store = () => { try { return window.localStorage; } catch { return null; } };
  const load = (key) => { try { const v = JSON.parse(store()?.getItem(PREFIX + key) || '[]'); return Array.isArray(v) ? v.filter((p) => p && typeof p.id === 'string') : []; } catch { return []; } };
  const save = (key, list) => { try { list.length ? store()?.setItem(PREFIX + key, JSON.stringify(list)) : store()?.removeItem(PREFIX + key); } catch {} };
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // 消息自己的 id：去掉「当前窗口里的序号」，分页后还是同一个。
  // 只有角色 + 时间戳时，同一时间戳的两条会撞（假网关的种子记录、批量导入的历史都这样），再加正文的短哈希分开。
  const hash = (s) => { let h = 5381; for (const ch of String(s).slice(0, 400)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
  function stableId(domId, text = '') {
    const id = String(domId || '');
    const m = /^msg:([a-z]+):(\d+):\d+$/.exec(id);
    return m ? `${m[1]}:${m[2]}:${hash(String(text).replace(/\s+/g, ' ').trim())}` : (id.startsWith('msg:') && id.length > 4 ? id.slice(4) : '');
  }
  const groupId = (group) => { const b = group.querySelector('.chat-bubble[data-message-id]'); return stableId(b?.dataset.messageId, b?.querySelector('.chat-text')?.textContent || ''); };
  const groupRole = (group) => (group.classList.contains('user') ? 'user' : 'assistant');
  const groupText = (group) => [...group.querySelectorAll('.chat-bubble .chat-text')].map((t) => t.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 140);
  const groups = () => [...document.querySelectorAll('.chat-thread .chat-group')].filter((g) => !g.closest('.pinkie-session-cards'));
  let open = false;

  function toggle(group) {
    const key = sessionKey(), id = groupId(group);
    if (!key || !id) return;
    const list = load(key), at = list.findIndex((p) => p.id === id);
    if (at >= 0) list.splice(at, 1);
    else { list.push({id, role: groupRole(group), text: groupText(group), at: Date.now()}); if (list.length > MAX) list.shift(); }
    save(key, list);
    paint();
  }
  function jump(id, status) {
    const group = groups().find((g) => groupId(g) === id);
    if (!group) { status.textContent = '这条不在已经加载的记录里，往上翻能找到。'; return; }
    status.textContent = '';
    // 瞬时滚动（mac2 任务 32）：smooth 滚到一半，laolao-perf.js 的 IntersectionObserver 回调 restoreNow 会把 scrollTop 写回锚点。
    group.scrollIntoView({block: 'center'});
    group.classList.remove('pk-metre-pin-flash'); void group.offsetWidth; group.classList.add('pk-metre-pin-flash');
    group.addEventListener('animationend', () => group.classList.remove('pk-metre-pin-flash'), {once: true});
  }
  function paintButtons(key, pinned) {
    for (const group of groups()) {
      const meta = group.querySelector(':scope > .chat-group-messages > .chat-group-footer > .chat-group-footer__meta');
      const id = groupId(group);
      let btn = meta?.querySelector(':scope > .pk-metre-pin');
      if (!meta || !id || !key || group.querySelector('.chat-bubble.streaming')) { btn?.remove(); continue; }
      if (!btn) { btn = node('button', 'pk-metre-pin'); btn.type = 'button'; btn.addEventListener('click', () => toggle(group)); meta.append(btn); }
      // 只在值变了时才写：domWatch 也看属性变化，原样再写一遍也会触发下一轮 paint。
      const on = pinned.has(id), label = on ? '已置顶' : '置顶';
      if (btn.textContent !== label) btn.textContent = label;
      if (btn.getAttribute('aria-pressed') !== String(on)) btn.setAttribute('aria-pressed', String(on));
      const aria = on ? '取消置顶这条' : '置顶这条';
      if (btn.getAttribute('aria-label') !== aria) btn.setAttribute('aria-label', aria);
    }
  }
  function paintBar(key, list) {
    // 放在对话流 .chat-thread 的最前面，普通排在流里：第一条消息被推下去，不被盖住；跟着对话一起滚走（不 sticky：贴顶时读起来像压住了消息）。
    const host = document.querySelector('.chat-thread');
    let bar = document.querySelector('.pk-metre-pins');
    if (!key || !list.length || !host) { bar?.remove(); return; }
    const sig = JSON.stringify([key, open, list.map((p) => p.id)]);
    if (bar && bar.dataset.sig === sig && host.firstElementChild === bar) return;
    bar?.remove();
    bar = node('section', 'pk-metre-pins'); bar.dataset.sig = sig; bar.setAttribute('aria-label', '置顶的消息');
    const head = node('button', 'pk-metre-pins__toggle', `已置顶 ${list.length} 条`); head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.addEventListener('click', () => { open = !open; paint(); });
    bar.append(head);
    if (open) {
      const ul = node('ul', 'pk-metre-pins__list'), status = node('p', 'pk-metre-pins__status'); status.setAttribute('role', 'status');
      for (const p of list) {
        const li = node('li', 'pk-metre-pins__item');
        const go = node('button', 'pk-metre-pins__go'); go.type = 'button';
        go.append(node('span', 'pk-metre-pins__role', p.role === 'user' ? '你' : 'Metre'), node('span', 'pk-metre-pins__text', p.text || '（没有文字）'));
        go.addEventListener('click', () => jump(p.id, status));
        const x = node('button', 'pk-metre-pins__x', '取消置顶'); x.type = 'button'; x.setAttribute('aria-label', '取消置顶：' + (p.text || '').slice(0, 30));
        x.addEventListener('click', () => { save(key, load(key).filter((q) => q.id !== p.id)); paint(); });
        li.append(go, x); ul.append(li);
      }
      bar.append(ul, status);
    }
    host.prepend(bar);
  }
  function paint() {
    const key = isMetre() ? sessionKey() : '';
    const list = key ? load(key) : [];
    paintButtons(key, new Set(list.map((p) => p.id)));
    paintBar(key, list);
  }
  // 测试用：不挂 window 全局，挂在已有的 window.Pinkie.metre 命名空间下。
  const ns = (window.Pinkie = window.Pinkie || {}); ns.metre = ns.metre || {}; ns.metre.pins = {stableId, paint};
  window.addEventListener('laolao:modechange', paint);
  window.addEventListener('popstate', paint);
  window.Pinkie.domWatch?.watch('.chat-thread .chat-group-footer__meta, .chat-thread', paint, {always: true});
  paint();
})();
