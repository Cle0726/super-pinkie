/* 工具流可见化：自动展开工具进度组 + 进行中指示 + 底部汇总。
   只读 DOM 与 chat-pane state，不改消息数据；全部幂等，可被 Lit 重渲染后自愈。 */
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

  /* 真实用户手动折叠后不再自动展开（isTrusted 区分程序点击） */
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

  function expandGroup(group) {
    const summary = $('.chat-activity-group__summary', group);
    if (!summary) return;
    if (summary.getAttribute('aria-expanded') === 'true') return;
    if (group.dataset.laolaoUserToggled === '1') return;
    summary.click(); /* 交给 Lit 自己渲染 body，不手搓 DOM */
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
      dot.dataset.kind = kind;

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
      for (const group of groups) {
        armToggleListener(group);
        expandGroup(group);
        const n = decorateItems(group, group === lastGroup, active);
        updateFooter(group, n, active && group === lastGroup);
      }
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(prepare, 80);
  }

  function start() {
    schedule();
    new MutationObserver((muts) => {
      if (applying) return;
      for (const m of muts) {
        if (m.type === 'childList' || m.type === 'attributes') { schedule(); return; }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-expanded'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  window.addEventListener('laolao:modechange', schedule);
  window.__laolaoToolStream = { refresh: schedule };
})();
