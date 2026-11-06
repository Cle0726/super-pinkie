/* 进阶调节 · 给性能好的电脑放开用，也可以省着用。
 * Reads and writes only through window.PinkieTuning (laolao-tuning.js) and the
 * existing motion switch (window.__pinkieMotion) and 小碧琪 氛围 preference, so
 * nothing here can disagree with another switch. Nothing looks at the hardware:
 * every choice is the user's. Entry points: the workspace rail button (under
 * 灵感圆桌), the 小碧琪 menu, and window.__pinkiePower.open(). */
(() => {
  "use strict";
  if (window.__pinkiePower) return;
  const T = () => window.PinkieTuning;
  const BUDDY_PREF_KEY = "pinkie-buddy-prefs-v1";
  const ART = (name) => `./laolao-pinkie-${name}.png`;

  const LEVELS = [
    {id: "saver", title: "省着用", line: "电脑吃力时用：帧率和粒子减半，记录少载一些。", art: "buddy-chat-sleepy"},
    {id: "standard", title: "标准", line: "现在的样子。没动过设置就是这一档。", art: "buddy-chat-rest", badge: "默认"},
    {id: "max", title: "全开", line: "电脑性能好就放开：更顺、更清楚、记录载得更多。", art: "buddy-unrestricted-happy"},
  ];

  const num = (n) => n >= 10000 ? `${n / 10000} 万` : String(n);
  const chars = (n) => `${num(n)} 字`;
  const GROUPS = [
    {id: "effects", icon: "✨", title: "特效", hint: "氛围画布、彩带和小动画。", rows: [
      {kind: "motion", title: "减少动效", hint: "容易晕动或想安静时打开。这是舒适选项，不跟着档位变。", cost: "不影响性能档位"},
      {kind: "ambient", title: "聊天背景氛围", hint: "聊天卡片后面飘着的气球、光点。和小碧琪菜单里的「氛围」是同一个开关。", cost: "关掉最省电"},
      {key: "effects.ambientFps", title: "氛围帧率", hint: "背景动画每秒画几次。越高越顺滑。", cost: "60 帧大约多用一倍显卡",
        label: (v) => `${v} 帧`},
      {key: "effects.particles", title: "粒子数量", hint: "背景光点、发送和完成时彩带的数量。", cost: "粒子越多越费显卡",
        label: (v) => `${v}×`},
    ]},
    {id: "render", icon: "🖼️", title: "渲染", hint: "画布画得多清楚。", rows: [
      {key: "render.pixelRatio", title: "画布清晰度", hint: "背景氛围、小碧琪、激光笔这些画布的分辨率。「原生」按屏幕本身的清晰度画。", cost: "原生在高分屏上像素多 1～3 倍",
        label: (v) => ({low: "低（1×）", standard: "标准", native: "原生"})[v]},
    ]},
    {id: "history", icon: "💬", title: "聊天记录与长回复", hint: "打开聊天时先载入多少、长回复显示多长。往上翻还能继续读更早的。", rows: [
      {key: "history.liveWindow", title: "先载入多少条", hint: "打开聊天时先放进页面的消息条数。", cost: "条数越多，打开越慢、占内存越多", label: (v) => `${v} 条`},
      {key: "history.pageSize", title: "每次读多少条", hint: "向碧琪要一页记录时的大小。", cost: "大页少跑几趟，但每趟更久", label: (v) => `${v} 条`},
      {key: "history.scanPages", title: "最多连读几页", hint: "开头一口气最多读几页来凑够上面的条数。", cost: "页数多，长对话打开更慢", label: (v) => `${v} 页`},
      {key: "history.maxChars", title: "单条回复最多显示", hint: "很长的回复超过这个长度会截断。50 万是网关允许的最大值。", cost: "越长越占内存", label: chars},
      {key: "process.maxCards", title: "思考过程保留几轮", hint: "每轮的「碧琪在想…」过程卡，最多记住多少轮。", cost: "存在本机，多了占一点空间", label: (v) => `${v} 轮`},
      {key: "process.maxText", title: "思考过程文字长度", hint: "一张过程卡最多留多少字，超出时先丢最早的。", cost: "越长越占内存", label: chars},
    ]},
    {id: "warmup", icon: "🚀", title: "预加载", hint: "空闲时先把常去的页面备好，点过去更快。", rows: [
      {key: "warmup.idleRoutes", title: "空闲时先备几页", hint: "启动后空闲时提前准备的侧栏页面数。0 就是不提前备。", cost: "多备几页多一点网络和内存", label: (v) => v ? `${v} 页` : "不备"},
      {key: "warmup.maxRoutes", title: "最多备几页", hint: "鼠标经过链接时也会提前准备，这是总上限。", cost: "同上", label: (v) => `${v} 页`},
    ]},
    {id: "ink", icon: "🖊️", title: "画笔", hint: "激光笔和画笔。", rows: [
      {key: "ink.scale", title: "笔迹长度", hint: "激光笔拖尾和一笔最多记住的点数。", cost: "长笔迹多画几百个点", label: (v) => `${v}×`},
    ]},
  ];

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const buddyPrefs = () => { try { return {ambient: true, ...JSON.parse(localStorage.getItem(BUDDY_PREF_KEY) || "{}")}; } catch { return {ambient: true}; } };
  const setAmbient = (on) => {
    const live = window.__pinkieBuddy?.prefs;
    if (live) live.ambient = on;
    const next = {...buddyPrefs(), ...(live || {}), ambient: on};
    try { localStorage.setItem(BUDDY_PREF_KEY, JSON.stringify(next)); } catch {}
    window.__pinkieBuddy?.ambient?.sync?.();
  };
  const ambientOn = () => (window.__pinkieBuddy?.prefs ? window.__pinkieBuddy.prefs.ambient !== false : buddyPrefs().ambient !== false);

  let root = null, dialog = null, lastFocus = null;
  const refs = {levels: new Map(), rows: [], status: null, custom: null};

  function segment(parent, entries, onPick) {
    const group = el("div", "pinkie-power__seg", parent);
    group.setAttribute("role", "radiogroup");
    return entries.map(([value, label, tag]) => {
      const b = el("button", "pinkie-power__opt", group);
      b.type = "button"; b.setAttribute("role", "radio");
      el("span", "pinkie-power__opt-label", b, label);
      if (tag) el("span", "pinkie-power__opt-tag", b, tag);
      b.addEventListener("click", () => onPick(value));
      return [value, b];
    });
  }
  const press = (pairs, current) => {
    for (const [value, node] of pairs) {
      const on = value === current;
      node.classList.toggle("is-on", on);
      node.setAttribute("aria-checked", String(on));
    }
  };

  function build() {
    root = el("div", "pinkie-power", document.body);
    root.id = "pinkie-power";
    root.hidden = true;
    root.addEventListener("click", (event) => { if (event.target === root) close(); });
    dialog = el("section", "pinkie-power__sheet", root);
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "pinkie-power-title");
    dialog.tabIndex = -1;

    const hero = el("header", "pinkie-power__hero", dialog);
    const heroArt = el("img", "pinkie-power__hero-art", hero);
    heroArt.src = ART("buddy-chat-happy"); heroArt.alt = ""; heroArt.decoding = "async";
    const heroCopy = el("div", "pinkie-power__hero-copy", hero);
    el("p", "pinkie-power__eyebrow", heroCopy, "碧琪 · 进阶调节");
    el("h2", "pinkie-power__title", heroCopy, "电脑够快，就别省着啦").id = "pinkie-power-title";
    el("p", "pinkie-power__lede", heroCopy, "特效、聊天记录、长回复、渲染……平时为了省电省内存设了上限，这里都能自己调。改动马上保存。");
    const closeBtn = el("button", "pinkie-power__close", hero, "×");
    closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "关闭进阶调节");
    closeBtn.addEventListener("click", close);

    const body = el("div", "pinkie-power__body", dialog);
    const levelWrap = el("div", "pinkie-power__levels", body);
    levelWrap.setAttribute("role", "radiogroup");
    levelWrap.setAttribute("aria-label", "总档位");
    for (const level of LEVELS) {
      const b = el("button", `pinkie-power__level pinkie-power__level--${level.id}`, levelWrap);
      b.type = "button"; b.setAttribute("role", "radio"); b.dataset.level = level.id;
      const art = el("img", "pinkie-power__level-art", b); art.src = ART(level.art); art.alt = ""; art.decoding = "async";
      const copy = el("span", "pinkie-power__level-copy", b);
      const head = el("span", "pinkie-power__level-head", copy);
      el("span", "pinkie-power__level-title", head, level.title);
      if (level.badge) el("span", "pinkie-power__badge", head, level.badge);
      el("span", "pinkie-power__level-line", copy, level.line);
      b.addEventListener("click", () => { T()?.setLevel(level.id); say(`已切到「${level.title}」`); sync(); });
      refs.levels.set(level.id, b);
    }
    refs.custom = el("p", "pinkie-power__custom", body, "");

    for (const group of GROUPS) {
      const card = el("section", `pinkie-power__card pinkie-power__card--${group.id}`, body);
      const head = el("header", "pinkie-power__card-head", card);
      el("span", "pinkie-power__card-icon", head, group.icon).setAttribute("aria-hidden", "true");
      const hc = el("div", "", head);
      el("h3", "pinkie-power__card-title", hc, group.title);
      el("p", "pinkie-power__card-hint", hc, group.hint);
      for (const spec of group.rows) {
        const row = el("div", "pinkie-power__row", card);
        if (spec.key) row.dataset.key = spec.key;
        const copy = el("div", "pinkie-power__row-copy", row);
        const titleLine = el("span", "pinkie-power__row-title", copy, spec.title);
        const dot = el("span", "pinkie-power__changed", titleLine, "已改");
        el("span", "pinkie-power__row-hint", copy, spec.hint);
        el("span", "pinkie-power__cost", copy, `代价：${spec.cost}`);
        const control = el("div", "pinkie-power__row-control", row);
        if (spec.kind === "motion") {
          const pairs = segment(control, [[false, "完整特效"], [true, "减少动效"]], (value) => {
            window.__pinkieMotion?.set(value); say(value ? "已减少动效" : "已恢复完整特效"); sync();
          });
          refs.rows.push(() => { press(pairs, Boolean(window.__pinkieMotion?.reduce)); dot.hidden = !window.__pinkieMotion?.reduce; });
        } else if (spec.kind === "ambient") {
          const pairs = segment(control, [[true, "开"], [false, "关"]], (value) => { setAmbient(value); say(value ? "背景氛围已打开" : "背景氛围已关掉"); sync(); });
          refs.rows.push(() => { const on = ambientOn(); press(pairs, on); dot.hidden = on; });
        } else {
          const tuning = T();
          const def = tuning.DEFAULTS[spec.key];
          const entries = tuning.OPTIONS[spec.key].map((value) => [value, spec.label(value), value === def ? "默认" : ""]);
          const pairs = segment(control, entries, (value) => { T()?.set(spec.key, value); say(`${spec.title}：${spec.label(value)}`); sync(); });
          refs.rows.push(() => {
            const t = T();
            press(pairs, t.get(spec.key));
            dot.hidden = !Object.prototype.hasOwnProperty.call(t.overrides, spec.key);
          });
        }
      }
    }

    const foot = el("footer", "pinkie-power__foot", dialog);
    const note = el("p", "pinkie-power__note", foot, "每台电脑看到的效果都一样，只听你在这里的选择。聊天记录类的改动在下次打开或切换聊天时生效，其它马上生效。");
    note.setAttribute("role", "note");
    refs.status = el("p", "pinkie-power__status", foot, "");
    refs.status.setAttribute("aria-live", "polite");
    const actions = el("div", "pinkie-power__actions", foot);
    const reset = el("button", "pinkie-power__reset", actions, "恢复默认");
    reset.type = "button";
    reset.addEventListener("click", () => {
      T()?.reset(); window.__pinkieMotion?.set(false); setAmbient(true);
      say("全部恢复成默认啦"); sync();
    });
    const done = el("button", "pinkie-power__done", actions, "好了");
    done.type = "button";
    done.addEventListener("click", close);

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const focusables = [...dialog.querySelectorAll("button:not([disabled])")];
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.addEventListener("pinkie:tuning-change", sync);
    window.addEventListener("pinkie:motion-change", sync);
  }

  let sayTimer = 0;
  function say(text) {
    if (!refs.status) return;
    refs.status.textContent = text;
    refs.status.classList.add("is-shown");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => refs.status.classList.remove("is-shown"), 2400);
  }

  function sync() {
    const t = T();
    if (!root || !t) return;
    const changed = Object.keys(t.overrides).length;
    for (const [id, node] of refs.levels) {
      const on = id === t.level;
      node.classList.toggle("is-on", on);
      node.setAttribute("aria-checked", String(on));
    }
    const levelTitle = LEVELS.find((level) => level.id === t.level)?.title || "标准";
    refs.custom.textContent = changed ? `在「${levelTitle}」的基础上，你单独改了 ${changed} 项。` : "";
    refs.custom.hidden = !changed;
    for (const update of refs.rows) update();
    window.dispatchEvent(new CustomEvent("pinkie:power-summary", {detail: summary()}));
  }

  function summary() {
    const t = T();
    if (!t) return {level: "standard", title: "标准", changed: 0};
    return {level: t.level, title: LEVELS.find((level) => level.id === t.level)?.title || "标准", changed: Object.keys(t.overrides).length};
  }

  function open() {
    if (!document.body || !T()) return;
    if (!root) build();
    lastFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.setAttribute("data-pinkie-power-open", "");
    sync();
    requestAnimationFrame(() => { root.classList.add("is-open"); dialog.focus({preventScroll: true}); });
  }
  function close() {
    if (!root || root.hidden) return;
    root.classList.remove("is-open");
    root.hidden = true;
    document.documentElement.removeAttribute("data-pinkie-power-open");
    try { lastFocus?.focus?.({preventScroll: true}); } catch {}
  }

  // ── Entry: a button in the workspace rail, under 派对空间 / 灵感圆桌 ──────────
  // Same shape as those entries (art + vertical label, horizontal when the rail
  // is expanded). Polled like them, never a subtree MutationObserver.
  const mountRail = () => {
    const rail = document.querySelector(".chat-workspace-rail");
    let entry = document.getElementById("pinkie-power-entry");
    if (!rail) { entry?.remove(); return; }
    const roundtable = document.getElementById("pinkie-roundtable-entry");
    const anchor = roundtable?.parentElement === rail ? roundtable : null;
    if (entry?.parentElement === rail) {
      if (anchor && entry.previousElementSibling !== anchor) anchor.after(entry);
      return;
    }
    entry?.remove();
    entry = el("button", "", null);
    entry.id = "pinkie-power-entry";
    entry.type = "button";
    entry.title = "进阶调节：特效、聊天记录、渲染";
    entry.setAttribute("aria-label", "打开进阶调节");
    const art = el("img", "", entry); art.src = ART("status-done"); art.alt = ""; art.draggable = false;
    el("span", "", entry, "进阶调节");
    entry.addEventListener("click", open);
    if (anchor) anchor.after(entry); else rail.append(entry);
  };
  setInterval(mountRail, 1500);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountRail, {once: true});
  else mountRail();

  window.__pinkiePower = Object.freeze({open, close, summary, get isOpen() { return Boolean(root && !root.hidden); }, GROUPS, LEVELS});
})();
