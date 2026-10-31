/* 碧琪伙伴 + 模式氛围 + 输入框动效。
   - 每一侧聊天 pane 都有自己的碧琪（双模式时两侧各一只，各自的菜单、状态、专注计时；
     不把同一个节点在两侧搬来搬去，所以非活动侧不会丢工具）。
   - 五状态 rest / typing / working / happy / sleepy 各有可辨认动作，动作由 laolao-cat-rig.js
     在局部（头、尾、呼吸、跃起）完成，底边钉在输入框上沿。rig 不可用时退回静态换图。
   - 猫坐在输入框上方偏右，不压正文：聊天内容的底部为它留出真实安全空间（--pinkie-safe）。
   - 功能：这是啥意思 / 一句话总结 / 帮我把问题问清楚 / 专注 25 分钟；模型请求走插件方法
     pinkie.companion.ask（独立模型），右键可设置模型与参数，只有测试预览使用演示回答。
   - 美术：优先 /cle/static/art/companion-v2/<state>.png（Claude 供图），缺失时自动回退到
     现有 pet-*.webp；不改画风、不画占位图。 */
(() => {
  "use strict";
  if (window.__pinkieBuddy) return;

  const MODES = ["chat", "project", "thinking", "learning", "unrestricted"];
  const STATES = ["rest", "typing", "working", "happy", "sleepy"];
  const ROOM_OF_AGENT = {main: "chat", project: "project", thinking: "thinking", learning: "learning", unrestricted: "unrestricted"};
  const ART_V2 = (s) => `/cle/static/art/companion-v2/${s}.webp?v=20261019e`;
  // 现有素材作回退；将来 companion-v2 到位后自动优先使用，无需改代码。
  // 只用横构图的两张（616×420）：pet-sit 是竖构图（314×420），塞进 168×90 的位子会缩成一小团，
  // 五状态之间还会忽大忽小 —— 那正是「用整图缩放冒充动作」。状态的差别交给 rig 的动作、
  // 模式小标记和状态文案；真正的五张表情由 Claude 的 companion-v2 提供。
  const FALLBACK = {
    rest: "/cle/static/art/pet-loaf.webp?v=20261019e",
    typing: "/cle/static/art/pet-loaf.webp?v=20261019e",
    working: "/cle/static/art/pet-loaf.webp?v=20261019e",
    happy: "/cle/static/art/pet-loaf.webp?v=20261019e",
    sleepy: "/cle/static/art/pet-loaf-closed.webp?v=20261019e",
  };
  const CLOSED = "/cle/static/art/pet-loaf-closed.webp?v=20261019e";
  // v2: six poses cut to one shared frame (scripts/art/cutout-plate.py), so he keeps his size between
  // states; the closed-eye frame belongs to the resting pose
  const CLOSED_V2 = "/cle/static/art/companion-v2/closed.webp?v=20261019e";
  const CALL = {project: "老板"};
  const PREF_KEY = "pinkie…s-v1";
  const SLEEPY_AFTER = 10 * 60_000;
  const FOCUS_MINUTES = 25;
  const preview = window.__pinkieCompanionPreview === true;
  const prefs = (() => { try { return {ambient: true, narrate: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}")}; } catch { return {ambient: true, narrate: false}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MODE_NAMES = {chat: "聊天", project: "项目", thinking: "想法", learning: "学习", unrestricted: "自由"};

  /* 每个模式的小标记：书页 / 工具 / 月亮 / 笔 / 纸。不用粉色，不用小马。 */
  const MARK = {
    chat: '<path d="M4 5h9a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2Z"/><path d="M7.5 8.5h4.5M7.5 11.5h3"/>',
    project: '<path d="m4 15 5-5 3 3 5-6"/><path d="M3 19h12"/>',
    thinking: '<path d="M12.5 4.5a6 6 0 0 0-4.6 9.9c.5.6.8 1.2.8 1.9v.2h5v-.2c0-.7.3-1.3.8-1.9A6 6 0 0 0 12.5 4.5Z"/><path d="M4 3.5v2M3 4.5h2"/>',
    learning: '<path d="M4 6.5 10 4l6 2.5v9L10 18l-6-2.5Z"/><path d="M10 4v14"/>',
    unrestricted: '<path d="m4 17 9-9 3 3-9 9H4Z"/><path d="m12.5 6.5 3 3"/>',
  };
  const MARK_LABEL = {chat: "雅叙 · 在陪你说话", project: "营造 · 摊开了图纸", thinking: "堇思 · 半夜的念头", learning: "习作 · 翻到今天这页", unrestricted: "挥洒 · 白纸一张"};

  /* 手绘线条图标：替代表情符号，悬停时各有一个小动作（见 CSS .ico--*） */
  const ICON = {
    explain: '<svg viewBox="0 0 24 24"><path class="draw" d="M9 18h6M10 21h4"/><path class="draw" d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/><path class="ray" d="M12 0.6v1.2M20.6 4l-.9.9M23 12h-1.2M3.4 4l.9.9M1 12h1.2"/></svg>',
    summary: '<svg viewBox="0 0 24 24"><path class="l1" d="M4 6h16"/><path class="l2" d="M4 11h12"/><path class="l3" d="M4 16h8"/><path class="draw" d="m16 15 2.5 2.5L22 13"/></svg>',
    clarify: '<svg viewBox="0 0 24 24"><path class="draw" d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14 8 3 3"/><path class="spark" d="M19 15.5v3M17.5 17h3"/></svg>',
    focus: '<svg viewBox="0 0 24 24"><circle class="draw" cx="12" cy="13.5" r="7.5"/><path class="hand" d="M12 13.5V9.5"/><path d="M10 2.5h4M12 2.5V6"/></svg>',
    ambient: '<svg viewBox="0 0 24 24"><path class="draw" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/><path class="spark" d="M17 3v3M15.5 4.5h3"/></svg>',
    narrate: '<svg viewBox="0 0 24 24"><path class="draw" d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg>',
  };

  /* ── 美术：v2 优先、旧素材回退，探测结果缓存一次 ───────────────────── */
  const BROKEN = new Set();
  const PROBED = new Map();
  const ART = new Map();             // state → 已确定的 url
  const probe = (url) => {
    if (!PROBED.has(url)) PROBED.set(url, new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
    }));
    return PROBED.get(url);
  };
  const artFor = async (state) => {
    if (ART.has(state)) return ART.get(state);
    for (const url of [ART_V2(state), FALLBACK[state]]) {
      if (!url || BROKEN.has(url)) continue;
      if (await probe(url)) { ART.set(state, url); return url; }
      BROKEN.add(url);
    }
    ART.set(state, FALLBACK[state]);
    return FALLBACK[state];
  };
  // 线描（默认画风）：Codex 线稿做成的墨色剪影，昼夜各一张；油画：上面的猫图
  const lineMode = () => document.documentElement.dataset.cleArt === "line";
  const night = () => document.documentElement.hasAttribute("data-pinkie-night") || /dark/.test(document.documentElement.dataset.theme || "");
  const LINE = (state) => `/cle/static/art/pet-line/${state === "sleepy" ? "sleep" : "loaf"}-${night() ? "night" : "day"}.png`;
  const artNow = (state) => (lineMode() ? LINE(state) : ART.get(state) || FALLBACK[state]);
  const closedNow = (state) => (state === "rest" && !lineMode() ? (ART.get("rest") === ART_V2("rest") ? CLOSED_V2 : CLOSED) : "");

  /* ── 动作引擎的载入 ──────────────────────────────────────────────────
     laolao-cat-rig.js 应该由模块表排在本文件之前（主控注册）。在它还没被注册时，
     这里按同一路径自取一次，避免“已写好但永远不加载”；两边都有幂等守卫，重复载入无害。 */
  const RIG_SRC = "/cle/static/legacy/laolao-cat-rig.js";
  let rigLoading = null;
  const loadRig = () => {
    if (window.__pinkieCatRig) return Promise.resolve(window.__pinkieCatRig);
    if (rigLoading) return rigLoading;
    rigLoading = new Promise((resolve) => {
      const done = (value) => { rigLoading = null; resolve(value); };
      if (typeof document === "undefined" || !document.head) return done(null);
      if (document.querySelector(`script[data-cle-legacy="laolao-cat-rig.js"]`)) return done(window.__pinkieCatRig || null);
      const script = document.createElement("script");
      script.src = RIG_SRC;
      script.async = false;
      script.dataset.cleLegacy = "laolao-cat-rig.js";
      script.onload = () => done(window.__pinkieCatRig || null);
      script.onerror = () => { script.remove(); done(null); };
      document.head.append(script);
      setTimeout(() => { if (!window.__pinkieCatRig) done(null); }, 4000);
    });
    return rigLoading;
  };

  /* ── 宿主侧：每个可见 pane 一只，互不搬动 ──────────────────────────── */
  const instances = new Map();       // pane → instance
  let seq = 0;
  let lastFocused = null;

  const paneList = () => [...document.querySelectorAll(".chat-pane-cache__pane--visible, .chat-pane-cache__pane--active")]
    .filter((p) => !p.closest(".chat-pane-cache__pane--hidden"));
  const activePane = () => document.querySelector(".chat-pane-cache__pane--active");
  const focusedPane = () => lastFocused?.isConnected ? lastFocused : activePane() || paneList()[0] || null;
  /* 双栏嵌套时 pane.querySelector 会伸进隔壁/内层 pane，这里只取本 pane 自己拥有的节点 */
  const own = (pane, selector) => {
    const list = pane ? [...pane.querySelectorAll(selector)] : [];
    return list.find((el) => el.closest(".chat-pane-cache__pane") === pane) || null;
  };
  const ownAll = (pane, selector) => (pane ? [...pane.querySelectorAll(selector)] : [])
    .filter((el) => el.closest(".chat-pane-cache__pane") === pane);
  const shellOf = (pane) => own(pane, ".agent-chat__composer-shell");
  const textareaOf = (pane) => own(pane, ".agent-chat__composer-combobox textarea");
  const stopOf = (pane) => own(pane, ".chat-send-btn--stop");
  const threadOf = (pane) => own(pane, ".chat-thread");
  const innerOf = (pane) => own(pane, ".chat-thread-inner");

  function roomOfPane(pane) {
    let agent = "";
    try {
      const v = JSON.parse(pane?.dataset?.mcpAppOwnerKey || "null");
      agent = (String(Array.isArray(v) ? v[1] || "" : "").match(/^agent:([^:]+):/) || [])[1] || "";
    } catch {}
    const room = ROOM_OF_AGENT[agent];
    if (room) return room;
    const fallback = document.documentElement.getAttribute("data-cle-room");
    return MODES.includes(fallback) ? fallback : "chat";
  }

  const helperRpc = async (method, params, timeout = 10000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc !== "function") throw new Error("设置服务暂时未连接，请稍后再试");
    return rpc(method, params, timeout);
  };

  /* ── 模型请求（每个 pane 各自发、各自收，结果不串侧） ───────────────── */
  const DEMO = {
    explain: (t) => `<strong>${esc(t)}</strong>，用大白话说：${/api/i.test(t) ? "就像餐厅的点菜窗口——你按规矩递单子，后厨照单做菜，你不用进厨房" : /token/i.test(t) ? "模型读文字时用的「小积木块」，块数决定花多少钱、能记住多少" : "一个专门的工具或概念，碧琪会结合当前聊天讲给你"}。<div class="muted">样板演示回答，接上模型后会结合上下文现讲</div>`,
    summary: () => `一句话：碧琪把这周学习排成每天不超过 50 分钟，周三只复习 15 分钟，周末空着。<div class="muted">样板演示回答</div>`,
  };
  const ask = async (job, kind, payload) => {
    if (preview) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (kind === "clarify") return {text: `${payload.text.replace(/[？?。]*$/, "")}。请给我具体建议，并说明需要注意的地方。`};
      return {html: DEMO[kind] ? DEMO[kind](payload.text || "") : "这个功能还没有演示回答。"};
    }
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc === "function") {
      try {
        const res = await rpc("pinkie.companion.ask", {kind, mode: job.room, ...payload}, 135000);
        if (res && typeof res.text === "string" && res.text.trim()) return {html: esc(res.text).replace(/\n/g, "<br>"), text: res.text};
        if (res?.error) return {html: `这次没想出来：${esc(res.error)}`};
      } catch (error) {
        if (!/unknown method|not found|invalid/i.test(String(error?.message || ""))) return {html: `这次没连上：${esc(error?.message || error)}`};
      }
    }
    return {html: "小帮手还没连接独立模型，先保留你正在写的内容。"};
  };

  /* ── 一只碧琪 ───────────────────────────────────────────────────────── */
  class Buddy {
    constructor(pane) {
      this.id = `b${++seq}`;
      this.pane = pane;
      this.state = "rest";
      this.lastActivity = Date.now();
      this.happyUntil = 0;
      this.wasRunning = false;
      this.imageVersion = 0;
      this.askTicket = 0;          // 解释/总结/澄清：打开设置不该打断正在等结果的请求
      this.settingsRequest = 0;    // 设置窗口自己的世代号
      this.jobs = new Set();
      this.focus = null;
      this.rig = null;
      this.rigTried = false;
      this.firstMountAt = 0;
      this.bubbleTimer = 0;
      this.lastNarrated = "";
      this.lastNarrateAt = 0;
      this.room = roomOfPane(pane);
      this.active = true;
      this.build();
    }

    get shell() { return shellOf(this.pane); }
    get ta() { return textareaOf(this.pane); }
    get running() { return Boolean(stopOf(this.pane)); }
    get connected() { return Boolean(this.buddy?.isConnected && this.pane?.isConnected); }
    callUser() { return CALL[this.room] || "先生"; }

    build() {
      const buddy = el("div", "pinkie-buddy");
      buddy.dataset.state = "rest";
      buddy.dataset.room = this.room;
      buddy.dataset.side = this.id;
      this.buddy = buddy;

      const figure = el("button", "pinkie-buddy__figure");
      figure.type = "button";
      figure.setAttribute("aria-label", "碧琪，点我打开小菜单");
      figure.setAttribute("aria-haspopup", "menu");
      figure.setAttribute("aria-expanded", "false");
      figure.setAttribute("aria-controls", `pinkie-buddy-menu-${this.id}`);
      this.figure = figure;

      this.imgA = el("img", "pinkie-buddy__img is-front");
      this.imgB = el("img", "pinkie-buddy__img");
      this.imgA.alt = this.imgB.alt = "";
      this.imgA.src = artNow("rest");
      this.frontImg = this.imgA;
      figure.append(this.imgA, this.imgB);

      this.mark = el("span", "pinkie-buddy__mark");
      this.mark.setAttribute("aria-hidden", "true");
      this.mark.innerHTML = `<svg viewBox="0 0 20 20">${MARK[this.room] || MARK.chat}</svg>`;
      this.mark.title = MARK_LABEL[this.room] || "";
      figure.append(this.mark);

      this.caption = el("div", "pinkie-buddy__caption");
      this.bubble = el("div", "pinkie-buddy__bubble");
      this.bubble.setAttribute("role", "status");
      this.menu = el("div", "pinkie-buddy__menu");
      this.menu.setAttribute("role", "menu");
      this.menu.id = `pinkie-buddy-menu-${this.id}`;
      this.menu.inert = true; this.bubble.inert = true;
      buddy.append(figure, this.caption, this.bubble, this.menu);

      figure.addEventListener("pointerdown", () => { lastFocused = this.pane; });
      figure.addEventListener("click", (event) => { event.stopPropagation(); this.nudge("is-boop"); this.toggleMenu(); });
      figure.title = "左键打开小菜单，右键设置模型与参数";
      figure.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); this.openSettings(); });
      figure.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); event.stopPropagation(); this.openSettings();
        }
      });
      this.bubble.addEventListener("mouseenter", () => clearTimeout(this.bubbleTimer));
      this.bubble.addEventListener("mouseleave", () => { if (!this.bubble.dataset.sticky) this.scheduleHide(4000); });
      // 说明气泡和菜单都不许被下一侧的监听拿走：只处理自己这一只
      document.addEventListener("click", (event) => { if (!this.buddy.contains(event.target)) this.hideMenu(); });
      document.addEventListener("keydown", (event) => this.onKey(event));
      this.bubble.addEventListener("click", () => { lastFocused = this.pane; });
    }

    onKey(event) {
      if (event.key === "Escape" && (this.menu.classList.contains("is-shown") || this.bubble.classList.contains("is-shown"))) {
        event.preventDefault(); this.hideMenu(); this.hideBubble(); this.figure.focus(); return;
      }
      if (!this.menu.classList.contains("is-shown") || !this.buddy.contains(event.target)) return;
      const items = [...this.menu.querySelectorAll("button")];
      let index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") index = (index + 1) % items.length;
      else if (event.key === "ArrowUp") index = (index + items.length - 1) % items.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = items.length - 1;
      else return;
      event.preventDefault(); items[index]?.focus();
    }

    /* 动作引擎：画出第一帧后才藏静态图；不可用就一直是静态换图 */
    ensureRig() {
      if (this.rig || this.rigTried) return;
      if (!window.__pinkieCatRig) {
        // 还没就位：自己取一次（最多一次），取不到就一直用静态图
        if (!this.rigAsked) { this.rigAsked = true; loadRig().then(() => { if (this.connected) this.ensureRig(); }).catch(() => {}); }
        return;
      }
      if (!this.figure) return;
      if (!this.firstMountAt) this.firstMountAt = performance.now();
      const waited = performance.now() - this.firstMountAt;
      const settled = waited > 8000 || (waited > 1500 && !document.getElementById("laolao-splash") && !document.documentElement.hasAttribute("data-cle-room-pending"));
      if (!settled) return;
      this.rigTried = true;
      this.rig = window.__pinkieCatRig.attach(this.figure);
      if (!this.rig) return;
      this.rig.onReady = () => this.buddy.classList.add("is-rig");
      this.rig.onDead = () => { this.buddy.classList.remove("is-rig"); this.rig = null; };
      this.rig.setMood(this.state);
      this.rig.setImage(this.frontImg.src, closedNow(this.state));
      window.__pinkieCatRig.warm(STATES.map((s) => artNow(s)));
    }

    apply(state, force = false) {
      // 首次进入某状态时先用已知素材，v2 探测成功再无声升级，不阻塞动作
      if (!ART.has(state)) artFor(state).then(() => { if (this.connected && this.state === state) this.apply(state, true); });
      const src = artNow(state);
      if (!force && this.frontImg.getAttribute("src") === src) { this.rig?.setImage(src, closedNow(state)); return; }
      const back = this.frontImg === this.imgA ? this.imgB : this.imgA;
      const ticket = ++this.imageVersion;
      back.onload = () => {
        if (ticket !== this.imageVersion || back.getAttribute("src") !== src) return;
        back.onload = null;
        back.classList.add("is-front"); this.frontImg.classList.remove("is-front"); this.frontImg = back;
      };
      back.onerror = () => { back.onerror = null; if (ticket === this.imageVersion && src !== FALLBACK[state] && !lineMode()) { back.setAttribute("src", FALLBACK[state]); } };
      back.setAttribute("src", src);
      if (back.complete && back.naturalWidth) back.onload?.();
      this.rig?.setImage(src, closedNow(state));
    }

    setName(room) {
      this.room = room;
      this.buddy.dataset.room = room;
      this.mark.innerHTML = `<svg viewBox="0 0 20 20">${MARK[room] || MARK.chat}</svg>`;
      this.mark.title = MARK_LABEL[room] || "";
    }

    setState(next) {
      if (next === this.state) return;
      const from = this.state;
      this.state = next;
      this.buddy.dataset.state = next;
      this.apply(next);
      this.rig?.setMood(next);
      if (next === "happy") this.rig?.impulse("hop");
      if (from === "sleepy" && next !== "sleepy" && this.rig) {
        this.rig.impulse("wake");
        const r = this.figure.getBoundingClientRect();
        window.__pinkieImmersion?.floatMark?.(r.left + r.width * .32, r.top + r.height * .05, "sparkle");
      }
      if ((from === "rest" && ["typing", "working"].includes(next)) || next === "happy") this.nudge("is-perk");
    }

    nudge(cls) {
      this.rig?.impulse(cls === "is-boop" ? "boop" : "perk");
      this.buddy.classList.remove(cls);
      void this.buddy.offsetWidth;
      this.buddy.classList.add(cls);
      setTimeout(() => this.buddy.classList.remove(cls), 700);
    }

    /* ── 气泡与菜单 ─────────────────────────────────────────────────── */
    say(html, {sticky = false, ms = 6000, close = sticky} = {}) {
      this.hideMenu();
      this.bubble.innerHTML = html;
      if (close) {
        const x = el("button", "pinkie-buddy__close"); x.type = "button"; x.setAttribute("aria-label", "收起");
        x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        x.addEventListener("click", (e) => { e.stopPropagation(); this.hideBubble(); });
        this.bubble.append(x);
      }
      this.bubble.classList.toggle("has-close", close);
      this.bubble.dataset.sticky = sticky ? "1" : "";
      this.bubble.inert = false;
      this.bubble.classList.add("is-shown");
      clearTimeout(this.bubbleTimer);
      if (!sticky) this.scheduleHide(ms);
      this.reflow();
    }

    scheduleHide(ms) { clearTimeout(this.bubbleTimer); this.bubbleTimer = setTimeout(() => this.hideBubble(), ms); }
    hideBubble() { this.bubble.classList.remove("is-shown"); this.bubble.dataset.sticky = ""; this.bubble.inert = true; }
    hideMenu() { this.menu.classList.remove("is-shown"); this.menu.inert = true; this.figure.setAttribute("aria-expanded", "false"); }

    /* 气泡/菜单超出这一侧时往里收，不让它被窗口或 pane 裁掉（横向平移 + 纵向限高） */
    reflow() {
      for (const node of [this.bubble, this.menu]) {
        node.style.removeProperty("--buddy-shift");
        node.style.removeProperty("--buddy-shift-y");
        node.style.removeProperty("max-height");
        if (!node.classList.contains("is-shown")) continue;
        const pane = this.pane.getBoundingClientRect(), r = node.getBoundingClientRect();
        const left = Math.max(8, pane.left + 8), right = Math.min(innerWidth - 8, pane.right - 8);
        if (r.left < left) node.style.setProperty("--buddy-shift", `${Math.round(left - r.left)}px`);
        else if (r.right > right) node.style.setProperty("--buddy-shift", `${Math.round(right - r.right)}px`);
        // 向上展开的菜单在很矮的窗口里会顶出可视区：改成往下移一点，必要时限高滚动
        const top = Math.max(8, Math.min(pane.top, 0) + 8);
        if (r.top < top) {
          node.style.setProperty("--buddy-shift-y", `${Math.round(top - r.top)}px`);
          if (r.height > innerHeight - top - 8) node.style.maxHeight = `${Math.max(160, innerHeight - top - 16)}px`;
        }
      }
    }

    toggleMenu() {
      if (this.menu.classList.contains("is-shown")) return this.hideMenu();
      lastFocused = this.pane;
      this.hideBubble();
      this.menu.textContent = "";
      const item = (key, label, fn, hint = "") => {
        const b = el("button", `pinkie-buddy__item ico--${key}`); b.type = "button"; b.setAttribute("role", "menuitem");
        const ico = el("span", "pinkie-buddy__ico"); ico.innerHTML = ICON[key];
        b.append(ico, el("span", "pinkie-buddy__label", label));
        if (hint) b.append(el("span", "pinkie-buddy__hint", hint));
        b.addEventListener("click", (e) => { e.stopPropagation(); this.hideMenu(); fn(); });
        this.menu.append(b);
      };
      item("explain", "这是啥意思", () => this.explainFlow(), "选中词也行");
      item("summary", "一句话总结", () => this.summaryFlow());
      item("clarify", "帮我把问题问清楚", () => this.clarifyFlow());
      item("focus", this.focus ? "结束专注" : `专注 ${FOCUS_MINUTES} 分钟`, this.focus ? () => this.stopFocus() : () => this.startFocus());
      this.menu.append(el("div", "pinkie-buddy__sep"));
      item("ambient", prefs.ambient ? "关掉氛围" : "打开氛围", () => { prefs.ambient = !prefs.ambient; savePrefs(); ambient.sync(); });
      item("narrate", prefs.narrate ? "不播报进度" : "播报干活进度", () => { prefs.narrate = !prefs.narrate; savePrefs(); if (!prefs.narrate) this.caption.classList.remove("is-shown"); });
      item("settings", "模型与参数", () => this.openSettings(), "也可右键");
      this.menu.classList.add("is-shown");
      this.menu.inert = false; this.figure.setAttribute("aria-expanded", "true");
      this.reflow();
    }

    openSettings() {
      this.hideMenu(); this.hideBubble();
      const existing = this.settingsDialog;
      if (existing?.open) { existing.focus(); return; }
      existing?.remove();
      // 两个 pane 各有一只猫，但同一时刻只能有一个模态设置窗；后开的把先开的收掉
      for (const other of instances.values()) {
        if (other !== this && other.settingsDialog?.open) other.settingsDialog.close();
      }
      const originRoom = roomOfPane(this.pane), ticket = ++this.settingsRequest;
      const dialog = el("dialog", "pinkie-buddy-settings");
      this.settingsDialog = dialog;
      const titleId = `pinkie-buddy-settings-title-${this.id}`;
      dialog.setAttribute("aria-labelledby", titleId);
      const heading = el("div", "pinkie-buddy-settings__heading");
      const title = el("h2", "", `${MODE_NAMES[originRoom]} · 碧琪的模型与参数`); title.id = titleId;
      // 与气泡上的关闭一致：墨线图标，不用字符冒充控件
      const close = el("button", "pinkie-buddy-settings__close"); close.type = "button"; close.setAttribute("aria-label", "关闭模型设置");
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      close.addEventListener("click", () => dialog.close()); heading.append(title, close);
      const note = el("p", "pinkie-buddy-settings__note", "这组设置用于碧琪在输入框旁的解释、总结和提问整理。");
      const form = el("form", "pinkie-buddy-settings__form"), fields = el("fieldset", "pinkie-buddy-settings__fields");
      fields.disabled = true;
      const field = (label, input, hint = "") => { const row = el("label", "pinkie-buddy-settings__field"); row.append(el("span", "", label), input); if (hint) row.append(el("small", "", hint)); fields.append(row); return input; };
      const model = field("模型", el("select"));
      const thinking = field("思考强度", el("select"));
      const temperature = field("随机程度", el("input"), "留空使用模型默认值"); temperature.type = "number"; temperature.min = "0"; temperature.max = "2"; temperature.step = "0.1"; temperature.placeholder = "默认";
      const maxTokens = field("输出上限（Token）", el("input")); maxTokens.type = "number"; maxTokens.min = "256"; maxTokens.max = "32000"; maxTokens.step = "1"; maxTokens.required = true;
      const timeout = field("等待时间（秒）", el("input")); timeout.type = "number"; timeout.min = "5"; timeout.max = "120"; timeout.step = "1"; timeout.required = true;
      const sync = el("label", "pinkie-buddy-settings__sync"), allModes = el("input"); allModes.type = "checkbox"; sync.append(allModes, el("span", "", "同步到所有模式"));
      const status = el("p", "pinkie-buddy-settings__status", "正在读取设置…"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      const actions = el("div", "pinkie-buddy-settings__actions"), test = el("button", "pinkie-buddy-settings__button", "测试连接"), save = el("button", "pinkie-buddy-settings__button is-primary", "保存设置");
      test.type = "button"; save.type = "submit"; test.disabled = save.disabled = true; actions.append(test, save);
      form.append(fields, sync, status, actions); dialog.append(heading, note, form); document.body.append(dialog);
      dialog.addEventListener("close", () => { this.settingsRequest += 1; if (this.figure?.isConnected) this.figure.focus(); });
      dialog.showModal();
      let catalog = [], data = null;
      const live = () => this.settingsDialog === dialog && dialog.open && this.settingsRequest === ticket && roomOfPane(this.pane) === originRoom;
      const showStatus = (message, error = false) => { status.textContent = message; status.classList.toggle("is-error", error); };
      const capabilities = () => {
        const current = catalog.find((item) => item.id === (model.value || data?.defaultModel));
        const previous = thinking.value, levels = current?.thinkingLevels || ["auto"];
        thinking.textContent = "";
        for (const level of levels) { const o = el("option", "", {auto: "自动", low: "低", medium: "标准", high: "高"}[level] || level); o.value = level; thinking.append(o); }
        thinking.value = levels.includes(previous) ? previous : "auto"; thinking.disabled = levels.length === 1;
        temperature.disabled = current?.temperatureSupported === false; if (temperature.disabled) temperature.value = "";
        maxTokens.max = String(Math.min(32000, current?.maxTokens || 32000));
      };
      const render = (result) => {
        data = result; catalog = Array.isArray(result?.models) ? result.models : [];
        model.textContent = "";
        const fallback = el("option", "", `默认 · ${result.defaultModel || result.model || "未配置"}`); fallback.value = ""; model.append(fallback);
        for (const item of catalog) { const o = el("option", "", `${item.name} · ${item.id}`); o.value = item.id; model.append(o); }
        const value = result.settings || {model: "", thinking: "auto", temperature: null, maxTokens: 1600, timeoutSeconds: 25};
        if (value.model && !catalog.some((item) => item.id === value.model)) { const missing = el("option", "", `${value.model}（暂时不可用）`); missing.value = value.model; model.append(missing); }
        model.value = value.model || ""; capabilities(); thinking.value = [...thinking.options].some((o) => o.value === value.thinking) ? value.thinking : "auto";
        temperature.value = value.temperature == null ? "" : String(value.temperature); if (temperature.disabled) temperature.value = "";
        maxTokens.value = String(value.maxTokens); timeout.value = String(value.timeoutSeconds);
        fields.disabled = false; test.disabled = save.disabled = !catalog.length;
        showStatus(result.available ? "设置会记住，切回这个模式时继续使用。" : "当前模型暂时不可用，请换一个模型后测试连接。", !result.available);
      };
      const values = () => ({model: model.value, thinking: thinking.value || "auto", temperature: temperature.value === "" ? null : Number(temperature.value), maxTokens: Number(maxTokens.value), timeoutSeconds: Number(timeout.value)});
      model.addEventListener("change", () => { capabilities(); showStatus("参数已修改，保存后生效。"); });
      form.addEventListener("input", () => showStatus("参数已修改，保存后生效。"));
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); if (!live()) return;
        const settings = values(), syncAll = allModes.checked; fields.disabled = allModes.disabled = true; test.disabled = save.disabled = true; showStatus("正在保存…");
        try {
          const result = await helperRpc("pinkie.companion.settings.set", {mode: originRoom, settings, allModes: syncAll});
          if (live()) { render(result); showStatus(syncAll ? "已保存到所有模式。" : "已保存。下一次小碧琪回复会使用这组设置。"); }
        } catch (error) { if (live()) showStatus(error.message || "保存失败，请再试一次。", true); }
        finally { if (live()) { fields.disabled = allModes.disabled = false; test.disabled = save.disabled = !catalog.length; } }
      });
      test.addEventListener("click", async () => {
        if (!form.reportValidity() || !live()) return;
        const settings = values(), snapshot = JSON.stringify(settings); test.disabled = save.disabled = true; showStatus("正在测试连接…");
        try {
          const result = await helperRpc("pinkie.companion.test", {mode: originRoom, settings}, 135000);
          if (live()) showStatus(JSON.stringify(values()) === snapshot ? `连接正常 · ${Math.max(.1, result.latencyMs / 1000).toFixed(1)} 秒` : "参数已修改，请用当前设置重新测试。");
        } catch (error) { if (live()) showStatus(error.message || "未连接成功，可以换模型或调整参数后再试。", true); }
        finally { if (live()) test.disabled = save.disabled = !catalog.length; }
      });
      helperRpc("pinkie.companion.status", {mode: originRoom})
        .then((result) => { if (!live()) return; if (!Array.isArray(result?.models)) throw new Error("设置服务需要更新，重开 App 后再试。"); render(result); model.focus(); })
        .catch((error) => { if (live()) showStatus(error.message || "暂时读不到设置，请稍后重新打开。", true); });
    }

    /* ── 功能 ───────────────────────────────────────────────────────── */
    latestReply() {
      const groups = ownAll(this.pane, ".chat-group.assistant:not(.chat-group--timeline-step)");
      for (let i = groups.length - 1; i >= 0; i--) {
        const t = [...groups[i].querySelectorAll(".chat-text")].map((n) => n.innerText).join("\n").trim();
        if (t) return {text: t, group: groups[i]};
      }
      return {text: "", group: null};
    }
    pickTerms(group) {
      if (!group) return [];
      const seen = new Set(); const out = [];
      const add = (t) => { t = t.trim().replace(/[，。：:；;,.]+$/, ""); if (t.length < 2 || t.length > 24 || seen.has(t.toLowerCase())) return; seen.add(t.toLowerCase()); out.push(t); };
      group.querySelectorAll(".chat-text code").forEach((c) => { const t = c.textContent; if (t.split(/\s+/).length <= 3) add(t); });
      const text = [...group.querySelectorAll(".chat-text")].map((n) => n.innerText).join(" ");
      (text.match(/\b[A-Z][A-Za-z0-9.+#-]{1,}(?:\s[A-Z][A-Za-z0-9.+#-]+)?\b|\b[a-z]+(?:[-_.][a-z0-9]+)+\b/g) || []).forEach(add);
      return out.slice(0, 6);
    }
    async explain(term) {
      const ticket = ++this.askTicket, originRoom = this.room;
      const job = {room: originRoom}; this.jobs.add(job);
      this.setState("working");
      this.say(`我在想「${esc(term)}」怎么说最好懂 ${DOTS}`, {sticky: true, close: false});
      try {
        const res = await ask(job, "explain", {text: term, context: this.latestReply().text.slice(0, 1200)});
        if (ticket !== this.askTicket || originRoom !== this.room) return;
        this.happyUntil = Date.now() + 1800; this.setState("happy");
        this.say(res.html, {sticky: true});
      } finally { this.jobs.delete(job); }
    }
    explainFlow() {
      const sel = String(window.getSelection?.() || "").trim();
      if (sel && sel.length <= 60) return this.explain(sel);
      const terms = this.pickTerms(this.latestReply().group);
      if (!terms.length) return this.say(`${this.callUser()}在聊天里选中看不懂的词，我用大白话讲给你听。`);
      this.say(`最新回复里这几个词可能不好懂，点一个：<div class="pinkie-buddy__chips"></div>`, {sticky: true});
      const box = this.bubble.querySelector(".pinkie-buddy__chips");
      terms.forEach((t) => { const c = el("button", "pinkie-buddy__chip", t); c.type = "button"; c.addEventListener("click", (e) => { e.stopPropagation(); this.explain(t); }); box.append(c); });
    }
    async summaryFlow() {
      const reply = this.latestReply().text;
      if (reply.length < 120) return this.say("最新这条回复本来就很短，不用再缩了。");
      const ticket = ++this.askTicket, originRoom = this.room;
      const job = {room: originRoom}; this.jobs.add(job);
      this.setState("working"); this.say(`正在把它缩成一句话 ${DOTS}`, {sticky: true, close: false});
      try {
        const res = await ask(job, "summary", {text: reply.slice(0, 6000)});
        if (ticket !== this.askTicket || originRoom !== this.room) return;
        this.happyUntil = Date.now() + 1800; this.setState("happy"); this.say(res.html, {sticky: true});
      } finally { this.jobs.delete(job); }
    }
    async clarifyFlow() {
      const ta = this.ta;
      const draft = (ta?.value || "").trim();
      if (!draft) return this.say(`${this.callUser()}先在输入框里随便写几句，我帮你整理成更清楚的问题。`);
      const ticket = ++this.askTicket, originRoom = this.room;
      const job = {room: originRoom}; this.jobs.add(job);
      this.setState("working"); this.say(`我在帮你理一理 ${DOTS}`, {sticky: true, close: false});
      try {
        const res = await ask(job, "clarify", {text: draft, context: this.latestReply().text.slice(0, 1200)});
        if (ticket !== this.askTicket || originRoom !== this.room) return;
        this.setState("rest");
        if (res.text && ta) {
          this.say(`这样问会更清楚：<div class="pinkie-buddy__quote">${esc(res.text)}</div><div class="pinkie-buddy__chips"><button class="pinkie-buddy__chip is-primary" type="button" data-use>用这个</button><button class="pinkie-buddy__chip" type="button" data-keep>保留原来的</button></div>`, {sticky: true});
          this.bubble.querySelector("[data-use]").addEventListener("click", (e) => {
            e.stopPropagation();
            if (ta.value.trim() !== draft) return this.say("输入框里的内容已经变了，先保留你现在写的。", {sticky: true});
            ta.value = res.text; ta.dispatchEvent(new Event("input", {bubbles: true})); ta.focus(); this.hideBubble();
          });
          this.bubble.querySelector("[data-keep]").addEventListener("click", (e) => { e.stopPropagation(); this.hideBubble(); });
        } else this.say(res.html || "这次没整理出来。", {sticky: true});
      } finally { this.jobs.delete(job); }
    }

    /* 专注计时：这一侧的输入框上边沿一条细线 + 小时间 */
    async startFocus() {
      if (this.room === "learning") {
        try {
          const result = await helperRpc("pinkie.learning.focus.start", {minutes: FOCUS_MINUTES});
          this.focus = {...result.focus, ledger: true, end: result.focus.start + result.focus.plannedMinutes * 60_000};
        } catch (error) { this.say(esc(error.message)); return; }
      } else this.focus = {start: Date.now(), end: Date.now() + FOCUS_MINUTES * 60_000};
      this.shell?.setAttribute("data-pinkie-focus", "");
      this.say(`好，接下来 ${FOCUS_MINUTES} 分钟我陪${this.callUser()}专心，时间到了叫你休息。`);
    }
    stopFocus(done = false) {
      const finished = this.focus;
      if (finished?.ledger) void helperRpc("pinkie.learning.focus.stop", {id: finished.id}).catch((error) => this.say(esc(error.message)));
      this.focus = null;
      this.shell?.removeAttribute("data-pinkie-focus");
      this.shell?.style.removeProperty("--pinkie-focus-progress");
      this.caption.classList.remove("is-shown");
      if (done === true) {
        this.happyUntil = Date.now() + 3000; this.setState("happy"); burstFrom(this.figure, "done");
        this.say(`${this.callUser()}专注了 ${FOCUS_MINUTES} 分钟，好。起来伸个懒腰、看看远处、喝口水吧。`, {sticky: true});
      }
    }
    tickFocus() {
      if (!this.focus) return;
      const left = Math.max(0, this.focus.end - Date.now());
      this.shell?.style.setProperty("--pinkie-focus-progress", String(1 - left / (this.focus.end - this.focus.start)));
      const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      this.caption.textContent = `专注 ${m}:${String(s).padStart(2, "0")}`;
      this.caption.classList.add("is-shown");
      if (!left) this.stopFocus(true);
    }

    narrate() {
      if (!prefs.narrate || this.focus) return;
      const rows = ownAll(this.pane, ".pinkie-process .chat-tool-msg-summary");
      const last = rows[rows.length - 1];
      const raw = last ? last.textContent.replace(/\s+/g, " ").trim() : "";
      if (!raw || raw === this.lastNarrated || Date.now() - this.lastNarrateAt < 2500) return;
      this.lastNarrated = raw; this.lastNarrateAt = Date.now();
      const hit = PLAIN.find(([re]) => re.test(raw));
      this.caption.textContent = `碧琪 ${hit ? hit[1] : "在忙一个小步骤"}`;
      this.caption.classList.add("is-shown");
    }

    /* 状态机：每 400ms 由 loop 推进一次 */
    tick() {
      const now = Date.now();
      if (!this.active || !this.connected) return;
      const room = roomOfPane(this.pane);
      if (room !== this.room) {
        if (this.settingsDialog?.open) this.settingsDialog.close();
        this.setName(room); this.askTicket += 1; this.settingsRequest += 1; this.hideBubble(); this.hideMenu();
        this.apply(this.state, true);
      }
      const run = this.running;
      const ta = this.ta;
      const typing = Boolean(ta && document.activeElement === ta && ta.value.trim());
      const helping = this.jobs.size > 0;
      if (run || typing || helping) this.lastActivity = now;
      if (this.wasRunning && !run) {
        this.happyUntil = now + 2200; this.lastNarrated = ""; this.caption.classList.remove("is-shown");
        setTimeout(() => burstFrom(this.figure, "done"), 120);
      }
      this.wasRunning = run;
      let next = "rest";
      if (run || helping) next = "working";
      else if (now < this.happyUntil) next = "happy";
      else if (typing) next = "typing";
      else if (now - this.lastActivity > SLEEPY_AFTER && !this.focus) next = "sleepy";
      if (preview && this.previewUntil > now) next = this.previewState;
      this.setState(next);
      this.gaze(run, typing, ta);
      if (run) this.narrate(); else if (!this.focus) this.caption.classList.remove("is-shown");
      this.tickFocus();
    }

    gaze(run, typing, ta) {
      const rig = this.rig;
      if (!rig) return;
      if (Date.now() < this.lookUpUntil) return;
      if (run) {
        const bubbles = ownAll(this.pane, ".chat-group.assistant .chat-bubble");
        const r = bubbles[bubbles.length - 1]?.getBoundingClientRect();
        if (r && r.bottom > 0 && r.top < innerHeight) { rig.attend(r.left + Math.min(r.width * .4, 420), Math.min(r.bottom, innerHeight - 160) - 30); return; }
      }
      if (typing && ta) { const r = ta.getBoundingClientRect(); rig.attend(r.left + r.width * .3, r.top + r.height / 2); return; }
      rig.attend(null);
    }

    lookUpAtThread() {
      if (!this.rig) return;
      const r = threadOf(this.pane)?.getBoundingClientRect();
      if (!r) return;
      this.lookUpUntil = Date.now() + 1500;
      this.rig.attend(r.left + r.width * .45, r.bottom - 260, 1500);
      this.rig.impulse("pulse");
    }

    /* 真实安全空间：正文最后一段可以滚到猫上方，猫不压字 */
    reserve() {
      // 按猫的实际显示高度留空间；量不到时按宽高比推算，再保底 72px（窄屏猫也不压字）
      const inner = innerOf(this.pane);
      const rect = this.figure?.getBoundingClientRect() || {width: 0, height: 0};
      const w = rect.width || this.figure?.clientWidth || 168;
      const h = rect.height > 8 && rect.height < 400 ? rect.height : w / (366 / 438);
      // 追加卡（chat-queue）在输入框上方时，猫要跟着抬高，不压住待发内容
      const queue = own(this.pane, ".chat-queue");
      const qh = queue ? Math.round(queue.getBoundingClientRect().height || 0) : 0;
      const lift = qh ? Math.min(220, qh + 6) : 0;
      const room = Math.round(Math.max(72, h + 16));
      // 只在数值变了才写样式，避免每 400ms 触发一次无意义的样式重算
      if (this.safeRoom !== room) {
        this.safeRoom = room;
        this.pane.setAttribute("data-pinkie-safe", "");
        this.pane.setAttribute("data-pinkie-buddy", "");
        this.pane.style.setProperty("--pinkie-safe", `${room}px`);
        if (inner) inner.style.setProperty("--pinkie-safe", `${room}px`);
      }
      if (this.liftPx !== lift) {
        this.liftPx = lift;
        if (lift) this.buddy.style.setProperty("--buddy-lift", `${lift}px`);
        else this.buddy.style.removeProperty("--buddy-lift");
        this.pane.toggleAttribute("data-pinkie-queue", Boolean(lift));
      }
    }

    dispose() {
      clearTimeout(this.bubbleTimer);
      this.safeRoom = 0; this.liftPx = 0;
      this.rig?.destroy?.(); this.rig = null;
      this.settingsDialog?.remove();
      this.buddy.remove();
      this.pane.removeAttribute("data-pinkie-safe");
      this.pane.removeAttribute("data-pinkie-buddy");
      this.pane.removeAttribute("data-pinkie-queue");
      this.pane.style.removeProperty("--pinkie-safe");
      innerOf(this.pane)?.style.removeProperty("--pinkie-safe");
    }

    /* 这一侧被缓存/隐藏时停掉动作和轮询，但保留菜单、专注计时和对话状态；
       再回到可见时继续用同一只，不重建、不丢旧的工具入口。 */
    pause() { this.active = false; this.rig?.pause(true); }
    resume() { this.active = true; this.rig?.pause(false); }
  }

  const DOTS = '<span class="pinkie-buddy__dots"><i></i><i></i><i></i></span>';
  const PLAIN = [
    [/list files|\bls\b|find files|查看目录/i, "在翻文件夹"], [/读取文件|\bread\b|show .*\.(md|txt|json)/i, "在读一份文件"],
    [/写入文件|\bwrite\b|编辑文件|\bedit\b|apply_patch/i, "在改文件"], [/web_search|搜索/i, "在网上查资料"],
    [/web_fetch|读取网页|browser|浏览器/i, "在看网页"], [/ffmpeg|视频|剪辑|渲染/i, "在处理视频"],
    [/\btest\b|测试|pytest/i, "在跑测试"], [/\bgit\b/i, "在看改动记录"], [/npm|pip|brew|install|安装/i, "在装工具"],
    [/exec|执行命令/i, "在电脑上执行命令"],
  ];

  // 线描/油画、昼/夜一换，猫跟着换（不重建实例、不打断动作）
  if (typeof MutationObserver === "function") new MutationObserver(() => { for (const i of instances.values()) if (i.connected) i.apply(i.state, true); })
    .observe(document.documentElement, {attributes: true, attributeFilter: ["data-cle-art", "data-pinkie-night", "data-theme"]});

  /* ── 挂载 / 卸下：以可见 pane 为准，不再用第一个 pane ───────────────── */
  const mount = () => {
    const panes = paneList();
    for (const pane of panes) {
      const shell = shellOf(pane);
      if (!shell) continue;
      let inst = instances.get(pane);
      if (!inst) {
        if (getComputedStyle(shell).position === "static") shell.style.position = "relative";
        inst = new Buddy(pane);
        instances.set(pane, inst);
        shell.append(inst.buddy);
        const track = shell.querySelector(".pinkie-focus-track") || el("span", "pinkie-focus-track");
        track.setAttribute("aria-hidden", "true");
        if (!track.parentElement) shell.append(track);
        artFor("rest").then(() => { if (inst.connected) inst.apply(inst.state, true); });
      } else if (inst.buddy.parentElement !== shell) {
        if (getComputedStyle(shell).position === "static") shell.style.position = "relative";
        shell.append(inst.buddy);
      }
      inst.reserve();
      inst.ensureRig();
    }
    // 还在 DOM 里但这一轮不可见的缓存 pane：保留实例，只停动作；真正被销毁的才回收
    for (const [pane, inst] of [...instances]) {
      if (!pane.isConnected) { inst.dispose(); instances.delete(pane); continue; }
      const visible = panes.includes(pane);
      if (visible) inst.resume(); else inst.pause();
    }
  };

  const loop = () => {
    mount();
    const visible = paneList();
    for (const inst of instances.values()) {
      if (!visible.includes(inst.pane)) continue;
      try { inst.tick(); } catch (e) { console.error("[pinkie-buddy]", e); }
    }
    const anyRun = [...instances.values()].some((i) => visible.includes(i.pane) && i.running);
    document.documentElement.toggleAttribute("data-pinkie-running", anyRun);
    document.documentElement.toggleAttribute("data-pinkie-focus", [...instances.values()].some((i) => i.focus));
  };

  /* ── 点缀：花瓣与金箔（沿用原版，按模式只换颜色） ───────────────────── */
  const matter = (() => {
    const cache = new Map();
    const make = (key, size, paint) => {
      if (cache.has(key)) return cache.get(key);
      const c = document.createElement("canvas"); c.width = c.height = size;
      const x = c.getContext("2d"); x.translate(size / 2, size / 2); paint(x, size / 2); cache.set(key, c); return c;
    };
    const night = () => document.documentElement.getAttribute("data-theme-mode") === "dark";
    const petal = () => make("petal", 64, (x, r) => {
      const g = x.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, "#fffdf6"); g.addColorStop(.62, "#f3ead6"); g.addColorStop(1, "#d9c49a");
      x.fillStyle = g; x.beginPath(); x.moveTo(0, -r * .92);
      x.bezierCurveTo(r * .78, -r * .6, r * .62, r * .55, 0, r * .9);
      x.bezierCurveTo(-r * .62, r * .55, -r * .78, -r * .6, 0, -r * .92); x.fill();
      x.strokeStyle = "rgba(170,140,80,.35)"; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, r * .82); x.quadraticCurveTo(r * .06, 0, 0, -r * .55); x.stroke();
    });
    const flake = (v) => make(`flake${v}`, 48, (x, r) => {
      const pts = 6 + v; x.beginPath();
      for (let k = 0; k < pts; k++) { const a = k / pts * 6.283, rr = r * (.45 + .4 * Math.abs(Math.sin(k * 2.7 + v))); x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * .8); }
      x.closePath();
      const g = x.createLinearGradient(-r, -r, r, r); g.addColorStop(0, "#8a6a26"); g.addColorStop(.45, "#f3d488"); g.addColorStop(.55, "#fff2c4"); g.addColorStop(1, "#a37b2c");
      x.fillStyle = g; x.fill();
    });
    const mote = () => make("mote", 48, (x, r) => {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, "rgba(190,225,255,.95)"); g.addColorStop(.25, "rgba(90,168,255,.45)"); g.addColorStop(1, "rgba(47,107,255,0)");
      x.fillStyle = g; x.fillRect(-r, -r, r * 2, r * 2);
    });
    const draw = (ctx, p) => {
      const img = p.kind === "petal" ? petal() : p.kind === "mote" ? mote() : flake(p.v || 0);
      const fx = Math.cos(p.flip);
      let alpha = p.a;
      if (p.kind === "flake") alpha *= .55 + .45 * Math.pow(Math.abs(fx), 6) + (Math.abs(fx) > .96 ? .5 : 0);
      if (p.kind === "petal" && night()) alpha *= .85;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(p.kind === "mote" ? 1 : Math.max(.08, Math.abs(fx)), 1);
      ctx.drawImage(img, -p.s, -p.s, p.s * 2, p.s * 2); ctx.restore();
    };
    return {draw};
  })();

  const fx = (() => {
    let canvas, ctx, parts = [], raf = 0;
    const fit = () => { const d = Math.min(2, devicePixelRatio || 1); canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const ensure = () => { if (canvas) return; canvas = el("canvas", "pinkie-burst"); document.body.append(canvas); ctx = canvas.getContext("2d"); fit(); addEventListener("resize", fit); };
    const spawn = (x, y, kind) => {
      ensure();
      const send = kind === "send", n = send ? 5 : 14;
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (Math.random() - .5) * Math.PI * (send ? .6 : 1.1);
        const sp = (send ? 1.2 : 2) + Math.random() * (send ? 1 : 2.2);
        const k = i % 3 === 0 ? "petal" : "flake";
        parts.push({kind: k, v: i % 3, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: Math.random() * 6.28, vr: (Math.random() - .5) * .08,
          flip: Math.random() * 6.28, vf: .08 + Math.random() * .12, s: k === "petal" ? 5 + Math.random() * 3 : 2.2 + Math.random() * 2.2,
          a: 1, life: 1, decay: send ? .016 : .009});
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.vx *= .955; p.vy = p.vy * .955 + .035; p.x += p.vx + Math.sin(p.flip) * .25; p.y += p.vy;
        p.rot += p.vr; p.flip += p.vf; p.life -= p.decay; p.a = Math.min(1, p.life * 1.6);
        matter.draw(ctx, p);
      }
      ctx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(tick) : 0;
      if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    return {spawn};
  })();
  const burstFrom = (node, kind) => {
    if (reduced() || !node?.isConnected) return;
    const r = node.getBoundingClientRect();
    fx.spawn(r.left + r.width / 2, r.top + (kind === "send" ? r.height / 2 : r.height * .3), kind);
  };

  /* 发送：按钮回弹 + 一小撮点缀 + 抬头看一眼 */
  const onSend = (pane) => {
    const inst = instances.get(pane);
    if (!inst || inst.running || !textareaOf(pane)?.value.trim()) return;
    const btn = own(pane, ".agent-chat__input .chat-send-btn:not(.chat-send-btn--stop)");
    const box = own(pane, ".agent-chat__input");
    if (btn) burstFrom(btn, "send");
    inst.lookUpAtThread();
    if (box) { box.classList.remove("is-sent"); void box.offsetWidth; box.classList.add("is-sent"); setTimeout(() => box.classList.remove("is-sent"), 700); }
  };
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".chat-pane-cache__pane .agent-chat__input .chat-send-btn:not(.chat-send-btn--stop)");
    if (btn) onSend(btn.closest(".chat-pane-cache__pane"));
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.altKey) return;
    const ta = e.target.closest?.(".chat-pane-cache__pane .agent-chat__composer-combobox textarea");
    if (ta && ta.value.trim()) onSend(ta.closest(".chat-pane-cache__pane"));
  }, true);

  /* 打字反馈 / 鼠标视线 / 滚动惯性：只作用在事件所在的那一侧 */
  document.addEventListener("input", (e) => {
    const ta = e.target.closest?.(".chat-pane-cache__pane .agent-chat__composer-combobox textarea");
    if (!ta) return;
    const inst = instances.get(ta.closest(".chat-pane-cache__pane"));
    inst?.rig?.impulse("key");
  }, true);
  let lookPending = null;
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const pane = e.target.closest?.(".chat-pane-cache__pane");
    if (pane) lastFocused = pane;
    const inst = pane ? instances.get(pane) : null;
    if (!inst?.rig) return;
    lookPending = {inst, x: e.clientX, y: e.clientY};
    if (lookPending.queued) return;
    lookPending.queued = true;
    requestAnimationFrame(() => { const p = lookPending; lookPending = null; if (p && p.inst.state !== "sleepy") p.inst.rig?.look(p.x, p.y); });
  }, {passive: true});
  document.documentElement.addEventListener("pointerleave", () => { for (const i of instances.values()) i.rig?.look(null); });

  let scrollSum = 0, scrollPane = null, scrollPending = false;
  document.addEventListener("wheel", (e) => {
    const thread = e.target.closest?.(".chat-pane-cache__pane .chat-thread");
    if (!thread) return;
    const pane = thread.closest(".chat-pane-cache__pane");
    scrollPane = pane; scrollSum += e.deltaY;
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      instances.get(scrollPane)?.rig?.impulse("scroll", scrollSum);
      scrollSum = 0;
    });
  }, {passive: true, capture: true});

  ["keydown", "pointerdown", "wheel"].forEach((t) => window.addEventListener(t, () => {
    const pane = focusedPane();
    const inst = pane ? instances.get(pane) : null;
    if (inst) inst.lastActivity = Date.now();
  }, {passive: true}));

  // 转场失败时不会发 finished，最多停 15 秒就自己恢复
  let rigResume = 0;
  window.addEventListener("laolao:mode-transition-start", () => {
    for (const i of instances.values()) i.rig?.pause(true);
    clearTimeout(rigResume);
    rigResume = setTimeout(() => { for (const i of instances.values()) i.rig?.pause(false); }, 15000);
  });
  window.addEventListener("laolao:mode-transition-finished", () => {
    clearTimeout(rigResume);
    for (const i of instances.values()) i.rig?.pause(false);
  });

  if (preview) window.addEventListener("pinkie:preview-state", (event) => {
    if (!STATES.includes(event.detail)) return;
    mount();
    const pane = focusedPane();
    const inst = pane ? instances.get(pane) : [...instances.values()][0];
    if (!inst) return;
    inst.previewState = event.detail; inst.previewUntil = Date.now() + 10000; inst.setState(inst.previewState);
    if (inst.previewState === "happy") burstFrom(inst.figure, "done");
  });

  /* 选中聊天文字时出现「问碧琪」 */
  window.__pinkieSelectionActions?.register("ask", {
    order: 2,
    when: ({text, library}) => library ? text.length <= 20000 : text.length <= 60,
    create: () => {
      const chip = el("button", "pinkie-buddy-ask");
      const ico = el("span", "pinkie-buddy__ico"); ico.innerHTML = ICON.explain;
      chip.append(ico, el("span", "", "问碧琪"));
      return chip;
    },
    run: (selected) => {
      if (selected.library) return void window.__pinkieLibrary?.askSelection(selected).catch((error) => console.warn("[cle] library ask", error));
      const pane = focusedPane();
      const inst = (pane && instances.get(pane)) || [...instances.values()][0];
      if (inst) inst.explain(selected.text);
    },
  });

  /* ── 氛围画布（只挂在当前活动 pane 的 .chat-main 上） ─────────────────── */
  const ambient = (() => {
    let canvas = null, ctx = null, raf = 0, last = 0, flow = 1, w = 0, h = 0, currentRoom = "", parts = [], t0 = performance.now();
    let resizeObserver = null;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const ROOM = {
      chat: {n: 9, kinds: ["petal", "petal", "petal", "flake"]},
      project: {n: 12, kinds: ["flake"]},
      thinking: {n: 16, kinds: ["mote", "mote", "mote", "flake"]},
      learning: {n: 18, kinds: ["flake", "flake", "petal"]},
      unrestricted: {n: 14, kinds: ["petal", "flake", "flake"]},
    };
    const room = () => {
      const pane = activePane();
      return pane ? roomOfPane(pane) : (MODES.includes(document.documentElement.getAttribute("data-cle-room")) ? document.documentElement.getAttribute("data-cle-room") : "chat");
    };
    const make = (m, fresh) => {
      const R = ROOM[m] || ROOM.chat, kind = R.kinds[Math.floor(Math.random() * R.kinds.length)];
      const big = kind === "petal" ? rnd(4, 7.5) : kind === "mote" ? rnd(5, 11) : rnd(1.8, 3.6);
      return {kind, v: Math.floor(rnd(0, 3)), x: rnd(0, w), y: fresh ? rnd(0, h) : (m === "thinking" ? h + 20 : -20), s: big,
        rot: rnd(0, 6.28), vr: rnd(-.25, .25), flip: rnd(0, 6.28), vf: rnd(.4, 1.1), ph: rnd(0, 6.28), sp: rnd(.6, 1.2),
        a: kind === "mote" ? rnd(.25, .5) : rnd(.35, .7), lane: rnd(0, 1)};
    };
    const seed = () => { parts = []; const R = ROOM[currentRoom] || ROOM.chat; for (let i = 0; i < R.n; i++) parts.push(make(currentRoom, true)); };
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      const d = Math.min(1.5, devicePixelRatio || 1);
      w = r.width; h = r.height; canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); ctx.setTransform(d, 0, 0, d, 0, 0);
      seed();
    };
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      const imm = window.__pinkieImmersion, ptr = imm?.pointer && now - imm.pointer.t < 1500 ? imm.pointer : null;
      const boost = 1 + (document.documentElement.hasAttribute("data-pinkie-running") ? .6 : 0) + (imm?.energy || 0) * .8;
      flow += (boost - flow) * .05;
      const dt = Math.min(.1, (now - last) / 1000) * flow; last = now;
      const t = (now - t0) / 1000, m = currentRoom;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.ph += dt * p.sp; p.rot += p.vr * dt; p.flip += p.vf * dt;
        if (m === "thinking") { p.y -= (p.kind === "mote" ? 9 : 5) * p.sp * dt; p.x += Math.sin(p.ph * .7) * 6 * dt; }
        else if (m === "learning") { p.x += 14 * p.sp * dt; p.y += (5 + Math.sin(p.ph) * 4) * dt; }
        else if (m === "unrestricted") {
          const u = t * .06 * p.sp + p.lane * 6.283, sc = Math.min(w, h * 1.6) * .42, den = 1 + Math.sin(u) ** 2;
          const tx = w / 2 + sc * Math.cos(u) / den, ty = h * .42 + sc * .55 * Math.sin(u) * Math.cos(u) / den;
          p.x += (tx + Math.sin(p.ph) * 24 - p.x) * Math.min(1, dt * .8); p.y += (ty + Math.cos(p.ph) * 18 - p.y) * Math.min(1, dt * .8);
        } else { p.y += (p.kind === "flake" ? 7 : 11) * p.sp * dt; p.x += Math.sin(p.ph) * 9 * dt; }
        if (ptr) { const dx = p.x - ptr.x, dy = p.y - ptr.y, d = Math.hypot(dx, dy); if (d < 120 && d > 1) { const k = (1 - d / 120) * 50 * dt / d; p.x += dx * k; p.y += dy * k; } }
        if (p.y > h + 30 || p.y < -30 || p.x > w + 30 || p.x < -30) parts[i] = Object.assign(make(m, false), m === "learning" ? {x: -10, y: rnd(0, h * .8)} : {});
        // 靠近顶部和底部渐隐，避开输入框与标题栏
        const edge = Math.min(1, p.y / (h * .12), (h - p.y) / (h * .22));
        const q = parts[i]; const a0 = q.a; q.a = a0 * Math.max(0, edge);
        matter.draw(ctx, q); q.a = a0;
      }
      ctx.globalAlpha = 1;
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const sync = () => {
      const ap = activePane();
      const card = ap ? own(ap, ".chat-main") : null;
      const want = prefs.ambient && !reduced() && !document.hidden && card && !document.documentElement.hasAttribute("data-cle-room-pending") && !document.getElementById("laolao-splash") && !document.getElementById("cle-splash");
      if (!want) { stop(); canvas?.classList.remove("is-on"); return; }
      if (!canvas || canvas.parentElement !== card) {
        resizeObserver?.disconnect(); canvas?.remove();
        if (getComputedStyle(card).position === "static") card.style.position = "relative";
        canvas = el("canvas", "pinkie-ambient"); ctx = canvas.getContext("2d"); card.prepend(canvas);
        currentRoom = ""; resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => canvas && resize())); resizeObserver.observe(card);
      }
      if (currentRoom !== room()) { currentRoom = room(); resize(); }
      canvas.classList.add("is-on");
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); }
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("laolao:modechange", sync);
    window.addEventListener("laolao:mode-transition-start", () => { stop(); canvas?.classList.remove("is-on"); });
    window.addEventListener("laolao:mode-transition-finished", () => setTimeout(sync, 300));
    return {sync};
  })();

  setInterval(() => { try { loop(); ambient.sync(); } catch (e) { console.error("[pinkie-buddy]", e); } }, 400);
  const ready = Promise.all(STATES.map((s) => artFor(s)));
  window.__pinkieBuddy = {
    get rig() { return (focusedPane() && instances.get(focusedPane()))?.rig || null; },
    get instances() { return [...instances.values()]; },
    get state() { const i = focusedPane() && instances.get(focusedPane()); return i?.state || "rest"; },
    ready,
    artFor,
    say: (t) => { const i = focusedPane() && instances.get(focusedPane()); i?.say(esc(t)); },
    setState: (s) => { const i = focusedPane() && instances.get(focusedPane()); i?.setState(s); },
    explain: (t) => { const i = focusedPane() && instances.get(focusedPane()); i?.explain(t); },
    startFocus: () => { const i = focusedPane() && instances.get(focusedPane()); i?.startFocus(); },
    stopFocus: (d) => { const i = focusedPane() && instances.get(focusedPane()); i?.stopFocus(d); },
    ambient, prefs,
    burst: (k) => { const i = focusedPane() && instances.get(focusedPane()); if (i) burstFrom(i.figure, k); },
    onSend: () => { const p = focusedPane(); if (p) onSend(p); },
    toggleMenu: () => { const i = focusedPane() && instances.get(focusedPane()); i?.toggleMenu(); },
    openSettings: () => { const i = focusedPane() && instances.get(focusedPane()); i?.openSettings(); },
    mount,
  };
  // 第一屏先挂上，别等 400ms
  mount();
})();
