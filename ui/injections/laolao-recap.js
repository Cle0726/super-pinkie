/* 月度回顾（任务书 任务-官方新功能五项-1125.md 第 2 项，ui2 11-25）。
 *
 * 每月 1–7 日在首页（laolao-startup-home.js 画的那一页，六个模式共用）「继续之前的工作」上面放一张回顾卡，说上个月：
 * 聊了多少、常用的模式、项目模式里忙过哪几件、学习书桌的分钟 / 作答 / 错题 / 复习 / 生词 / 连续天数。
 * 设置弹层里有一张「月度回顾」卡片：回顾卡开关、「无限制模式的会话也算进去」（默认不算）、「现在看看」。
 *
 * 数据只取本机：会话列表走已有的 sessions.list，学习数走只读的 pinkie.recap.month（services/mode-architecture/monthly-recap.mjs）。
 * 不调模型、不往外发；文案按数拼。只用 textContent。数据很少的月份只给一句短话。
 * 长期记忆按模式各自独立，不跨模式汇总，这里不数。不新增观察器、定时器和 window 全局名，页面变化走 window.Pinkie.domWatch.poll。 */
(() => {
  'use strict';
  const PREFS = 'pinkie.recap.prefs';
  const S = 'pinkie-user-settings__';
  const AGENT_MODE = {main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning', unrestricted: 'unrestricted', metre: 'metre'};
  const LABEL = {chat: '唠嗑', project: '项目', thinking: '想法', learning: '学习', unrestricted: '无限制', metre: 'Metre'};
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = () => { try { return window.localStorage; } catch { return null; } };
  const prefs = () => { try { const v = JSON.parse(store()?.getItem(PREFS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const setPrefs = (patch) => { try { store()?.setItem(PREFS, JSON.stringify({...prefs(), ...patch})); } catch {} };
  const rpc = (method, params, timeout = 15_000) => {
    const call = window.__laolaoSidebar?.gwRequest;
    return typeof call === 'function' ? call(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const pad = (n) => String(n).padStart(2, '0');
  const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const lastMonth = (d = new Date()) => monthOf(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const inWindow = (d = new Date()) => d.getDate() <= 7;
  const monthName = (m) => `${Number(m.slice(5))} 月`;
  const modeOfKey = (key) => AGENT_MODE[/^agent:([^:]+):/.exec(String(key || ''))?.[1] || ''] || '';

  // 会话：这个月有动静的（updatedAt / lastActivityAt 落在这个月，按本机时间），子任务不算；无限制默认不算。
  async function sessionsFor(month, withUnrestricted) {
    const listed = await rpc('sessions.list', {limit: 1000});
    const rows = (listed?.sessions || []).filter((s) => {
      if (!s?.key || /:subagent:/i.test(s.key)) return false;
      const mode = modeOfKey(s.key);
      if (!mode || (mode === 'unrestricted' && !withUnrestricted)) return false;
      const at = Number(s.lastActivityAt || s.updatedAt) || 0;
      return at > 0 && monthOf(new Date(at)) === month;
    });
    const byMode = {};
    for (const s of rows) { const m = modeOfKey(s.key); byMode[m] = (byMode[m] || 0) + 1; }
    const top = Object.entries(byMode).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const projects = rows.filter((s) => modeOfKey(s.key) === 'project').map((s) => String(s.label || s.displayName || s.derivedTitle || '').trim()).filter(Boolean).slice(0, 3);
    return {total: rows.length, top, projects};
  }

  // 按数拼几句；数很少就一句。
  function lines(month, chats, study) {
    const name = monthName(month);
    const s = study?.study || {}, v = study?.vocab || {}, streak = study?.streak || {};
    if (chats.total < 3 && !s.minutes && !s.answered) return {short: true, lines: [`${name}没怎么见面。这个月想到什么，随时来说。`]};
    const out = [];
    if (chats.total) {
      const fav = chats.top.map(([m, n]) => `${LABEL[m] || m} ${n} 个`).join('、');
      out.push(`${name}一起聊了 ${chats.total} 个会话，最常在${fav ? `：${fav}` : '一处'}。`);
    }
    if (chats.projects.length) out.push(`项目模式里忙过：${chats.projects.map((t) => `「${t.length > 18 ? t.slice(0, 18) + '…' : t}」`).join('、')}。`);
    if (s.minutes || s.answered || s.reviews) {
      const bits = [s.minutes ? `学了 ${s.minutes} 分钟` : '', s.answered ? `做了 ${s.answered} 道题` : '', s.wrong ? `其中 ${s.wrong} 道进了错题` : '', s.reviews ? `复习 ${s.reviews} 次` : ''].filter(Boolean);
      out.push(`学习书桌上，${s.activeDays ? `${s.activeDays} 天有动静，` : ''}${bits.join('，')}。`);
    }
    if (v.added || v.reviewed) out.push(`词汇本${v.added ? `新添 ${v.added} 个词` : ''}${v.added && v.reviewed ? '，' : ''}${v.reviewed ? `背过 ${v.reviewed} 个` : ''}。`);
    if (streak.current >= 2) out.push(`现在已经连着学了 ${streak.current} 天，别断。`);
    else if (streak.best >= 3) out.push(`最长连着学过 ${streak.best} 天，这个月再来一次？`);
    out.push(chats.total >= 20 ? '一个月下来挺充实的，这个月也慢慢来。' : '这个月也一起好好过。');
    return {short: false, lines: out};
  }

  async function build(month) {
    const withU = Boolean(prefs().unrestricted);
    const [chats, study] = await Promise.all([
      sessionsFor(month, withU).catch(() => ({total: 0, top: [], projects: []})),
      rpc('pinkie.recap.month', {month}).catch(() => null),
    ]);
    return {month, ...lines(month, chats, study)};
  }

  function cardNode(data, {onClose} = {}) {
    const card = node('section', 'laolao-startup-home__recap');
    card.setAttribute('aria-label', '月度回顾');
    card.dataset.month = data.month;
    if (data.short) card.dataset.short = '1';
    const head = node('div', 'laolao-startup-home__recap-head');
    head.append(node('h3', 'laolao-startup-home__recap-title', `${monthName(data.month)}回顾`));
    if (onClose) {
      const x = node('button', 'laolao-startup-home__recap-close', '收起'); x.type = 'button';
      x.setAttribute('aria-label', `收起${monthName(data.month)}回顾，这个月不再出现`);
      x.addEventListener('click', onClose);
      head.append(x);
    }
    card.append(head);
    for (const line of data.lines) card.append(node('p', 'laolao-startup-home__recap-line', line));
    return card;
  }

  // 首页：1–7 日、开着、这个月没收起，才放卡片；一个页面里同一个月只取一次数。
  let cache = null, loading = '';
  function onHome() {
    const main = document.querySelector('.chat-main');
    const old = main?.querySelector(':scope > .laolao-startup-home__recap');
    const month = lastMonth();
    const want = main && document.documentElement.getAttribute('data-laolao-startup-home') === '1' && inWindow()
      && !prefs().off && prefs().dismissed !== month;
    if (!want) { old?.remove(); return; }
    const sig = JSON.stringify([month, Boolean(prefs().unrestricted)]);
    if (cache?.sig === sig) {
      if (old?.dataset.sig === sig) return;
      old?.remove();
      const card = cardNode(cache.data, {onClose: () => { setPrefs({dismissed: month}); onHome(); }});
      card.dataset.sig = sig;
      const recent = main.querySelector(':scope > .laolao-startup-home__recent');
      recent ? recent.before(card) : main.append(card);
      return;
    }
    if (loading === sig) return;
    loading = sig;
    build(month).then((data) => { cache = {sig, data}; }).catch(() => {}).finally(() => { loading = ''; onHome(); });
  }

  // 设置弹层：一张卡片，两个开关加「现在看看」。
  function toggleRow(id, label, hint, get, set) {
    const row = node('div', S + 'row');
    const copy = node('div', S + 'row-copy');
    const title = node('span', S + 'row-title', label); title.id = id;
    copy.append(title, node('span', S + 'hint', hint));
    const control = node('div', S + 'row-control');
    const group = node('div', S + 'segments'); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', id);
    const btns = [[true, '开'], [false, '关']].map(([value, text]) => {
      const btn = node('button', S + 'choice', text); btn.type = 'button';
      btn.addEventListener('click', () => { set(value); paint(); });
      group.append(btn);
      return [value, btn];
    });
    const paint = () => { for (const [value, btn] of btns) { const on = value === get(); btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('is-selected', on); } };
    control.append(group); row.append(copy, control); paint();
    return row;
  }
  function mountSettings(target) {
    if (!target || target.querySelector('.laolao-recap-settings')) return;
    const card = node('section', S + 'card laolao-recap-settings');
    const head = node('header', S + 'card-header');
    const icon = node('span', S + 'icon', '☾'); icon.setAttribute('aria-hidden', 'true');
    head.append(icon, node('h3', S + 'card-title', '月度回顾'));
    card.append(head, node('p', S + 'card-hint', '每月头一周，首页放一张上个月的回顾。数都在这台电脑上算，不往外发。'));
    card.append(toggleRow('laolao-recap-on', '回顾卡', '关掉以后首页不再出现。', () => !prefs().off, (v) => { setPrefs({off: !v}); onHome(); }));
    card.append(toggleRow('laolao-recap-unrestricted', '算上无限制模式', '默认不算无限制模式里的会话。', () => Boolean(prefs().unrestricted), (v) => { setPrefs({unrestricted: v}); cache = null; onHome(); }));
    const row = node('div', S + 'row');
    const copy = node('div', S + 'row-copy');
    copy.append(node('span', S + 'row-title', '现在看看'), node('span', S + 'hint', '不用等到月初，随时看上个月。'));
    const control = node('div', S + 'row-control');
    const open = node('button', S + 'button laolao-recap-open', '看上个月'); open.type = 'button';
    const slot = node('div', 'laolao-recap-preview'); slot.setAttribute('aria-live', 'polite');
    open.addEventListener('click', () => {
      open.disabled = true; slot.replaceChildren(node('p', S + 'hint', '在算…'));
      build(lastMonth()).then((data) => slot.replaceChildren(cardNode(data))).catch(() => slot.replaceChildren(node('p', S + 'hint', '这会儿读不到，过一会儿再试。')))
        .finally(() => { open.disabled = false; });
    });
    control.append(open); row.append(copy, control);
    card.append(row, slot);
    const footer = target.querySelector('.' + S + 'footer');
    footer ? footer.before(card) : target.append(card);
  }

  window.addEventListener('pinkie:settings-ready', (event) => mountSettings(event.detail));
  const ready = () => { mountSettings(document.querySelector('#laolao-user-settings .' + S + 'scroll')); onHome(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
  window.Pinkie?.domWatch?.poll(onHome, 1500);
})();
