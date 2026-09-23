(() => {
  "use strict";

  const BUTTON_CLASS = "laolao-web-gpt-collab";
  const PREFIX = "laolao:web-gpt-collab:";
  let arming = null;
  let bypassOnce = false;
  let panel = null;
  let activity = null;
  let activityTimer = null;
  let connection = null;
  let connectionBusy = false;
  let pendingConfirmation = null;
  let buttonClickTimer = null;
  let observedSessionKey = "";
  let activityOffset = 0;
  const pendingBrowserControls = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const sessionKey = () => {
    const routed = new URLSearchParams(location.search).get("session") || "";
    if (/^agent:(main|project|thinking|learning|unrestricted):/.test(routed)) return routed;
    const active = $("[data-session-key].sidebar-recent-session--active");
    const key = active?.dataset?.sessionKey || "";
    return /^agent:(main|project|thinking|learning|unrestricted):/.test(key) ? key : "";
  };
  const storageKey = () => PREFIX + (sessionKey() || "default");
  const enabled = () => {
    try { return localStorage.getItem(storageKey()) === "1"; } catch { return false; }
  };
  const toast = (message) => {
    if (typeof window.__laolaoToast === "function") window.__laolaoToast(message);
    else window.dispatchEvent(new CustomEvent("laolao:toast", {detail: {message}}));
  };

  const rpc = () => window.__laolaoSidebar?.gwRequest;
  const browserBridge = () => window.webkit?.messageHandlers?.laolaoBrowserWorkspace;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__laolaoBrowserControlResult = (payload = {}) => {
    const pending = pendingBrowserControls.get(String(payload.requestId || ""));
    if (!pending) return;
    pendingBrowserControls.delete(String(payload.requestId || ""));
    clearTimeout(pending.timer);
    if (payload.ok) pending.resolve(payload.result || {});
    else pending.reject(new Error(payload.error || "内置 ChatGPT 页面操作失败"));
  };
  const browserControl = (operation, payload = {}, timeout = 20_000) => new Promise((resolve, reject) => {
    const bridge = browserBridge();
    if (!bridge) { reject(new Error("当前版本没有内置浏览器控制桥")); return; }
    const requestId = `web-gpt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      pendingBrowserControls.delete(requestId);
      reject(new Error("等待内置 ChatGPT 页面超时"));
    }, timeout);
    pendingBrowserControls.set(requestId, {resolve, reject, timer});
    bridge.postMessage({action: "chatgpt-control", operation, requestId, ...payload});
  });
  const selectedWorkspace = () => {
    const key = sessionKey();
    const sidebar = window.__laolaoSidebar;
    const state = sidebar?.state;
    if (!key || !state?.projects || !state?.projectFolders) return "";
    const project = Object.keys(state.projects).find((name) => state.projects[name]?.includes?.(key));
    return project ? String(state.projectFolders[project] || "") : "";
  };
  const connectionParams = (extra = {}) => ({sessionKey: sessionKey(), workspace: selectedWorkspace(), ...extra});
  const formatTime = (value) => {
    const date = new Date(Number(value) || Date.now());
    return new Intl.DateTimeFormat("zh-CN", {hour: "2-digit", minute: "2-digit", second: "2-digit"}).format(date);
  };
  const stageInfo = (stage) => ({
    queued: {label: "本轮请求已排队", status: "等待发送", tone: "waiting"},
    sent: {label: "发往网页 GPT", status: "已发送，等待回复", tone: "sending"},
    received: {label: "网页 GPT 返回", status: "已收到回复", tone: "received"},
    failed: {label: "协作失败", status: "发送失败", tone: "failed"},
    note: {label: "协作说明", status: "协作进行中", tone: "note"},
  }[stage] || {label: "协作记录", status: "协作进行中", tone: "note"});

  const renderConnection = () => {
    if (!panel) return;
    const host = panel.querySelector(".laolao-web-gpt-connection");
    if (!host) return;
    const bridge = connection?.bridge;
    const projectRequired = connection?.projectRequired === true;
    const status = host.querySelector(".laolao-web-gpt-connection__state");
    const running = bridge?.running === true;
    const fatalTunnel = /Unauthorized|Tunnel not found|no recent network activity|operation was aborted due to timeout/i.test(String(bridge?.tunnel?.detail || bridge?.error || ""));
    const publicReady = bridge?.publicReady === true || (bridge?.publicReady == null && running && !fatalTunnel && Boolean(bridge?.publicUrl || bridge?.tunnel?.running || connection?.started?.mcpUrl));
    const pairedReady = Number(bridge?.tokenCount || 0) > 0;
    const unknown = bridge?.running == null && bridge?.state === "unknown";
    status.textContent = connectionBusy
      ? "正在检查…"
      : connection?.error
        ? "连接状态不可用"
        : projectRequired
          ? "未绑定项目 · 不读取碧琪记忆"
        : publicReady && pairedReady && Boolean(connection?.conversation?.chatUrl)
          ? "网页会话已绑定"
          : publicReady && pairedReady
            ? "连接器已就绪 · 等待首条网页会话"
          : publicReady
            ? "安全连接已建立 · 等待配对"
          : running
            ? "桥接已启动 · 等待安全连接"
          : unknown
            ? "连接状态待确认"
            : "本地桥接未启动";
    status.dataset.tone = connection?.error ? "failed" : publicReady && pairedReady && connection?.conversation?.chatUrl ? "received" : running ? "waiting" : unknown ? "waiting" : "off";
    const workspace = host.querySelector('[data-field="workspace"]');
    const connector = host.querySelector('[data-field="connector"]');
    const account = host.querySelector('[data-field="account"]');
    workspace.textContent = projectRequired
      ? "未绑定用户项目（内部记忆不会共享）"
      : connection?.workspace || selectedWorkspace() || "未绑定用户项目";
    const conversation = connection?.conversation || {};
    connector.textContent = projectRequired
      ? "绑定项目后建立只读连接器"
      : conversation.connectorName || connection?.diagnostics?.chatgptRepair?.connectorName || bridge?.connectorName || connection?.started?.connectorName || "尚未配对";
    account.textContent = connection?.accountIdentity || "由右侧 ChatGPT 页面显示";
    const pairing = connection?.pairing;
    const pairBox = host.querySelector(".laolao-web-gpt-connection__pairing");
    if (pairing?.pairingCode) {
      pairBox.hidden = false;
      pairBox.querySelector("code").textContent = pairing.pairingCode;
      const expires = Number(pairing.pairingExpiresAt);
      pairBox.querySelector("span").textContent = expires
        ? `有效至 ${formatTime(expires)}`
        : "请在 ChatGPT 连接器授权页输入";
    } else {
      pairBox.hidden = true;
    }
    for (const button of host.querySelectorAll("button[data-action]")) button.disabled = connectionBusy;
    const start = host.querySelector('[data-action="start"]');
    start.hidden = publicReady || projectRequired;
    start.textContent = running ? "建立安全连接" : "启动桥接";
    host.querySelector('[data-action="pair"]').hidden = projectRequired || !publicReady;
    if (projectRequired) {
      for (const action of ["clear-conversation", "unpair"]) {
        host.querySelector(`[data-action="${action}"]`).disabled = true;
      }
    }
    const error = host.querySelector(".laolao-web-gpt-connection__error");
    error.hidden = !connection?.error;
    error.textContent = connection?.error || "";
  };

  const compactEventPreview = (entry, retiredInternalWorkspace = false) => {
    if (retiredInternalWorkspace) return "修复前记录，内部工作区连接现已停用";
    let text = String(entry?.text || "").trim();
    if (entry?.stage === "sent") {
      text = /(?:^|\n)GOAL:\s*\n?([\s\S]*?)(?:\n\nINSTRUCTION:|$)/i.exec(text)?.[1] || text;
    } else if (entry?.stage === "received") {
      text = text
        .replace(/^\s*\[C2C\]\s*/i, "")
        .replace(/^(?:STATE|TASK_ID|ITERATION)\s*:[^\n]*\n?/gim, "")
        .replace(/^\s*PLAN\s*:\s*/i, "");
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return entry?.stage === "queued" ? "等待发送" : "没有内容摘要";
    return text.length > 72 ? `${text.slice(0, 72).trim()}…` : text;
  };

  const renderActivity = () => {
    if (!panel) return;
    const active = enabled();
    const events = Array.isArray(activity?.events) ? activity.events : [];
    const latestStage = activity?.latestStage || events[events.length - 1]?.stage;
    const info = latestStage ? stageInfo(latestStage) : null;
    const status = panel.querySelector(".laolao-web-gpt-panel__status");
    status.textContent = !active ? "已关闭" : (info?.status || "尚未向网页 GPT 发送");
    status.dataset.tone = !active ? "off" : (info?.tone || "idle");
    const toggleInput = panel.querySelector(".laolao-web-gpt-panel__toggle");
    toggleInput.setAttribute("aria-checked", String(active));
    toggleInput.classList.toggle("is-active", active);
    const list = panel.querySelector(".laolao-web-gpt-panel__list");
    if (!events.length) {
      list.innerHTML = '<div class="laolao-web-gpt-panel__empty"><strong>还没有协作记录</strong><span>发送后会在这里显示结果。</span></div>';
      renderConnection();
      return;
    }
    const entry = events[events.length - 1];
    const meta = stageInfo(entry.stage);
    const retiredInternalWorkspace = entry.stage === "sent"
      && /Codex with ChatGPT · workspace(?:-project|-thinking|-learning|-unrestricted)?/i.test(String(entry.text || ""));
    const article = document.createElement("details");
    article.className = "laolao-web-gpt-event";
    article.dataset.stage = entry.stage;
    if (retiredInternalWorkspace) article.dataset.retired = "true";
    const head = document.createElement("summary");
    const label = document.createElement("strong");
    label.textContent = retiredInternalWorkspace ? "历史记录" : entry.label || meta.label;
    const preview = document.createElement("span");
    preview.className = "laolao-web-gpt-event__preview";
    preview.textContent = compactEventPreview(entry, retiredInternalWorkspace);
    const time = document.createElement("time");
    time.textContent = formatTime(entry.at);
    head.append(label, preview, time);
    const body = document.createElement("pre");
    const eventText = entry.text || (entry.stage === "queued" ? "已挂载协作指令，尚未向网页 GPT 发送文字。" : "没有可显示的文字");
    body.textContent = retiredInternalWorkspace
      ? `【修复前历史记录】现在已经禁止读取碧琪记忆和内部工作区。\n\n${eventText}`
      : eventText;
    article.append(head, body);
    const total = Math.max(events.length, Number(activity?.totalEvents) || 0);
    const pager = document.createElement("nav");
    pager.className = "laolao-web-gpt-panel__pager";
    pager.innerHTML = `<button type="button" data-page="older" ${activityOffset >= total - 1 ? "disabled" : ""}>较早</button><span>${Math.min(activityOffset + 1, total)} / ${total}</span><button type="button" data-page="newer" ${activityOffset <= 0 ? "disabled" : ""}>较新</button>`;
    pager.addEventListener("click", (event) => {
      const direction = event.target.closest?.("button[data-page]")?.dataset?.page;
      if (!direction) return;
      activityOffset = Math.max(0, Math.min(total - 1, activityOffset + (direction === "older" ? 1 : -1)));
      void loadActivity();
    });
    list.replaceChildren(article, pager);
    renderConnection();
  };

  const loadActivity = async () => {
    const key = sessionKey();
    const request = rpc();
    if (!key || typeof request !== "function") return;
    try {
      activity = await request("pinkie.webGpt.activity.get", {sessionKey: key, limit: 1, offset: activityOffset}, 8_000);
      renderActivity();
      sync();
    } catch (error) {
      if (panel && !panel.hidden) {
        const status = panel.querySelector(".laolao-web-gpt-panel__status");
        status.textContent = error?.message || "协作记录暂时不可用";
        status.dataset.tone = "failed";
      }
    }
  };

  const loadConnection = async () => {
    const request = rpc();
    if (!sessionKey() || typeof request !== "function") return;
    connectionBusy = true;
    renderConnection();
    try {
      connection = await request("pinkie.webGpt.connection.get", connectionParams(), 35_000);
    } catch (error) {
      connection = {...connection, error: error?.message || "连接状态暂时不可用"};
    } finally {
      connectionBusy = false;
      renderConnection();
    }
    return connection;
  };

  // A green toggle only means that this session opted in. It must never be
  // mistaken for a working connector: a quick tunnel may have changed after
  // restart, and an OAuth token is deliberately scoped to one user project.
  // Start the bridge for the selected project on demand, then refuse to send
  // the user's request until that exact project has a live read-only grant.
  const hasLiveProjectConnector = (value) => value?.projectRequired !== true
    && value?.bridge?.publicReady === true
    && Number(value?.bridge?.tokenCount || 0) > 0;

  const ensureCollaborationConnection = async () => {
    const request = rpc();
    if (!sessionKey() || typeof request !== "function") {
      throw new Error("网页 GPT 协作服务还没连接好");
    }
    if (!connection) await loadConnection();
    if (connection?.projectRequired === true) {
      throw new Error("当前会话还没有绑定项目；网页 GPT 不会读取碧琪记忆或内部工作区");
    }
    if (connection?.bridge?.publicReady !== true) {
      connectionBusy = true;
      renderConnection();
      try {
        connection = await request("pinkie.webGpt.connection.start", connectionParams(), 125_000);
      } finally {
        connectionBusy = false;
        renderConnection();
      }
    }
    if (connection?.bridge?.publicReady !== true) {
      throw new Error("当前项目的安全连接没有建立，已阻止向网页 GPT 发送任务");
    }
    if (!hasLiveProjectConnector(connection)) {
      throw new Error("当前项目还没有完成网页 GPT 的只读配对。双击网页 GPT 图标，生成新配对后在“管理连接器”完成授权");
    }
    return connection;
  };

  const connectionAction = async (method, params = {}, success = "操作完成") => {
    const request = rpc();
    if (typeof request !== "function" || connectionBusy) return;
    connectionBusy = true;
    connection = {...connection, error: ""};
    renderConnection();
    try {
      connection = await request(method, connectionParams(params), 125_000);
      toast(success);
    } catch (error) {
      connection = {...connection, error: error?.message || "操作失败"};
      toast(error?.message || "网页 GPT 连接操作失败");
    } finally {
      connectionBusy = false;
      renderConnection();
    }
  };

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast("配对码已复制");
    } catch { toast("复制失败，请手动选择配对码"); }
  };

  const closeConfirmation = () => {
    pendingConfirmation = null;
    const box = panel?.querySelector(".laolao-web-gpt-connection__confirm");
    if (box) box.hidden = true;
  };

  const askConfirmation = (message, label, action) => {
    const box = panel?.querySelector(".laolao-web-gpt-connection__confirm");
    if (!box) return;
    box.querySelector("p").textContent = message;
    box.querySelector('[data-action="confirm-apply"]').textContent = label;
    pendingConfirmation = action;
    box.hidden = false;
  };

  const closePanel = () => {
    if (!panel) return;
    panel.hidden = true;
    for (const button of $$("." + BUTTON_CLASS)) button.setAttribute("aria-expanded", "false");
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = null;
  };

  const ensurePanel = () => {
    if (panel?.isConnected) return panel;
    panel = document.createElement("aside");
    panel.className = "laolao-web-gpt-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "网页 GPT 协作记录");
    panel.innerHTML = `
      <header class="laolao-web-gpt-panel__head">
        <div class="laolao-web-gpt-panel__title"><strong>网页 GPT</strong><span class="laolao-web-gpt-panel__status" data-tone="idle">尚未发送</span></div>
        <div class="laolao-web-gpt-panel__head-actions">
          <button type="button" class="laolao-web-gpt-panel__toggle" role="switch" aria-label="本会话网页协作" aria-checked="false"><i></i></button>
          <button type="button" class="laolao-web-gpt-panel__close" aria-label="关闭协作记录">×</button>
        </div>
      </header>
      <details class="laolao-web-gpt-connection">
        <summary><span>连接与账号</span><em class="laolao-web-gpt-connection__state" data-tone="off">尚未检查</em></summary>
        <div class="laolao-web-gpt-connection__body">
          <dl>
            <div><dt>工作区</dt><dd data-field="workspace">当前模式工作区</dd></div>
            <div><dt>连接器</dt><dd data-field="connector">尚未配对</dd></div>
            <div><dt>ChatGPT 账号</dt><dd data-field="account">由右侧 ChatGPT 页面显示</dd></div>
          </dl>
          <p>碧琪不会读取密码或冒充显示邮箱。换号只清除内置浏览器里的 ChatGPT / OpenAI 登录，不动其他网站、聊天记录、项目、权限和本机配置。</p>
          <div class="laolao-web-gpt-connection__pairing" hidden><div><span></span><code></code></div><button type="button" data-action="copy-pair">复制配对码</button></div>
          <div class="laolao-web-gpt-connection__actions">
            <button type="button" data-action="open-chatgpt">打开 ChatGPT</button>
            <button type="button" data-action="manage-connectors">管理连接器</button>
            <button type="button" data-action="switch-account">更换账号</button>
            <button type="button" data-action="start">启动桥接</button>
            <button type="button" data-action="pair" hidden>生成新配对</button>
            <button type="button" data-action="refresh">检查连接</button>
          </div>
          <div class="laolao-web-gpt-connection__maintenance">
            <button type="button" data-action="clear-conversation">忘记网页对话绑定</button>
            <button type="button" data-action="unpair">断开当前连接器授权</button>
          </div>
          <div class="laolao-web-gpt-connection__confirm" hidden><p></p><div><button type="button" data-action="confirm-cancel">取消</button><button type="button" data-action="confirm-apply">确认</button></div></div>
          <p class="laolao-web-gpt-connection__error" hidden></p>
        </div>
      </details>
      <main class="laolao-web-gpt-panel__list"></main>`;
    panel.querySelector(".laolao-web-gpt-panel__close").addEventListener("click", closePanel);
    panel.querySelector(".laolao-web-gpt-panel__toggle").addEventListener("click", () => {
      toggle();
      renderActivity();
    });
    panel.querySelector(".laolao-web-gpt-connection").addEventListener("toggle", (event) => {
      if (event.currentTarget.open && !connection) void loadConnection();
    });
    panel.querySelector(".laolao-web-gpt-connection").addEventListener("click", (event) => {
      const action = event.target.closest?.("button[data-action]")?.dataset?.action;
      if (!action) return;
      if (action === "confirm-cancel") { closeConfirmation(); return; }
      if (action === "confirm-apply") {
        const run = pendingConfirmation;
        closeConfirmation();
        if (typeof run === "function") run();
        return;
      }
      if (action === "open-chatgpt") {
        const bridge = browserBridge();
        if (bridge) {
          void ensureChatGPTReady()
            .then((snapshot) => {
              if (snapshot?.recoveredFromStaleConversation) toast("原网页会话已失效，已自动回到 ChatGPT 新会话");
            })
            .catch((error) => toast(error?.message || "ChatGPT 页面没有就绪"));
        } else window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
      } else if (action === "manage-connectors") {
        const bridge = browserBridge();
        if (bridge) bridge.postMessage({action: "open", url: "https://chatgpt.com/plugins"});
        else window.open("https://chatgpt.com/plugins", "_blank", "noopener,noreferrer");
      } else if (action === "switch-account") {
        askConfirmation(
          "只退出内置浏览器里的 ChatGPT / OpenAI 登录。碧琪聊天、项目、权限和其他网站账号都不会删除。",
          "退出并换号",
          () => {
            const bridge = browserBridge();
            if (!bridge) {
              toast("网页版环境不能单独清理内置登录，请在 ChatGPT 页面手动退出");
              window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
              return;
            }
            bridge.postMessage({action: "reset-chatgpt-session"});
            toast("正在清理内置 ChatGPT 登录并打开登录页");
          },
        );
      } else if (action === "start") {
        void connectionAction("pinkie.webGpt.connection.start", {}, "网页 GPT 本地桥接已启动");
      } else if (action === "pair") {
        void connectionAction("pinkie.webGpt.connection.pair", {}, "已生成新的临时配对码");
      } else if (action === "refresh") {
        void loadConnection();
      } else if (action === "copy-pair") {
        void copyText(connection?.pairing?.pairingCode);
      } else if (action === "clear-conversation") {
        askConfirmation(
          "只忘记当前工作区保存的网页 ChatGPT 对话地址，项目和聊天内容不会删除。",
          "忘记绑定",
          () => void connectionAction("pinkie.webGpt.connection.clearConversation", {}, "已忘记当前网页对话绑定"),
        );
      } else if (action === "unpair") {
        askConfirmation(
          "这会立即撤销当前工作区连接器的访问令牌，但不会删除碧琪数据或 ChatGPT 对话。",
          "确认断开",
          () => void connectionAction("pinkie.webGpt.connection.unpair", {confirm: "UNPAIR_CURRENT_WEB_GPT"}, "当前工作区连接器授权已断开"),
        );
      }
    });
    document.body.append(panel);
    return panel;
  };

  const openPanel = () => {
    ensurePanel();
    panel.hidden = false;
    for (const button of $$("." + BUTTON_CLASS)) button.setAttribute("aria-expanded", "true");
    renderActivity();
    void loadActivity();
    void loadConnection();
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = setInterval(loadActivity, 1_500);
  };

  const sync = () => {
    const active = enabled();
    const events = Array.isArray(activity?.events) ? activity.events : [];
    const latest = events[events.length - 1];
    for (const button of $$("." + BUTTON_CLASS)) {
      button.classList.toggle("is-active", active);
      button.dataset.stage = latest?.stage || (active ? "idle" : "off");
      button.setAttribute("aria-pressed", String(active));
      const hint = active
        ? "网页 GPT 协作已开启：单击关闭，双击管理"
        : "单击开启网页 GPT 协作，双击管理";
      button.setAttribute("aria-label", hint);
      button.setAttribute("title", hint);
    }
  };

  const syncSession = () => {
    const next = sessionKey();
    if (next === observedSessionKey) { sync(); return; }
    observedSessionKey = next;
    activityOffset = 0;
    activity = null;
    connection = null;
    arming = null;
    renderActivity();
    sync();
    if (panel && !panel.hidden && next) {
      void loadActivity();
      if (panel.querySelector(".laolao-web-gpt-connection")?.open) void loadConnection();
    }
  };

  const toggle = () => {
    const next = !enabled();
    try {
      if (next) localStorage.setItem(storageKey(), "1");
      else localStorage.removeItem(storageKey());
    } catch {}
    sync();
    toast(next ? "网页 GPT 协作已开启，只作用于这个会话" : "网页 GPT 协作已关闭，恢复普通聊天");
  };

  const appendActivity = async (stage, label, text) => {
    const request = rpc();
    const key = sessionKey();
    if (!key || typeof request !== "function") return;
    activityOffset = 0;
    activity = await request("pinkie.webGpt.activity.append", {sessionKey: key, stage, label, text, limit: 1, offset: 0}, 12_000);
    renderActivity();
    sync();
  };

  const truncateUtf8 = (value, maxBytes = 520) => {
    const source = String(value || "").replace(/\s+/g, " ").trim();
    const encoder = new TextEncoder();
    if (encoder.encode(source).length <= maxBytes) return source;
    let low = 0;
    let high = source.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (encoder.encode(source.slice(0, middle)).length <= maxBytes) low = middle;
      else high = middle - 1;
    }
    return `${source.slice(0, low).trim()}…`;
  };

  const buildControlMessage = (preview) => {
    const projectWorkspace = String(connection?.workspace || selectedWorkspace() || "").trim();
    const connector = String(
      connection?.conversation?.connectorName
      || connection?.diagnostics?.chatgptRepair?.connectorName
      || connection?.bridge?.connectorName
      || "Codex with ChatGPT",
    ).slice(0, 120);
    const instruction = projectWorkspace
      ? `Use the connected "${connector}" connector to inspect only the files needed inside the bound user project ${JSON.stringify(projectWorkspace)}. First call workspace_info, then inspect only directly relevant files. Never inspect Pinkie/OpenClaw memory, persona, configuration, or hidden agent workspaces. Return a concise executable plan for Codex in normal prose.`
      : "No user project folder is bound. Do not use any connector and do not inspect, request, or infer local files, Pinkie memory, persona, configuration, or hidden agent workspaces. Analyze only the user request and return a concise plan in normal prose.";
    return [
      "请协助碧琪分析下面这项用户任务。",
      "",
      "用户任务：",
      truncateUtf8(preview),
      "",
      "工作要求：",
      instruction,
      "",
      "不要输出 C2C、STATE、TASK_ID、ITERATION 或其他协议标签；直接给计划。",
    ].join("\n").slice(0, 980);
  };

  const sameConversation = (current, expected) => {
    if (!expected) return /^https:\/\/chatgpt\.com(?:\/|$)/i.test(String(current || ""));
    try {
      const currentUrl = new URL(current);
      const expectedUrl = new URL(expected);
      if (expectedUrl.pathname === "/") return currentUrl.hostname === "chatgpt.com" || currentUrl.hostname.endsWith(".chatgpt.com");
      return currentUrl.pathname === expectedUrl.pathname;
    } catch { return false; }
  };

  const ensureChatGPTReady = async () => {
    const bridge = browserBridge();
    if (!bridge) throw new Error("请使用碧琪 App 的内置浏览器运行网页协作");
    if (!connection) await loadConnection();
    const home = "https://chatgpt.com/";
    const target = connection?.conversation?.chatUrl || home;
    const hasSavedConversation = target !== home;
    let snapshot = null;
    try { snapshot = await browserControl("snapshot"); } catch {}
    if (!snapshot?.ready || !sameConversation(snapshot?.url, target)) {
      bridge.postMessage({action: "open", url: target});
    }
    const targetAttempts = hasSavedConversation ? 20 : 60;
    for (let attempt = 0; attempt < targetAttempts; attempt += 1) {
      await wait(attempt ? 400 : 120);
      try { snapshot = await browserControl("snapshot"); } catch { snapshot = null; }
      if (snapshot?.ready && sameConversation(snapshot?.url, target)) return snapshot;
    }
    if (hasSavedConversation) {
      bridge.postMessage({action: "open", url: home});
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await wait(attempt ? 400 : 120);
        try { snapshot = await browserControl("snapshot"); } catch { snapshot = null; }
        if (snapshot?.ready && sameConversation(snapshot?.url, home)) {
          return {...snapshot, recoveredFromStaleConversation: true};
        }
      }
    }
    throw new Error("ChatGPT 输入框没有就绪，请先在右侧完成登录");
  };

  const bindConversation = async (url) => {
    if (!url || connection?.conversation?.chatUrl === url) return;
    const request = rpc();
    if (typeof request !== "function") return;
    try {
      connection = await request("pinkie.webGpt.connection.bindConversation", connectionParams({url}), 20_000);
      renderConnection();
    } catch (error) {
      await appendActivity("note", "网页会话未保存", error?.message || "保存网页会话地址失败");
    }
  };

  const waitForChatGPTReply = async (baseline) => {
    let lastText = "";
    let stable = 0;
    let boundUrl = "";
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await wait(attempt < 8 ? 500 : 1_000);
      const snapshot = await browserControl("snapshot");
      if (snapshot.conversationUrl && snapshot.conversationUrl !== boundUrl) {
        boundUrl = snapshot.conversationUrl;
        await bindConversation(boundUrl);
      }
      const text = String(snapshot.latestAssistant || "").trim();
      if (Number(snapshot.assistantCount || 0) > Number(baseline || 0) && text) {
        stable = !snapshot.generating && text === lastText ? stable + 1 : 0;
        lastText = text;
        if (!snapshot.generating && stable >= 1) return text;
      }
    }
    throw new Error("等待网页 ChatGPT 回复超时");
  };

  const prepare = async (preview = "") => {
    if (!enabled()) return true;
    if (!String(preview || "").trim()) {
      preview = $(".agent-chat__composer-combobox textarea")?.value || "";
    }
    const key = sessionKey();
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!key || typeof rpc !== "function") throw new Error("网页 GPT 协作服务还没连接好");
    if (!arming) {
      arming = (async () => {
        await ensureCollaborationConnection();
        const result = await rpc("pinkie.webGpt.arm", {sessionKey: key, preview: String(preview || "").slice(0, 16_000)}, 12_000);
          if (!result?.armed) throw new Error("本轮网页 GPT 协作没有挂载成功");
          if (result.activity) activity = result.activity;
          renderActivity();
          sync();
        try {
          const ready = await ensureChatGPTReady();
          if (ready?.recoveredFromStaleConversation) {
            await appendActivity("note", "网页会话已恢复", "原来保存的 ChatGPT 会话已失效，已自动回到首页；本轮发送后会绑定新的网页会话。");
          }
          const controlMessage = buildControlMessage(preview);
          const sent = await browserControl("send", {text: controlMessage}, 30_000);
          if (!sent?.sent) throw new Error("网页 ChatGPT 没有确认发送");
          await appendActivity("sent", "发往网页 GPT", controlMessage);
          toast("已发往右侧 ChatGPT，正在等网页回复");
          const reply = await waitForChatGPTReply(sent.assistantCount);
          await appendActivity("received", "网页 GPT 返回", reply);
          const injected = await rpc("pinkie.webGpt.inject", {sessionKey: key, plan: reply}, 12_000);
          if (!injected?.injected) throw new Error("网页回复没有带回当前碧琪会话");
          toast("网页 GPT 已回复，碧琪继续执行");
          return true;
        } catch (error) {
          const message = error?.message || "网页 GPT 协作失败";
          try { await appendActivity("failed", "协作失败", message); } catch {}
          toast(`${message}，已自动改用普通聊天`);
          return false;
        }
      })()
        .finally(() => { arming = null; });
    }
    return arming;
  };
  window.__laolaoWebGptPrepareNextTurn = prepare;
  window.__laolaoWebGptAllowNextSend = () => { bypassOnce = true; };

  const render = () => {
    const actions = $(".agent-chat__composer-actions");
    if (!actions?.isConnected) return;
    if (actions.querySelector("." + BUTTON_CLASS)) { sync(); return; }
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute("aria-label", "单击开启网页 GPT 协作，双击管理");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="4.2" width="17.6" height="14.6" rx="4.2"/>
        <path d="M7.2 8.1h.01M10.1 8.1h.01M13 8.1h.01M6.8 12.2h6.7M6.8 15.2h4.1"/>
        <path class="laolao-web-gpt-collab__spark" d="M17.2 10.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>
      </svg><span>网页 GPT 协作</span>`;
    button.addEventListener("click", () => {
      if (buttonClickTimer) clearTimeout(buttonClickTimer);
      buttonClickTimer = setTimeout(() => {
        buttonClickTimer = null;
        toggle();
      }, 230);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (buttonClickTimer) clearTimeout(buttonClickTimer);
      buttonClickTimer = null;
      openPanel();
    });
    actions.appendChild(button);
    sync();
  };

  const realSendButton = (target) => {
    const button = target?.closest?.(".chat-send-btn");
    if (!button || button.disabled || button.hasAttribute("disabled")) return null;
    if (["chat-send-btn--stop", "chat-send-btn--voice", "chat-send-btn--laolao-dictation", "chat-send-btn--queue"]
      .some((name) => button.classList.contains(name))) return null;
    return /send|发送/i.test(button.getAttribute("aria-label") || "") ? button : null;
  };
  const through = async (send, preview) => {
    try {
      await prepare(preview);
      bypassOnce = true;
      send();
    } catch (error) {
      toast(`${error?.message || "网页 GPT 协作暂时不可用"}，已自动改用普通聊天`);
      bypassOnce = true;
      send();
    } finally {
      queueMicrotask(() => { bypassOnce = false; });
    }
  };

  document.addEventListener("click", (event) => {
    if (bypassOnce) { bypassOnce = false; return; }
    if (!enabled()) return;
    // 极致思考会先挂两种指令，再放行同一次发送；避免两个拦截器互相重放。
    if ($(".laolao-deep-think-btn.is-selected")) return;
    const button = realSendButton(event.target);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const preview = $(".agent-chat__composer-combobox textarea")?.value || "";
    void through(() => button.click(), preview);
  }, true);
  document.addEventListener("keydown", (event) => {
    if (bypassOnce) { bypassOnce = false; return; }
    if (!enabled() || $(".laolao-deep-think-btn.is-selected")) return;
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const input = event.target?.closest?.(".agent-chat__composer-combobox textarea");
    if (!input?.value?.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void through(() => input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true,
    })), input.value);
  }, true);

  const style = document.createElement("style");
  style.id = "laolao-web-gpt-collab-style";
  style.textContent = `
.laolao-web-gpt-collab{position:relative;display:inline-grid;place-items:center;width:30px;height:30px;padding:0;margin:0 3px;border:1px solid transparent;border-radius:999px;background:transparent;color:#a3426c;cursor:pointer;box-shadow:none;transition:background .18s ease,border-color .18s ease,color .18s ease,transform .12s ease,box-shadow .18s ease}
.laolao-web-gpt-collab:hover,.laolao-web-gpt-collab.is-active{background:rgba(255,248,252,.56);border-color:rgba(211,91,142,.32);box-shadow:inset 0 1px rgba(255,255,255,.5),0 3px 10px rgba(196,71,128,.12)}
.laolao-web-gpt-collab:active{transform:scale(.95)}
.laolao-web-gpt-collab svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}
.laolao-web-gpt-collab .laolao-web-gpt-collab__spark{fill:rgba(202,78,132,.12)}
.laolao-web-gpt-collab.is-active::after{content:"";position:absolute;right:1px;top:1px;width:5px;height:5px;border:1px solid rgba(255,255,255,.9);border-radius:50%;background:#d04e87;box-shadow:0 2px 5px rgba(196,71,128,.22)}
.laolao-web-gpt-collab[data-stage="sent"]::after{background:#d89b46}
.laolao-web-gpt-collab[data-stage="received"]::after{background:#45aa85}
.laolao-web-gpt-collab[data-stage="failed"]::after{background:#d14d61}
.laolao-web-gpt-collab span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.laolao-web-gpt-panel{position:fixed;z-index:10070;top:58px;right:14px;bottom:14px;display:flex;flex-direction:column;width:min(356px,calc(100vw - 28px));box-sizing:border-box;overflow:hidden;border:1px solid rgba(214,111,155,.2);border-radius:20px;color:#633a50;background:rgba(255,250,253,.94);box-shadow:0 22px 58px rgba(92,37,65,.16),inset 0 1px rgba(255,255,255,.82);backdrop-filter:blur(26px) saturate(116%);-webkit-backdrop-filter:blur(26px) saturate(116%)}
.laolao-web-gpt-panel[hidden]{display:none!important}
.laolao-web-gpt-panel__head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(213,112,154,.12)}
.laolao-web-gpt-panel__title{display:flex;align-items:baseline;min-width:0;gap:8px}
.laolao-web-gpt-panel__title strong{font-size:13px;font-weight:680;color:#583347}
.laolao-web-gpt-panel__head-actions{display:flex;align-items:center;gap:6px}
.laolao-web-gpt-panel__close{display:grid;place-items:center;width:29px;height:29px;padding:0;border:0;border-radius:9px;color:#a04a70;background:transparent;font:400 23px/1 -apple-system,sans-serif;cursor:pointer}
.laolao-web-gpt-panel__close:hover{background:rgba(240,208,223,.42)}
.laolao-web-gpt-panel__status{font-size:10.5px;color:#9a7788}
.laolao-web-gpt-panel__status[data-tone="sending"],.laolao-web-gpt-panel__status[data-tone="waiting"]{color:#a67637}
.laolao-web-gpt-panel__status[data-tone="received"]{color:#397f69}
.laolao-web-gpt-panel__status[data-tone="failed"]{color:#b43e57}
.laolao-web-gpt-panel__toggle{position:relative;width:34px;height:20px;padding:0;border:1px solid rgba(191,100,140,.22);border-radius:999px;background:#eadde4;cursor:pointer;transition:background .16s ease}
.laolao-web-gpt-panel__toggle i{position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(85,36,59,.18);transition:transform .16s ease}
.laolao-web-gpt-panel__toggle.is-active{background:#cf5a8e}
.laolao-web-gpt-panel__toggle.is-active i{transform:translateX(14px)}
.laolao-web-gpt-connection{margin:9px 12px 8px;border:1px solid rgba(214,112,155,.13);border-radius:12px;background:rgba(255,255,255,.3);overflow:hidden}
.laolao-web-gpt-connection>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;list-style:none;cursor:pointer;user-select:none}
.laolao-web-gpt-connection>summary::-webkit-details-marker{display:none}
.laolao-web-gpt-connection>summary span{font-size:11.5px;font-weight:650;color:#744258}
.laolao-web-gpt-connection>summary em{font-size:10px;font-style:normal;color:#9a7788}
.laolao-web-gpt-connection>summary em[data-tone="received"]{color:#397f69}.laolao-web-gpt-connection>summary em[data-tone="waiting"]{color:#a67637}.laolao-web-gpt-connection>summary em[data-tone="failed"]{color:#b43e57}
.laolao-web-gpt-connection[open]>summary{border-bottom:1px solid rgba(214,112,155,.1)}
.laolao-web-gpt-connection__body{padding:11px 12px 12px}
.laolao-web-gpt-connection dl{display:grid;gap:7px;margin:0 0 9px}.laolao-web-gpt-connection dl div{display:grid;grid-template-columns:66px minmax(0,1fr);gap:8px}.laolao-web-gpt-connection dt{color:#a27c8e;font-size:10px}.laolao-web-gpt-connection dd{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#654052;font-size:10.5px}
.laolao-web-gpt-connection__body>p{margin:0 0 10px;color:#9a7889;font-size:9.8px;line-height:1.55}
.laolao-web-gpt-connection__actions{display:flex;flex-wrap:wrap;gap:6px}.laolao-web-gpt-connection button{min-height:27px;padding:0 9px;border:1px solid rgba(201,87,137,.2);border-radius:9px;color:#8e3d63;background:rgba(255,250,253,.7);font-size:10px;cursor:pointer}.laolao-web-gpt-connection button:hover{background:rgba(247,224,235,.72)}.laolao-web-gpt-connection button:disabled{opacity:.5;cursor:wait}
.laolao-web-gpt-connection__maintenance{display:flex;gap:10px;margin-top:10px}.laolao-web-gpt-connection__maintenance button{min-height:0;padding:0;border:0;border-radius:0;background:transparent;color:#a47d8f;font-size:9.6px;text-decoration:underline;text-underline-offset:2px}.laolao-web-gpt-connection__maintenance button:last-child{color:#ad5266}
.laolao-web-gpt-connection__confirm{margin-top:10px;padding:10px;border:1px solid rgba(201,87,137,.16);border-radius:10px;background:rgba(250,232,240,.58)}.laolao-web-gpt-connection__confirm[hidden]{display:none}.laolao-web-gpt-connection__confirm p{margin:0 0 9px;color:#744e61;font-size:9.8px;line-height:1.55}.laolao-web-gpt-connection__confirm>div{display:flex;justify-content:flex-end;gap:6px}.laolao-web-gpt-connection__confirm [data-action="confirm-apply"]{color:#fff;background:#bd527f;border-color:#bd527f}
.laolao-web-gpt-connection__pairing{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;padding:9px 10px;border-radius:10px;background:rgba(242,222,232,.48)}.laolao-web-gpt-connection__pairing[hidden]{display:none}.laolao-web-gpt-connection__pairing>div{display:grid;gap:3px}.laolao-web-gpt-connection__pairing span{color:#9a7889;font-size:9px}.laolao-web-gpt-connection__pairing code{color:#713f57;font-size:12px;font-weight:700;letter-spacing:.08em}
.laolao-web-gpt-connection__error{margin:9px 0 0!important;color:#b43e57!important}
.laolao-web-gpt-panel__list{min-height:0;overflow:auto;padding:0 12px 12px;overscroll-behavior:contain}
.laolao-web-gpt-panel__empty{display:grid;place-items:center;gap:7px;min-height:170px;padding:18px;text-align:center;color:#a58696}
.laolao-web-gpt-panel__empty strong{font-size:12px;color:#795266}
.laolao-web-gpt-panel__empty span{max-width:260px;font-size:10.5px;line-height:1.65}
.laolao-web-gpt-event{border:1px solid rgba(211,108,151,.12);border-radius:11px;background:rgba(255,255,255,.38);overflow:hidden}
.laolao-web-gpt-event[data-stage="sent"]{border-left:3px solid #d5a04f}
.laolao-web-gpt-event[data-stage="received"]{border-left:3px solid #65a991}
.laolao-web-gpt-event[data-stage="failed"]{border-left:3px solid #d65b70}
.laolao-web-gpt-event[data-retired="true"]{opacity:.76}
.laolao-web-gpt-event>summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 10px;list-style:none;cursor:pointer;user-select:none}
.laolao-web-gpt-event>summary::-webkit-details-marker{display:none}
.laolao-web-gpt-event>summary strong{font-size:10.5px;font-weight:680;color:#7f3f5e;white-space:nowrap}
.laolao-web-gpt-event__preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#775e6b;font-size:10.5px}
.laolao-web-gpt-event>summary time{font-size:9.2px;color:#a98a99}
.laolao-web-gpt-event[open]>summary{border-bottom:1px solid rgba(211,108,151,.1)}
.laolao-web-gpt-event pre{max-height:240px;margin:0;padding:10px 11px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#593c4b;font:10.5px/1.58 ui-monospace,SFMono-Regular,Menlo,Monaco,"PingFang SC",monospace;background:rgba(255,255,255,.2)}
.laolao-web-gpt-panel__pager{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 0 0;color:#9a7889}.laolao-web-gpt-panel__pager button{min-width:42px;height:24px;padding:0 8px;border:1px solid rgba(201,87,137,.14);border-radius:8px;color:#8e516e;background:rgba(255,255,255,.42);font-size:9.5px;cursor:pointer}.laolao-web-gpt-panel__pager button:disabled{opacity:.34;cursor:default}.laolao-web-gpt-panel__pager span{font-size:9.5px;font-variant-numeric:tabular-nums}
@media(max-width:720px){.laolao-web-gpt-panel{top:50px;right:8px;bottom:8px;width:calc(100vw - 16px);border-radius:16px}}
@media(prefers-reduced-motion:reduce){.laolao-web-gpt-collab,.laolao-web-gpt-panel__toggle,.laolao-web-gpt-panel__toggle i{transition:none!important}}
`;
  document.head.appendChild(style);

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  };
  setInterval(() => { syncSession(); schedule(); }, 700);
  window.addEventListener("popstate", () => {
    requestAnimationFrame(syncSession);
  });
  window.addEventListener("laolao:sessions-changed", () => requestAnimationFrame(syncSession));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel && !panel.hidden) closePanel();
  });
  observedSessionKey = sessionKey();
  render();
})();
