(() => {
  "use strict";

  // Presentation only: replies/tool output stay intact. The reserved gateway
  // failure sentinel is localized as a system notice, not a character reply.
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

  const phraseIndex = (seed, length) => {
    let value = 0;
    for (const character of String(seed)) value = ((value * 31) + character.charCodeAt(0)) >>> 0;
    return value % length;
  };

  const pickPhrase = (phrases, seed) => phrases[phraseIndex(seed, phrases.length)];

  const toolPhrase = (name, seed) => {
    const key = name.trim().toLowerCase();
    const phrases = {
      exec: [
        "碧琪在翻小抽屉找线索…",
        "派对清单飞起来啦，碧琪正一张张接住…",
        "碧琪卷起袖子，马上把这一步办妥…",
        "这点小活交给碧琪的蹄子，马上有消息…",
      ],
      process: [
        "小帮手正在跑，碧琪踮着脚等回信…",
        "碧琪把耳朵竖起来，正听它有没有好消息…",
        "计时开始！碧琪盯着进度不眨眼…",
        "这台小机器忙着呢，碧琪在旁边加油…",
      ],
      read: [
        "碧琪正在展开小纸条看看…",
        "让我悄悄读一下这里藏着什么…",
        "碧琪戴上侦探帽，正翻看线索…",
      ],
      write: [
        "碧琪正在写一张亮晶晶的便签…",
        "这份小纸条由碧琪认真落笔中…",
        "碧琪把答案装进信封，马上封好…",
      ],
      edit: [
        "碧琪正在给这张小纸条修修边…",
        "这儿稍微挪一下，碧琪马上整理好…",
        "碧琪拿着彩笔，正把细节补齐…",
      ],
      search: [
        "碧琪正四处转转找线索…",
        "让我把放大镜拿出来找找看…",
        "碧琪已经小跑出去搜寻啦…",
      ],
      browser: [
        "碧琪打开小望远镜看看那边…",
        "让我探头瞧一眼，马上回来报告…",
        "碧琪正顺着网页上的小箭头找路…",
      ],
      default: [
        "碧琪请了一位工具小帮手来搭把手…",
        "这一步交给碧琪的可靠小伙伴啦…",
        "小帮手已经出发，碧琪在旁边盯着呢…",
      ],
    };
    const family = key === "web_search" ? "search" : (phrases[key] ? key : "default");
    return pickPhrase(phrases[family], `${family}:${seed}`);
  };

  const activityPhrase = (count, seed) => pickPhrase([
    `先生稍等，碧琪正安排 ${count} 位工具小帮手…`,
    `派对行动队出发：${count} 位小帮手正忙着呢…`,
    `碧琪把 ${count} 个小任务排成队啦…`,
    `这回有 ${count} 位小帮手一起跑腿，热闹起来啦！`,
  ], seed);

  const detailPhrase = (seed) => pickPhrase([
    "先生稍等，纸屑飞飞，碧琪马上带着结果回来！",
    "碧琪已经小跑出去了，答案马上送到！",
    "先别眨眼，这一步快完成啦！",
    "小帮手正忙，碧琪在旁边举着小旗子加油！",
    "碧琪把这件小事放进惊喜盒子里处理啦…",
  ], seed);

  const cardDetailPhrase = (seed) => pickPhrase([
    "碧琪正在给这一步系上彩带…",
    "小帮手在忙，碧琪负责盯进度！",
    "这张小任务卡正在处理，马上就好…",
    "碧琪正在把结果装进惊喜盒子…",
    "这一步正在咔嗒咔嗒往前走呢…",
  ], seed);

  const localizeToolSummary = (item, index) => {
    const toolLabel = item.querySelector(".chat-tool-msg-summary__label");
    const detail = item.querySelector(".chat-tool-msg-summary__names");
    const rawToolName = toolLabel?.textContent || "";
    const rawDetail = detail?.textContent || "";
    const group = item.closest(".chat-group");
    const groupLabel = group?.querySelector(".chat-activity-group__label")?.textContent || "";
    const itemSeed = `${groupLabel}:${group?.textContent || ""}:${index}:${rawToolName}:${rawDetail}`;

    if (toolLabel && !toolLabel.dataset.laolaoLocalized) {
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
      const groupSeed = `${label?.textContent || ""}:${group.textContent || ""}`;
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

    scope.querySelectorAll?.(".chat-tool-card__detail").forEach((detail, index) => {
      if (detail.dataset.laolaoLocalized) return;
      // Do not replace real progress with an invented activity sentence.
      detail.dataset.laolaoLocalized = "1";
    });
  };

  const start = () => {
    localizeTree(document.body);
    localizeToolActivity(document);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") localizeText(record.target);
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) localizeText(node);
          if (node.nodeType === Node.ELEMENT_NODE) {
            localizeTree(node);
            localizeToolActivity(node);
          }
        }
      }
      localizeToolActivity(document);
      syncFailureCards();
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
