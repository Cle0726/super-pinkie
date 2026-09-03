/* 来啦～老弟 · 侧边栏分组管理
   功能：置顶 / 文件夹项目 / 最近会话 / 搜索与归档恢复。
   必须在应用模块包之前加载（包装 WebSocket 以复用已认证的网关连接）。 */
(() => {
  "use strict";

  /* ---------- 0. 捕获网关 WebSocket，复用其认证 ---------- */
  const NativeWS = window.WebSocket;
  let gwSocket = null;
  const pending = new Map();

  function sniff(ws) {
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if(msg?.type==='event' && (String(msg.event).startsWith('sessions.') || msg.event==='chat'&&['final','error','aborted'].includes(msg.payload?.state))){
        window.dispatchEvent(new Event('laolao:sessions-changed'));
      }
      if (!msg || msg.type !== "res" || !msg.id) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.payload);
      else entry.reject(new Error((msg.error && msg.error.message) || "gateway error"));
    });
  }

  window.WebSocket = function (url, protocols) {
    const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
    try {
      if (/18789/.test(String(url))) {
        gwSocket = ws;
        sniff(ws);
        const send = ws.send.bind(ws);
        let sendQueue = Promise.resolve();
        const abortVersions=new Map();
        ws.send = function(data) {
          let request;try { request=JSON.parse(data); } catch { return send(data); }
          if(request.type==='req'&&['chat.abort','sessions.abort'].includes(request.method)){
            const key=request.params?.sessionKey||request.params?.key;
            abortVersions.set(key,(abortVersions.get(key)||0)+1);return send(data);
          }
          if(request.type!=='req'||!['chat.send','sessions.send'].includes(request.method)) return send(data);
          const key=request.params?.sessionKey||request.params?.key;
          const version=abortVersions.get(key)||0;
          // Finish the authenticated binding before the model can receive this
          // message. A failed binding returns an ordinary RPC error to the UI.
          sendQueue=sendQueue.catch(()=>{}).then(async()=>{
            try { await ensureProjectScope(key);if((abortVersions.get(key)||0)!==version)throw new Error('发送已取消');send(data); }
            catch(error) {
              toast('没有发送：'+error.message);
              ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'res',id:request.id,ok:false,error:{code:'INVALID_REQUEST',message:'项目目录尚未确认：'+error.message}})}));
            }
          });
        };
      }
    } catch {}
    return ws;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    window.WebSocket[k] = NativeWS[k];
  }

  function gwRequest(method, params, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const trySend = () => {
        if (gwSocket && gwSocket.readyState === 1) {
          const id =
            window.crypto && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("gateway timeout"));
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          gwSocket.send(JSON.stringify({ type: "req", id, method, params: params || {} }));
        } else if (attempts++ < 60) {
          setTimeout(trySend, 250);
        } else {
          reject(new Error("gateway socket unavailable"));
        }
      };
      trySend();
    });
  }

  /* ---------- 1. 状态与模式隔离（localStorage） ----------
     每个模式有独立 agent、会话、置顶、项目与文件夹绑定。旧版共享
     数据只迁移一次，并按会话所属 agent 拆开；旧 key 留着作为恢复副本。 */
  const MODES = ["chat", "project", "thinking", "unrestricted"];
  const MODE_AGENT = { chat: "main", project: "project", thinking: "thinking", unrestricted: "unrestricted" };
  const AGENT_MODE = Object.fromEntries(Object.entries(MODE_AGENT).map(([mode, agent]) => [agent, mode]));
  const LEGACY_LS_KEY = "laolao.sidebar.v1";
  const MIGRATION_KEY = "laolao.sidebar.v2.migrated";
  const storageKey = (mode) => `laolao.sidebar.v2.${mode}`;
  const emptyState = () => ({ pins: [], projects: {}, projectFolders: {}, collapsed: {} });

  const normalizeState = (value) => ({
    pins: Array.isArray(value?.pins) ? value.pins.filter((key) => typeof key === "string") : [],
    projects: value?.projects && typeof value.projects === "object"
      ? Object.fromEntries(Object.entries(value.projects).map(([name, keys]) => [
        name,
        Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [],
      ]))
      : {},
    projectFolders: value?.projectFolders && typeof value.projectFolders === "object"
      ? Object.fromEntries(Object.entries(value.projectFolders).filter(([, path]) => typeof path === "string" && path))
      : {},
    collapsed: value?.collapsed && typeof value.collapsed === "object" ? value.collapsed : {},
  });

  const modeForSession = (key) => {
    const agent = String(key || "").match(/^agent:([^:]+):/)?.[1];
    return AGENT_MODE[agent] || null;
  };

  const pageSessionKey = () => {
    const routed = new URL(location.href).searchParams.get("session") || "";
    if (routed) return routed;
    const activeRow = document.querySelector(".sidebar-recent-session--active[data-session-key]");
    if (activeRow?.dataset.sessionKey) return activeRow.dataset.sessionKey;
    return document.querySelector("openclaw-app-shell")?.context?.gateway?.snapshot?.sessionKey || "";
  };

  const currentModeId = () => {
    const presented = document.documentElement.getAttribute("data-laolao-mode");
    if (MODES.includes(presented)) return presented;
    const fromSession = modeForSession(pageSessionKey());
    if (fromSession) return fromSession;
    const stored = localStorage.getItem("laolao:active-mode");
    return MODES.includes(stored) ? stored : "chat";
  };

  const readModeState = (mode) => {
    try {
      const raw = localStorage.getItem(storageKey(mode));
      return raw ? normalizeState(JSON.parse(raw)) : emptyState();
    } catch {
      return emptyState();
    }
  };

  const writeModeState = (mode, value) => {
    try { localStorage.setItem(storageKey(mode), JSON.stringify(value)); } catch {}
  };

  const migrateLegacyState = () => {
    if (localStorage.getItem(MIGRATION_KEY) === "1") return;
    const byMode = Object.fromEntries(MODES.map((mode) => [mode, readModeState(mode)]));
    try {
      const legacyRaw = localStorage.getItem(LEGACY_LS_KEY);
      if (legacyRaw) {
        const legacy = normalizeState(JSON.parse(legacyRaw));
        const fallbackMode = currentModeId();
        for (const key of legacy.pins) {
          const mode = modeForSession(key) || fallbackMode;
          if (!byMode[mode].pins.includes(key)) byMode[mode].pins.push(key);
        }
        for (const [name, keys] of Object.entries(legacy.projects)) {
          const buckets = new Map();
          for (const key of keys) {
            const mode = modeForSession(key) || fallbackMode;
            if (!buckets.has(mode)) buckets.set(mode, []);
            buckets.get(mode).push(key);
          }
          if (!buckets.size) buckets.set(fallbackMode, []);
          for (const [mode, modeKeys] of buckets) {
            const existing = byMode[mode].projects[name] || [];
            byMode[mode].projects[name] = [...new Set([...existing, ...modeKeys])];
          }
          const folderOwner = modeForSession(keys[0]) || fallbackMode;
          if (legacy.projectFolders[name] && !byMode[folderOwner].projectFolders[name]) {
            byMode[folderOwner].projectFolders[name] = legacy.projectFolders[name];
          }
        }
        for (const mode of MODES) {
          byMode[mode].collapsed = { ...legacy.collapsed, ...byMode[mode].collapsed };
        }
      }
      for (const mode of MODES) writeModeState(mode, byMode[mode]);
      localStorage.setItem(MIGRATION_KEY, "1");
    } catch {}
  };

  migrateLegacyState();
  let stateMode = currentModeId();
  let state = readModeState(stateMode);
  const save = () => writeModeState(stateMode, state);

  const syncModeState = () => {
    const nextMode = currentModeId();
    if (nextMode === stateMode) return false;
    save();
    stateMode = nextMode;
    state = readModeState(stateMode);
    sessionIndex = null;
    return true;
  };

  const projectOf = (key) => {
    for (const [name, keys] of Object.entries(state.projects)) {
      if (Array.isArray(keys) && keys.includes(key)) return name;
    }
    return null;
  };

  let scopeLabelSignature='';
  const scopeBindings=new Map();
  const scopeErrors=new Map();
  async function ensureProjectScope(key) {
    const mode=modeForSession(key);if(!mode)return null;
    const snapshot=readModeState(mode);
    const name=Object.keys(snapshot.projects).find(n=>snapshot.projects[n].includes(key));
    const folder=name?snapshot.projectFolders[name]:null;
    if(name&&!folder) throw new Error('「'+name+'」还只是会话分组，请先选择项目文件夹。');
    if(!folder&&!scopeBindings.has(key))return null;
    const result=await gwRequest('pinkie.project.bind',{key,path:folder||null,name:name||''},15000);
    scopeBindings.set(key,result.binding);scopeErrors.delete(key);showScope(key,result.binding);return result.binding;
  }
  function showScope(key,binding,error='') {
    if(pageSessionKey()!==key)return;
    const host=document.querySelector('.agent-chat__input');if(!host)return;
    const text=error?'项目未就绪 · '+error:binding?'当前项目 · '+binding.root:'未绑定项目文件夹';
    const signature=key+'|'+text;
    let label=document.getElementById('laolao-project-scope');
    if(label&&label.parentElement===host&&scopeLabelSignature===signature)return;
    if(!label){label=document.createElement('div');label.id='laolao-project-scope';label.setAttribute('role','status');}
    label.textContent=text;label.title=text;label.dataset.error=error?'true':'false';
    if(label.parentElement!==host)host.prepend(label);scopeLabelSignature=signature;
  }
  let checkedScope='';
  let scopeRetryAt=0;
  function refreshScopeLabel() {
    const key=pageSessionKey();if(!modeForSession(key))return;
    const project=projectOf(key);const folder=project&&state.projectFolders[project];
    const signature=key+'|'+(folder||'');
    if(checkedScope===signature){showScope(key,scopeBindings.get(key),scopeErrors.get(key));if(!scopeErrors.has(key)||Date.now()<scopeRetryAt)return;}
    checkedScope=signature;
    gwRequest('pinkie.project.bind',{key,path:folder||null,name:project||''},15000)
      .then(result=>{scopeBindings.set(key,result.binding);scopeErrors.delete(key);showScope(key,result.binding);})
      .catch(error=>{scopeErrors.set(key,'目录保护未连接，请重新打开 App');scopeRetryAt=Date.now()+15000;showScope(key,null,scopeErrors.get(key));});
  }

  /* 原生 agentSelection 先过滤，class 隐藏再兜底，避免任何一帧串出
     其他模式的会话。 */

  const currentModeAgent = () => MODE_AGENT[stateMode] || "main";

  const rowAgent = (row) => {
    const key = row.dataset.sessionKey
      || new URLSearchParams(
        (row.querySelector("a.sidebar-recent-session__link")?.getAttribute("href") || "").split("?")[1] || ""
      ).get("session")
      || "";
    const match = key.match(/^agent:([^:]+):/);
    return match ? match[1] : "";
  };

  function applyModeFilter(section) {
    const agent = currentModeAgent();
    try {
      const sel = document.querySelector("openclaw-app-shell")?.context?.agentSelection;
      if (sel && typeof sel.set === "function" && sel.state && sel.state.selectedId !== agent) {
        sel.set(agent);
      }
    } catch {}
    section.querySelectorAll(".sidebar-recent-session.session-row-host").forEach((row) => {
      const ra = rowAgent(row);
      row.classList.toggle("laolao-mode-hidden", ra !== agent);
    });
    // 分组计数按可见行重算 + 空态提示区分
    for (const g of section.querySelectorAll("[data-laolao-group]")) {
      const list = g.querySelector(":scope > .laolao-group__list");
      if (!list) continue;
      const visible = list.querySelectorAll(".sidebar-recent-session:not(.laolao-mode-hidden)").length;
      const countEl = g.querySelector(".laolao-group__count");
      if (countEl) countEl.textContent = visible ? String(visible) : "";
      if (g.dataset.laolaoGroup === "__pins") g.style.display = visible ? "" : "none";
      const empty = list.querySelector(".laolao-group__empty");
      const hasAnyRow = !!list.querySelector(".sidebar-recent-session");
      if (hasAnyRow && !visible) {
        if (empty) empty.textContent = "该模式下暂无会话";
        else {
          const emptyEl = document.createElement("div");
          emptyEl.className = "laolao-group__empty";
          emptyEl.textContent = "该模式下暂无会话";
          list.appendChild(emptyEl);
        }
      } else if (empty && visible) {
        empty.remove();
      }
    }
  }

  /* ---------- 2. 图标 ---------- */
  const svg = (path) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const ICONS = {
    pin: svg('<path d="M9 4h6l1 6 3 3v2H5v-2l3-3z"/><path d="M12 15v6"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>'),
    archive: svg('<path d="M4 7h16v12H4z"/><path d="M3 4h18v3H3zM9 11h6"/>'),
    restore: svg('<path d="M4 11a8 8 0 1 0 2-5.3L4 8"/><path d="M4 3v5h5"/>'),
    chevron: svg('<path d="M6 9l6 6 6-6"/>'),
    close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>'),
  };

  /* ---------- 3. 通用浮层：菜单 / 弹窗 / Toast ---------- */
  let activeMenu = null;
  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  }
  document.addEventListener("pointerdown", (e) => {
    if (activeMenu && !activeMenu.contains(e.target) && !e.target.closest(".laolao-row-btn")) closeMenu();
  }, true);

  function openMenu(anchor, build) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "laolao-menu";
    build(menu);
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
    const below = rect.bottom + 6;
    const top = below + menuRect.height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuRect.height - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    activeMenu = menu;
  }

  function menuItem(menu, icon, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "laolao-menu__item";
    btn.innerHTML = (icon || "") + `<span></span>`;
    btn.querySelector("span").textContent = label;
    btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    menu.appendChild(btn);
    return btn;
  }

  function showModal({ title, body, dangerText, busyText = "处理中…", onConfirm }) {
    const mask = document.createElement("div");
    mask.className = "laolao-modal-mask";
    mask.innerHTML = `
      <div class="laolao-modal" role="dialog" aria-modal="true">
        <h3 class="laolao-modal__title"></h3>
        <p class="laolao-modal__body"></p>
        <p class="laolao-modal__error" role="status" hidden></p>
        <div class="laolao-modal__buttons">
          <button type="button" class="laolao-modal__btn" data-act="cancel">取消</button>
          <button type="button" class="laolao-modal__btn laolao-modal__btn--danger" data-act="ok"></button>
        </div>
      </div>`;
    mask.querySelector(".laolao-modal__title").textContent = title;
    mask.querySelector(".laolao-modal__body").textContent = body;
    const okBtn = mask.querySelector('[data-act="ok"]');
    const errorEl = mask.querySelector('.laolao-modal__error');
    okBtn.textContent = dangerText;
    mask.querySelector('[data-act="cancel"]').addEventListener("click", () => mask.remove());
    mask.addEventListener("pointerdown", (e) => { if (e.target === mask) mask.remove(); });
    okBtn.addEventListener("click", async () => {
      okBtn.disabled = true;
      okBtn.textContent = busyText;
      errorEl.hidden = true;
      try {
        await onConfirm();
        mask.remove();
      } catch (error) {
        errorEl.textContent = error?.message || "操作失败，请稍后再试";
        errorEl.hidden = false;
        okBtn.disabled = false;
        okBtn.textContent = dangerText;
      }
    });
    document.body.appendChild(mask);
  }

  let toastTimer = null;
  function toast(text) {
    let el = document.querySelector(".laolao-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "laolao-toast";
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add("laolao-toast--show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("laolao-toast--show"), 2600);
  }

  /* ---------- 3.1 原生文件夹项目桥 ---------- */
  const folderRequests = new Map();

  window.__laolaoProjectFolderResult = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const request = folderRequests.get(payload.requestId);
    if (!request) return;
    folderRequests.delete(payload.requestId);
    clearTimeout(request.timer);
    request.resolve(payload);
  };

  function requestNativeFolder(path) {
    const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (!bridge) {
      return window.PinkieSessionList?.chooseFolder(path,gwRequest) || Promise.resolve(null);
    }
    const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        folderRequests.delete(requestId);
        toast("文件夹选择没有响应，先生再试一次吧");
        resolve(null);
      }, 120000);
      folderRequests.set(requestId, { resolve, timer });
      bridge.postMessage({ action: "choose", requestId, path: path || "" });
    });
  }

  function revealNativeFolder(path) {
    const bridge = window.webkit?.messageHandlers?.laolaoProjectFolder;
    if (!bridge || !path) return toast("这个项目还没有关联文件夹");
    bridge.postMessage({ action: "reveal", path });
  }

  function uniqueProjectName(base) {
    const clean = String(base || "新项目").trim() || "新项目";
    if (!state.projects[clean]) return clean;
    let number = 2;
    while (state.projects[`${clean} ${number}`]) number += 1;
    return `${clean} ${number}`;
  }

  async function addFolderProject(existingName) {
    const ownerMode=stateMode;
    if(existingName&&state.projectFolders[existingName]&&state.projects[existingName]?.length){toast('已有会话的项目目录固定不变。换目录请新建项目，避免混用记录。');return;}
    const currentPath = existingName ? state.projectFolders[existingName] : "";
    const result = await requestNativeFolder(currentPath);
    if (!result || result.cancelled || !result.path) return;
    if(stateMode!==ownerMode){toast('模式已切换，未把文件夹添加到其他模式');return;}
    try{const validated=await gwRequest('pinkie.project.validate',{path:result.path});result.path=validated.path;}catch(error){toast('文件夹未添加：'+error.message);return;}
    if(stateMode!==ownerMode){toast('模式已切换，未把文件夹添加到其他模式');return;}

    const duplicate = Object.entries(state.projectFolders)
      .find(([name, path]) => path === result.path && name !== existingName);
    if (duplicate) {
      toast(`这个文件夹已经是「${duplicate[0]}」`);
      return duplicate[0];
    }

    let projectName=existingName;
    if (existingName) {
      state.projectFolders[existingName] = result.path;
      toast(`「${existingName}」已换成新的文件夹`);
    } else {
      const name = uniqueProjectName(result.name || result.path.split("/").filter(Boolean).pop());
      projectName=name;
      state.projects[name] = [];
      state.projectFolders[name] = result.path;
      state.collapsed.__projects = false;
      toast(`已添加文件夹项目「${name}」`);
    }
    save();
    schedule();
    return projectName;
  }

  async function copyProjectPath(name) {
    const path = state.projectFolders[name];
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      toast("项目路径已复制");
    } catch {
      toast(path);
    }
  }

  function showNameInput(menu, { value = "", placeholder = "项目名称，回车确认", onSubmit }) {
    menu.innerHTML = "";
    const input = document.createElement("input");
    input.className = "laolao-menu__input";
    input.placeholder = placeholder;
    input.value = value;
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const name = input.value.trim();
        if (!name || input.disabled) return;
        input.disabled = true;
        input.setAttribute("aria-busy", "true");
        try { await onSubmit(name); } finally { closeMenu(); }
      }
      if (event.key === "Escape") closeMenu();
    });
    menu.appendChild(input);
    input.focus();
    input.select();
  }

  function renameProject(oldName, requestedName) {
    const newName = requestedName.trim();
    if (!newName || newName === oldName) return;
    if (state.projects[newName]) return toast(`已经有一个「${newName}」了`);
    state.projects[newName] = state.projects[oldName] || [];
    delete state.projects[oldName];
    if (state.projectFolders[oldName]) {
      state.projectFolders[newName] = state.projectFolders[oldName];
      delete state.projectFolders[oldName];
    }
    const oldCollapseKey = `proj:${oldName}`;
    if (oldCollapseKey in state.collapsed) {
      state.collapsed[`proj:${newName}`] = state.collapsed[oldCollapseKey];
      delete state.collapsed[oldCollapseKey];
    }
    save();
    schedule();
    toast(`项目已改名为「${newName}」`);
  }

  function removeProject(name) {
    delete state.projects[name];
    delete state.projectFolders[name];
    delete state.collapsed[`proj:${name}`];
    save();
    schedule();
    toast(`已移除「${name}」，里面的会话仍然保留`);
  }

  function openProjectSettings(anchor, name) {
    openMenu(anchor, (menu) => {
      const path = state.projectFolders[name];
      const info = document.createElement("div");
      info.className = "laolao-menu__project-path";
      info.textContent = path || "仅会话分组 · 尚未选择文件夹";
      info.title = path || "";
      menu.appendChild(info);

      if (path) {
        menuItem(menu, ICONS.external, "在 Finder 中显示", () => {
          revealNativeFolder(path);
          closeMenu();
        });
        menuItem(menu, ICONS.copy, "复制文件夹路径", () => {
          copyProjectPath(name);
          closeMenu();
        });
      }
      menuItem(menu, ICONS.folder, path ? "重新选择文件夹…" : "选择文件夹…", async () => {
        closeMenu();
        await addFolderProject(name);
      });
      menuItem(menu, ICONS.plus, "重命名项目…", () => {
        showNameInput(menu, { value: name, onSubmit: (nextName) => renameProject(name, nextName) });
      });
      const divider = document.createElement("div");
      divider.className = "laolao-menu__divider";
      menu.appendChild(divider);
      menuItem(menu, ICONS.close, "移除项目（保留会话）", () => {
        removeProject(name);
        closeMenu();
      });
    });
  }

  const creatingSessions=new Map();
  async function createProjectSession(name) {
    if(name&&!state.projectFolders[name]){toast('请先为「'+name+'」选择项目文件夹');return;}
    const agentId = currentModeAgent();
    const ownerMode=stateMode,ownerState=state;
    const operation=ownerMode+'|'+(name||'');
    if(creatingSessions.has(operation))return creatingSessions.get(operation);
    const promise=(async()=>{
    try {
      if(name)await gwRequest('pinkie.project.validate',{path:ownerState.projectFolders[name]});
      const listed=await gwRequest('sessions.list',{agentId,limit:1000});
      const labels=new Set((listed.sessions||[]).map(s=>s.label));
      const base=name?`${name} · 新会话`:'新会话';
      let number=1,label=base;
      while(labels.has(label))label=base+' '+(++number);
      const requestedKey=`agent:${agentId}:dashboard:${window.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(16).slice(2)}`;
      let result;
      for(let attempt=0;attempt<5;attempt++){
        try{result=await gwRequest('sessions.create',{agentId,key:requestedKey,label},20000);break;}
        catch(error){if(!/label already in use/i.test(error.message))throw error;label=base+' '+(++number);}
      }
      if(!result)throw new Error('名称正在被使用，请稍后再试');
      const key = result?.key;
      if (!key) throw new Error("missing session key");
      if(name){
        await gwRequest('pinkie.project.bind',{key,path:ownerState.projectFolders[name],name});
        if (!ownerState.projects[name]) ownerState.projects[name] = [];
        if (!ownerState.projects[name].includes(key)) ownerState.projects[name].push(key);
      }
      writeModeState(ownerMode,ownerState);
      window.PinkieSessionList?.invalidate();
      if(stateMode!==ownerMode){toast('项目会话已在原模式建立');return;}
      sessionIndex = null;
      schedule();
      navigateSession(key);
      toast(name?`已在「${name}」中新建会话`:'已新建会话');
    } catch (error) {
      toast(`新建失败：${error?.message || "请稍后再试"}`);
    }
    })();
    creatingSessions.set(operation,promise);
    try{return await promise;}finally{creatingSessions.delete(operation);}
  }

  function navigateSession(key){
    if(modeForSession(key)!==stateMode)return;
    const current=new URL(window.location.href).searchParams.get('session');
    if(current===key)return;
    const search=`?session=${encodeURIComponent(key)}`;
    const shell=document.querySelector('openclaw-app-shell');
    if(typeof shell?.context?.navigate==='function'){
      shell.context.gateway?.setSessionKey?.(key);shell.context.navigate('chat',{search});
    }else{
      // Newer OpenClaw builds keep router context private. A normal location
      // assignment reloads the whole document and wrongly replays the App
      // entrance. Popstate changes only the session inside the current mode.
      window.history.pushState(window.history.state,'','/chat'+search);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    schedule();
  }

  async function patchSession(key,changes){
    const mode=modeForSession(key);if(mode!==stateMode)throw new Error('请回到该会话所属模式再操作');
    const result=await gwRequest('sessions.patch',{key,agentId:MODE_AGENT[mode],...changes});
    window.PinkieSessionList?.invalidate();sessionIndex=null;schedule();return result;
  }

  function removeSessionFromLocalState(key){
    state.pins=state.pins.filter(item=>item!==key);
    for(const name of Object.keys(state.projects))state.projects[name]=(state.projects[name]||[]).filter(item=>item!==key);
    save();
  }

  async function followAfterSessionLeaves(key,projectName){
    if(pageSessionKey()!==key)return;
    const project=projectName===undefined?projectOf(key):projectName;
    try{
      await createProjectSession(project&&state.projectFolders[project]?project:null);
    }catch(error){
      toast('记录已处理，但新会话创建失败：'+(error?.message||'请手动点新会话'));
    }
  }

  async function archiveSession(key){
    await patchSession(key,{archived:true});
    await followAfterSessionLeaves(key);
    toast('已归档；记录、项目绑定和文件都保留');
  }

  async function restoreSession(key){
    await patchSession(key,{archived:false});
    toast('会话已恢复，原记录和项目绑定都保留');
  }

  async function deleteSession(key){
    const mode=modeForSession(key);
    if(mode!==stateMode)throw new Error('请回到该会话所属模式再删除');
    const project=projectOf(key);
    await gwRequest('sessions.delete',{key,agentId:MODE_AGENT[mode],deleteTranscript:true});
    removeSessionFromLocalState(key);
    window.PinkieSessionList?.invalidate();sessionIndex=null;schedule();
    await followAfterSessionLeaves(key,project);
    toast('会话和聊天记录已删除');
  }

  function askDeleteSession(key,title){
    closeMenu();
    showModal({
      title:'删除会话',
      body:`确定删除「${title}」吗？聊天记录会一起删除，项目文件夹里的真实文件不会被动。此操作不可撤销。`,
      dangerText:'确认删除',
      busyText:'删除中…',
      onConfirm:()=>deleteSession(key),
    });
  }

  function sessionMenu(anchor,key,title,archived=false){
    openMenu(anchor,menu=>{
      if(archived){
        menuItem(menu,ICONS.restore,'恢复会话',async()=>{closeMenu();try{await restoreSession(key);}catch(error){toast(error.message);}});
        const divider=document.createElement('div');divider.className='laolao-menu__divider';menu.appendChild(divider);
        const remove=menuItem(menu,ICONS.trash,'永久删除…',()=>askDeleteSession(key,title));
        remove.classList.add('laolao-menu__item--danger');
        return;
      }
      menuItem(menu,ICONS.plus,'重命名会话…',()=>showNameInput(menu,{value:title,placeholder:'会话名称，回车保存',onSubmit:async name=>{
        try{await patchSession(key,{label:name});toast('会话名称已保存');}catch(error){toast(/label already in use/i.test(error.message)?'已有同名会话，请换一个名称':error.message);}
      }}));
      menuItem(menu,ICONS.pin,state.pins.includes(key)?'取消置顶':'置顶会话',()=>{closeMenu();togglePin(key);});
      menuItem(menu,ICONS.folder,'归入项目…',()=>openProjectMenu(anchor,key));
      menuItem(menu,ICONS.archive,'归档会话（保留记录）',async()=>{closeMenu();try{await archiveSession(key);}catch(error){toast(error.message);}});
      const divider=document.createElement('div');divider.className='laolao-menu__divider';menu.appendChild(divider);
      const remove=menuItem(menu,ICONS.trash,'删除会话和记录…',()=>askDeleteSession(key,title));
      remove.classList.add('laolao-menu__item--danger');
    });
  }

  /* ---------- 4. 分组 UI ---------- */
  // When already inside a folder project, the familiar New chat button should
  // create another conversation in that project, not silently leave it.
  document.addEventListener('click',event=>{
    if(!event.target?.closest?.('.sidebar-new-session'))return;
    const name=projectOf(pageSessionKey());
    event.preventDefault();event.stopImmediatePropagation();createProjectSession(name&&state.projectFolders[name]?name:null);
  },true);
  function makeGroup(id, labelText, actions) {
    const group = document.createElement("div");
    group.className = "laolao-group";
    group.dataset.laolaoGroup = id;

    const head = document.createElement("div");
    head.className = "laolao-group__head";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "laolao-group__toggle";
    toggle.innerHTML = ICONS.chevron;
    toggle.title = "折叠 / 展开";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      state.collapsed[id] = !state.collapsed[id];
      save();
      syncGroupCollapse(group, id);
    });

    const label = document.createElement("span");
    label.className = "laolao-group__label";
    label.textContent = labelText;

    const count = document.createElement("span");
    count.className = "laolao-group__count";

    head.append(toggle, label, count);
    for (const act of actions || []) head.appendChild(act);

    const list = document.createElement("div");
    list.className = "laolao-group__list";

    group.append(head, list);
    syncGroupCollapse(group, id);
    return group;
  }

  function syncGroupCollapse(group, id) {
    const collapsed = !!state.collapsed[id];
    group.classList.toggle("laolao-group--collapsed", collapsed);
    const list = group.querySelector(":scope > .laolao-group__list");
    if (list) list.classList.toggle("laolao-group__list--collapsed", collapsed);
  }

  function makeIconBtn(icon, title, onClick, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "laolao-group__action" + (extraClass ? " " + extraClass : "");
    btn.innerHTML = icon;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
    return btn;
  }

  /* ---------- 5. 一键清理 ---------- */
  /* ---------- 5. 会话索引（为掉出最近列表的置顶/项目会话合成行） ---------- */
  let sessionIndex = null; // Map<key, {name, updatedAt}>
  let sessionIndexLoading = false;

  function ensureSessionIndex() {
    if (sessionIndex || sessionIndexLoading) return;
    sessionIndexLoading = true;
    gwRequest("sessions.list", { limit: 1000 })
      .then((payload) => {
        const map = new Map();
        for (const s of extractSessions(payload)) {
          map.set(s.key, { name: s.name, updatedAt: s.updatedAt });
        }
        sessionIndex = map;
        // 刷新已存在的合成行（名称可能还是占位符）
        for (const row of document.querySelectorAll("[data-laolao-synthetic]")) {
          const key = row.dataset.sessionKey;
          const info = map.get(key);
          if (!info) continue;
          const nameSpan = row.querySelector(".sidebar-recent-session__name");
          const trail = row.querySelector(".session-row-trail");
          const link = row.querySelector("a.sidebar-recent-session__link");
          if (nameSpan && info.name) nameSpan.textContent = info.name;
          if (link && info.name) link.title = info.name;
          if (trail) trail.textContent = relTime(info.updatedAt);
        }
      })
      .catch(() => {})
      .finally(() => {
        sessionIndexLoading = false;
        schedule();
      });
  }

  function relTime(ms) {
    if (!ms) return "";
    const diff = Date.now() - ms;
    if (diff < 0) return "now";
    const m = Math.floor(diff / 60000);
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    return Math.floor(h / 24) + "d";
  }

  function makeSyntheticRow(key) {
    const info = sessionIndex && sessionIndex.get(key);
    const name = (info && info.name) || key.split(":").pop().slice(0, 8) + "…";
    const row = document.createElement("div");
    row.className = "sidebar-recent-session session-row-host";
    row.dataset.sessionKey = key;
    row.dataset.laolaoSynthetic = "1";
    const link = document.createElement("a");
    link.className = "sidebar-recent-session__link";
    link.href = "/chat?session=" + encodeURIComponent(key);
    link.title = name;
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-recent-session__name hover-marquee";
    nameSpan.textContent = name;
    link.appendChild(nameSpan);
    const aside = document.createElement("span");
    aside.className = "sidebar-recent-session__aside session-row-aside";
    const trail = document.createElement("span");
    trail.className = "session-row-trail";
    trail.textContent = info ? relTime(info.updatedAt) : "";
    aside.appendChild(trail);
    row.append(link, aside);
    return row;
  }

  function extractSessions(payload) {
    const arr = Array.isArray(payload)
      ? payload
      : payload && (payload.sessions || payload.items || payload.results) || [];
    return arr
      .map((it) => {
        const key = it && (it.key || it.sessionKey || it.id || it.session);
        const parsed = typeof key === "string" ? key.match(/^agent:([^:]+):/) : null;
        return {
          key,
          agentId: (it && it.agentId) || (parsed && parsed[1]) || undefined,
          name: it && (it.displayName || it.title || it.label || it.name),
          updatedAt: it && (it.updatedAt || it.lastActivityAt || it.createdAt),
        };
      })
      .filter((s) => typeof s.key === "string" && s.key && !s.key.includes(":subagent:"));
  }

  async function cleanupSessions() {
    const currentKey = pageSessionKey();
    const agentId = currentModeAgent();
    const keep = new Set([currentKey, ...state.pins]);
    for (const keys of Object.values(state.projects)) {
      for (const k of keys || []) keep.add(k);
    }

    const payload = await gwRequest("sessions.list", { limit: 1000 });
    const all = extractSessions(payload);
    const targets = all.filter((s) => s.agentId === agentId && !keep.has(s.key));
    if (targets.length === 0) {
      toast("没有需要清理的会话");
      return;
    }

    let deleted = 0, failed = 0;
    for (const s of targets) {
      try {
        await gwRequest("sessions.delete", {
          key: s.key,
          ...(s.agentId ? { agentId: s.agentId } : {}),
          deleteTranscript: true,
        });
        deleted++;
      } catch { failed++; }
    }
    toast(`清理完成：删除 ${deleted} 个会话${failed ? `，${failed} 个失败` : ""}（当前、置顶、项目内会话已保留）`);
  }

  function askCleanup() {
    showModal({
      title: "一键清理会话记录",
      body: "只清理当前模式中未整理的会话及聊天记录；其他三个模式不会受影响。当前打开、置顶和项目内会话都会保留。此操作不可撤销，确定继续吗？",
      dangerText: "确认清理",
      busyText: "清理中…",
      onConfirm: cleanupSessions,
    });
  }

  async function deleteAllSessions() {
    const agentId = currentModeAgent();
    const currentKey = pageSessionKey();
    const currentProject = projectOf(currentKey);
    const [active, archivedRows] = await Promise.all([
      gwRequest('sessions.list', {agentId, archived:false, limit:1000}),
      gwRequest('sessions.list', {agentId, archived:true, limit:1000}),
    ]);
    const all = new Map();
    for (const item of [...extractSessions(active), ...extractSessions(archivedRows)]) {
      if (item.agentId === agentId && item.key !== `agent:${agentId}:main`) all.set(item.key, item);
    }
    const targets = [...all.values()];
    if (!targets.length) {
      toast('当前模式没有可删除的普通会话');
      return;
    }
    const deleted = [];
    let failed = 0;
    for (let offset = 0; offset < targets.length; offset += 5) {
      const results = await Promise.all(targets.slice(offset, offset + 5).map(async (item) => {
        try {
          await gwRequest('sessions.delete', {key:item.key, agentId, deleteTranscript:true}, 30000);
          return item.key;
        } catch { failed += 1; return ''; }
      }));
      deleted.push(...results.filter(Boolean));
    }
    for (const key of deleted) removeSessionFromLocalState(key);
    window.PinkieSessionList?.invalidate();
    sessionIndex = null;
    schedule();
    if (deleted.includes(currentKey)) {
      await createProjectSession(currentProject && state.projectFolders[currentProject] ? currentProject : null);
    }
    toast(`已删除 ${deleted.length} 个会话和记录${failed ? `，${failed} 个未能删除` : ''}`);
  }

  function askDeleteAllSessions() {
    showModal({
      title:'删除当前模式全部会话',
      body:'普通会话和聊天记录会一次删除；其他模式、主会话以及项目文件夹里的真实文件不会被动。此操作不可撤销。',
      dangerText:'全部删除',
      busyText:'正在批量删除…',
      onConfirm:deleteAllSessions,
    });
  }

  /* ---------- 6. 行内按钮与项目菜单 ---------- */
  function keyOfRow(row) {
    const link = row.querySelector("a.sidebar-recent-session__link");
    if (!link) return null;
    try {
      return new URL(link.href, location.href).searchParams.get("session");
    } catch { return null; }
  }

  function openProjectMenu(anchor, key) {
    openMenu(anchor, (menu) => {
      const current = projectOf(key);
      const names = Object.keys(state.projects);
      for (const name of names) {
        menuItem(menu, ICONS.folder, name === current ? `${name}（当前）` : name, () => {
          if(name!==current)assignToProject(key,name);
          closeMenu();
        });
      }
      if (names.length) {
        const div = document.createElement("div");
        div.className = "laolao-menu__divider";
        menu.appendChild(div);
      }
      menuItem(menu, ICONS.plus, "添加文件夹项目…", async () => {
        const ownerMode=stateMode;
        closeMenu();
        const name=await addFolderProject();
        if(name&&stateMode===ownerMode)await assignToProject(key,name);
      });
    });
  }

  async function assignToProject(key, name) {
    if (modeForSession(key) !== stateMode) {
      toast("这个会话属于其他模式，不能放进当前项目");
      return;
    }
    const ownerMode=stateMode,ownerState=state;
    try {
      const current=await gwRequest('pinkie.project.bind',{key,path:null});
      if(current.binding&&(!name||ownerState.projectFolders[name]!==current.binding.root))throw new Error('这个会话已有固定项目。请在目标项目中新建会话。');
      if(name){if(!ownerState.projectFolders[name])throw new Error('请先给这个分组选择文件夹');await gwRequest('pinkie.project.bind',{key,path:ownerState.projectFolders[name],name});}
      if(stateMode!==ownerMode){toast('模式已切换，请回原模式重新操作');return;}
    } catch(error){toast(error.message);return;}
    for (const keys of Object.values(state.projects)) {
      const i = keys.indexOf(key);
      if (i >= 0) keys.splice(i, 1);
    }
    if (name) {
      if (!state.projects[name]) state.projects[name] = [];
      state.projects[name].push(key);
      toast(`已归入「${name}」`);
    } else {
      toast("已移出项目");
    }
    // Empty folder projects remain available for their next conversation.
    save();
    schedule();
  }

  async function togglePin(key) {
    if (modeForSession(key) !== stateMode) return;
    const ownerMode=stateMode,ownerState=state;
    const pinned=!ownerState.pins.includes(key);
    try{await patchSession(key,{pinned});}catch(error){toast('置顶未保存：'+error.message);return;}
    if(stateMode!==ownerMode){const i=ownerState.pins.indexOf(key);if(pinned&&i<0)ownerState.pins.push(key);else if(!pinned&&i>=0)ownerState.pins.splice(i,1);writeModeState(ownerMode,ownerState);return;}
    const i = state.pins.indexOf(key);
    if (i >= 0) { state.pins.splice(i, 1); toast("已取消置顶"); }
    else { state.pins.push(key); toast("已置顶"); }
    save();
    schedule();
  }

  function decorateRow(row) {
    if (row.dataset.laolaoDecorated) return;
    row.dataset.laolaoDecorated = "1";
    const key = keyOfRow(row);
    if (!key) return;

    const actions = document.createElement("span");
    actions.className = "laolao-row-actions";

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "laolao-row-btn";
    pinBtn.innerHTML = ICONS.pin;
    pinBtn.title = "置顶";
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      togglePin(key);
    });

    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "laolao-row-btn";
    folderBtn.innerHTML = ICONS.folder;
    folderBtn.title = "归入项目";
    folderBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      openProjectMenu(folderBtn, key);
    });

    actions.append(pinBtn, folderBtn);
    const aside = row.querySelector(".session-row-aside");
    if (aside) aside.prepend(actions);
    else row.appendChild(actions);
  }

  /* ---------- 7. 布局应用 ---------- */
  let applying = false;
  let timer = null;

  function ensureUI(section) {
    const recent = section.querySelector(".sidebar-recent-sessions");
    if (!recent) return null;

    let pins = section.querySelector('[data-laolao-group="__pins"]');
    if (!pins) {
      pins = makeGroup("__pins", "置顶");
      section.insertBefore(pins, recent);
    }

    let projWrap = section.querySelector("#laolao-projects");
    if (!projWrap) {
      projWrap = document.createElement("div");
      projWrap.id = "laolao-projects";
      projWrap.className = "laolao-group";

      const head = document.createElement("div");
      head.className = "laolao-group__head";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "laolao-group__toggle";
      toggle.innerHTML = ICONS.chevron;
      toggle.title = "折叠 / 展开";
      toggle.setAttribute("aria-label", "折叠或展开项目");
      toggle.addEventListener("click", () => {
        state.collapsed["__projects"] = !state.collapsed["__projects"];
        save();
        syncGroupCollapse(projWrap, "__projects");
      });
      const label = document.createElement("span");
      label.className = "laolao-group__label";
      label.textContent = "项目";
      const addBtn = makeIconBtn(ICONS.plus, "新建项目", () => {
        openMenu(addBtn, (menu) => {
          menuItem(menu, ICONS.folder, "选择文件夹作为项目…", async () => {
            closeMenu();
            await addFolderProject();
          });
          menuItem(menu, ICONS.plus, "仅创建会话分组…", () => {
            showNameInput(menu, {
              onSubmit: (name) => {
                if (state.projects[name]) return toast(`已经有一个「${name}」了`);
                state.projects[name] = [];
                save();
                schedule();
                toast(`已创建会话分组「${name}」`);
              },
            });
          });
        });
      });
      head.append(toggle, label, addBtn);

      const list = document.createElement("div");
      list.className = "laolao-group__list";
      list.id = "laolao-projects-list";

      projWrap.append(head, list);
      syncGroupCollapse(projWrap, "__projects");
      section.insertBefore(projWrap, recent);
    }

    // 最近：改名 + 清理按钮（幂等）
    const labelText = recent.querySelector(".sidebar-recent-sessions__label-text");
    if (labelText && ["会话", "Sessions", "Recent"].includes(labelText.textContent.trim())) {
      labelText.textContent = "最近";
    }
    const head = recent.querySelector(".sidebar-recent-sessions__head");
    if (head && !head.querySelector(".laolao-cleanup-btn")) {
      const cleanBtn = makeIconBtn(ICONS.trash, "一键清理会话记录", askCleanup, "laolao-cleanup-btn");
      head.appendChild(cleanBtn);
    }
    return { pins, projWrap, recent };
  }

  function applyLayout(section, ui) {
    const pinsList = ui.pins.querySelector(":scope > .laolao-group__list");
    const projListWrap = ui.projWrap.querySelector("#laolao-projects-list");
    const recentList = ui.recent.querySelector(".sidebar-recent-sessions__list");
    if (!pinsList || !projListWrap || !recentList) return;

    // 同步项目组（增删）
    const names = Object.keys(state.projects);
    for (const groupEl of [...projListWrap.querySelectorAll("[data-laolao-group]")]) {
      const name = groupEl.dataset.laolaoGroup.replace(/^proj:/, "");
      if (!names.includes(name)) groupEl.remove();
    }
    const projGroups = {};
    for (const name of names) {
      const id = "proj:" + name;
      let g = projListWrap.querySelector(`[data-laolao-group="${CSS.escape(id)}"]`);
      if (!g) {
        g = makeGroup(id, name, [
          makeIconBtn(ICONS.plus, "在此项目中新建会话", () => createProjectSession(name)),
          makeIconBtn(ICONS.folder, "管理项目文件夹", (event) => openProjectSettings(event.currentTarget, name)),
        ]);
        g.classList.add("laolao-project");
        projListWrap.appendChild(g);
      }
      const projectPath = state.projectFolders[name] || "";
      const projectLabel = g.querySelector(":scope > .laolao-group__head .laolao-group__label");
      if (projectLabel) {
        projectLabel.title = projectPath || "仅会话分组";
        projectLabel.classList.toggle("laolao-group__label--folder", Boolean(projectPath));
      }
      let pathLabel = g.querySelector(":scope > .laolao-project__path");
      if (projectPath && !pathLabel) {
        pathLabel = document.createElement("div");
        pathLabel.className = "laolao-project__path";
        g.insertBefore(pathLabel, g.querySelector(":scope > .laolao-group__list"));
      }
      if (pathLabel) {
        if (projectPath) {
          pathLabel.textContent = projectPath.replace(/^\/Users\/[^/]+/, "~");
          pathLabel.title = projectPath;
        } else {
          pathLabel.remove();
        }
      }
      projGroups[name] = g;
    }

    // 归置会话行：先按 key 去重（应用重渲染 recentList 时会生成新节点，
    // 已移走的旧节点会残留成重复项；保留仍在 recentList 里的新节点）
    const rows = [...section.querySelectorAll(".sidebar-recent-session.session-row-host")];
    const byKey = new Map();
    for (const row of rows) {
      const key = keyOfRow(row);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const existingFresh = existing.parentElement === recentList;
      const currentFresh = row.parentElement === recentList;
      if (currentFresh && !existingFresh) {
        byKey.set(key, row);
        existing.remove();
      } else {
        row.remove();
      }
    }

    for (const [key, row] of byKey) {
      decorateRow(row);
      const pinned = state.pins.includes(key);
      const proj = projectOf(key);

      const actions = row.querySelector(".laolao-row-actions");
      if (actions) {
        actions.classList.toggle("laolao-row-actions--pinned", pinned);
        const pinBtn = actions.querySelector(".laolao-row-btn");
        if (pinBtn) pinBtn.classList.toggle("laolao-active", pinned);
      }

      const currentKey = pageSessionKey();
      row.classList.toggle("sidebar-recent-session--active", key === currentKey);

      let target = recentList;
      if (pinned) target = pinsList;
      else if (proj && projGroups[proj]) {
        target = projGroups[proj].querySelector(":scope > .laolao-group__list");
      } else if (row.dataset.laolaoSynthetic) {
        // 合成行不再属于任何分组 → 移除（若它仍是最近会话，应用会自己渲染真行）
        target = null;
      }
      if (target === null) row.remove();
      else if (row.parentElement !== target) target.appendChild(row);
    }

    // 为掉出最近列表的置顶/项目会话合成行
    const realKeys = new Set();
    for (const [key, row] of byKey) {
      if (!row.dataset.laolaoSynthetic && row.isConnected) realKeys.add(key);
    }
    const missing = [];
    for (const k of state.pins) if (!realKeys.has(k)) missing.push(k);
    for (const keys of Object.values(state.projects)) {
      for (const k of keys || []) if (!realKeys.has(k)) missing.push(k);
    }
    if (missing.length) {
      ensureSessionIndex();
      for (const key of missing) {
        const exists = section.querySelector(
          `[data-laolao-synthetic][data-session-key="${CSS.escape(key)}"]`
        );
        if (exists) continue;
        const pinned = state.pins.includes(key);
        const proj = projectOf(key);
        const row = makeSyntheticRow(key);
        decorateRow(row);
        const target = pinned
          ? pinsList
          : proj && projGroups[proj]
            ? projGroups[proj].querySelector(":scope > .laolao-group__list")
            : null;
        if (target) target.appendChild(row);
      }
    }

    // 计数与可见性
    const pinsCount = pinsList.childElementCount;
    ui.pins.style.display = pinsCount ? "" : "none";
    const pinsCountEl = ui.pins.querySelector(".laolao-group__count");
    if (pinsCountEl) pinsCountEl.textContent = pinsCount ? String(pinsCount) : "";
    for (const [name, g] of Object.entries(projGroups)) {
      const list = g.querySelector(":scope > .laolao-group__list");
      const stored = (state.projects[name] || []).length;
      const countEl = g.querySelector(".laolao-group__count");
      if (countEl) countEl.textContent = stored ? String(stored) : "";
      if (!list) continue;
      const hasRows = !!list.querySelector(".sidebar-recent-session");
      const empty = list.querySelector(".laolao-group__empty");
      if (!hasRows && !empty) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "laolao-group__empty";
        emptyEl.textContent = "暂无会话";
        list.appendChild(emptyEl);
      } else if (hasRows && empty) {
        empty.remove();
      }
    }
  }

  function run() {
    if (applying) return;
    const section = document.querySelector("section.sidebar-sessions");
    if (!section) return;
    applying = true;
    try {
      syncModeState();
      if(window.PinkieSessionList){
        window.PinkieSessionList.render(section,{mode:stateMode,agentId:currentModeAgent(),state,currentKey:pageSessionKey(),
          gwRequest,navigateSession,createProjectSession,addFolderProject,openProjectSettings,revealProject:revealNativeFolder,sessionMenu,togglePin,patchSession,askDeleteAllSessions,toast,
          toggleGroup:id=>{state.collapsed[id]=!state.collapsed[id];save();schedule();}});
        refreshScopeLabel();return;
      }
      const ui = ensureUI(section);
      if (ui) {
        applyLayout(section, ui);
        applyModeFilter(section);
        refreshScopeLabel();
      }
    } finally {
      applying = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 80);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 模式切换是 SPA 路由变化（URL 变了但未必触发列表重渲染）：单独盯 URL
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      schedule();
    }
  }, 500);
  window.addEventListener("popstate", schedule);
  window.addEventListener("laolao:modechange", schedule);

  /* 调试句柄（只读排查用） */
  window.__laolaoSidebar = {
    gwRequest,
    askDeleteAllSessions,
    get mode() { return stateMode; },
    get state() { return state; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }
})();
