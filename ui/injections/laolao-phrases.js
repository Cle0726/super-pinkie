(() => {
  "use strict";

  // Presentation only: replies/tool output stay intact. The reserved gateway
  // failure sentinel is localized as a system notice, not a character reply.
  //
  // 性能约束：首次启动允许做一次完整中文化；之后只处理新增子树，
  // 绝不在每个流式 mutation 后重扫 document.body。
  // 另：删掉死代码：itemSeed/groupSeed 会在守卫判断之前读取整组 textContent
  //    （每组工具输出可达数百 KB），且计算结果从未被使用；连带删除不再被调用的
  //    措辞抽取函数组（toolPhrase/activityPhrase/detailPhrase 等）。
  const failureSentinel='The agent run failed before producing a reply.';
  const watchdogSentinel='\u2063';
  const watchdogControlPrefix='[pinkie-watchdog]';
  const tierControlPrefix='[pinkie-tier-control]';
  const restartRecoveryNotice='[System] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool/model work. Continue from the existing transcript and finish the interrupted response.';
  const sessionFenceRecovery=/^(?:⚠️\s*)?Agent failed before reply:\s*(?:EmbeddedAttemptSessionTakeoverError:\s*)?session file changed while embedded prompt lock was released:/i;
  const failureNotice='这次模型调用失败，碧琪暂时没能完成回复。';
  const fallbackName=/^(?:Assistant|助手|main|project|thinking|learning|unrestricted)$/i;
  const askAssistantLabel=/(?:Ask|询问|问问).*(?:OpenClaw|CLE\s*Kk)/i;
  // The compact toolbar gives the Home shortcut and the Ask shortcut a shared
  // OpenClaw-flavoured title.  The Home aria-label is the reliable difference,
  // so explicitly keep it out of the branded Ask treatment.
  const homeAssistantLabel=/(?:Home\s*智能体|与你的\s*Home|主页|首页|home\s+agent)/i;
  const modelStartup=/^正在启动模型(?:…|\.\.\.)?\s*(?:[·•]\s*)?(\d+)\s*秒$/;
  const exactPhrases = new Map([
    ["网关仪表盘", "CLE Kk 本地工作台"],
    ["WebSocket URL", "CLE Kk 连接地址"],
    ["Gateway 令牌", "CLE Kk 访问令牌"],
    ["需要认证", "需要连接验证"],
    ["Gateway 可以访问，但此浏览器连接前需要匹配的令牌或密码。", "CLE Kk 已启动，这个窗口需要匹配的访问令牌或密码。"],
    ["粘贴来自", "粘贴 CLE Kk 的访问令牌；需要时可复制"],
    ["如果未配置令牌，请在 Gateway 主机上运行", "还没有访问令牌时，可在本机终端运行"],
    ["更新凭据后再次点击 Connect。", "填好后再次点击“连接”。"],
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
    ["Delete message", "删除消息"],
    ["Open in canvas", "在画布中打开"],
    ["Copy as markdown", "复制为 Markdown"],
    ["Copied", "已复制"],
    ["Copy failed", "复制失败"],
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
    if (/^(?:Ask|询问|问问)\s*(?:OpenClaw|CLE\s*Kk)$/i.test(core)) {
      return `${leading}问问碧琪${trailing}`;
    }

    const activity = core.match(/^Activity:\s*(\d+)\s*tools?$/i);
    if (activity) return `${leading}碧琪请了 ${activity[1]} 位工具小帮手${trailing}`;
    const toolCount = core.match(/^(\d+)\s*(Enabled |Live )?Tools?$/i);
    if (toolCount) return `${leading}${toolCount[1]} 位工具小帮手${trailing}`;
    // Brand chrome only. Chat messages/code are filtered by
    // isProtectedContent before translate() is called.
    if (/\bOpenClaw\b/.test(core)) {
      return `${leading}${core.replace(/\bOpenClaw\b/g,"CLE Kk")}${trailing}`;
    }
    return text;
  };

  const isProtectedContent = (node) => Boolean(
    node.parentElement?.closest("pre, code, textarea, input, select, [contenteditable='true'], .cm-preview, .chat-text, .chat-tool-card__detail, .chat-tool-msg-summary__names")
  );

  const localizeText = (node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const parent=node.parentElement;
    const core=(node.nodeValue||'').trim();
    const startup=core.match(modelStartup);
    if(startup && parent && !isProtectedContent(node)){
      const leading=(node.nodeValue||'').match(/^\s*/)?.[0]||'';
      const trailing=(node.nodeValue||'').match(/\s*$/)?.[0]||'';
      node.nodeValue=`${leading}碧琪正在把新模型请进派对… ${startup[1]}秒${trailing}`;
      parent.dataset.pinkieModelStartup='true';
      parent.setAttribute('aria-label',`碧琪正在启动模型，已等待 ${startup[1]} 秒`);
      return;
    }
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

  // Keep every follow-up pass local to the newly changed subtree.  The old
  // version periodically walked document.body again, which meant one streamed
  // token could make us revisit every mounted message and every sidebar item.
  const ownOrDescendants = (scope, selector) => {
    if (!scope?.querySelectorAll) return [];
    const own = scope.nodeType === 1 && scope.matches?.(selector) ? [scope] : [];
    return own.concat([...scope.querySelectorAll(selector)]);
  };

  const chatScopeFromNode = (node) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return element?.closest?.(".chat-thread-inner, .chat-thread, .agent-chat") || null;
  };

  const chatScopeFor = (node) => chatScopeFromNode(node)
    || document.querySelector(".chat-thread-inner, .chat-thread, .agent-chat");

  const syncBrandTitle = () => {
    if (/OpenClaw/.test(document.title)) document.title=document.title.replace(/OpenClaw/g,'CLE Kk');
  };

  const syncBrandChrome = (scope=document) => {
    syncBrandTitle();
    // "You" is upstream message chrome, not user-authored content. Localize
    // only the dedicated sender label so a real message containing that word
    // is never rewritten.
    ownOrDescendants(scope,'.chat-group.user .chat-sender-name').forEach(sender=>{
      if(sender.textContent.trim()==='You')sender.textContent='你';
    });
    ownOrDescendants(scope,'input[placeholder], textarea[placeholder]').forEach(control=>{
      const value=control.getAttribute('placeholder')||'';
      const next=value
        .replace(/OPENCLAW_GATEWAY_TOKEN(?:\s*[（(]可选[）)])?/g,'CLE Kk 访问令牌（可选）')
        .replace(/OpenClaw/g,'CLE Kk');
      if(next!==value)control.setAttribute('placeholder',next);
    });
    ownOrDescendants(scope,'[title], [aria-label], img[alt]').forEach(element=>{
      for(const name of ['title','aria-label','alt']){
        if(!element.hasAttribute(name))continue;
        const value=element.getAttribute(name)||'';
        const next=(exactPhrases.get(value) || value).replace(/OpenClaw/g,'CLE Kk');
        if(next!==value)element.setAttribute(name,next);
      }
    });
    ownOrDescendants(scope,'button, [role="button"]').forEach(element=>{
      const labels=[element.getAttribute('title'),element.getAttribute('aria-label')].filter(Boolean);
      const label=labels.join(' ');
      const isToolbarHome=element.classList.contains('shell-chrome-controls__home');
      const isToolbarCustodian=element.classList.contains('shell-chrome-controls__custodian');
      if(isToolbarHome||homeAssistantLabel.test(label)){
        delete element.dataset.pinkieAskClekk;
        return;
      }
      if(!isToolbarCustodian&&!askAssistantLabel.test(label))return;
      element.dataset.pinkieAskClekk='true';
      element.setAttribute('title','问问碧琪');
      element.setAttribute('aria-label','问问碧琪');
    });
  };

  // The upstream shell can replace <title> after the first gateway snapshot.
  // Keep the document/AX title branded without polling the whole page or
  // touching streamed message content.
  const watchBrandTitle = () => {
    const head = document.head;
    if (!head || head.dataset.pinkieBrandTitleWatch === '1') return;
    head.dataset.pinkieBrandTitleWatch = '1';
    const observer = new MutationObserver(() => syncBrandTitle());
    observer.observe(head, { subtree: true, childList: true, characterData: true });
    syncBrandTitle();
  };

  const hasTerminalReplyAfter = (group, assistantGroups) => {
    const index=assistantGroups.indexOf(group);
    return index>=0 && assistantGroups.slice(index+1).some(candidate=>
      [...candidate.querySelectorAll('.chat-bubble')].some(item=>{
        const raw=item.getAttribute('data-message-text');
        const text=item.querySelector('.chat-text')?.textContent.trim();
        return Boolean(text && raw!==failureSentinel && raw!==watchdogSentinel
          && !sessionFenceRecovery.test(raw||'')
          && !raw?.startsWith(watchdogControlPrefix) && !raw?.startsWith(tierControlPrefix));
      }));
  };

  const notifyUnrecoveredFailure = (bubble) => {
    if(bubble.dataset.pinkieRecoveryNotified)return;
    bubble.dataset.pinkieRecoveryNotified='true';
    window.dispatchEvent(new CustomEvent('pinkie:run-failed'));
  };

  // Large histories mount in chunks. An old failure can appear one render
  // before its later successful terminal reply, briefly arming the retry
  // ribbon. Publish the reverse transition as soon as the full DOM proves
  // every visible failure has already been superseded.
  let lastFailureProjectionState='unknown';
  const syncFailureProjectionState = (scope=chatScopeFor()) => {
    const assistantGroups=ownOrDescendants(scope,'.chat-group.assistant');
    const unresolvedRuntime=ownOrDescendants(scope,'.chat-bubble[data-pinkie-runtime-error]')
      .some(bubble=>!hasTerminalReplyAfter(bubble.closest('.chat-group.assistant'),assistantGroups));
    const unresolvedFence=assistantGroups.some(group=>
      [...group.querySelectorAll('.chat-bubble[data-message-text]')].some(bubble=>
        sessionFenceRecovery.test(bubble.getAttribute('data-message-text')||'') &&
        !hasTerminalReplyAfter(group,assistantGroups)));
    const next=unresolvedRuntime||unresolvedFence?'unrecovered':'clear';
    if(next===lastFailureProjectionState)return;
    const previous=lastFailureProjectionState;
    lastFailureProjectionState=next;
    if(next==='clear'&&previous==='unrecovered'){
      window.dispatchEvent(new CustomEvent('pinkie:run-recovered'));
    }
  };

  const syncFailureCards = (scope=chatScopeFor()) => {
    const assistantGroups=ownOrDescendants(scope,'.chat-group.assistant');
    ownOrDescendants(scope,'.chat-bubble[data-pinkie-runtime-error]').forEach(bubble=>{
      const content=bubble.querySelector('.chat-text')?.textContent.trim();
      if(bubble.getAttribute('data-message-text')!==failureSentinel || ![failureSentinel,failureNotice].includes(content)){
        bubble.removeAttribute('data-pinkie-runtime-error');
        if(bubble.getAttribute('title')==='系统运行提示；原始信息：'+failureSentinel)bubble.removeAttribute('title');
        bubble.hidden=false;
        bubble.style.removeProperty('display');
        delete bubble.dataset.pinkieRecoveredError;
        return;
      }
      const group=bubble.closest('.chat-group.assistant');
      const recovered=hasTerminalReplyAfter(group,assistantGroups);
      if(recovered){
        bubble.hidden=true;
        bubble.dataset.pinkieRecoveredError='true';
        bubble.style.setProperty('display','none','important');
      }else if(bubble.dataset.pinkieRecoveredError){
        bubble.hidden=false;
        bubble.style.removeProperty('display');
        delete bubble.dataset.pinkieRecoveredError;
        notifyUnrecoveredFailure(bubble);
      }else{
        notifyUnrecoveredFailure(bubble);
      }
    });
  };

  const hideInternalRecoveryTurns = (scope=chatScopeFor()) => {
    const assistantGroups=ownOrDescendants(scope,'.chat-group.assistant');
    ownOrDescendants(scope,'.chat-group.user').forEach(group=>{
      const bubbles=[...group.querySelectorAll('.chat-group-messages > .chat-bubble')];
      let hiddenCount=0;
      for(const bubble of bubbles){
        const raw=bubble.getAttribute('data-message-text');
        const internal=raw===watchdogSentinel || raw===restartRecoveryNotice || raw?.startsWith(watchdogControlPrefix) || raw?.startsWith(tierControlPrefix);
        if(internal){
          bubble.hidden=true;
          bubble.dataset.pinkieInternalRecovery='true';
          bubble.style.setProperty('display','none','important');
          hiddenCount+=1;
        }else if(bubble.dataset.pinkieInternalRecovery){
          bubble.hidden=false;
          bubble.style.removeProperty('display');
          delete bubble.dataset.pinkieInternalRecovery;
        }
      }
      if(bubbles.length>0 && hiddenCount===bubbles.length){
        group.hidden=true;
        group.dataset.pinkieInternalOnly='true';
        group.style.setProperty('display','none','important');
      }else if(group.dataset.pinkieInternalOnly){
        group.hidden=false;
        group.style.removeProperty('display');
        delete group.dataset.pinkieInternalOnly;
      }
    });
    assistantGroups.forEach(group=>{
      const bubbles=[...group.querySelectorAll('.chat-group-messages > .chat-bubble')];
      let hiddenCount=0;
      for(const bubble of bubbles){
        const raw=bubble.getAttribute('data-message-text')||'';
        if(sessionFenceRecovery.test(raw)){
          bubble.hidden=true;
          bubble.dataset.pinkieInternalRecovery='true';
          bubble.style.setProperty('display','none','important');
          hiddenCount+=1;
          if(!hasTerminalReplyAfter(group,assistantGroups)) notifyUnrecoveredFailure(bubble);
        }else if(bubble.dataset.pinkieInternalRecovery){
          bubble.hidden=false;
          bubble.style.removeProperty('display');
          delete bubble.dataset.pinkieInternalRecovery;
        }
      }
      if(bubbles.length>0 && hiddenCount===bubbles.length){
        group.hidden=true;
        group.dataset.pinkieInternalOnly='true';
        group.style.setProperty('display','none','important');
      }else if(group.dataset.pinkieInternalOnly){
        group.hidden=false;
        group.style.removeProperty('display');
        delete group.dataset.pinkieInternalOnly;
      }
    });
  };

  const hideLegacyThinkPrefixes = (scope=chatScopeFor()) => {
    ownOrDescendants(scope,'.chat-group.user .chat-bubble[data-message-text]').forEach(bubble=>{
      const raw=bubble.getAttribute('data-message-text')||'';
      const match=raw.match(/^\[deep-think:(?:base|boost|full|marathon)\]\s*/i);
      if(!match)return;
      const text=bubble.querySelector('.chat-text');
      if(!text||text.dataset.pinkieThinkPrefixHidden)return;
      const walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){
        if(node.nodeValue?.includes(match[0])){node.nodeValue=node.nodeValue.replace(match[0],'');break;}
      }
      text.dataset.pinkieThinkPrefixHidden='true';
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
    const scope = root?.querySelectorAll ? root : document;
    ownOrDescendants(scope,".chat-activity-group").forEach((group) => {
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
    ownOrDescendants(scope,".chat-tool-msg-summary").forEach(localizeToolSummary);
    ownOrDescendants(scope,".chat-group.tool:not(.chat-group--activity) .chat-sender-name").forEach((sender) => {
      if (sender.dataset.laolaoLocalized) return;
      sender.textContent = "碧琪的小帮手记录";
      sender.dataset.laolaoLocalized = "1";
    });

    ownOrDescendants(scope,".chat-tool-card__detail").forEach((detail) => {
      if (detail.dataset.laolaoLocalized) return;
      // Do not replace real progress with an invented activity sentence.
      detail.dataset.laolaoLocalized = "1";
    });
  };

  let chatProjectionTimer = 0;
  let pendingChatScope = null;
  const scheduleChatProjection = (node) => {
    const scope = chatScopeFromNode(node) || chatScopeFor();
    if (!scope) return;
    pendingChatScope = scope;
    if (chatProjectionTimer) return;
    // Failure/recovery state depends on message order, so it needs one small
    // chat-local pass. It is not a document-wide polling loop: only an actual
    // chat mutation can schedule it, and it is coalesced during streaming.
    chatProjectionTimer = window.setTimeout(() => {
      chatProjectionTimer = 0;
      const current = pendingChatScope?.isConnected ? pendingChatScope : chatScopeFor();
      pendingChatScope = null;
      if (!current) return;
      syncFailureCards(current);
      hideInternalRecoveryTurns(current);
      syncFailureProjectionState(current);
      hideLegacyThinkPrefixes(current);
    }, 350);
  };

  const localizeAddedSubtree = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      localizeText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    localizeTree(node);
    syncBrandChrome(node);
    localizeToolActivity(node);
  };

  const start = () => {
    // One initial pass is needed for already-mounted chrome. From this point
    // on, only the exact newly added subtree is touched.
    localizeTree(document.body);
    syncBrandChrome(document);
    watchBrandTitle();
    localizeToolActivity(document);
    const initialChat = chatScopeFor();
    if (initialChat) {
      syncFailureCards(initialChat);
      hideInternalRecoveryTurns(initialChat);
      syncFailureProjectionState(initialChat);
      hideLegacyThinkPrefixes(initialChat);
    }

    // openclaw-app is the stable application mount. Observing it (rather than
    // document.body) keeps portal/splash/background churn out of localization
    // work and avoids a perpetual whole-page scan during streamed output.
    const appRoot = document.querySelector("openclaw-app") || document.querySelector("#openclaw-mount-fallback");
    if (!appRoot || appRoot.dataset.pinkieLocalizedWatch === "1") return;
    appRoot.dataset.pinkieLocalizedWatch = "1";
    new MutationObserver((records) => {
      let chatChanged = false;
      for (const record of records) {
        if (record.type === "characterData") localizeText(record.target);
        if (chatScopeFromNode(record.target)) chatChanged = true;
        for (const node of record.addedNodes) {
          localizeAddedSubtree(node);
          if (chatScopeFromNode(node)) chatChanged = true;
        }
      }
      if (chatChanged) scheduleChatProjection();
    }).observe(appRoot, { childList: true, characterData: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
