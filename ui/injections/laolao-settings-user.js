/* 来啦～老弟 · 面向日常使用的设置页。
   新界面只创建自己的节点；原生设置仍由 OpenClaw/Lit 管理。 */
(() => {
  "use strict";
  if (window.__laolaoUserSettingsPageLoaded) return;
  window.__laolaoUserSettingsPageLoaded = true;

  const MODE_KEY = "laolao:active-mode";
  const MODE_OPTIONS = [
    ["chat", "唠嗑"], ["project", "项目"], ["thinking", "想法"],
    ["learning", "学习"], ["unrestricted", "无限制"],
  ];
  const PRESET_MAP = Object.freeze({
    chat: Object.freeze({profile: "minimal", execSecurity: "deny", browserEnabled: false}),
    work: Object.freeze({profile: "coding", execSecurity: "allowlist", browserEnabled: false}),
    open: Object.freeze({profile: "full", execSecurity: "full", browserEnabled: true}),
  });
  const PRESET_CARDS = Object.freeze([
    Object.freeze({id: "chat", title: "只聊天", detail: "不读写文件、不运行命令。"}),
    Object.freeze({id: "work", title: "能帮忙干活", detail: "可读写项目文件、运行命令。"}),
    Object.freeze({id: "open", title: "完全放开", detail: "再加上浏览器和控制电脑。"}),
  ]);
  const REASONING_OPTIONS = [["off", "关闭"], ["low", "浅"], ["medium", "中"], ["high", "深"]];
  const SPEED_OPTIONS = [["auto", "自动"], [true, "快速"], [false, "标准"]];
  const THEME_OPTIONS = [
    ["claw", "碧琪经典"], ["knot", "丝带柔粉"], ["dash", "彩虹点点"], ["custom", "自定义主题"],
  ];
  const THEME_MODE_OPTIONS = [["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]];
  const CHANNEL_LABELS = Object.freeze({
    telegram: "Telegram", discord: "Discord", slack: "Slack", whatsapp: "WhatsApp",
    signal: "Signal", imessage: "iMessage",
    "openclaw-weixin": "微信",
  });
  const MESSAGING_CONNECTIONS = Object.freeze({
    feishu: Object.freeze({
      label: "飞书", agentId: "learning", mode: "学习模式", prefix: "pinkie.feishu",
      hosts: Object.freeze(["accounts.feishu.cn", "accounts.larksuite.com", "open.feishu.cn", "open.larksuite.com"]),
      guide: "用手机飞书扫一扫，按手机上的提示确认。飞书聊天会单独保存。",
    }),
    qq: Object.freeze({
      label: "QQ", agentId: "project", mode: "项目模式", prefix: "pinkie.qq",
      hosts: Object.freeze(["q.qq.com"]), project: true, pairing: true,
      guide: "用手机 QQ 扫一扫，按手机上的提示连接机器人。QQ 聊天会单独保存。",
    }),
  });

  const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const copyObject = (value) => JSON.parse(JSON.stringify(value));
  const configFromSnapshot = (snapshot) => {
    for (const value of [snapshot?.sourceConfig, snapshot?.resolved, snapshot?.config]) {
      if (isObject(value)) return value;
    }
    return null;
  };
  const permissionValues = (config) => {
    const tools = isObject(config?.tools) ? config.tools : {};
    const exec = isObject(tools.exec) ? tools.exec : {};
    const browser = isObject(config?.browser) ? config.browser : {};
    return {
      profile: typeof tools.profile === "string" && tools.profile.trim() ? tools.profile.trim() : "full",
      execSecurity: typeof exec.security === "string" && exec.security.trim() ? exec.security.trim() : "allowlist",
      browserEnabled: browser.enabled !== false,
    };
  };
  const hasScopedToolOverrides = (config) => {
    const baseProfile = permissionValues(config).profile;
    const hasRules = (value) => isObject(value) && (
      (Array.isArray(value.allow) && value.allow.length > 0)
      || (Array.isArray(value.deny) && value.deny.length > 0)
      || (typeof value.profile === "string" && value.profile.trim() && value.profile.trim() !== baseProfile)
    );
    if (hasRules(config?.tools) || hasRules(config?.agents?.defaults?.tools)) return true;
    return Array.isArray(config?.agents?.list) && config.agents.list.some((agent) => hasRules(agent?.tools));
  };
  const matchingPreset = (config) => {
    if (hasScopedToolOverrides(config)) return null;
    const current = permissionValues(config);
    return Object.keys(PRESET_MAP).find((id) => {
      const preset = PRESET_MAP[id];
      return current.profile === preset.profile && current.execSecurity === preset.execSecurity
        && current.browserEnabled === preset.browserEnabled;
    }) || null;
  };
  const hostIsOutsideThisComputer = (host) => {
    const value = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (!value || value === "localhost" || value === "::1" || value === "0:0:0:0:0:0:0:1") return false;
    if (/^127(?:\.\d{1,3}){3}$/.test(value) || value.endsWith(".localhost")) return false;
    return true;
  };
  const hasExternalAddress = (value) => {
    if (typeof value !== "string" || !value.trim()) return false;
    try { return hostIsOutsideThisComputer(new URL(value).hostname); }
    catch { return hostIsOutsideThisComputer(value.split(":")[0]); }
  };
  const remoteAccessEnabled = (config, pageHost = "") => {
    const gateway = isObject(config?.gateway) ? config.gateway : {};
    const tailscale = isObject(gateway.tailscale) ? gateway.tailscale : {};
    const bind = String(gateway.bind || "").trim().toLowerCase();
    if (String(tailscale.mode || "").toLowerCase() === "funnel") return true;
    if (["lan", "tailnet", "0.0.0.0", "::", "all"].includes(bind)) return true;
    if (bind === "custom" && hostIsOutsideThisComputer(gateway.customBindHost || gateway.host)) return true;
    if (hostIsOutsideThisComputer(gateway.host) || hasExternalAddress(gateway.remote?.url)) return true;
    if (hasExternalAddress(gateway.remote?.address)) return true;
    if (hasExternalAddress(config?.mobile?.remoteUrl) || hasExternalAddress(gateway.mobile?.remoteUrl)) return true;
    return hostIsOutsideThisComputer(pageHost);
  };
  const authMode = (config) => {
    const auth = isObject(config?.gateway?.auth) ? config.gateway.auth : {};
    if (typeof auth.mode === "string" && auth.mode.trim()) return auth.mode.trim().toLowerCase();
    if (auth.password) return "password";
    if (auth.token) return "token";
    if (auth.trustedProxy) return "trusted-proxy";
    return "none";
  };

  // Small read-only test surface for the preset and exposure rules.
  window.__laolaoUserSettings = Object.freeze({
    presetMap: PRESET_MAP,
    presetCards: PRESET_CARDS,
    matchingPreset,
    permissionValues,
    hasScopedToolOverrides,
    remoteAccessEnabled,
    authMode,
    configFromSnapshot,
  });

  const state = {
    root: null, main: null, config: null, snapshot: null, models: [], activeModelGroup: "",
    modelButton: null, modelMenu: null, modelList: null, modelChoices: [], brandButtons: [],
    modeButtons: new Map(), reasoningButtons: new Map(), speedButtons: new Map(),
    presetButtons: new Map(), themeButtons: [], themeModeButtons: [], channelList: null,
    channelDisclosure: null, warning: null, version: null, usageValues: new Map(), statuses: new Map(),
    saveQueue: Promise.resolve(), lastRoute: "", lastView: "", initialized: false,
    wechat: null, feishu: null, qq: null,
  };

  const ownText = (parent, value) => {
    const text = String(value ?? "");
    let node = parent.firstChild;
    while (node && node.nodeType !== 3) node = node.nextSibling;
    if (node) node.nodeValue = text;
    else parent.append(document.createTextNode(text));
  };
  const element = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.append(document.createTextNode(String(text)));
    if (parent) parent.append(node);
    return node;
  };
  const button = (label, className, parent, onClick) => {
    const node = element("button", className || "pinkie-user-settings__button", parent, label);
    node.type = "button";
    if (onClick) node.addEventListener("click", onClick);
    return node;
  };
  const makeStatus = (parent, key) => {
    const node = element("p", "pinkie-user-settings__status", parent, "");
    node.setAttribute("aria-live", "polite");
    state.statuses.set(key, node);
    return node;
  };
  const setStatus = (key, message, kind = "") => {
    const node = state.statuses.get(key);
    if (!node) return;
    ownText(node, message);
    node.dataset.state = kind;
  };
  const setPressed = (node, pressed) => {
    node.setAttribute("aria-pressed", String(Boolean(pressed)));
    node.classList.toggle("is-selected", Boolean(pressed));
  };
  const row = (parent, title, hint = "") => {
    const item = element("div", "pinkie-user-settings__row", parent);
    const copy = element("div", "pinkie-user-settings__row-copy", item);
    element("span", "pinkie-user-settings__row-title", copy, title);
    if (hint) element("span", "pinkie-user-settings__hint", copy, hint);
    const control = element("div", "pinkie-user-settings__row-control", item);
    return {item, copy, control};
  };
  const segmented = (parent, entries, className, choose) => entries.map(([value, label]) => {
    const node = button(label, className || "pinkie-user-settings__choice", parent,
      () => choose(value, node));
    return [value, node];
  });
  const card = (parent, icon, title, hint = "") => {
    const section = element("section", "pinkie-user-settings__card", parent);
    const header = element("header", "pinkie-user-settings__card-header", section);
    element("span", "pinkie-user-settings__icon", header, icon).setAttribute("aria-hidden", "true");
    element("h3", "pinkie-user-settings__card-title", header, title);
    if (hint) element("p", "pinkie-user-settings__card-hint", section, hint);
    return section;
  };

  function buildPage() {
    if (state.root || !document.body) return;
    state.root = element("div", "pinkie-user-settings", document.body);
    state.root.id = "laolao-user-settings";
    state.root.hidden = true;
    const scroll = element("main", "pinkie-user-settings__scroll", state.root);
    const intro = element("div", "pinkie-user-settings__intro", scroll);
    element("h2", "pinkie-user-settings__title", intro, "碧琪的常用设置");
    element("p", "pinkie-user-settings__intro-copy", intro, "把常用的几件事调成顺手的样子。修改后会自动保存。");

    const modeCard = card(scroll, "🌈", "碧琪", "选择新建聊天时先进入的模式。" );
    const modeRow = row(modeCard, "默认模式", "会影响之后新建的聊天。" );
    const modeGroup = element("div", "pinkie-user-settings__segments pinkie-user-settings__segments--wrap", modeRow.control);
    for (const [value, label] of MODE_OPTIONS) {
      const node = button(label, "pinkie-user-settings__choice", modeGroup, () => saveDefaultMode(value));
      node.dataset.mode = value;
      state.modeButtons.set(value, node);
    }
    element("p", "pinkie-user-settings__soft-note", modeCard, "回复语气会跟随所选模式；目前没有单独的语气选项。" );
    makeStatus(modeCard, "mode");

    const modelCard = card(scroll, "🧠", "模型与思考", "选择碧琪默认使用的模型和回答节奏。" );
    const modelRow = row(modelCard, "默认模型", "显示名称来自可用模型目录。" );
    state.modelButton = button("正在读取…", "pinkie-user-settings__model-button", modelRow.control, () => {
      if (!state.models.length) return;
      state.modelMenu.hidden = !state.modelMenu.hidden;
    });
    state.modelButton.setAttribute("aria-haspopup", "listbox");
    state.modelMenu = element("div", "pinkie-user-settings__model-menu", modelCard);
    state.modelMenu.hidden = true;
    const brandRow = element("div", "pinkie-user-settings__brand-row", state.modelMenu);
    state.modelList = element("div", "pinkie-user-settings__model-list", state.modelMenu);
    state.modelList.setAttribute("role", "listbox");
    state.modelList.setAttribute("aria-label", "选择默认模型");
    state.brandButtons = [];
    state.modelChoices = [];
    const thinkingRow = row(modelCard, "思考深度");
    const thinkingGroup = element("div", "pinkie-user-settings__segments", thinkingRow.control);
    for (const [value, label] of REASONING_OPTIONS) {
      const node = button(label, "pinkie-user-settings__choice", thinkingGroup,
        () => saveConfigPatch([["agents", "defaults", "thinkingLevel", value]], "thinking"));
      state.reasoningButtons.set(value, node);
    }
    const speedRow = row(modelCard, "回复速度");
    const speedGroup = element("div", "pinkie-user-settings__segments", speedRow.control);
    for (const [value, label] of SPEED_OPTIONS) {
      const node = button(label, "pinkie-user-settings__choice", speedGroup,
        () => saveConfigPatch([["agents", "defaults", "fastMode", value]], "thinking"));
      state.speedButtons.set(String(value), node);
    }
    makeStatus(modelCard, "thinking");

    const permissionCard = card(scroll, "🛠️", "碧琪能做什么", "选择碧琪可以使用的能力。" );
    const presetGrid = element("div", "pinkie-user-settings__preset-grid", permissionCard);
    for (const preset of PRESET_CARDS) {
      const node = button("", "pinkie-user-settings__preset", presetGrid,
        () => savePreset(preset.id));
      node.dataset.preset = preset.id;
      element("span", "pinkie-user-settings__preset-title", node, preset.title);
      element("span", "pinkie-user-settings__preset-detail", node, preset.detail);
      state.presetButtons.set(preset.id, node);
    }
    state.customPreset = element("p", "pinkie-user-settings__custom", permissionCard,
      "当前配置：自定义（在高级设置中修改）");
    state.customPreset.hidden = true;
    element("p", "pinkie-user-settings__soft-note", permissionCard,
      "权限修改会按现有设置流程应用；如网关提示需要重启，重启后生效。" );
    makeStatus(permissionCard, "permissions");

    const appearanceCard = card(scroll, "🎨", "外观与声音", "只显示当前已有的外观设置。" );
    const themeRow = row(appearanceCard, "主题");
    const themeGroup = element("div", "pinkie-user-settings__segments pinkie-user-settings__segments--wrap", themeRow.control);
    for (const [value, label] of THEME_OPTIONS) {
      const node = button(label, "pinkie-user-settings__choice", themeGroup,
        () => chooseNativeTheme(value));
      state.themeButtons.push([value, node]);
    }
    const themeModeRow = row(appearanceCard, "明暗模式");
    const themeModeGroup = element("div", "pinkie-user-settings__segments", themeModeRow.control);
    for (const [value, label] of THEME_MODE_OPTIONS) {
      const node = button(label, "pinkie-user-settings__choice", themeModeGroup,
        () => chooseNativeThemeMode(value));
      state.themeModeButtons.push([value, node]);
    }
    element("p", "pinkie-user-settings__soft-note", appearanceCard,
      "语音输入和朗读可在聊天输入区使用；目前没有单独的开关。" );
    makeStatus(appearanceCard, "appearance");

    const connectionCard = card(scroll, "📱", "连接", "管理手机配对和已连接的应用。" );
    const pairRow = row(connectionCard, "手机版配对", "把手机连接到这台碧琪。" );
    const pairButton = button("配对移动设备", "pinkie-user-settings__button pinkie-user-settings__button--primary", pairRow.control,
      pairMobile);
    pairButton.setAttribute("aria-label", "配对移动设备");
    buildWechatConnection(connectionCard);
    buildMessagingConnection(connectionCard, "feishu");
    buildMessagingConnection(connectionCard, "qq");
    state.channelDisclosure = element("details", "pinkie-user-settings__channels", connectionCard);
    const channelSummary = element("summary", "pinkie-user-settings__channels-summary", state.channelDisclosure,
      "已连接的其他应用");
    state.channelCount = element("span", "pinkie-user-settings__count", channelSummary, "0");
    state.channelList = element("div", "pinkie-user-settings__channel-list", state.channelDisclosure);
    state.warning = element("div", "pinkie-user-settings__warning", connectionCard);
    state.warning.hidden = true;
    element("span", "pinkie-user-settings__warning-icon", state.warning, "⚠️").setAttribute("aria-hidden", "true");
    const warningCopy = element("div", "pinkie-user-settings__warning-copy", state.warning);
    element("p", "pinkie-user-settings__warning-text", warningCopy,
      "网关可能可以从本机以外连接，但还没有设置访问验证。请到高级设置检查。" );
    button("去高级设置", "pinkie-user-settings__button pinkie-user-settings__button--small", state.warning,
      () => openAdvanced("auth"));
    const connectionActions = element("div", "pinkie-user-settings__actions", connectionCard);
    button("连接更多", "pinkie-user-settings__text-button", connectionActions, () => openAdvanced("channels"));
    makeStatus(connectionCard, "connections");

    const aboutCard = card(scroll, "🎂", "关于与更新", "查看版本和本机累计用量。" );
    const versionRow = row(aboutCard, "版本");
    state.version = element("span", "pinkie-user-settings__value", versionRow.control, "读取中…");
    const updateRow = row(aboutCard, "检查更新");
    button("检查更新", "pinkie-user-settings__button", updateRow.control, checkForUpdates);
    makeStatus(aboutCard, "updates");
    const usageLabel = element("div", "pinkie-user-settings__usage-label", aboutCard, "用量统计");
    state.usageGrid = element("div", "pinkie-user-settings__usage-grid", aboutCard);
    for (const [key, label] of [["input", "输入"], ["output", "输出"], ["cacheRead", "缓存读"], ["requests", "请求"], ["cost", "累计估算"]]) {
      const chip = element("div", "pinkie-user-settings__usage-chip", state.usageGrid);
      element("span", "pinkie-user-settings__usage-name", chip, label);
      const value = element("strong", "pinkie-user-settings__usage-value", chip, "—");
      state.usageValues.set(key, value);
    }
    usageLabel.setAttribute("aria-hidden", "true");
    makeStatus(aboutCard, "usage");

    const footer = element("footer", "pinkie-user-settings__footer", scroll);
    button("高级设置（开发者）　›", "pinkie-user-settings__advanced-link", footer, () => openAdvanced());
    state.main = scroll;
    window.__pinkieCapabilities?.mount(scroll);
    window.dispatchEvent(new CustomEvent('pinkie:settings-ready', {detail: scroll}));
    state.initialized = true;
    syncPage();
    loadInitialData();
    syncVersion();
    syncAppearance();
    syncUsage();
  }

  function rpc() { return window.__laolaoSidebar?.gwRequest; }

  function buildWechatConnection(parent) {
    const wechatRow = row(parent, "微信", "手机微信聊，碧琪用无限模式回复。" );
    const actions = element("div", "pinkie-user-settings__actions", wechatRow.control);
    const connect = button("连接微信", "pinkie-user-settings__button pinkie-user-settings__button--primary", actions,
      () => wechatAction("pinkie.wechat.login.start"));
    connect.dataset.wechatAction = "connect";
    const panel = element("div", "pinkie-user-settings__wechat", parent);
    panel.hidden = true;
    const image = element("img", "pinkie-user-settings__wechat-qr", panel);
    image.alt = "用手机微信扫描，连接碧琪无限模式";
    image.width = 280; image.height = 280; image.hidden = true;
    const guide = element("p", "pinkie-user-settings__soft-note", panel,
      "用手机微信扫一扫，按手机上的提示确认。连接后只处理扫码者的消息。" );
    const link = element("a", "pinkie-user-settings__wechat-link", panel, "打开微信连接链接");
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.hidden = true;
    const verify = element("form", "pinkie-user-settings__wechat-verify", panel);
    verify.hidden = true;
    const label = element("label", "pinkie-user-settings__row-title", verify, "手机微信显示的数字");
    const code = element("input", "pinkie-user-settings__wechat-code", verify);
    code.id = "pinkie-wechat-code"; label.htmlFor = code.id;
    code.type = "text"; code.inputMode = "numeric"; code.autocomplete = "one-time-code";
    code.maxLength = 12; code.pattern = "[0-9]{1,12}"; code.required = true;
    const submit = button("确认数字", "pinkie-user-settings__button", verify);
    submit.type = "submit";
    verify.addEventListener("submit", event => {
      event.preventDefault();
      const value = code.value.trim();
      if (!/^\d{1,12}$/.test(value)) { setStatus("wechat", "请输入手机微信显示的数字。", "error"); return; }
      code.value = "";
      void wechatAction("pinkie.wechat.login.verify", {id: state.wechat.data?.job?.id, code: value});
    });
    const cancel = button("取消连接", "pinkie-user-settings__text-button", panel,
      () => wechatAction("pinkie.wechat.login.cancel", {id: state.wechat.data?.job?.id}));
    cancel.dataset.wechatAction = "cancel";
    const accounts = element("div", "pinkie-user-settings__wechat-accounts", parent);
    makeStatus(parent, "wechat");
    state.wechat = {connect, panel, image, guide, link, verify, code, submit, cancel, accounts,
      accountNodes: new Map(), data: null, pending: false, polling: false, lastPoll: 0, lastQr: "",
      requestEpoch: 0, stateStamp: JSON.stringify([null, null, null, []]), actionError: ""};
  }

  function renderWechat(data) {
    const ui = state.wechat;
    if (!ui || !data) return;
    ui.data = data;
    const job = data.job;
    const active = ["starting", "waiting", "confirming", "verify", "finishing"].includes(job?.state);
    const accounts = Array.isArray(data.accounts) ? data.accounts.filter(account => account.enabled && account.routeReady) : [];
    const stamp = JSON.stringify([job?.id, job?.state, job?.qrGeneration, accounts.map(account => account.accountId)]);
    if (stamp !== ui.stateStamp) { ui.actionError = ""; ui.stateStamp = stamp; }
    ui.connect.disabled = ui.pending || active;
    ownText(ui.connect, active ? "正在连接…" : accounts.length ? "重新扫码" : "连接微信");
    ui.panel.hidden = !active;
    ui.verify.hidden = job?.state !== "verify";
    ui.submit.disabled = ui.pending;
    ui.cancel.disabled = ui.pending || job?.state === "finishing";
    const qr = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(job?.qrDataUrl || "") ? job.qrDataUrl : "";
    if (qr && qr !== ui.lastQr) { ui.image.src = qr; ui.lastQr = qr; }
    ui.image.hidden = !qr || !active;
    let qrLink = "";
    try {
      const url = new URL(job?.qrUrl || "");
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        && ["weixin.qq.com", "wechat.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) qrLink = url.href;
    } catch { /* Only a recognized official QR link is clickable. */ }
    ui.link.hidden = !qrLink || !active;
    if (qrLink) ui.link.href = qrLink;
    if (!active) { ui.image.removeAttribute("src"); ui.link.removeAttribute("href"); ui.lastQr = ""; ui.code.value = ""; }
    for (const [id, node] of ui.accountNodes) node.hidden = !accounts.some(account => account.accountId === id);
    for (const account of accounts) {
      if (ui.accountNodes.has(account.accountId)) continue;
      const accountRow = element("div", "pinkie-user-settings__wechat-account", ui.accounts);
      element("span", "pinkie-user-settings__channel-name", accountRow, "微信已连接 · 无限模式");
      button("断开微信", "pinkie-user-settings__text-button", accountRow,
        () => wechatAction("pinkie.wechat.disconnect", {accountId: account.accountId}));
      ui.accountNodes.set(account.accountId, accountRow);
    }
    const message = active || ["error", "expired", "cancelled"].includes(job?.state) ? job.message
      : accounts.length ? "微信已连接到无限模式，聊天会单独保存。" : "还没有连接微信。";
    setStatus("wechat", ui.actionError || message, ui.actionError ? "error" : active ? "busy" : ["error", "expired"].includes(job?.state) ? "error" : accounts.length ? "success" : "");
  }

  async function pollWechat() {
    const ui = state.wechat, request = rpc();
    if (!ui || ui.polling || ui.pending || typeof request !== "function") return;
    const epoch = ui.requestEpoch;
    ui.polling = true; ui.lastPoll = Date.now();
    try { const data = await request("pinkie.wechat.status", {}, 15000);
      if (epoch === ui.requestEpoch && !ui.pending) renderWechat(data); }
    catch { if (epoch === ui.requestEpoch && !ui.pending) setStatus("wechat", "微信连接暂时还没准备好，稍后再试。", "error"); }
    finally { ui.polling = false; }
  }
  async function wechatAction(method, params = {}) {
    const ui = state.wechat, request = rpc();
    if (!ui || ui.pending) return;
    if (typeof request !== "function") { setStatus("wechat", "暂时没有连上碧琪，请稍后重试。", "error"); return; }
    ui.requestEpoch += 1; ui.actionError = "";
    ui.pending = true; ui.connect.disabled = true; ui.cancel.disabled = true; ui.submit.disabled = true;
    try { renderWechat(await request(method, params, 20000)); }
    catch (error) { ui.actionError = `连接未完成：${friendlyError(error)}`; setStatus("wechat", ui.actionError, "error"); }
    finally {
      ui.pending = false;
      if (ui.data) renderWechat(ui.data);
      else { ui.connect.disabled = false; ui.cancel.disabled = false; ui.submit.disabled = false; }
      ui.lastPoll = 0;
    }
  }

  function buildMessagingConnection(parent, key) {
    if (state[key]) return state[key];
    const options = MESSAGING_CONNECTIONS[key];
    if (!options) return null;
    const section = element("div", "pinkie-user-settings__messaging-connection", parent);
    section.dataset.messagingChannel = key;
    const channelRow = row(section, options.label, `${options.label}聊天固定使用${options.mode}，会话单独保存。`);
    const connect = button(`连接${options.label}`, "pinkie-user-settings__button pinkie-user-settings__button--primary", channelRow.control,
      () => messagingAction(key, "login.start"));
    let project = null, chooseFolder = null, projectBound = null;
    if (options.project) {
      const projectField = element("div", "pinkie-user-settings__messaging-project", section);
      project = messagingInput(projectField, key, "project", "QQ 绑定的项目", "text");
      project.placeholder = "粘贴项目文件夹的完整路径";
      project.maxLength = 4096;
      project.addEventListener("input", () => {
        const ui = state[key];
        ui.projectEdited = true; ui.projectEditEpoch += 1;
      });
      chooseFolder = button("选择文件夹", "pinkie-user-settings__button", projectField, () => chooseMessagingProject(key));
      chooseFolder.hidden = typeof window.webkit?.messageHandlers?.laolaoProjectFolder?.postMessage !== "function";
      element("p", "pinkie-user-settings__soft-note", section, "先选定 QQ 要处理的项目，再扫码连接。" );
      projectBound = element("p", "pinkie-user-settings__soft-note pinkie-user-settings__messaging-bound", section);
      projectBound.hidden = true;
    }
    const panel = element("div", "pinkie-user-settings__messaging-panel", section);
    panel.hidden = true;
    const image = element("img", "pinkie-user-settings__messaging-qr", panel);
    image.alt = `用手机${options.label}扫描，连接碧琪${options.mode}`;
    image.width = 280; image.height = 280; image.hidden = true;
    const guide = element("p", "pinkie-user-settings__soft-note", panel, options.guide);
    const link = element("a", "pinkie-user-settings__messaging-link", panel, `打开${options.label}连接链接`);
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.hidden = true;
    let verify = null, code = null, verifySubmit = null;
    if (options.pairing) {
      verify = element("form", "pinkie-user-settings__messaging-verify", panel);
      verify.hidden = true;
      code = messagingInput(verify, key, "pairing", "QQ 机器人私信里的配对码", "text");
      code.autocomplete = "one-time-code"; code.maxLength = 128;
      code.placeholder = "粘贴配对码";
      verifySubmit = button("确认配对", "pinkie-user-settings__button", verify);
      verifySubmit.type = "submit";
      verify.addEventListener("submit", event => {
        event.preventDefault();
        const value = code.value.trim();
        code.value = "";
        if (!value) { messagingError(key, "请填入 QQ 机器人私信里的配对码。"); return; }
        void messagingAction(key, "login.verify", {id: state[key].data?.job?.id, code: value});
      });
    }
    const cancel = button("取消连接", "pinkie-user-settings__text-button", panel,
      () => messagingAction(key, "login.cancel", {id: state[key].data?.job?.id}));
    const manualDisclosure = element("details", "pinkie-user-settings__messaging-manual", section);
    element("summary", "pinkie-user-settings__channels-summary", manualDisclosure, "使用已有机器人");
    element("p", "pinkie-user-settings__soft-note", manualDisclosure, "填入已有机器人的 App ID 和 App Secret。" );
    const manual = element("form", "pinkie-user-settings__messaging-form", manualDisclosure);
    const appId = messagingInput(manual, key, "appid", "App ID", "text");
    appId.maxLength = 128;
    const secret = messagingInput(manual, key, "secret", "App Secret", "password");
    secret.autocomplete = "new-password"; secret.maxLength = 1024;
    const manualSubmit = button("保存并连接", "pinkie-user-settings__button", manual);
    manualSubmit.type = "submit";
    manual.addEventListener("submit", event => {
      event.preventDefault();
      const credentials = {appId: appId.value.trim(), appSecret: secret.value.trim()};
      secret.value = "";
      if (!credentials.appId || !credentials.appSecret) { messagingError(key, "请填入 App ID 和 App Secret。"); return; }
      void messagingAction(key, "login.manual", credentials);
    });
    const accounts = element("div", "pinkie-user-settings__messaging-accounts", section);
    makeStatus(section, key);
    state[key] = {connect, panel, image, guide, link, verify, code, verifySubmit, cancel, manualDisclosure,
      manual, appId, secret, manualSubmit, project, chooseFolder, projectBound, accounts, accountNodes: new Map(),
      data: null, pending: false, polling: false, lastPoll: 0, lastQr: "", requestEpoch: 0,
      stateStamp: "", actionError: "", projectEdited: false, projectEditEpoch: 0, projectPicking: false};
    return state[key];
  }
  function messagingInput(parent, key, name, title, type) {
    const field = element("label", "pinkie-user-settings__messaging-field", parent);
    const id = `pinkie-${key}-${name}`;
    field.htmlFor = id;
    element("span", "pinkie-user-settings__row-title", field, title);
    const input = element("input", "pinkie-user-settings__messaging-input", field);
    input.id = id; input.type = type; input.autocomplete = "off"; input.spellcheck = false; input.required = true;
    return input;
  }
  function absoluteProjectPath(value) {
    return typeof value === "string" && !/[\u0000\r\n]/.test(value)
      && /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(value.trim());
  }
  function messagingError(key, message) {
    const ui = state[key];
    if (!ui) return;
    ui.actionError = message;
    setStatus(key, message, "error");
  }
  function messagingControls(key, active = false) {
    const ui = state[key], options = MESSAGING_CONNECTIONS[key];
    const unavailable = Boolean(ui.data && (ui.data.available !== true || ui.data.agentId !== options.agentId));
    const blocked = ui.pending || active || ui.projectPicking || unavailable;
    ui.connect.disabled = blocked; ui.manualSubmit.disabled = blocked;
    ui.appId.disabled = blocked; ui.secret.disabled = blocked;
    ui.cancel.disabled = ui.pending || ui.data?.job?.state === "finishing";
    if (ui.verifySubmit) { ui.verifySubmit.disabled = ui.pending || unavailable; ui.code.disabled = ui.pending || unavailable; }
    if (ui.project) {
      ui.project.disabled = blocked;
      ui.chooseFolder.disabled = blocked;
      ui.chooseFolder.hidden = typeof window.webkit?.messageHandlers?.laolaoProjectFolder?.postMessage !== "function";
    }
    for (const item of ui.accountNodes.values()) item.disconnect.disabled = blocked;
  }
  function renderMessaging(key, data) {
    const ui = state[key], options = MESSAGING_CONNECTIONS[key];
    if (!ui || !options || !data) return;
    const job = data.job;
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const stamp = JSON.stringify([job?.id, job?.state, job?.qrGeneration, data.projectRoot || "",
      accounts.map(account => [account.accountId, account.enabled, account.configured, account.routeReady,
        account.running, account.connected, account.paired, account.needsPairing])]);
    if (stamp !== ui.stateStamp) {
      if (ui.data) ui.actionError = "";
      ui.stateStamp = stamp;
    }
    ui.data = data;
    const available = data.available === true && data.agentId === options.agentId;
    const active = available && ["starting", "waiting", "confirming", "finishing", "pairing"].includes(job?.state);
    const projectReady = !options.project || absoluteProjectPath(data.projectRoot);
    const isConnected = account => account.enabled && account.routeReady && account.connected
      && (!options.pairing || account.paired) && projectReady;
    const connected = accounts.filter(isConnected);
    ownText(ui.connect, active ? "正在连接…" : connected.length ? "重新扫码" : `连接${options.label}`);
    ui.panel.hidden = !active;
    if (ui.project && !ui.projectEdited) ui.project.value = typeof data.projectRoot === "string" ? data.projectRoot : "";
    if (ui.projectBound) {
      ui.projectBound.hidden = !absoluteProjectPath(data.projectRoot);
      ownText(ui.projectBound, ui.projectBound.hidden ? "" : `当前连接的项目：${data.projectRoot}`);
    }
    const pairing = active && options.pairing && job?.state === "pairing";
    if (ui.verify) ui.verify.hidden = !pairing;
    ownText(ui.guide, pairing ? "先给 QQ 机器人发一条私信，再把它回复的配对码填在这里。" : options.guide);
    const showQr = active && !pairing && job?.state !== "finishing";
    const qr = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(job?.qrDataUrl || "") ? job.qrDataUrl : "";
    if (showQr && qr) {
      if (qr !== ui.lastQr) { ui.image.src = qr; ui.lastQr = qr; }
    } else { ui.image.removeAttribute("src"); ui.lastQr = ""; }
    ui.image.hidden = !showQr || !qr;
    let qrLink = "";
    try {
      const url = new URL(job?.qrUrl || "");
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && options.hosts.includes(url.hostname)) qrLink = url.href;
    } catch { /* Keep unexpected QR links unclickable. */ }
    ui.link.hidden = !showQr || !qrLink;
    if (!ui.link.hidden) ui.link.href = qrLink;
    else ui.link.removeAttribute("href");
    if (!pairing && ui.code) ui.code.value = "";
    const visibleAccounts = available ? accounts.filter(account => account.enabled && (account.configured || account.connected || account.needsPairing)) : [];
    for (const [id, item] of ui.accountNodes) item.node.hidden = !visibleAccounts.some(account => account.accountId === id);
    for (const account of visibleAccounts) {
      let item = ui.accountNodes.get(account.accountId);
      if (!item) {
        const node = element("div", "pinkie-user-settings__messaging-account", ui.accounts);
        const label = element("span", "pinkie-user-settings__channel-name", node);
        const disconnect = button(`断开${options.label}`, "pinkie-user-settings__text-button", node,
          () => messagingAction(key, "disconnect", {accountId: account.accountId}));
        item = {node, label, disconnect}; ui.accountNodes.set(account.accountId, item);
      }
      item.node.hidden = false;
      ownText(item.label, isConnected(account) ? `${options.label}已连接 · ${options.mode}`
        : options.pairing && !account.paired ? `${options.label}等待配对 · ${options.mode}`
          : `${options.label}已保存，尚未接通${options.mode}`);
    }
    messagingControls(key, active);
    let message = `还没有连接${options.label}。`, kind = "";
    if (!available) { message = `${options.label}连接暂时还没准备好，稍后再试。`; kind = "error"; }
    else if (active || ["error", "expired", "cancelled"].includes(job?.state)) {
      message = job.message || (pairing ? "请填入 QQ 私信里的配对码。" : "正在连接，请稍等…");
      kind = active ? "busy" : ["error", "expired"].includes(job?.state) ? "error" : "";
    } else if (connected.length) {
      message = `${options.label}已连接到${options.mode}，聊天会单独保存。`; kind = "success";
    } else if (visibleAccounts.length) {
      message = options.pairing && visibleAccounts.some(account => !account.paired)
        ? "QQ 机器人还需要配对，请点击连接 QQ 继续。" : `${options.label}机器人已保存，尚未接通${options.mode}。`;
    }
    setStatus(key, ui.actionError || message, ui.actionError ? "error" : kind);
  }
  async function pollMessaging(key) {
    const ui = state[key], options = MESSAGING_CONNECTIONS[key], request = rpc();
    if (!ui || !options || state.root?.hidden || ui.polling || ui.pending || typeof request !== "function") return;
    const epoch = ui.requestEpoch;
    ui.polling = true; ui.lastPoll = Date.now();
    try {
      const data = await request(`${options.prefix}.status`, {}, 15000);
      if (epoch === ui.requestEpoch && !ui.pending) renderMessaging(key, data);
    } catch {
      if (epoch === ui.requestEpoch && !ui.pending) setStatus(key, ui.actionError || `${options.label}连接暂时还没准备好，稍后再试。`, "error");
    } finally { ui.polling = false; }
  }
  async function messagingAction(key, operation, params = {}) {
    const ui = state[key], options = MESSAGING_CONNECTIONS[key], request = rpc();
    if (!ui || !options || ui.pending || ui.projectPicking) return;
    if (typeof request !== "function") { messagingError(key, "暂时没有连上碧琪，请稍后重试。"); return; }
    if (options.project && ["login.start", "login.manual", "login.verify"].includes(operation)) {
      const projectRoot = ui.project.value.trim();
      if (!absoluteProjectPath(projectRoot)) { messagingError(key, "请先选择 QQ 绑定的项目，或填入文件夹的完整路径。"); return; }
      params = {...params, projectRoot};
    }
    if (operation === "login.verify" && (!params.id || ui.data?.job?.state !== "pairing")) {
      messagingError(key, "这次配对已经结束，请重新连接 QQ。"); return;
    }
    ui.requestEpoch += 1; ui.actionError = ""; ui.pending = true;
    messagingControls(key, true);
    setStatus(key, operation === "disconnect" ? "正在断开…" : operation === "login.cancel" ? "正在取消…" : "正在连接，请稍等…", "busy");
    try { renderMessaging(key, await request(`${options.prefix}.${operation}`, params, 20000)); }
    catch (error) {
      let detail = friendlyError(error);
      if (params.appSecret) detail = detail.split(params.appSecret).join("******");
      messagingError(key, `连接未完成：${detail}`);
    } finally {
      ui.pending = false;
      if (ui.data) renderMessaging(key, ui.data);
      else messagingControls(key);
      ui.lastPoll = 0;
    }
  }
  async function chooseMessagingProject(key) {
    const ui = state[key], bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (!ui?.project || ui.pending || ui.projectPicking || ui.project.disabled) return;
    if (typeof bridge?.postMessage !== "function") { messagingError(key, "请粘贴项目文件夹的完整路径。"); return; }
    const editEpoch = ui.projectEditEpoch, requestEpoch = ui.requestEpoch;
    const requestId = window.crypto?.randomUUID?.() || `pinkie-${key}-${Date.now()}-${Math.random()}`;
    ui.projectPicking = true; messagingControls(key);
    try {
      const result = await new Promise(resolve => {
        const previous = window.__laolaoProjectFolderResult;
        let settled = false, timer;
        const finish = payload => {
          if (settled) return;
          settled = true; window.clearTimeout(timer);
          if (window.__laolaoProjectFolderResult === handler) window.__laolaoProjectFolderResult = previous;
          resolve(payload);
        };
        const handler = payload => {
          if (payload?.requestId === requestId) finish(payload);
          else if (typeof previous === "function") previous(payload);
        };
        window.__laolaoProjectFolderResult = handler;
        timer = window.setTimeout(() => finish({timeout: true}), 120000);
        try { bridge.postMessage({action: "choose", context: "qq", requestId, path: ui.project.value.trim()}); }
        catch { finish({error: true}); }
      });
      if (ui !== state[key] || editEpoch !== ui.projectEditEpoch || requestEpoch !== ui.requestEpoch) return;
      if (result?.timeout || result?.error) { messagingError(key, "文件夹选择没有响应，请重试或粘贴完整路径。"); return; }
      if (!result?.cancelled && absoluteProjectPath(result?.path)) {
        ui.project.value = result.path; ui.projectEdited = true; ui.projectEditEpoch += 1;
      }
    } finally {
      ui.projectPicking = false;
      if (ui.data) renderMessaging(key, ui.data);
      else messagingControls(key);
    }
  }
  async function loadInitialData() {
    const request = rpc();
    if (typeof request !== "function") {
      setStatus("permissions", "暂时无法读取设置，请检查连接后重试。", "error");
      setStatus("thinking", "暂时无法读取设置，请检查连接后重试。", "error");
      return;
    }
    try {
      const snapshot = await request("config.get", {}, 15000);
      const config = configFromSnapshot(snapshot);
      if (!config || typeof snapshot?.hash !== "string") throw new Error("无法读取当前设置版本");
      state.snapshot = snapshot;
      state.config = config;
      renderConfigValues();
      setStatus("permissions", "已读取当前设置。", "success");
    } catch (error) {
      setStatus("permissions", `读取失败：${friendlyError(error)}`, "error");
      setStatus("thinking", `读取失败：${friendlyError(error)}`, "error");
    }
    try {
      const catalogApi = window.__laolaoModelPickerCatalog;
      if (!catalogApi?.load || !catalogApi?.present) throw new Error("模型目录暂不可用");
      const models = await catalogApi.load("main");
      const modelValue = configuredModelValue(state.config);
      state.models = catalogApi.present(models, modelValue);
      buildModelChoices(catalogApi);
      syncConfigValues();
    } catch (error) {
      ownText(state.modelButton, "暂时无法读取模型");
      setStatus("thinking", `模型目录读取失败：${friendlyError(error)}`, "error");
    }
    syncChannels();
    syncRemoteWarning();
    syncUsage();
  }

  function configuredModelValue(config) {
    const model = config?.agents?.defaults?.model;
    if (typeof model === "string") return model;
    if (isObject(model)) return model.primary || model.model || model.id || "";
    return "";
  }
  function displayModelName(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.toLowerCase() === "default") {
      const preferred = state.models.find((model) => model.default === true || model.isDefault === true || model.primary === true);
      return preferred?.name || "由碧琪自动选择";
    }
    const item = state.models.find((model) => model.sources?.includes(normalized)
      || `${model.provider}/${model.id}` === normalized || model.id === normalized
      || model.id === normalized.split("/").at(-1));
    if (item?.name) return item.name;
    const id = normalized.split("/").at(-1);
    return id.split(/[-_.]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
      || "由碧琪自动选择";
  }
  function buildModelChoices(catalogApi) {
    const groups = [...new Set(state.models.map((model) => catalogApi.group(model)))];
    state.brandButtons.length = 0;
    for (const group of groups) {
      const sample = state.models.find((model) => catalogApi.group(model) === group);
      const brand = catalogApi.brand(sample?.provider, sample?.id) || "crossmodel";
      const tab = button(group, "pinkie-user-settings__brand", state.modelMenu.firstElementChild,
        () => activateModelGroup(group));
      tab.dataset.brand = brand;
      tab.setAttribute("aria-pressed", "false");
      state.brandButtons.push([group, tab]);
    }
    for (const model of state.models) {
      const group = catalogApi.group(model);
      const choice = button(model.name || displayModelName(model.id), "pinkie-user-settings__model-choice", state.modelList,
        () => saveModel(model));
      choice.dataset.modelGroup = group;
      choice.setAttribute("role", "option");
      state.modelChoices.push([model, group, choice]);
    }
    const current = configuredModelValue(state.config);
    const currentItem = state.models.find((model) => model.sources?.includes(current)
      || `${model.provider}/${model.id}` === current || model.id === current);
    activateModelGroup(currentItem ? catalogApi.group(currentItem) : groups[0] || "");
  }
  function activateModelGroup(group) {
    state.activeModelGroup = group;
    for (const [name, node] of state.brandButtons) setPressed(node, name === group);
    for (const [, modelGroup, node] of state.modelChoices) node.hidden = modelGroup !== group;
  }
  function renderConfigValues() {
    if (!state.config) return;
    const mode = localMode();
    for (const [value, node] of state.modeButtons) setPressed(node, value === mode);
    syncConfigValues();
    syncChannels();
    syncRemoteWarning();
  }
  function syncConfigValues() {
    const config = state.config;
    if (!config) return;
    const model = configuredModelValue(config);
    ownText(state.modelButton, displayModelName(model));
    const defaults = config.agents?.defaults || {};
    const thinking = typeof defaults.thinkingLevel === "string" ? defaults.thinkingLevel : "off";
    for (const [value, node] of state.reasoningButtons) setPressed(node, value === thinking);
    const fast = defaults.fastMode === "auto" ? "auto" : defaults.fastMode === true ? "true" : "false";
    for (const [value, node] of state.speedButtons) setPressed(node, String(value) === fast);
    const activePreset = matchingPreset(config);
    state.customPreset.hidden = Boolean(activePreset);
    for (const [id, node] of state.presetButtons) setPressed(node, id === activePreset);
  }
  function setPath(target, path, value) {
    let current = target;
    for (const key of path.slice(0, -1)) {
      if (!isObject(current[key])) current[key] = {};
      current = current[key];
    }
    current[path.at(-1)] = value;
  }
  function saveConfigPatch(changes, statusKey) {
    state.saveQueue = state.saveQueue.then(async () => {
      const request = rpc();
      if (typeof request !== "function") throw new Error("连接暂不可用");
      setStatus(statusKey, "正在保存…", "busy");
      const snapshot = await request("config.get", {}, 15000);
      const config = configFromSnapshot(snapshot);
      if (!config || typeof snapshot?.hash !== "string") throw new Error("无法读取设置版本，请刷新后重试");
      const next = copyObject(config);
      for (const [path, value] of changes) setPath(next, path, value);
      const result = await request("config.apply", {raw: JSON.stringify(next), baseHash: snapshot.hash}, 30000);
      if (result?.ok === false) throw new Error(result.error || result.message || "网关没有接受这项设置");
      state.config = next;
      const restartRequired = resultNeedsRestart(result);
      setStatus(statusKey, restartRequired ? "已保存；重启网关后生效。" : "已保存并应用。", "success");
      try {
        const fresh = await request("config.get", {}, 8000);
        const freshConfig = configFromSnapshot(fresh);
        if (freshConfig) { state.snapshot = fresh; state.config = freshConfig; }
      } catch { /* A gateway restart can briefly close the settings connection. */ }
      syncConfigValues();
      syncRemoteWarning();
      syncChannels();
      return true;
    }).catch((error) => {
      setStatus(statusKey, `保存失败：${friendlyError(error)}`, "error");
      renderConfigValues();
      return false;
    });
    return state.saveQueue;
  }
  function resultNeedsRestart(result) {
    return result?.restartRequired === true || result?.requiresRestart === true
      || result?.restart?.required === true || result?.restart?.pending === true
      || result?.restart?.started === true;
  }
  function saveModel(model) {
    const value = `${model.provider}/${model.id}`;
    state.modelMenu.hidden = true;
    const current = state.config?.agents?.defaults?.model;
    const path = isObject(current)
      ? ["agents", "defaults", "model", "primary"]
      : ["agents", "defaults", "model"];
    void saveConfigPatch([[path, value]], "thinking");
  }
  function savePreset(id) {
    const preset = PRESET_MAP[id];
    if (!preset) return;
    const save = saveConfigPatch([
      [["tools", "profile"], preset.profile],
      [["tools", "exec", "security"], preset.execSecurity],
      [["browser", "enabled"], preset.browserEnabled],
    ], "permissions");
    void save.then((saved) => {
      if (saved && state.config && matchingPreset(state.config) !== id) {
        setStatus("permissions", "这三项已保存；高级设置里的单独权限规则仍保留，所以当前仍显示为自定义。", "success");
      }
    });
  }
  function localMode() {
    try {
      const stored = window.localStorage?.getItem(MODE_KEY);
      if (MODE_OPTIONS.some(([value]) => value === stored)) return stored;
      const session = new URLSearchParams(window.location?.search || "").get("session") || "";
      for (const [value] of MODE_OPTIONS) if (session.startsWith(`agent:${value}:`)) return value;
    } catch { /* The first mode is a safe presentation fallback. */ }
    return "chat";
  }
  function saveDefaultMode(value) {
    try {
      window.localStorage.setItem(MODE_KEY, value);
      for (const [mode, node] of state.modeButtons) setPressed(node, mode === value);
      setStatus("mode", "已保存，之后新建的聊天会使用这个模式。", "success");
    } catch (error) {
      setStatus("mode", `保存失败：${friendlyError(error)}`, "error");
    }
  }
  function syncChannels() {
    if (!state.config || !state.channelList) return;
    const channels = isObject(state.config.channels) ? state.config.channels : {};
    const connected = Object.entries(channels).filter(([id, value]) => !["openclaw-weixin", "feishu", "qqbot"].includes(id) && isObject(value)
      && Object.keys(value).length > 0 && value.enabled !== false);
    ownText(state.channelCount, String(connected.length));
    for (const channel of connected) {
      const [id, value] = channel;
      if ([...state.channelList.querySelectorAll("[data-channel]")]
        .some((node) => node.dataset.channel === id)) continue;
      const item = element("div", "pinkie-user-settings__channel", state.channelList);
      item.dataset.channel = id;
      element("span", "pinkie-user-settings__channel-name", item, CHANNEL_LABELS[id.toLowerCase()]
        || "其他应用");
      element("span", "pinkie-user-settings__channel-state", item,
        value.enabled === false ? "已暂停" : "已连接");
    }
    if (connected.length === 0 && !state.channelList.querySelector(".pinkie-user-settings__empty")) {
      element("p", "pinkie-user-settings__empty", state.channelList, "还没有连接其他应用。" );
    }
  }
  function syncRemoteWarning() {
    if (!state.config || !state.warning) return;
    const exposed = remoteAccessEnabled(state.config, window.location?.hostname || "");
    state.warning.hidden = !(exposed && authMode(state.config) === "none");
  }
  function pairMobile() {
    const nativeButton = document.querySelector(".qs-card--security .qs-row__value--action");
    if (!nativeButton) {
      setStatus("connections", "暂时无法打开手机配对，请到高级设置中重试。", "error");
      return;
    }
    if (nativeButton.disabled) {
      setStatus("connections", "当前连接暂不支持手机配对。", "error");
      return;
    }
    nativeButton.click();
    setStatus("connections", "已打开手机配对。", "success");
  }
  function nativeThemeButtons(rowIndex) {
    const rows = document.querySelectorAll(".qs-card--appearance .qs-row--stacked .qs-segmented");
    return rows[rowIndex] ? [...rows[rowIndex].querySelectorAll("button.qs-segmented__btn")] : [];
  }
  function chooseNativeTheme(value) {
    const index = THEME_OPTIONS.findIndex(([item]) => item === value);
    const options = nativeThemeButtons(0);
    if (index < 0 || !options[index]) {
      setStatus("appearance", "当前版本暂不支持这个主题。", "error");
      return;
    }
    options[index].click();
    setStatus("appearance", "主题已保存到这台设备。", "success");
    window.requestAnimationFrame(syncAppearance);
  }
  function chooseNativeThemeMode(value) {
    const index = THEME_MODE_OPTIONS.findIndex(([item]) => item === value);
    const options = nativeThemeButtons(1);
    if (index < 0 || !options[index]) {
      setStatus("appearance", "当前版本暂不支持这个明暗模式。", "error");
      return;
    }
    options[index].click();
    setStatus("appearance", "明暗模式已保存到这台设备。", "success");
    window.requestAnimationFrame(syncAppearance);
  }
  function syncAppearance() {
    const themes = nativeThemeButtons(0);
    const themeIndex = themes.findIndex((node) => node.classList.contains("qs-segmented__btn--active"));
    for (const [index, [value, node]] of state.themeButtons.entries()) {
      const available = index < themes.length;
      node.hidden = !available;
      setPressed(node, index === themeIndex);
      if (value === "custom" && themeIndex !== 3) setPressed(node, false);
    }
    const modes = nativeThemeButtons(1);
    const modeIndex = modes.findIndex((node) => node.classList.contains("qs-segmented__btn--active"));
    for (const [index, [, node]] of state.themeModeButtons.entries()) setPressed(node, index === modeIndex);
  }
  function syncVersion() {
    const shell = document.querySelector("openclaw-app-shell");
    const version = shell?.context?.config?.current?.serverVersion
      || shell?.context?.gateway?.snapshot?.hello?.server?.version || "暂不可用";
    ownText(state.version, String(version));
  }
  const tokenCount = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1e9) return `${(number / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return String(Math.round(number));
  };
  function syncUsage() {
    const usage = window.__laolaoUsage?.view;
    if (!usage) return;
    for (const [key, node] of state.usageValues) {
      let value = "—";
      if (key === "input" || key === "output" || key === "cacheRead") value = tokenCount(usage[key]);
      else if (key === "requests") value = usage.requests == null ? "—" : tokenCount(usage.requests);
      else if (key === "cost") value = Number.isFinite(usage.cost) ? `$${usage.cost.toFixed(2)}` : "—";
      ownText(node, value);
    }
    setStatus("usage", "用量数据已更新。", "success");
  }
  async function checkForUpdates() {
    setStatus("updates", "正在打开更新检查…", "busy");
    let action = null;
    for (const node of document.querySelectorAll("*")) {
      const overlays = node?.context?.overlays;
      if (typeof overlays?.runUpdate === "function") {
        action = () => overlays.runUpdate();
        break;
      }
    }
    if (!action) {
      setStatus("updates", "暂时无法打开更新入口，请到高级设置的更新页查看。", "error");
      return;
    }
    try {
      await action();
      setStatus("updates", "更新检查已启动；如应用正在更新，等它重新连接即可。", "success");
    } catch (error) {
      setStatus("updates", `检查失败：${friendlyError(error)}`, "error");
    }
  }
  function openAdvanced(section = "") {
    const tabs = [...document.querySelectorAll(".config-view-toggle button[role='tab']")];
    const advanced = tabs.find((node) => node.getAttribute("aria-selected") !== "true"
      && node === tabs[1]) || tabs[1];
    if (!advanced) return;
    if (advanced.getAttribute("aria-selected") !== "true") advanced.click();
    if (!section) return;
    window.setTimeout(() => activateNativeSection(section, 0), 120);
  }
  function activateNativeSection(section, attempt) {
    const links = [...document.querySelectorAll("a[href]")];
    const direct = links.find((link) => {
      try {
        const url = new URL(link.href, window.location.href);
        return url.pathname.split("/").some((part) => part === section)
          || url.searchParams.get("section") === section;
      } catch { return false; }
    });
    if (direct) { direct.click(); return; }
    const textPattern = section === "channels" ? /频道|channels/i : /认证|authentication/i;
    const named = links.find((link) => textPattern.test(link.textContent || link.getAttribute("aria-label") || ""));
    if (named) { named.click(); return; }
    if (attempt < 12) window.setTimeout(() => activateNativeSection(section, attempt + 1), 120);
    else window.location.assign(section === "channels" ? "/settings/channels" : "/settings/general?section=auth");
  }
  function friendlyError(error) {
    const original = String(error?.message || error || "");
    if (/(?:hash|version|conflict)/i.test(original)) return "设置刚刚有变化，请重新打开后再试。";
    if (/(?:schema|invalid|required|validation|parse)/i.test(original)) return "这项设置不符合当前要求，请检查高级设置。";
    if (/(?:unauthori[sz]ed|forbidden|permission|authentication|token)/i.test(original)) return "当前连接没有修改权限。";
    if (/(?:timeout|timed out|disconnect|connection|network|closed)/i.test(original)) return "连接暂时中断，请恢复连接后重试。";
    const plain = original
      .replace(/openclaw(?:\.json)?/gi, "设置")
      .replace(/gateway/gi, "网关")
      .replace(/config(?:uration)?/gi, "设置")
      .replace(/\s+/g, " ").trim();
    return /[\u3400-\u9fff]/.test(plain) ? plain : "操作没有完成，请到高级设置查看原因。";
  }
  function localizeModeToggle(toggle) {
    const tabs = [...toggle.querySelectorAll("button[role='tab']")];
    for (const [index, label] of [[0, "常用"], [1, "高级"]]) {
      const tab = tabs[index];
      if (!tab) continue;
      for (const node of tab.childNodes) {
        if (node.nodeType === 3 && node.nodeValue.trim()) node.nodeValue = label;
      }
    }
  }
  function localizeSettingsTitle(common) {
    const title = document.querySelector(".content-header .page-title");
    if (!title) return;
    for (const node of title.childNodes) {
      if (node.nodeType !== 3) continue;
      const text = node.nodeValue.trim();
      if (common && text === "Settings") node.nodeValue = node.nodeValue.replace("Settings", "设置");
      else if (!common && text === "设置") node.nodeValue = node.nodeValue.replace("设置", "Settings");
    }
  }
  function syncPage() {
    if (!state.root) return;
    const onSettingsRoute = String(window.location?.pathname || "").startsWith("/settings");
    const toggle = onSettingsRoute ? document.querySelector(".config-view-toggle") : null;
    if (!toggle) {
      state.root.hidden = true;
      document.body?.removeAttribute("data-pinkie-user-settings");
      return;
    }
    localizeModeToggle(toggle);
    const tabs = [...toggle.querySelectorAll("button[role='tab']")];
    const advanced = tabs[1]?.getAttribute("aria-selected") === "true";
    const common = !advanced && (tabs[0]?.getAttribute("aria-selected") === "true" || tabs.length > 0);
    localizeSettingsTitle(common);
    const view = advanced ? "advanced" : common ? "common" : "";
    const returnedToCommon = state.lastView === "advanced" && common;
    state.lastView = view;
    state.root.hidden = !common;
    if (common) document.body?.setAttribute("data-pinkie-user-settings", "1");
    else document.body?.removeAttribute("data-pinkie-user-settings");
    if (common) updatePosition();
    if (returnedToCommon) {
      void loadInitialData();
      syncAppearance();
    }
    const route = `${window.location.pathname}${window.location.search}`;
    if (route !== state.lastRoute) {
      state.lastRoute = route;
      syncVersion();
      syncAppearance();
      syncUsage();
    }
  }
  function updatePosition() {
    const header = document.querySelector(".content-header");
    if (!header || !state.root || state.root.hidden) return;
    const bounds = header.getBoundingClientRect();
    state.root.style.left = `${bounds.left}px`;
    state.root.style.width = `${bounds.width}px`;
    state.root.style.top = `${Math.max(0, bounds.bottom + 10)}px`;
  }
  function activate() {
    buildPage();
    document.addEventListener("click", (event) => {
      const tab = event.target?.closest?.(".config-view-toggle button[role='tab']");
      if (tab) window.requestAnimationFrame(() => window.requestAnimationFrame(syncPage));
    }, true);
    window.addEventListener("popstate", syncPage);
    window.addEventListener("resize", updatePosition, {passive: true});
    window.setInterval(() => {
      syncPage();
      syncUsage();
      if (!state.root.hidden && state.wechat && Date.now() - state.wechat.lastPoll > 2500) void pollWechat();
      if (!state.root.hidden) for (const key of Object.keys(MESSAGING_CONNECTIONS)) {
        if (state[key] && Date.now() - state[key].lastPoll > 2500) void pollMessaging(key);
      }
    }, 1000);
    const usage = window.__laolaoUsage;
    if (usage?.refresh) void usage.refresh().then(syncUsage).catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", activate, {once: true});
  else activate();
})();
