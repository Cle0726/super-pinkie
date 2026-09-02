/* 工具流可见化 v2：自动展开"最后一组"工具进度 + 进行中指示 + 底部汇总。
   只读 DOM 与 chat-pane state，不改消息数据；全部幂等，可被 Lit 重渲染后自愈。

   v2 安全约束（v1 在大会话/流式中会把主线程打满）：
   1. 只自动展开最后一组（正在运行/最近一轮），历史组保持折叠——
      避免 600+ 消息会话一次性展开全部工具组造成 DOM 爆炸。
   2. 展开判断用 is-open class + aria-expanded 双重确认（原生两个都会渲染）。
   3. WeakSet 记录已自动点过的组元素：同一元素终身只自动点击一次，
      从机制上杜绝"点开→重渲染→再点→点开"的乒乓循环。
   4. 用户手动折叠过的组永不再自动展开。 */
(() => {
  'use strict';

  let scheduled = false;
  let applying = false;
  const autoExpanded = new WeakSet();

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

  /* 只自动展开最后一组；每个元素终身最多自动点一次 */
  function expandLastGroup(lastGroup) {
    if (!lastGroup) return;
    if (isOpen(lastGroup)) return;
    if (lastGroup.dataset.laolaoUserToggled === '1') return;
    if (autoExpanded.has(lastGroup)) return;
    const summary = $('.chat-activity-group__summary', lastGroup);
    if (!summary) return;
    autoExpanded.add(lastGroup);
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
      expandLastGroup(lastGroup);
      for (const group of groups) {
        armToggleListener(group);
        if (!isOpen(group)) continue; /* 折叠的组没有 body，跳过装饰 */
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
