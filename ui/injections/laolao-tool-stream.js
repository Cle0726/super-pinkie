/* 工具流可见化 v4：保持工具摘要折叠 + 进行中指示 + 底部汇总。
   只读 DOM 与 chat-pane state，不改消息数据；全部幂等，可被 Lit 重渲染后自愈。

   v2 安全约束（v1 在大会话/流式中会把主线程打满）：
   1. 不自动点击任何工具摘要。Lit 重挂时的程序 click 会把大段工具正文
      重新挂入 DOM，是聊天框跳动和内存暴涨的直接来源。
   2. 当前工具组默认只保留原生摘要；需要细节时用户手动展开即可。
   3. 每轮只观察最后一个工具组，历史工具组完全不扫描。 */
(() => {
  'use strict';

  let scheduled = false;
  let applying = false;

  const KIND_RULES = [
    [/读取文件|read/i, 'read', '读取'],
    [/写入文件|write/i, 'write', '写入'],
    [/编辑文件|应用补丁|edit|apply_patch/i, 'edit', '编辑'],
    [/执行命令|exec/i, 'exec', '命令'],
    [/查看进程|process/i, 'process', '进程'],
    [/搜索资料|web_search/i, 'search', '搜索'],
    [/读取网页|web_fetch/i, 'fetch', '网页'],
    [/操作浏览器|browser/i, 'browser', '浏览器'],
    [/cron/i, 'cron', '定时'],
    [/image|图片/i, 'image', '图片'],
    [/memory/i, 'memory', '记忆'],
  ];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function kindOf(labelText) {
    for (const [re, kind, cn] of KIND_RULES) {
      if (re.test(labelText)) return { kind, cn };
    }
    return { kind: 'other', cn: '工具' };
  }

  function runActive() {
    if (document.querySelector('.chat-send-btn--stop')) return true;
    const pane = document.querySelector('openclaw-chat-pane');
    const st = pane && pane.state;
    return !!(st && (st.chatRunStatus === 'running' || st.chatRunStatus === 'streaming' || st.chatStream));
  }

  /* 原生展开态：is-open class 与 aria-expanded 任一表示已展开即视为已展开 */
  function isOpen(group) {
    if (group.classList.contains('is-open')) return true;
    const summary = $('.chat-activity-group__summary', group);
    return summary ? summary.getAttribute('aria-expanded') === 'true' : false;
  }

  /* 记录用户主动查看过的摘要；脚本从不模拟 click 或改变展开状态。 */
  function armToggleListener(group) {
    if (group.dataset.laolaoTsListener) return;
    group.dataset.laolaoTsListener = '1';
    group.addEventListener('click', (ev) => {
      if (!ev.isTrusted) return;
      if (ev.target.closest && ev.target.closest('.chat-activity-group__summary')) {
        group.dataset.laolaoUserToggled = '1';
      }
    }, true);
  }

  function decorateItems(group, isLiveGroup, active) {
    const summaries = $$('.chat-tool-msg-summary', group);
    summaries.forEach((btn, i) => {
      const label = $('.chat-tool-msg-summary__label', btn);
      const text = label ? label.textContent || '' : '';
      const { kind } = kindOf(text);
      /* 类型色点 */
      let dot = $('.laolao-tool-dot', btn);
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'laolao-tool-dot';
        const icon = $('.chat-tool-msg-summary__icon', btn);
        if (icon && icon.parentNode === btn) btn.insertBefore(dot, icon);
        else btn.insertBefore(dot, btn.firstChild);
      }
      if (dot.dataset.kind !== kind) dot.dataset.kind = kind;

      /* 进行中徽标：只挂在运行中那一组的最后一项 */
      const isLast = i === summaries.length - 1;
      const wantLive = active && isLiveGroup && isLast;
      let badge = $('.laolao-tool-live-badge', btn);
      if (wantLive && !badge) {
        badge = document.createElement('span');
        badge.className = 'laolao-tool-live-badge';
        badge.textContent = '进行中';
        btn.insertBefore(badge, btn.firstChild);
      } else if (!wantLive && badge) {
        badge.remove();
      }
      btn.classList.toggle('laolao-tool-active', wantLive);
    });
    return summaries.length;
  }

  function updateFooter(group, count, active) {
    const body = $('.chat-activity-group__body', group);
    if (!body || !count) return;
    const counts = new Map();
    $$('.chat-tool-msg-summary__label', body).forEach((el) => {
      const { kind, cn } = kindOf(el.textContent || '');
      counts.set(cn + '|' + kind, (counts.get(cn + '|' + kind) || 0) + 1);
    });
    const parts = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, n]) => key.split('|')[0] + ' ' + n);
    const text = active
      ? '工具实时输出 · 已完成 ' + count + ' 项' + (parts.length ? ' · ' + parts.join(' · ') : '')
      : '共 ' + count + ' 项工具调用' + (parts.length ? ' · ' + parts.join(' · ') : '');
    let footer = $('.laolao-tool-stream-footer', body);
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'laolao-tool-stream-footer';
      body.appendChild(footer);
    }
    footer.classList.toggle('laolao-tool-stream-footer--live', active);
    if (footer.textContent !== text) footer.textContent = text;
  }

  function prepare() {
    scheduled = false;
    if (applying) return;
    applying = true;
    try {
      const active = runActive();
      const groups = $$('.chat-activity-group');
      const lastGroup = groups.length ? groups[groups.length - 1] : null;
      if (!lastGroup) return;
      armToggleListener(lastGroup);
      // 历史与当前工具正文都保持按需挂载；没有用户手动展开时，这里只
      // 保留原生 summary，不创建任何额外子树。
      if (!isOpen(lastGroup)) return;
      const n = decorateItems(lastGroup, true, active);
      updateFooter(lastGroup, n, active);
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(prepare, 80);
  }

  /* v3: MutationObserver 换成 1s 轮询。
     子树观察器在大会话流式期间是 mutation 记录雪崩的放大器
     （每条记录为每个观察器单独包装 JS 对象 → GC 死亡螺旋）。
     prepare 本身幂等且便宜，1s 延迟对工具流展示无感知。 */
  function start() {
    schedule();
    setInterval(schedule, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  window.addEventListener('laolao:modechange', schedule);
  window.__laolaoToolStream = { refresh: schedule };
})();
