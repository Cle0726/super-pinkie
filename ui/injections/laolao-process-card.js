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
  // Only the four included modes get the new segmented presentation. Other
  // sessions retain the previous single combined thought at the top.
  const segmentedAllowed = () => /^agent:(?:main|project|thinking|learning):/.test(sessionKey());
  const publishRunState = (key, active) => {
    if (!key) return;
    const runs = window.__pinkieActiveChatRuns instanceof Map
      ? window.__pinkieActiveChatRuns
      : (window.__pinkieActiveChatRuns = new Map());
    if (runs.get(key) === active) return;
    runs.set(key, active);
    rerender();
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
  const processCards = new Map();
  const processCardKeys = new WeakMap();
  const dirtyCards = new Set();
  const openedThoughts = new Set(); // Manual expansion is page-local; history starts folded.
  // v8: show each received thought before folding, including a block delivered
  // in the same batch as tool.start. Keep this transient state out of storage.
  const TYPE_CPS = 120, TYPE_MIN = 500, TYPE_MAX = 2500, TYPE_HURRY = 400, TYPE_HOLD = 1000;
  const typing = new Map();
  let typingFrame = false;
  const typedLength = (t, now) => t.from + (t.to - t.from) * Math.min(1, Math.max(0, (now - t.start) / (t.dur || 1)));
  function typeOut(key, before, length) {
    const now = performance.now(), current = typing.get(key);
    const from = current ? Math.min(typedLength(current, now), before) : before;
    typing.set(key, {from: reduced() ? length : from, to: length, start: now,
      dur: reduced() ? 0 : Math.min(TYPE_MAX, Math.max(TYPE_MIN, (length - from) / TYPE_CPS * 1000)), doneAt: 0});
  }
  function hurryTyping() {
    const now = performance.now();
    for (const t of typing.values()) {
      if (t.start + t.dur - now > TYPE_HURRY) {
        t.from = typedLength(t, now); t.start = now; t.dur = TYPE_HURRY;
      }
    }
  }
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
  const run = {session: "", key: "", state: "", startedAt: 0, thinkingSince: 0, boundaryAt: 0, boundaryToolId: "", buffer: "", doneKey: "", doneAt: 0, oops: new Map(), confetti: "", migrate: null};
  const liveCardKey = () => {
    const known = processCards.get(run.key);
    if (known?.isConnected && known.dataset.pinkieProcess === run.key
        && known.querySelector('details.pinkie-process[data-live="1"]')) return run.key;
    let key = "";
    for (const [id, card] of processCards) {
      if (card.isConnected && card.querySelector('details.pinkie-process[data-live="1"]')) key = id;
    }
    return key;
  };
  const resolveKey = () => {
    const key = liveCardKey();
    if (key && key !== run.key) {
      // The optimistic user row can be replaced by its durable history row
      // while this very run is still streaming. Carry the current thought and
      // its transient animation/open state to the new live card immediately.
      const oldKey = run.key, previous = oldKey && store[oldKey];
      // Plan B: a follow-up message opens a card for a different gateway run.
      // Only the optimistic → durable swap of the same run may carry thoughts.
      const oldRun = processCards.get(oldKey)?.dataset.pinkieRun || "";
      const newRun = processCards.get(key)?.dataset.pinkieRun || "";
      const sameRun = !oldRun || !newRun || oldRun === newRun;
      if (sameRun && run.startedAt && run.session === sessionKey() && previous?.text && !store[key]?.text) {
        store[key] = {...previous, eps: previous.eps?.map(ep => ({...ep})),
          turn: {session: run.session, id: key.slice(('pinkie:process:' + run.session + ':').length)}};
        keep.add(key);
        episodesOf(previous).forEach((_, index) => {
          const from = epKey(oldKey, index), to = epKey(key, index);
          if (typing.has(from)) { typing.set(to, typing.get(from)); typing.delete(from); }
          if (openedThoughts.has(from)) { openedThoughts.add(to); openedThoughts.delete(from); }
        });
        save();
      }
      run.key = key;
      if (run.buffer) { appendThinking(run.buffer); run.buffer = ""; }
    }
    return run.key;
  };
  // v12: each thinking burst is its own episode, anchored before the step that
  // followed it. A single box at the top of the card made later thoughts
  // appear above everything and pushed the whole card around while typing.
  // `anchor` = how many work rows existed when the burst started; the box sits
  // in front of row #anchor, or at the bottom of the card until that row exists.
  const epKey = (key, index) => `${key}#${index}`;
  const episodesOf = (record) => !segmentedAllowed() && record?.text
    ? [{text: record.text, ms: record.ms || 0, anchor: 0, legacy: true}]
    : Array.isArray(record?.eps) && record.eps.length ? record.eps
    : record?.text ? [{text: record.text, ms: record.ms || 0, anchor: 0, legacy: true}] : [];
  const overflowCount = (node) => node?.matches?.(".chat-timeline-overflow")
    ? Number(/\d+/.exec(node.querySelector("summary")?.textContent || "")?.[0]) || 0 : 0;
  function rowAnchor(key) {
    const card = processCards.get(key);
    const projectedCount = card?.dataset?.pinkieRowCount;
    if (projectedCount !== undefined && Number.isFinite(Number(projectedCount))) return Number(projectedCount);
    const rows = card?.querySelector?.(".pinkie-process__rows");
    if (!rows) return null;
    const kids = [...rows.children], hidden = overflowCount(kids[0]);
    return hidden ? kids.length - 1 + hidden : kids.length;
  }
  function appendThinking(text) {
    const key = resolveKey();
    if (!key) { run.buffer = (run.buffer + text).slice(-MAX_TEXT); return; }
    const record = store[key] || (store[key] = {text: "", ms: 0, count: 0, at: Date.now()});
    record.turn = {session: sessionKey(), id: key.slice(('pinkie:process:' + sessionKey() + ':').length)};
    if (!segmentedAllowed()) {
      if (!run.thinkingSince) {
        run.thinkingSince = run.boundaryAt || Date.now(); record.count += 1;
        if (record.text) record.text += "\n\n";
      }
      const before = record.text.length, combined = record.text + text;
      const dropped = Math.max(0, combined.length - MAX_TEXT), id = epKey(key, 0), previous = typing.get(id);
      if (previous && dropped) { previous.from = Math.max(0, previous.from - dropped); previous.to = Math.max(0, previous.to - dropped); }
      record.text = combined.slice(-MAX_TEXT);
      typeOut(id, Math.max(0, before - dropped), record.text.length);
      record.at = Date.now(); keep.add(key); save();
      return;
    }
    if (!Array.isArray(record.eps)) record.eps = record.text ? [{text: record.text, ms: record.ms || 0, anchor: 0, legacy: true}] : [];
    if (!run.thinkingSince) {
      run.thinkingSince = run.boundaryAt || Date.now(); record.count += 1;
      if (record.text) record.text += "\n\n";
      record.eps.push({text: "", ms: 0, anchor: rowAnchor(key),
        ...(run.boundaryToolId ? {afterTool: run.boundaryToolId, pendingTool: true} : {})});
    }
    const index = record.eps.length - 1, ep = record.eps[index], before = ep.text.length;
    ep.text += text;
    record.text = (record.text + text).slice(-MAX_TEXT);
    // Older bursts give up their text first; the live one is trimmed last.
    let over = record.eps.reduce((sum, item) => sum + item.text.length, 0) - MAX_TEXT;
    for (const item of record.eps) {
      if (over <= 0 || item === ep) break;
      const cut = Math.min(over, item.text.length);
      item.text = item.text.slice(cut); over -= cut;
    }
    const dropped = Math.max(0, over);
    if (dropped) ep.text = ep.text.slice(dropped);
    const id = epKey(key, index), previous = typing.get(id);
    if (previous && dropped) { previous.from = Math.max(0, previous.from - dropped); previous.to = Math.max(0, previous.to - dropped); }
    typeOut(id, Math.max(0, before - dropped), ep.text.length);
    record.at = Date.now();
    if (!keep.has(key)) keep.add(key);
    save();
  }
  function stopThinking() {
    if (!run.thinkingSince) return;
    const record = store[run.key];
    const spent = Date.now() - run.thinkingSince;
    if (record) { record.ms += spent; const ep = segmentedAllowed() && record.eps?.at(-1); if (ep) ep.ms += spent; save(); }
    run.thinkingSince = 0;
    // A stream may have finished drawing while the model was still thinking.
    // Its one-second reading hold starts after thinking stops, never before.
    const t = record ? typing.get(epKey(run.key, segmentedAllowed() && record.eps?.length ? record.eps.length - 1 : 0)) : null;
    if (t) t.doneAt = 0;
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
            stopThinking();
            Object.assign(run, {session: key, key: "", startedAt: Date.now(), boundaryAt: Date.now(), boundaryToolId: "", thinkingSince: 0, buffer: "", confetti: "", migrate: null});
            run.oops.clear();
          }
          publishRunState(key, true);
          setState("thinking");
        } else if (data.phase === "end" || data.phase === "error") {
          const aborted = data.aborted === true || /abort|error/i.test(String(data.stopReason || ""));
          finish(aborted || data.phase === "error" ? "oops" : "done");
        }
        return;
      }
      // A page opened mid-run missed lifecycle.start. Adopt its first actual
      // content/tool event so lifecycle.end can clear the live card normally.
      if (!run.startedAt && Date.now() - run.doneAt > 3000
          && ["thinking", "assistant", "tool"].includes(payload.stream)) {
        Object.assign(run, {session: key, key: "", startedAt: Date.now(), boundaryAt: Date.now(), boundaryToolId: "",
          thinkingSince: 0, buffer: "", migrate: null});
        publishRunState(key, true);
      }
      if (payload.stream === "thinking") {
        const text = String(data.delta ?? data.text ?? "");
        if (text) { if (run.state !== "thinking") setState("thinking"); appendThinking(text); schedule(); }
        return;
      }
      if (payload.stream === "assistant") { if (run.state !== "asking") setState("writing"); return; }
      if (payload.stream === "tool") {
        if (data.phase === "start") setState(data.name === "ask_user" ? "asking" : "working");
        else if (data.phase === "result") {
          run.boundaryAt = Date.now();
          run.boundaryToolId = String(data.toolCallId || data.tool_call_id || data.callId || "");
          if (run.state === "working") setState("thinking");
        }
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
    hurryTyping();
    if (run.key) run.migrate = {from: run.key, session: sessionKey(), until: Date.now() + 20000};
    if (state === "oops" && run.key) run.oops.set(run.key, Date.now());
    publishRunState(run.session, false);
    run.state = state;
    run.doneKey = run.key;
    run.doneAt = Date.now();
    run.startedAt = 0;
    schedule();
    if (run.key && store[run.key]) rerender();
  }

  // Lit owns the slots themselves; this script only owns the boxes inside
  // those slots. A row or tail slot can be destroyed/reused by Lit safely.
  function hydrate(slot) {
    const key = slot.dataset.pinkieThinking || "";
    let record = store[key];
    if (!record?.text) {
      const legacy = slot.pinkieLegacyKey || '';
      const previous = store[legacy] || store[legacy.replace('pinkie:process:', 'pinkie:process:' + sessionKey() + ':')]
        || Object.values(store).find(record => record.turn?.id && key === 'pinkie:process:' + record.turn.session + ':' + record.turn.id);
      if (previous?.text) { record = store[key] = {...previous}; keep.add(key); save(); }
    }
    const history = segmentedAllowed() && Array.isArray(slot.pinkieHistorySegments) ? slot.pinkieHistorySegments.filter(ep => ep?.text) : [];
    if (!record?.text && (history.length || slot.pinkieHistoryThinking)) {
      const text = history.length ? history.map(ep => ep.text).join("\n\n") : String(slot.pinkieHistoryThinking);
      record = store[key] = {text: text.slice(-MAX_TEXT), ms: 0, count: history.length || 1,
        ...(history.length ? {eps: history.map(ep => ({text: ep.text, ms: 0, anchor: ep.anchor}))} : {}),
        at: Date.now(), fromHistory: true};
      record.turn = {session: sessionKey(), id: key.slice(('pinkie:process:' + sessionKey() + ':').length)};
      keep.add(key); save();
    }
    const anchors = slot.pinkieToolAnchors || {};
    let resolved = false;
    for (const ep of record?.eps || []) {
      if (ep.pendingTool && Object.prototype.hasOwnProperty.call(anchors, ep.afterTool)) {
        ep.anchor = anchors[ep.afterTool]; ep.pendingTool = false; resolved = true;
      }
    }
    if (resolved) save();
    // The final history may know row positions more accurately than a live DOM
    // snapshot. Match every episode first; never rewrite an old combined entry.
    if (!run.startedAt && history.length && Array.isArray(record?.eps)
        && history.length === record.eps.length
        && history.every((ep, i) => !record.eps[i].legacy && String(ep.text).trim() === String(record.eps[i].text).trim())) {
      let changed = false;
      history.forEach((ep, i) => { if (record.eps[i].anchor !== ep.anchor) { record.eps[i].anchor = ep.anchor; changed = true; } });
      if (changed) save();
    }
    return record;
  }

  function placeFor(card, slot, ep) {
    if (ep.pendingTool) return [...card.querySelectorAll('[data-pinkie-thinking]')]
      .find(node => node.dataset.pinkieThinkingTail === "1") || slot;
    if (ep.legacy || !ep.anchor) return slot;
    const slots = [...card.querySelectorAll('[data-pinkie-thinking]')];
    const target = slots.find(node => Number(node.dataset.pinkieThinkingSeg) === ep.anchor);
    if (target) return target;
    const count = Number(card.dataset.pinkieRowCount);
    if (!Number.isFinite(count)) return slot; // compatible with an older renderer
    if (ep.anchor >= count) return slots.find(node => node.dataset.pinkieThinkingTail === "1") || slot;
    return null; // the matching row is inside a closed overflow section
  }

  function renderThinking(slot) {
    if (slot.dataset.pinkieThinkingTail === "1" || Number(slot.dataset.pinkieThinkingSeg || 0) !== 0) return;
    const card = slot.closest?.(".chat-group--process[data-pinkie-process]");
    const key = slot.dataset.pinkieThinking || "";
    const record = hydrate(slot);
    const eps = episodesOf(record);
    const lastIndex = eps.length - 1;
    const wanted = new Set();
    const placements = [];
    eps.forEach((ep, index) => {
      if (!ep.text) return;
      const target = card ? placeFor(card, slot, ep) : slot;
      if (!target) return;
      wanted.add(epKey(key, index));
      placements.push([target, index, ep]);
    });
    const owned = card ? [...card.querySelectorAll(".pinkie-thinking[data-pinkie-ep]")] : [...slot.querySelectorAll(".pinkie-thinking")];
    const stale = owned.filter(box => !wanted.has(box.dataset.pinkieEp));
    const boxes = new Map(owned.map(box => [box.dataset.pinkieEp, box]));
    const moves = [];
    for (const [target, index] of placements) {
      const id = epKey(key, index), box = boxes.get(id);
      if (!box || box.parentNode !== target) moves.push([target, id]);
    }
    // Anything that adds, moves or removes a box keeps the reader's place.
    if (stale.length || moves.length) {
      preserveSlot(slot, () => {
        stale.forEach(box => box.remove());
        for (const [target, id] of moves) {
          const box = boxes.get(id) || createBox(slot, id);
          boxes.set(id, box);
          target.append(box);
        }
        // Keep bursts that share a place in order.
        for (const [target, index] of placements) target.append(boxes.get(epKey(key, index)));
      });
    }
    for (const [target, index, ep] of placements) {
      const box = target.querySelector(`:scope > [data-pinkie-ep="${CSS.escape(epKey(key, index))}"]`);
      if (box) updateBox(slot, box, key, index, ep, record, index === lastIndex);
    }
  }

  function createBox(slot, id) {
    const box = el("div", "pinkie-thinking");
    box.dataset.pinkieEp = id;
    const head = el("button", "pinkie-thinking__head"); head.type = "button";
    head.append(el("span", "pinkie-thinking__chev", "›"), el("span", "pinkie-thinking__label"));
    const body = el("div", "pinkie-thinking__body");
    body.id = "pinkie-thought-" + id.replace(/[^a-zA-Z0-9_-]/g, "_");
    head.setAttribute("aria-controls", body.id);
    head.addEventListener("click", () => {
      preserveSlot(slot, () => {
        if (openedThoughts.has(id)) openedThoughts.delete(id); else openedThoughts.add(id);
        if (slot.isConnected) renderThinking(slot);
      });
    });
    body.append(el("div", "pinkie-thinking__text"));
    box.append(head, body);
    const t = typing.get(id);
    if (t && t.to > t.from) box.classList.add("is-entering");
    return box;
  }

  function updateBox(slot, box, key, index, ep, record, last) {
    const id = epKey(key, index);
    const thinking = Boolean(last && run.thinkingSince && run.key === key);
    const now = performance.now(), t = typing.get(id);
    const typed = t ? Math.min(ep.text.length, Math.floor(typedLength(t, now))) : ep.text.length;
    const isTyping = typed < ep.text.length;
    if (t && !isTyping && !t.doneAt) {
      t.doneAt = now;
      setTimeout(schedule, TYPE_HOLD + 20);
    }
    const holding = Boolean(t && !isTyping && now - t.doneAt < TYPE_HOLD);
    if (t && !isTyping && !holding && !thinking) typing.delete(id);
    if (isTyping) typingFrame = true;
    const live = thinking || isTyping || holding;
    const opened = openedThoughts.has(id);
    // Folding a finished thought shrinks the card; keep the reader in place.
    if (box.classList.contains("is-live") !== live && !live) preserveSlot(slot, () => box.classList.remove("is-live"));
    box.classList.toggle("is-live", live);
    box.classList.toggle("is-typing", isTyping);
    box.classList.toggle("is-open", opened);
    const head = box.querySelector(".pinkie-thinking__head");
    const expanded = String(live || opened);
    if (head.getAttribute("aria-expanded") !== expanded) head.setAttribute("aria-expanded", expanded);
    const label = box.querySelector(".pinkie-thinking__label");
    const ms = (ep.legacy ? record.ms : ep.ms) + (thinking ? Date.now() - run.thinkingSince : 0);
    const text = thinking ? `正在思考 · ${Math.round(ms / 1000)}s`
      : `思考了 ${duration(ms || 1000)}${ep.legacy && record.count > 1 ? ` · ${record.count} 次` : ""}`;
    if (label.textContent !== text) label.textContent = text;
    const body = box.querySelector(".pinkie-thinking__text");
    const visibleText = isTyping ? ep.text.slice(0, typed) : ep.text;
    if (body.textContent !== visibleText) body.textContent = visibleText;
    if (live && !opened) box.querySelector(".pinkie-thinking__body").scrollTop = 1e9;
  }

  function renderStatus(slot) {
    const key = slot.dataset.pinkieStatus || "";
    const live = slot.dataset.live === "1" && (!run.startedAt || run.key === key || !run.key);
    const recentDone = run.doneKey === key && run.state === "done" && Date.now() - run.doneAt < 2800;
    const oops = run.oops.has(key);
    const restoredState = slot.dataset.state === "oops" ? "oops" : "";
    const state = oops ? "oops" : recentDone ? "done"
      : live ? (run.state || "thinking") : restoredState;
    if (!state) {
      const pill = slot.querySelector(".pinkie-status");
      if (pill && !pill.classList.contains("is-gone")) {
        pill.classList.add("is-gone");
        setTimeout(() => { if (pill.classList.contains("is-gone")) preserveSlot(slot, () => pill.remove()); }, 450);
      }
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
    const nextTime = state === "done" || state === "oops" || !run.startedAt ? "" : `${seconds}s`;
    if (time.textContent !== nextTime) time.textContent = nextTime;
  }

  // The v8 thought cache follows the same completed card when native history
  // replaces it with an orphan reply. Never migrate across a session/new run.
  function migrateThinking() {
    const move = run.migrate;
    if (!move) return;
    if (Date.now() > move.until || sessionKey() !== move.session || run.startedAt) { run.migrate = null; return; }
    const cards = [...processCards.values()].filter(card => card.isConnected);
    if (cards.some(card => card.dataset.pinkieProcess === move.from)) return;
    const card = cards.at(-1), key = card?.dataset.pinkieProcess || '';
    const record = store[move.from];
    if (!key || key === move.from || !record?.text) return;
    const history = String(card.querySelector('[data-pinkie-thinking]')?.pinkieHistoryThinking || '').trim();
    if (history && !record.text.includes(history)) { run.migrate = null; return; }
    store[key] = {...record, eps: record.eps?.map(ep => ({...ep}))};
    keep.add(key);
    episodesOf(record).forEach((_, index) => {
      const from = epKey(move.from, index), to = epKey(key, index);
      if (typing.has(from)) { typing.set(to, typing.get(from)); typing.delete(from); }
      if (openedThoughts.has(from)) { openedThoughts.add(to); openedThoughts.delete(from); }
    });
    if (run.doneKey === move.from) run.doneKey = key;
    if (run.oops.has(move.from)) run.oops.set(key, run.oops.get(move.from));
    run.migrate = null;
    save();
  }

  // Plan B: cards are keyed by run id now. A thought saved under the old
  // position key moves once to the run key; one that matches nothing stays.
  function adoptPrior(card, key) {
    const prior = card.dataset.pinkiePrior || "";
    if (!prior || prior === key || !store[prior] || store[key]) return;
    store[key] = {...store[prior], eps: store[prior].eps?.map(ep => ({...ep})), run: card.dataset.pinkieRun || ""};
    delete store[prior];
    keep.delete(prior);
    keep.add(key);
    save();
  }

  function preserveSlot(slot, change) {
    const pane = slot.closest?.('openclaw-chat-pane');
    return window.__pinkieChatViewport?.preserve
      ? window.__pinkieChatViewport.preserve(pane, change) : change();
  }

  let frame = 0;
  function markCard(card) {
    if (!card?.matches?.('.chat-group--process[data-pinkie-process]')) return;
    const key = card.dataset.pinkieProcess;
    const previous = processCardKeys.get(card);
    if (previous && previous !== key && processCards.get(previous) === card) processCards.delete(previous);
    processCardKeys.set(card, key);
    processCards.set(key, card);
    adoptPrior(card, key);
    dirtyCards.add(card);
  }
  function indexCards(root) {
    if (!root) return;
    markCard(root);
    root.querySelectorAll?.('.chat-group--process[data-pinkie-process]').forEach(markCard);
  }
  function markCurrent() {
    const card = processCards.get(run.key || run.doneKey);
    if (card) dirtyCards.add(card);
  }
  function schedule() {
    markCurrent();
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      typingFrame = false;
      if (run.startedAt) resolveKey();
      migrateThinking();
      const changed = [...dirtyCards];
      dirtyCards.clear();
      for (const card of changed) {
        if (!card.isConnected) continue;
        card.querySelectorAll('[data-pinkie-thinking]').forEach(renderThinking);
        card.querySelectorAll('[data-pinkie-status]').forEach(renderStatus);
      }
      // Only the card whose thought is typing is dirtied for the next frame.
      if (typingFrame) schedule();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    schedule();
  });
  // Index new/replaced cards once; text updates dirty only their owning card.
  // Attribute changes are limited to the native run metadata, not our text.
  new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      if (record.type !== 'attributes' && record.target.closest?.('[data-pinkie-thinking], [data-pinkie-status]')) continue;
      const owner = record.target.closest?.('.chat-group--process[data-pinkie-process]');
      if (owner) { markCard(owner); changed = true; }
      for (const node of record.addedNodes || []) { indexCards(node); changed = true; }
      for (const node of record.removedNodes || []) {
        const removed = [];
        if (node.matches?.('.chat-group--process[data-pinkie-process]')) removed.push(node);
        removed.push(...(node.querySelectorAll?.('.chat-group--process[data-pinkie-process]') || []));
        for (const card of removed) if (processCards.get(card.dataset.pinkieProcess) === card && !card.isConnected) processCards.delete(card.dataset.pinkieProcess);
      }
    }
    if (changed) schedule();
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-live', 'data-state', 'data-pinkie-process', 'data-pinkie-row-count', 'data-pinkie-thinking-seg', 'data-pinkie-history-revision']});
  indexCards(document);
  schedule();
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
  window.addEventListener("pinkie:session-selected", () => { typing.clear(); Object.assign(run, {key: "", startedAt: 0, thinkingSince: 0, buffer: "", state: "", migrate: null}); schedule(); });
  window.__laolaoProcessCard = {store, keep, run, schedule};
})();
