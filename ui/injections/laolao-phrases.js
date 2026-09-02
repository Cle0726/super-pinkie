(() => {
  "use strict";

  // Presentation only: replies/tool output stay intact. The reserved gateway
  // failure sentinel is localized as a system notice, not a character reply.
  //
  // v2 性能修复（2026-09-01，大会话流式期间整页冻结的根因）：
  // 1. 删掉每轮回调里的全文档 localizeToolActivity(document) + syncFailureCards()，
  //    改为 600ms 防抖（原来每个 mutation 批次都全文档扫 4 个 querySelectorAll）。
  // 2. 删掉死代码：itemSeed/groupSeed 会在守卫判断之前读取整组 textContent
  //    （每组工具输出可达数百 KB），且计算结果从未被使用；连带删除不再被调用的
  //    措辞抽取函数组（toolPhrase/activityPhrase/detailPhrase 等）。
  const failureSentinel='The agent run failed before producing a reply.';
  const failureNotice='这次模型调用失败，碧琪暂时没能完成回复。';
  const fallbackName=/^(?:Assistant|助手|main|project|thinking|unrestricted)$/i;
  const exactPhrases = new Map([
    ["Loading…", "先生稍等，碧琪在找派对用品…"],
    ["Loading...", "先生稍等，碧琪在找派对用品…"],
    ["Loading config schema…", "碧琪正在整理配置小卡片…"],
    ["Loading schema…", "碧琪正在翻找说明小卡…"],
    ["Loading runtime tool catalog…", "碧琪正在清点工具小帮手…"],
    ["Loading microphones…", "碧琪正在听听麦克风有没有打喷嚏…"],
    ["Thinking", "碧琪在转着卷卷鬃毛想呀想…"],
    ["Thinking…", "碧琪在转着卷卷鬃毛想呀想…"],
    ["Thinking...", "碧琪在转着卷卷鬃毛想呀想…"],
    ["Running", "碧琪正在忙活中…"],
    ["Waiting…", "碧琪在门口踮脚等着呢…"],
    ["Waiting...", "碧琪在门口踮脚等着呢…"],
    ["Calling tool", "碧琪正在请工具小帮手出场…"],
    ["Running tool", "工具小帮手正在开工…"],
    ["Tool call", "工具小帮手出场"],
    ["Tool result", "工具小帮手回信"],
    ["Tool input", "碧琪收到的小任务"],
    ["Tool output", "小帮手带回的消息"],
    ["Tool error", "这一步碰到一点彩带小状况"],
    ["Tool Access", "工具小帮手通行证"],
    ["Retry", "再试一次"],
    ["Retrying…", "碧琪再试一次，别急别急…"],
    ["Retrying...", "碧琪再试一次，别急别急…"],
    ["Interrupted", "碧琪先把小蹄子收回来啦"],
    ["Stopped", "碧琪已经乖乖停下啦"],
    ["Cancelled", "这件小事先不做啦"],
    ["Aborted", "碧琪先停在这里等先生"],
    ["Error rendering content", "这块内容被奶油糊住啦"],
    ["An error occurred:", "哎呀，碧琪碰到一点小意外："],
    [failureSentinel, failureNotice],
    ["No agents found.", "碧琪暂时没找到小伙伴。"],
    ["Nothing waiting today", "今天没有待办派对啦。"],
  ]);

  const translate = (text) => {
    const leading = text.match(/^\s*/)?.[0] ?? "";
    const trailing = text.match(/\s*$/)?.[0] ?? "";
    const core = text.slice(leading.length, text.length - trailing.length);
    if (exactPhrases.has(core)) return `${leading}${exactPhrases.get(core)}${trailing}`;

    // The UI sometimes interpolates the assistant's configured name into an
    // English live-status sentence (for example, “碧琪 is responding…”), so an
    // exact string map cannot catch it.
    if (/^.+\s+is responding[.…]*$/i.test(core)) {
      return `${leading}碧琪正鼓着腮帮子认真回话呢…${trailing}`;
    }
    if (/^.+\s+is thinking[.…]*$/i.test(core)) {
      return `${leading}碧琪转着卷卷鬃毛想呀想…${trailing}`;
    }
    if (/^.+\s+is working[.…]*$/i.test(core)) {
      return `${leading}碧琪正忙着把这件事办好呢…${trailing}`;
    }

    const activity = core.match(/^Activity:\s*(\d+)\s*tools?$/i);
    if (activity) return `${leading}碧琪请了 ${activity[1]} 位工具小帮手${trailing}`;
    const toolCount = core.match(/^(\d+)\s*(Enabled |Live )?Tools?$/i);
    if (toolCount) return `${leading}${toolCount[1]} 位工具小帮手${trailing}`;
    return text;
  };

  const isProtectedContent = (node) => Boolean(
    node.parentElement?.closest("pre, code, textarea, input, select, [contenteditable='true'], .cm-preview, .chat-text, .chat-tool-card__detail, .chat-tool-msg-summary__names")
  );

  const localizeText = (node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const parent=node.parentElement;
    const core=(node.nodeValue||'').trim();
    // Only the exact, unquoted gateway failure in an assistant bubble. Never
    // translate a user's text, a code sample, or normal assistant prose.
    if(core===failureSentinel && parent?.closest('.chat-group.assistant') && !parent.closest('pre, code, blockquote, textarea, input, [contenteditable="true"]')){
      const text=parent.closest('.chat-text'),bubble=parent.closest('.chat-bubble');
      if(text?.textContent.trim()===failureSentinel && bubble?.getAttribute('data-message-text')===failureSentinel){
        node.nodeValue=node.nodeValue.replace(failureSentinel,failureNotice);
        bubble.setAttribute('data-pinkie-runtime-error','true');
        bubble.setAttribute('title','系统运行提示；原始信息：'+failureSentinel);
        return;
      }
    }
    if(isProtectedContent(node))return;
    if(fallbackName.test(core) && parent?.closest('.chat-group.assistant .chat-sender-name, .agent-chat__welcome h2, .dashboard-header__breadcrumb-context')){
      node.nodeValue=node.nodeValue.replace(core,'碧琪');
      if(parent.hasAttribute('title'))parent.setAttribute('title','碧琪');
      return;
    }
    const localized = translate(node.nodeValue ?? "");
    if (localized !== node.nodeValue) node.nodeValue = localized;
  };

  const localizeTree = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) localizeText(node);
  };

  const syncFailureCards = () => {
    document.querySelectorAll('.chat-bubble[data-pinkie-runtime-error]').forEach(bubble=>{
      const content=bubble.querySelector('.chat-text')?.textContent.trim();
      if(bubble.getAttribute('data-message-text')!==failureSentinel || ![failureSentinel,failureNotice].includes(content)){
        bubble.removeAttribute('data-pinkie-runtime-error');
        if(bubble.getAttribute('title')==='系统运行提示；原始信息：'+failureSentinel)bubble.removeAttribute('title');
      }
    });
  };

  const localizeToolSummary = (item) => {
    const toolLabel = item.querySelector(".chat-tool-msg-summary__label");
    const detail = item.querySelector(".chat-tool-msg-summary__names");

    if (toolLabel && !toolLabel.dataset.laolaoLocalized) {
      const rawToolName = toolLabel.textContent || "";
      const labels={read:'读取文件',write:'写入文件',edit:'编辑文件',exec:'执行命令',process:'查看进程',web_search:'搜索资料',web_fetch:'读取网页',browser:'操作浏览器',apply_patch:'应用补丁'};
      const label=labels[rawToolName.trim().toLowerCase()];
      if(label)toolLabel.textContent=label+' · '+rawToolName;
      toolLabel.dataset.laolaoLocalized = "1";
    }
    if (detail && !detail.dataset.laolaoLocalized) {
      // Paths, commands and actual tool results must remain visible.
      detail.dataset.laolaoLocalized = "1";
    }
  };

  const localizeToolActivity = (root) => {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll?.(".chat-activity-group").forEach((group) => {
      const summary = group.querySelector(".chat-activity-group__summary");
      const label = group.querySelector(".chat-activity-group__label");
      if (label && !label.dataset.laolaoLocalized) {
        const count = (label.textContent || "").match(/\d+/)?.[0] || "几";
        label.textContent = `工具进度 · ${count} 项`;
        label.dataset.laolaoLocalized = "1";
        if (summary) summary.setAttribute("aria-label", "碧琪的工具小帮手行动记录");
      }

      const activitySender = group.closest(".chat-group")?.querySelector(".chat-sender-name");
      if (activitySender && !activitySender.dataset.laolaoLocalized) {
        activitySender.textContent = "碧琪的行动小记录";
        activitySender.dataset.laolaoLocalized = "1";
      }
    });

    /* A one-step tool run is rendered outside .chat-activity-group. Localize
       these summaries too; otherwise its stock "Edit" / "Tool" labels leak
       through while multi-step activity looks correct. */
    scope.querySelectorAll?.(".chat-tool-msg-summary").forEach(localizeToolSummary);
    scope.querySelectorAll?.(".chat-group.tool:not(.chat-group--activity) .chat-sender-name").forEach((sender) => {
      if (sender.dataset.laolaoLocalized) return;
      sender.textContent = "碧琪的小帮手记录";
      sender.dataset.laolaoLocalized = "1";
    });

    scope.querySelectorAll?.(".chat-tool-card__detail").forEach((detail) => {
      if (detail.dataset.laolaoLocalized) return;
      // Do not replace real progress with an invented activity sentence.
      detail.dataset.laolaoLocalized = "1";
    });
  };

  const start = () => {
    localizeTree(document.body);
    localizeToolActivity(document);

    /* 全文档补扫做 600ms 防抖：Lit 有时就地复用节点（不触发 addedNodes），
       需要定期兜底；但绝不能每个 mutation 批次都全扫。
       v3：新增元素的语言树/工具条本地化也全部并入这次防抖扫描——
       观察者回调里跑 querySelectorAll 会疯狂制造 NodeList 包装对象，
       是 2026-09-01 第三次冻结实抓到的 GC 雪崩主凶。 */
    let fullScanScheduled = false;
    const scheduleFullScan = () => {
      if (fullScanScheduled) return;
      fullScanScheduled = true;
      setTimeout(() => {
        fullScanScheduled = false;
        localizeTree(document.body);
        localizeToolActivity(document);
        syncFailureCards();
      }, 600);
    };

    new MutationObserver((records) => {
      for (const record of records) {
        // 回调里只做零分配的纯文本替换；元素级扫描全部交给防抖。
        if (record.type === "characterData") localizeText(record.target);
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) localizeText(node);
        }
      }
      scheduleFullScan();
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
