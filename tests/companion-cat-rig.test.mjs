// Li An 陪伴：动作引擎（laolao-cat-rig.js）与「每侧一只」的挂载/状态隔离。
// 这两件是这次修复的真实风险点：
//  1) 动作不能靠整图缩放冒充，底边必须钉住；
//  2) 双模式两侧各自有猫、菜单、状态，不能把同一个节点搬来搬去。
// 这里用一个只够跑脚本的最小 DOM，跑真实文件，而不是对源码做正则。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.join(import.meta.dirname, "..");
// 沙箱里“存在的图片”：用来验证 companion-v2 优先、缺图回退两条路径
let existing = new Set();
const EXISTS = (url) => [...existing].some((p) => String(url).endsWith(p));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/* ── 最小 DOM ─────────────────────────────────────────────────────────── */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { for (const n of names) if (n) this.set.add(n); }
  remove(...names) { for (const n of names) this.set.delete(n); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const on = force === undefined ? !this.set.has(n) : Boolean(force);
    if (on) this.set.add(n); else this.set.delete(n);
    return on;
  }
  get value() { return [...this.set].join(" "); }
}

// selector support: comma lists, descendant combinators, .class / tag / :not(.class) / :scope
function parseCompound(text) {
  const nots = [];
  const bare = text.replace(/:not\(([^)]*)\)/g, (_, inner) => { nots.push(inner.trim().replace(/^\./, "")); return ""; });
  const classes = (bare.match(/\.[A-Za-z0-9_-]+/g) || []).map((c) => c.slice(1));
  const tag = (bare.match(/^[A-Za-z][A-Za-z0-9-]*/) || [])[0]?.toUpperCase() || null;
  return {classes, tag, nots};
}
function matchCompound(el, compound) {
  if (compound.tag && el.tagName !== compound.tag) return false;
  for (const c of compound.classes) if (!el.classList.contains(c)) return false;
  for (const n of compound.nots) if (el.classList.contains(n)) return false;
  return true;
}
function parseSelector(selector) {
  return selector.split(",").map((part) => {
    const cleaned = part.trim().replace(/^:scope\s+/, "").replace(/:scope\s*>?\s*/, "");
    return cleaned.split(/\s+/).filter(Boolean).map(parseCompound);
  });
}
function matchesSelector(el, selector) {
  return parseSelector(selector).some((chain) => {
    if (!chain.length) return false;
    if (!matchCompound(el, chain[chain.length - 1])) return false;
    let i = chain.length - 2, node = el.parentElement;
    while (i >= 0) {
      if (!node) return false;
      if (matchCompound(node, chain[i])) i -= 1;
      node = node.parentElement;
    }
    return true;
  });
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classList = new ClassList(this);
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.props = new Map();
    this.style = {
      setProperty: (name, value) => this.props.set(name, String(value)),
      removeProperty: (name) => this.props.delete(name),
      getPropertyValue: (name) => this.props.get(name) || "",
    };
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = "";
    this._html = "";
    this.hidden = false;
    this.inert = false;
    this.clientWidth = 168;
    this.checked = false;
    this.value = "";
    this.disabled = false;
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === this.ownerDocument?.documentElement; }
  get offsetWidth() { return this.clientWidth; }
  get textContent() { return this._text || this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === "string" ? Object.assign(new Element("span"), {_text: n}) : n;
      node.parentElement = this;
      this.children.push(node);
    }
  }
  prepend(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.unshift(n); } }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.attrs.has(name) : Boolean(force);
    if (on) this.attrs.set(name, ""); else this.attrs.delete(name);
    return on;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  descendants() {
    const out = [];
    const walk = (node) => { for (const c of node.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(selector) { return this.descendants().filter((el) => matchesSelector(el, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches?.(selector)) return node; node = node.parentElement; }
    return null;
  }
  contains(node) { while (node) { if (node === this) return true; node = node.parentElement; } return false; }
  getBoundingClientRect() { return this._rect || {left: 100, top: 100, right: 860, bottom: 140, width: 760, height: 40}; }
  focus() {}
  checkVisibility() { return true; }
  // <dialog> 的最小实现：只记录 open，showModal/close 触发同一个 close 回调
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.fire("close"); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener() {}
  fire(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({target: this, stopPropagation() {}, preventDefault() {}, ...event}); }
  getContext(type) {
    if (type !== "2d") return null;
    const noop = () => {};
    return {canvas: this, globalAlpha: 1, setTransform: noop, clearRect: noop, drawImage: noop,
      getImageData: (x, y, w, h) => ({data: new Uint8ClampedArray(w * h * 4)}), translate: noop};
  }
}

function makeDocument() {
  const documentElement = new Element("html");
  const body = new Element("body");
  const head = new Element("head");
  documentElement.append(head, body);
  const doc = {
    documentElement, body, head, hidden: false,
    createElement: (tag) => { const el = new Element(tag); el.ownerDocument = doc; return el; },
    createTextNode: (t) => Object.assign(new Element("span"), {_text: t}),
    addEventListener() {}, removeEventListener() {},
    querySelector: (s) => documentElement.querySelector(s),
    querySelectorAll: (s) => documentElement.querySelectorAll(s),
    getElementById: () => null,
    getSelection: () => ({toString: () => ""}),
    activeElement: null,
  };
  body.ownerDocument = doc;
  return doc;
}

function paneWith({composer = true} = {}) {
  const pane = new Element("div");
  pane.classList.add("chat-pane-cache__pane", "chat-pane-cache__pane--visible");
  pane._rect = {left: 100, top: 0, right: 860, bottom: 700, width: 760, height: 700};
  if (composer) {
    const main = new Element("div");
    main.classList.add("chat-main");
    const thread = new Element("div");
    thread.classList.add("chat-thread");
    const inner = new Element("div");
    inner.classList.add("chat-thread-inner");
    thread.append(inner);
    main.append(thread);
    const shell = new Element("div");
    shell.classList.add("agent-chat__composer-shell");
    const combobox = new Element("div");
    combobox.classList.add("agent-chat__composer-combobox");
    const ta = new Element("textarea");
    combobox.append(ta);
    shell.append(combobox);
    main.append(shell);
    pane.append(main);
  }
  return pane;
}

function boot({panes}) {
  const document = makeDocument();
  panes.forEach((p) => { p.ownerDocument = document; document.body.append(p); });
  const window = {
    document,
    matchMedia: () => ({matches: false}),
    localStorage: {getItem: () => null, setItem() {}},
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    devicePixelRatio: 1,
    innerWidth: 1600, innerHeight: 900,
    addEventListener() {}, removeEventListener() {},
    getSelection: () => ({toString: () => ""}),
    // 假图片：默认全部不存在（onerror），测试可以按需登记存在的 URL
    Image: class {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this._src = ""; }
      set src(v) { this._src = String(v); setTimeout(() => (EXISTS(v) ? (this.naturalWidth = 616, this.naturalHeight = 420, this.onload?.()) : this.onerror?.()), 0); }
      get src() { return this._src; }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({position: "relative"}),
    __pinkieCompanionPreview: true,
    console,
  };
  window.window = window;
  document.defaultView = window;
  const context = vm.createContext({window, document, console, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    setInterval: window.setInterval, Image: window.Image, matchMedia: window.matchMedia, localStorage: window.localStorage,
    getComputedStyle: window.getComputedStyle,
    ResizeObserver: window.ResizeObserver, IntersectionObserver: window.IntersectionObserver,
    performance: {now: () => Date.now()}, devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900});
  context.globalThis = context;
  // 两个脚本按真实顺序加载：先 rig，再 companion
  vm.runInContext(read("services/cle-studio/static/legacy/laolao-cat-rig.js"), context, {filename: "laolao-cat-rig.js"});
  vm.runInContext(read("services/cle-studio/static/legacy/laolao-companion.js"), context, {filename: "laolao-companion.js"});
  return {window, document};
}

/* ── rig：轮廓分区与动作幅度 ───────────────────────────────────────────── */
test("cat rig finds the head from the silhouette, not from fur colour", () => {
  const {window} = boot({panes: []});
  const rig = window.__pinkieCatRig;
  assert.ok(rig, "rig registered");
  const w = 60, h = 40;
  // 趴着的猫：底部整条是身体，上半部只在左边有头 → 头在左
  const alpha = new Uint8Array(w * h);
  for (let y = 24; y < h; y += 1) for (let x = 4; x < 52; x += 1) alpha[y * w + x] = 255;
  for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) alpha[y * w + x] = 255;
  const left = rig.profileFromAlpha(alpha, w, h);
  assert.ok(left.headLeft, "head detected on the left");
  assert.ok(left.headU < .4, "head centre is on the left side");

  // 镜像：头在右
  const mirrored = new Uint8Array(w * h);
  for (let y = 24; y < h; y += 1) for (let x = 4; x < 52; x += 1) mirrored[y * w + x] = 255;
  for (let y = 8; y < 24; y += 1) for (let x = 36; x < 52; x += 1) mirrored[y * w + x] = 255;
  const right = rig.profileFromAlpha(mirrored, w, h);
  assert.equal(right.headLeft, false);
  assert.ok(right.headU > .6);

  // 空图不能误判出一只猫
  assert.equal(rig.profileFromAlpha(new Uint8Array(w * h), w, h), null);
});

test("head and tail move on their own side; the bottom edge stays pinned", () => {
  const {window} = boot({panes: []});
  const rig = window.__pinkieCatRig;
  const profile = {headU: .24, tailU0: .56, tailU1: .98};
  const head = rig.weightsAt(profile, .24);
  const middle = rig.weightsAt(profile, .45);
  const tail = rig.weightsAt(profile, .95);
  assert.ok(head.head > .8 && head.tail < .01, "head strip is head-weighted");
  assert.ok(tail.tail > .8 && tail.head < .01, "tail strip is tail-weighted");
  assert.ok(middle.head < .3 && middle.tail < .2, "middle is body");

  const M = rig.MOODS.rest;
  const s = rig.newMotion();
  s.target.lean = .4;
  for (let i = 0; i < 40; i += 1) rig.stepMotion(s, "rest", 1 / 60, i / 60);
  const headOff = rig.stripOffset(profile, .24, s, M, .5);
  const tailOff = rig.stripOffset(profile, .95, s, M, .5);
  assert.ok(Math.abs(headOff.dx) > 1, "head follows the gaze");
  assert.ok(Math.abs(headOff.dx) > Math.abs(tailOff.dx), "tail does not inherit the lean");

  // 呼吸是纵向压缩，不是整图放大
  const breathe = rig.stripOffset(profile, .5, rig.newMotion(), M, 1);
  assert.ok(breathe.scaleY > 1 && breathe.scaleY < 1.06, "breathing stays subtle");
  assert.equal(breathe.dy, 0, "breathing does not lift the body off the composer");

  // 完成时跃起是向上（负 dy），并且会落回
  const hop = rig.newMotion();
  hop.vLift = 150;
  let apex = 0;
  for (let i = 0; i < 120; i += 1) { rig.stepMotion(hop, "happy", 1 / 60, i / 60); apex = Math.min(apex, -hop.lift); }
  assert.ok(apex < -3, `hop rises noticeably, got ${apex}`);
  assert.equal(hop.lift, 0, "and lands again");
});

/* ── companion：每侧一只，状态互不串 ───────────────────────────────────── */
test("each visible pane owns its own cat, menu and state", async () => {
  const left = paneWith(), right = paneWith();
  const {window, document} = boot({panes: [left, right]});
  const buddy = window.__pinkieBuddy;
  assert.ok(buddy, "companion registered");
  buddy.mount();

  const shellLeft = left.querySelector(".agent-chat__composer-shell");
  const shellRight = right.querySelector(".agent-chat__composer-shell");
  const catLeft = shellLeft.querySelector(".pinkie-buddy");
  const catRight = shellRight.querySelector(".pinkie-buddy");
  assert.ok(catLeft, "left pane has a cat");
  assert.ok(catRight, "right pane has a cat");
  assert.notEqual(catLeft, catRight, "the two panes do not share one node");
  assert.equal(catLeft.parentElement, shellLeft);
  assert.equal(catRight.parentElement, shellRight);

  // 再挂一次不会复制、也不会把猫搬到另一侧
  buddy.mount();
  assert.equal(shellLeft.querySelectorAll(".pinkie-buddy").length, 1);
  assert.equal(shellRight.querySelectorAll(".pinkie-buddy").length, 1);
  assert.equal(shellLeft.querySelector(".pinkie-buddy"), catLeft);

  // 左侧在跑：只有左侧进入 working
  const stop = new Element("button");
  stop.classList.add("chat-send-btn--stop");
  shellLeft.querySelector(".agent-chat__composer-combobox").append(stop);
  const [a, b] = buddy.instances;
  a.tick(); b.tick();
  assert.equal(a.state, "working");
  assert.equal(b.state, "rest");
  // 真实 DOM 里 dataset.state 会同步到 data-state 属性；测试的假 DOM 只有 dataset
  assert.equal(catLeft.dataset.state, "working");
  assert.equal(catRight.dataset.state, "rest");

  // 两侧菜单是各自的
  a.toggleMenu(); b.toggleMenu();
  assert.ok(catLeft.querySelector(".pinkie-buddy__menu").classList.contains("is-shown"));
  assert.ok(catRight.querySelector(".pinkie-buddy__menu").classList.contains("is-shown"));
  assert.notEqual(catLeft.querySelector(".pinkie-buddy__menu"), catRight.querySelector(".pinkie-buddy__menu"));
});

test("a cached hidden pane keeps its cat alive but stops animating; destroying the pane reclaims it", async () => {
  const left = paneWith(), right = paneWith();
  const {window} = boot({panes: [left, right]});
  const buddy = window.__pinkieBuddy;
  buddy.mount();

  const catLeft = left.querySelector(".pinkie-buddy");
  const catRight = right.querySelector(".pinkie-buddy");
  assert.ok(catLeft && catRight);
  const instRight = buddy.instances.find((i) => i.pane === right);
  assert.ok(instRight);

  // 右侧被缓存隐藏：实例与菜单都留着（切回来不丢工具），但不再出动作、不再参与状态推进
  right.classList.add("chat-pane-cache__pane--hidden");
  buddy.mount();
  assert.equal(buddy.instances.length, 2, "cached pane is not torn down");
  assert.equal(right.querySelector(".pinkie-buddy"), catRight, "same node, not rebuilt");
  assert.equal(instRight.active, false, "hidden side is paused");
  assert.equal(buddy.instances.find((i) => i.pane === left).active, true, "visible side keeps running");

  // 隐藏侧即使在跑，也不推进状态、不弹完成点缀
  const stopBtn = new Element("button");
  stopBtn.classList.add("chat-send-btn--stop");
  right.querySelector(".agent-chat__composer-combobox").append(stopBtn);
  instRight.tick();
  assert.equal(catRight.dataset.state, "rest", "hidden side does not animate state");

  // 回到可见：仍是同一只，继续用自己的状态
  right.classList.remove("chat-pane-cache__pane--hidden");
  buddy.mount();
  assert.equal(right.querySelector(".pinkie-buddy"), catRight);
  assert.equal(instRight.active, true, "resumes when visible again");
  instRight.tick();
  assert.equal(catRight.dataset.state, "working", "visible side picks its run back up");
  stopBtn.remove();

  // pane 真被销毁：只回收右侧，左侧不动
  const leftInst = buddy.instances.length;
  right.remove();
  buddy.mount();
  assert.equal(buddy.instances.length, leftInst - 1);
  assert.equal(left.querySelector(".pinkie-buddy"), catLeft);
});

test("chat keeps a real safe gap under the last message for the cat", async () => {
  const pane = paneWith();
  const {window} = boot({panes: [pane]});
  const buddy = window.__pinkieBuddy;
  buddy.mount();
  const inner = pane.querySelector(".chat-thread-inner");
  // 猫的高度 + 间距，写成这一侧自己的变量，并且只有挂了猫的 pane 才吃这条规则
  assert.ok(pane.hasAttribute("data-pinkie-safe"), "pane is marked so the CSS applies");
  const value = pane.style.getPropertyValue("--pinkie-safe");
  assert.match(value, /^\d+px$/);
  assert.ok(parseInt(value, 10) >= 72, `reserve a real gap, got ${value}`);
  assert.equal(inner.style.getPropertyValue("--pinkie-safe"), value);

  // 追加卡（chat-queue）出现时：猫整只抬高、不压待发卡片
  const queue = new Element("div");
  queue.classList.add("chat-queue");
  queue._rect = {left: 100, top: 600, right: 800, bottom: 690, width: 700, height: 90};
  pane.querySelector(".chat-main").append(queue);
  buddy.mount();
  const cat = pane.querySelector(".pinkie-buddy");
  assert.equal(cat.style.getPropertyValue("--buddy-lift"), "96px");
  assert.ok(pane.hasAttribute("data-pinkie-queue"));
  queue.remove();
  buddy.mount();
  assert.equal(cat.style.getPropertyValue("--buddy-lift"), "", "lift is cleared when the queue is gone");
  assert.equal(pane.hasAttribute("data-pinkie-queue"), false);

  // 猫被回收后，安全空间必须一起撤掉，不能留下永久空白
  pane.remove();
  buddy.mount();
  assert.equal(pane.hasAttribute("data-pinkie-safe"), false);
  assert.equal(pane.style.getPropertyValue("--pinkie-safe"), "");
  assert.equal(inner.style.getPropertyValue("--pinkie-safe"), "");
});

test("a long label does not push the menu out of its own pane", async () => {
  const pane = paneWith();
  const {window} = boot({panes: [pane]});
  const buddy = window.__pinkieBuddy;
  buddy.mount();
  const inst = buddy.instances[0];
  inst.toggleMenu();
  const menu = pane.querySelector(".pinkie-buddy__menu");
  // 菜单默认在 pane 里；把它假想成溢出左侧，reflow 应把它往右推回 pane 边缘
  menu._rect = {left: 20, top: 300, right: 264, bottom: 520, width: 244, height: 220};
  inst.reflow();
  const shift = menu.style.getPropertyValue("--buddy-shift");
  assert.match(shift, /^-?\d+px$/);
  assert.ok(parseInt(shift, 10) > 0, "shifted back inside the pane");

  // 很矮的窗口里菜单向上展开会顶出可视区：应当往下移，必要时限高（不把菜单切一半）
  menu._rect = {left: 300, top: -120, right: 524, bottom: 100, width: 224, height: 220};
  inst.reflow();
  const shiftY = menu.style.getPropertyValue("--buddy-shift-y");
  assert.match(shiftY, /^\d+px$/);
  assert.ok(parseInt(shiftY, 10) > 100, "pushed down into view");
});

test("the menu uses the shell type and colour tokens, not ad-hoc fonts or emoji", () => {
  const css = read("services/cle-studio/static/legacy/laolao-companion.css");
  const menu = css.slice(css.indexOf(".pinkie-buddy__menu {"), css.indexOf(".pinkie-buddy-settings {"));
  assert.doesNotMatch(menu, /[\u{1F300}-\u{1FAFF}]/u, "no emoji in the menu");
  assert.match(menu, /color: var\(--cle-ink/);
  assert.match(css, /\.pinkie-buddy__item \{[^}]*font: [^;]*var\(--cle-sans/);
});

test("opening the settings dialog does not throw away an answer already in flight", async () => {
  const pane = paneWith();
  const {window} = boot({panes: [pane]});
  const buddy = window.__pinkieBuddy;
  buddy.mount();
  const inst = buddy.instances[0];
  inst.setState("rest");
  // 模拟「解释」正在等模型：请求世代号在等待期间必须保持不变
  const before = inst.askTicket;
  inst.openSettings();
  assert.equal(inst.askTicket, before, "settings does not bump the ask generation");
  assert.ok(inst.settingsRequest > 0, "settings has its own generation counter");
  inst.settingsDialog?.close?.();
  assert.equal(inst.askTicket, before, "closing settings does not cancel the in-flight ask either");

  // 换房间才应该作废在途回答
  pane.dataset.mcpAppOwnerKey = JSON.stringify(["x", "agent:learning:main"]);
  inst.tick();
  assert.equal(inst.askTicket, before + 1, "a room change still invalidates stale answers");
});

test("the cat attaches the motion rig once the page has settled, and never twice", async () => {
  const pane = paneWith();
  const {window} = boot({panes: [pane]});
  const buddy = window.__pinkieBuddy;
  const cat = window.__pinkieCatRig;
  assert.ok(cat, "rig is present");
  let attaches = 0;
  const realAttach = cat.attach;
  cat.attach = (figure) => {
    attaches += 1;
    let rig = null;
    try { rig = realAttach(figure); } catch (e) { rig = null; }
    if (!rig) rig = {paused: false, paused_: false, onReady: null, onDead: null, attachError: true,
      setMood() {}, setImage() {}, impulse() {}, attend() {}, look() {}, pause() { this.paused = true; }, };
    return rig;
  };
  try {
    // 刚挂上时页面还没 settle（首屏 splash），不应该编译任何东西
    buddy.mount();
    const inst = buddy.instances[0];
    assert.equal(attaches, 0, "no rig while the page is still settling");
    // 把 mount 时间推早，模拟页面已经稳定
    inst.firstMountAt = performance.now() - 9000;
    buddy.mount();
    assert.equal(attaches, 1, "attaches once the page settled");
    buddy.mount();
    buddy.mount();
    assert.equal(attaches, 1, "and only once per pane");
    assert.ok(inst.rig, "instance keeps the rig");
  } finally {
    cat.attach = realAttach;
    for (const i of buddy.instances) { i.rig?.pause?.(true); i.rig?.destroy?.(); }
    pane.remove();
  }
});

test("companion-v2 art wins when Claude ships it, per state, without a code change", async () => {
  existing = new Set(["/companion-v2/rest.webp?v=20261019e", "/companion-v2/working.webp?v=20261019e"]);
  try {
    const pane = paneWith();
    const {window} = boot({panes: [pane]});
    const buddy = window.__pinkieBuddy;
    assert.match(await buddy.artFor("rest"), /companion-v2\/rest\.webp(\?v=\w+)?$/);
    assert.match(await buddy.artFor("working"), /companion-v2\/working\.webp(\?v=\w+)?$/);
    // 该状态还没有 v2 图：仍然回退到现有素材，而不是空图
    assert.match(await buddy.artFor("typing"), /pet-/);
  } finally { existing = new Set(); }
});

test("asset fallback keeps working when companion-v2 art is absent", async () => {
  const pane = paneWith();
  const {window} = boot({panes: [pane]});
  const buddy = window.__pinkieBuddy;
  const art = await buddy.artFor("rest");
  assert.match(art, /^\/cle\/static\/art\//);
  assert.ok(!/companion-v2/.test(art), "falls back to an existing plate when v2 is missing");
  for (const state of ["rest", "typing", "working", "happy", "sleepy"]) {
    assert.ok(await buddy.artFor(state), `${state} resolves to something`);
  }
});
