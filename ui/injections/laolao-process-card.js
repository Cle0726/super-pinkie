/* laolao-process-card：给“碧琪的工作过程”卡片补上实时思考和状态表情。
   卡片本身由时间线补丁（patch/apply-chat-timeline.mjs）作为原生分组渲染，
   这里只往它预留的两个静态位置里填内容，不碰 Lit 管理的节点：
   - [data-pinkie-thinking]：碧琪的思考。实时来自网关 thinking 事件；网关的历史
     接口不返回思考内容，所以按卡片记在本机，刷新后照样能展开。
   - [data-pinkie-status]：只在进行中的一轮显示，六张碧琪表情跟着进度换：
     思考 / 干活 / 写回复 / 完成 / 出错或停止 / 等你确认。
   事件来自 laolao-sidebar 广播的 pinkie:gateway-event。 */
(() => {
  "use strict";
  if (window.__laolaoProcessCard) return;

  const STORE = "laolao:process-thinking:v1";
  const MAX_CARDS = 80;
  const MAX_TEXT = 8000;
  const STICKER = (state) => `./laolao-pinkie-status-${state}.png`;
  const PHRASE = {
    thinking: "碧琪在动小脑瓜…", working: "碧琪在抛气球干活…", writing: "碧琪在比划着回你…",
    asking: "碧琪在等你点头…", done: "完成啦！", oops: "这一轮停下来了，做到一半的记录都留着",
  };
  ["thinking", "working", "writing", "asking", "done", "oops"].forEach((state) => { new Image().src = STICKER(state); });
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const sessionKey = () => {
    const routed = new URL(location.href).searchParams.get("session") || "";
    if (routed) return routed;
    return document.querySelector(".sidebar-recent-session--active[data-session-key]")?.dataset.sessionKey || "";
  };
  const duration = (ms) => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const rest = seconds % 60;
    return rest ? `${Math.floor(seconds / 60)} 分 ${rest} 秒` : `${Math.floor(seconds / 60)} 分钟`;
  };

  // ---------- recorded thinking, per card ----------
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { store = {}; }
  const keep = window.__pinkieProcessKeep instanceof Set ? window.__pinkieProcessKeep : new Set();
  window.__pinkieProcessKeep = keep;
  for (const key of Object.keys(store)) keep.add(key);
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = Object.keys(store).sort((a, b) => (store[b].at || 0) - (store[a].at || 0));
      for (const key of keys.slice(MAX_CARDS)) { delete store[key]; keep.delete(key); }
      try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {}
    }, 400);
  };
  // Re-run the native projection so a kept card for a plain answer appears.
  const rerender = () => { try { document.querySelector("openclaw-chat-pane")?.requestUpdate?.(); } catch {} };

  // ---------- the live run ----------
  // boundaryAt: when the model last started a new call (turn start, a tool
  // result). Some providers deliver a whole thought in one chunk just before
  // acting, so the wait since that boundary is the real thinking time.
  const run = {session: "", key: "", state: "", startedAt: 0, thinkingSince: 0, boundaryAt: 0, buffer: "", doneKey: "", doneAt: 0, oops: new Map(), confetti: "", migrate: null};
  const liveCardKey = () => {
    const cards = document.querySelectorAll(".chat-group--process details.pinkie-process[data-live='1']");
    const card = cards[cards.length - 1];
    return card?.closest("[data-pinkie-process]")?.dataset.pinkieProcess || "";
  };
  const resolveKey = () => {
    const key = liveCardKey();
    if (key && key !== run.key) {
      run.key = key;
      if (run.buffer) { appendThinking(run.buffer); run.buffer = ""; }
    }
    return run.key;
  };
  function appendThinking(text) {
    const key = resolveKey();
    if (!key) { run.buffer = (run.buffer + text).slice(-MAX_TEXT); return; }
    const record = store[key] || (store[key] = {text: "", ms: 0, count: 0, at: Date.now()});
    if (!run.thinkingSince) { run.thinkingSince = run.boundaryAt || Date.now(); record.count += 1; if (record.text) record.text += "\n\n"; }
    record.text = (record.text + text).slice(-MAX_TEXT);
    record.at = Date.now();
    if (!keep.has(key)) keep.add(key);
    save();
  }
  function stopThinking() {
    if (!run.thinkingSince) return;
    const record = store[run.key];
    if (record) { record.ms += Date.now() - run.thinkingSince; save(); }
    run.thinkingSince = 0;
  }
  function setState(state) {
    run.state = state;
    if (state !== "thinking") stopThinking();
    schedule();
  }

  window.addEventListener("pinkie:gateway-event", (event) => {
    const {event: name, payload} = event.detail || {};
    if (!payload) return;
    const key = sessionKey();
    const own = !payload.sessionKey || payload.sessionKey === key;
    if (name === "agent" || name === "session.tool") {
      if (!own) return;
      const data = payload.data || {};
      if (payload.stream === "lifecycle") {
        if (data.phase === "start") {
          if (run.state !== "asking" || run.session !== key) {
            Object.assign(run, {session: key, key: "", startedAt: Date.now(), boundaryAt: Date.now(), thinkingSince: 0, buffer: "", confetti: ""});
            run.oops.clear();
          }
          setState("thinking");
        } else if (data.phase === "end" || data.phase === "error") {
          const aborted = data.aborted === true || /abort|error/i.test(String(data.stopReason || ""));
          finish(aborted || data.phase === "error" ? "oops" : "done");
        }
        return;
      }
      if (payload.stream === "thinking") {
        const text = String(data.delta ?? data.text ?? "");
        if (text) { if (run.state !== "thinking") setState("thinking"); appendThinking(text); schedule(); }
        return;
      }
      if (payload.stream === "assistant") { if (run.state !== "asking") setState("writing"); return; }
      if (payload.stream === "tool") {
        if (data.phase === "start") setState(data.name === "ask_user" ? "asking" : "working");
        else if (data.phase === "result") { run.boundaryAt = Date.now(); if (run.state === "working") setState("thinking"); }
      }
      return;
    }
    if (/^(?:exec|plugin)\.approval\.requested$/.test(String(name))) { if (own) setState("asking"); return; }
    if (/^(?:exec|plugin)\.approval\.resolved$/.test(String(name))) { if (own && run.state === "asking") setState("working"); return; }
    if (name === "chat" && own && ["aborted", "error"].includes(payload.state)) finish("oops");
  });

  function finish(state) {
    if (!run.startedAt && state === "done") return;
    resolveKey();
    stopThinking();
    // The history sync after a turn replaces the optimistic user message, so
    // the card's key changes. Carry this turn's thinking over to the new key.
    if (run.key) run.migrate = {from: run.key, until: Date.now() + 20000};
    if (state === "oops" && run.key) run.oops.set(run.key, Date.now());
    run.state = state;
    run.doneKey = run.key;
    run.doneAt = Date.now();
    run.startedAt = 0;
    schedule();
    if (run.key && store[run.key]) rerender();
  }

  // ---------- rendering into the two slots ----------
  function renderThinking(slot) {
    const key = slot.dataset.pinkieThinking || "";
    const record = store[key];
    const live = Boolean(run.thinkingSince && run.key === key);
    if (!record || !record.text) { if (slot.firstChild) slot.replaceChildren(); return; }
    let box = slot.querySelector(".pinkie-thinking");
    if (!box) {
      box = el("div", "pinkie-thinking");
      const head = el("button", "pinkie-thinking__head"); head.type = "button";
      head.append(el("span", "pinkie-thinking__chev", "›"), el("span", "pinkie-thinking__label"));
      head.addEventListener("click", () => box.classList.toggle("is-open"));
      const body = el("div", "pinkie-thinking__body");
      body.append(el("div", "pinkie-thinking__text"));
      box.append(head, body);
      slot.replaceChildren(box);
    }
    box.classList.toggle("is-live", live);
    const label = box.querySelector(".pinkie-thinking__label");
    const ms = record.ms + (live ? Date.now() - run.thinkingSince : 0);
    const text = live ? `正在思考 · ${Math.round(ms / 1000)}s` : `思考了 ${duration(ms || 1000)}${record.count > 1 ? ` · ${record.count} 次` : ""}`;
    if (label.textContent !== text) label.textContent = text;
    const body = box.querySelector(".pinkie-thinking__text");
    if (body.textContent !== record.text) body.textContent = record.text;
    if (live) box.querySelector(".pinkie-thinking__body").scrollTop = 1e9;
  }

  function renderStatus(slot) {
    const key = slot.dataset.pinkieStatus || "";
    const live = slot.dataset.live === "1" && Boolean(run.startedAt) && (run.key === key || !run.key);
    const recentDone = run.doneKey === key && run.state === "done" && Date.now() - run.doneAt < 2800;
    const oops = run.oops.has(key);
    const state = oops ? "oops" : recentDone ? "done" : live ? (run.state || "thinking") : "";
    if (!state) {
      const pill = slot.querySelector(".pinkie-status");
      if (pill && !pill.classList.contains("is-gone")) { pill.classList.add("is-gone"); setTimeout(() => { if (pill.classList.contains("is-gone")) pill.remove(); }, 450); }
      return;
    }
    let pill = slot.querySelector(".pinkie-status:not(.is-gone)");
    if (!pill) {
      pill = el("div", "pinkie-status");
      const face = el("span", "pinkie-status__face");
      pill.append(face, el("span", "pinkie-status__phrase"), el("span", "pinkie-status__time"));
      slot.replaceChildren(pill);
    }
    if (pill.dataset.state !== state) {
      pill.dataset.state = state;
      const face = pill.querySelector(".pinkie-status__face");
      const old = face.querySelector("img.is-current");
      const img = el("img", "is-current is-in"); img.src = STICKER(state); img.alt = "";
      face.append(img);
      requestAnimationFrame(() => img.classList.remove("is-in"));
      if (old) { old.classList.remove("is-current"); old.classList.add("is-out"); setTimeout(() => old.remove(), 380); }
      const phrase = pill.querySelector(".pinkie-status__phrase");
      phrase.textContent = PHRASE[state];
      phrase.classList.toggle("is-shimmer", state !== "done" && state !== "oops");
      if (state === "done" && run.confetti !== key) { run.confetti = key; setTimeout(() => burst(face), 140); }
    }
    const time = pill.querySelector(".pinkie-status__time");
    const seconds = run.startedAt ? Math.round((Date.now() - run.startedAt) / 1000) : 0;
    time.textContent = state === "done" || state === "oops" ? "" : `${seconds}s`;
  }

  function migrateThinking() {
    const move = run.migrate;
    if (!move) return;
    if (Date.now() > move.until) { run.migrate = null; return; }
    const cards = document.querySelectorAll(".chat-group--process[data-pinkie-process]");
    const latest = cards[cards.length - 1]?.dataset.pinkieProcess || "";
    if (!latest || latest === move.from) return;
    if (store[move.from] && !store[latest]) {
      store[latest] = store[move.from];
      delete store[move.from];
      keep.delete(move.from);
      keep.add(latest);
      save();
    }
    if (run.doneKey === move.from) run.doneKey = latest;
    if (run.oops.has(move.from)) { run.oops.set(latest, run.oops.get(move.from)); run.oops.delete(move.from); }
    run.confetti = run.confetti === move.from ? latest : run.confetti;
    run.migrate = null;
  }

  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (run.startedAt) resolveKey();
      migrateThinking();
      document.querySelectorAll("[data-pinkie-thinking]").forEach(renderThinking);
      document.querySelectorAll("[data-pinkie-status]").forEach(renderStatus);
    });
  }
  new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
  setInterval(() => { if (run.startedAt || run.doneAt > Date.now() - 3200) schedule(); }, 250);

  // ---------- a small confetti pop from the sticker (drawn above the text) ----------
  let canvas = null, parts = [], raf = 0;
  function burst(anchor) {
    if (reduced() || !anchor?.isConnected) return;
    if (!canvas) {
      canvas = el("canvas", "pinkie-confetti");
      document.body.append(canvas);
      const fit = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
      fit(); addEventListener("resize", fit);
    }
    const rect = anchor.getBoundingClientRect();
    const colors = ["#e94f91", "#69bdea", "#ffd84d", "#ff9cc6"];
    for (let index = 0; index < 22; index += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, speed = 2 + Math.random() * 2.8;
      parts.push({x: rect.left + rect.width * 0.6, y: rect.top + 8, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, w: 2.6 + Math.random() * 2.4, h: 4 + Math.random() * 3, c: colors[index % 4], life: 1});
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.vy += 0.08; p.vx *= 0.98; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.014;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 0.8); ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  // Restored kept cards need one projection pass after this script loads.
  setTimeout(rerender, 0);
  window.addEventListener("pinkie:session-selected", () => { Object.assign(run, {key: "", startedAt: 0, thinkingSince: 0, buffer: "", state: ""}); schedule(); });
  window.__laolaoProcessCard = {store, keep, run, schedule};
})();
