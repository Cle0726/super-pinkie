/* 碧琪小伙伴 + 模式氛围 + 输入框动效。
   - 碧琪趴在输入框上边沿偏右：平时安静（只有很轻的呼吸），你打字时抬头看，碧琪输出时托腮，
     完成时欢呼一下，很久没操作会睡着。点她打开功能菜单。
   - 功能：这是啥意思 / 一句话总结 / 帮我把问题问清楚 / 专注 25 分钟；模型请求走插件方法
     pinkie.companion.ask（独立模型），右键可设置模型与参数，只有测试预览使用演示回答。
   - 发送、完成时按模式放一点点缀（气球、彩带、光点…）；氛围画布很轻，页面不可见或切换模式时停。 */
(() => {
  "use strict";
  if (window.__pinkieBuddy) return;

  const MODES = ["chat", "project", "thinking", "learning", "unrestricted"];
  const mode = () => { const m = document.documentElement.getAttribute("data-laolao-mode"); return MODES.includes(m) ? m : "chat"; };
  const ART = (m, s) => `./laolao-pinkie-buddy-${m}-${s}.png`;
  const CALL = {project: "老板"};
  const callUser = () => CALL[mode()] || "先生";
  const PREF_KEY = "pinkie-buddy-prefs-v1";
  const SLEEPY_AFTER = 10 * 60_000;
  const FOCUS_MINUTES = 25;
  const preview = window.__pinkieCompanionPreview === true;
  const prefs = (() => { try { return {ambient: true, narrate: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}")}; } catch { return {ambient: true, narrate: false}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  let buddy, figure, imgA, imgB, bubble, menu, caption, frontImg, rig = null;
  let state = "rest", lastActivity = Date.now(), bubbleTimer = 0, wasRunning = false, happyUntil = 0, focus = null;
  let lastNarrated = "", lastNarrateAt = 0, imageVersion = 0, requestVersion = 0;
  let previewState = "", previewUntil = 0;
  const preloadedModes = new Set();
  let settingsDialog = null, settingsRequest = 0;
  const MODE_NAMES = {chat:"聊天",project:"项目",thinking:"想法",learning:"学习",unrestricted:"自由"};
  const helperRpc = async (method, params, timeout=10000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc !== "function") throw new Error("设置服务暂时未连接，请稍后再试");
    return rpc(method,params,timeout);
  };

  /* ── 模型请求 ─────────────────────────────────────────────────────────── */
  const DEMO = {
    explain: (t) => `<strong>${esc(t)}</strong>，用大白话说：${/api/i.test(t) ? "就像餐厅的点菜窗口——你按规矩递单子，后厨照单做菜，你不用进厨房" : /token/i.test(t) ? "模型读文字时用的「小积木块」，块数决定花多少钱、能记住多少" : "一个专门的工具或概念，碧琪会结合当前聊天讲给你"}。<div class="muted">样板演示回答，接上模型后会结合上下文现讲</div>`,
    summary: () => `一句话：碧琪把这周学习排成每天不超过 50 分钟，周三只复习 15 分钟，周末空着。<div class="muted">样板演示回答</div>`,
  };
  const helperRequests = new Set();
  const ask = async (kind, payload) => {
    const job = {mode: mode()};
    helperRequests.add(job);
    try {
    if (preview) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (kind === "clarify") return {text: `${payload.text.replace(/[？?。]*$/, "")}。请给我具体建议，并说明需要注意的地方。`};
      return {html: DEMO[kind] ? DEMO[kind](payload.text || "") : "这个功能还没有演示回答。"};
    }
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (typeof rpc === "function") {
      try {
        const res = await rpc("pinkie.companion.ask", {kind, mode: job.mode, ...payload}, 135000);
        if (res && typeof res.text === "string" && res.text.trim()) return {html: esc(res.text).replace(/\n/g, "<br>"), text: res.text};
        if (res?.error) return {html: `碧琪这次没想出来：${esc(res.error)}`};
      } catch (error) {
        if (!/unknown method|not found|invalid/i.test(String(error?.message || ""))) return {html: `碧琪这次没连上：${esc(error?.message || error)}`};
      }
    }
    return {html: "小帮手还没连接独立模型，先保留你正在写的内容。"};
    } finally { helperRequests.delete(job); }
  };

  /* ── 碧琪本体：两张图交替淡入淡出，换表情不闪 ───────────────────────── */
  const build = () => {
    buddy = el("div", "pinkie-buddy");
    buddy.dataset.state = "rest";
    figure = el("button", "pinkie-buddy__figure"); figure.type = "button"; figure.setAttribute("aria-label", "碧琪小伙伴，点我打开小菜单");
    figure.setAttribute("aria-haspopup", "menu"); figure.setAttribute("aria-expanded", "false"); figure.setAttribute("aria-controls", "pinkie-buddy-menu");
    imgA = el("img", "pinkie-buddy__img is-front"); imgB = el("img", "pinkie-buddy__img"); imgA.alt = imgB.alt = "";
    imgA.src = ART(mode(), "rest"); frontImg = imgA;
    figure.append(imgA, imgB);
    caption = el("div", "pinkie-buddy__caption");
    bubble = el("div", "pinkie-buddy__bubble"); bubble.setAttribute("role", "status");
    menu = el("div", "pinkie-buddy__menu"); menu.setAttribute("role", "menu");
    menu.id = "pinkie-buddy-menu"; menu.inert = true; bubble.inert = true;
    buddy.append(figure, caption, bubble, menu);
    figure.addEventListener("click", (event) => { event.stopPropagation(); nudge("is-boop"); toggleMenu(); });
    figure.title = "左键打开小菜单，右键设置模型与参数";
    figure.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); openSettings(); });
    figure.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); event.stopPropagation(); openSettings();
      }
    });
    bubble.addEventListener("mouseenter", () => clearTimeout(bubbleTimer));
    bubble.addEventListener("mouseleave", () => { if (!bubble.dataset.sticky) scheduleHide(4000); });
    document.addEventListener("click", (event) => { if (!buddy.contains(event.target)) hideMenu(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (menu.classList.contains("is-shown") || bubble.classList.contains("is-shown"))) {
        event.preventDefault(); hideMenu(); hideBubble(); figure.focus(); return;
      }
      if (!menu.classList.contains("is-shown") || !buddy.contains(event.target)) return;
      const items = [...menu.querySelectorAll("button")];
      let index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") index = (index + 1) % items.length;
      else if (event.key === "ArrowUp") index = (index + items.length - 1) % items.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = items.length - 1;
      else return;
      event.preventDefault(); items[index]?.focus();
    });
  };
  /* 会动的碧琪（laolao-buddy-rig.js，加载先后不限）：画出第一帧后才把静态图藏起来；不可用时一直用静态图 */
  // 创建画布要编译着色器（二三十毫秒），等开场画面结束、页面渲染完再做，免得和首屏抢时间；最多等 8 秒。
  let rigTried = false, firstMountAt = 0;
  const pageSettled = () => {
    const waited = performance.now() - firstMountAt;
    if (waited > 8000) return true;
    return waited > 1500 && !document.getElementById("laolao-splash") && !document.documentElement.hasAttribute("data-laolao-mode-pending");
  };
  const ensureRig = () => {
    if (rig || rigTried || !figure || !window.__pinkieBuddyRig) return;
    if (!firstMountAt) firstMountAt = performance.now();
    if (!pageSettled()) return;
    rigTried = true;
    rig = window.__pinkieBuddyRig.attach(figure);
    if (!rig) return;
    rig.onReady = () => buddy.classList.add("is-rig");
    rig.onDead = () => { buddy.classList.remove("is-rig"); rig = null; };
    rig.setMood(state);
    rig.setImage(frontImg.src);
    warmRig();
  };
  const STATES = ["rest", "typing", "working", "happy", "sleepy"];
  const warmRig = () => window.__pinkieBuddyRig?.warm?.(STATES.map((s) => new URL(ART(mode(), s), location.href).href));
  const preload = () => {
    const m = mode(); if (preloadedModes.has(m)) return; preloadedModes.add(m);
    for (const s of STATES) { const i = new Image(); i.decoding = "async"; i.src = ART(m, s); }
    warmRig();
  };

  const mount = () => {
    const shell = document.querySelector(".agent-chat__composer-shell");
    if (!shell) return;
    if (!buddy) build();
    if (buddy.parentElement !== shell) {
      if (getComputedStyle(shell).position === "static") shell.style.position = "relative";
      shell.append(buddy);
      const track = el("span", "pinkie-focus-track"); track.setAttribute("aria-hidden", "true"); shell.append(track);
    }
    preload();
    ensureRig();
    // 追加卡留在她左侧；她始终趴在输入框上沿。
    const queue = document.querySelector(".chat-queue");
    const qr = queue?.getBoundingClientRect();
    document.documentElement.toggleAttribute("data-pinkie-queue", Boolean(qr?.height));
    if (buddy.dataset.mode !== mode()) {
      if (settingsDialog?.open) settingsDialog.close();
      buddy.dataset.mode = mode(); requestVersion += 1; hideBubble(); hideMenu();
      show(state, true);
    }
  };

  const show = (s, force = false) => {
    const src = ART(mode(), s);
    rig?.setImage(new URL(src, location.href).href);
    if (!force && frontImg.getAttribute("src") === src) return;
    const back = frontImg === imgA ? imgB : imgA;
    const ticket = ++imageVersion;
    back.onload = () => {
      if (ticket !== imageVersion || back.getAttribute("src") !== src) return;
      back.onload = null; back.classList.add("is-front"); frontImg.classList.remove("is-front"); frontImg = back;
    };
    back.setAttribute("src", src);
    if (back.complete && back.naturalWidth) back.onload?.();
  };
  const setState = (next) => {
    if (next === state) return;
    const from = state; state = next; buddy.dataset.state = next;
    show(next);
    rig?.setMood(next);
    if (next === "happy") rig?.impulse("hop");
    if (from === "sleepy" && next !== "sleepy" && rig) {
      // 睡醒：伸个懒腰，头顶冒一颗小星星
      rig.impulse("wake");
      const r = figure.getBoundingClientRect();
      window.__pinkieImmersion?.floatMark?.(r.left + r.width * .32, r.top + r.height * .05, "sparkle");
    }
    if ((from === "rest" && ["typing", "working"].includes(next)) || next === "happy") nudge("is-perk");
  };
  const nudge = (cls) => {
    rig?.impulse(cls === "is-boop" ? "boop" : "perk");
    buddy.classList.remove(cls); void buddy.offsetWidth; buddy.classList.add(cls); setTimeout(() => buddy.classList.remove(cls), 700);
  };

  /* ── 气泡 & 菜单 ─────────────────────────────────────────────────────── */
  const say = (html, {sticky = false, ms = 6000, close = sticky} = {}) => {
    hideMenu();
    bubble.innerHTML = html;
    if (close) {
      const x = el("button", "pinkie-buddy__close"); x.type = "button"; x.setAttribute("aria-label", "收起");
      x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      x.addEventListener("click", (e) => { e.stopPropagation(); hideBubble(); });
      bubble.append(x);
    }
    bubble.classList.toggle("has-close", close);
    bubble.dataset.sticky = sticky ? "1" : "";
    bubble.inert = false;
    bubble.classList.add("is-shown");
    clearTimeout(bubbleTimer);
    if (!sticky) scheduleHide(ms);
  };
  const scheduleHide = (ms) => { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, ms); };
  const hideBubble = () => { bubble.classList.remove("is-shown"); bubble.dataset.sticky = ""; bubble.inert = true; };
  const hideMenu = () => { menu.classList.remove("is-shown"); menu.inert = true; figure.setAttribute("aria-expanded", "false"); };
  const toggleMenu = () => {
    if (menu.classList.contains("is-shown")) return hideMenu();
    hideBubble();
    menu.textContent = "";
    const item = (key, label, fn, hint = "") => {
      const b = el("button", `pinkie-buddy__item ico--${key}`); b.type = "button"; b.setAttribute("role", "menuitem");
      const ico = el("span", "pinkie-buddy__ico"); ico.innerHTML = ICON[key];
      b.append(ico, el("span", "pinkie-buddy__label", label));
      if (hint) b.append(el("span", "pinkie-buddy__hint", hint));
      b.addEventListener("click", (e) => { e.stopPropagation(); hideMenu(); fn(); });
      menu.append(b);
    };
    item("explain", "这是啥意思", explainFlow, "选中词也行");
    item("summary", "一句话总结", summaryFlow);
    item("clarify", "帮我把问题问清楚", clarifyFlow);
    item("focus", focus ? "结束专注" : `专注 ${FOCUS_MINUTES} 分钟`, focus ? () => stopFocus() : startFocus);
    menu.append(el("div", "pinkie-buddy__sep"));
    item("ambient", prefs.ambient ? "关掉氛围" : "打开氛围", () => { prefs.ambient = !prefs.ambient; savePrefs(); ambient.sync(); });
    item("narrate", prefs.narrate ? "不播报进度" : "播报干活进度", () => { prefs.narrate = !prefs.narrate; savePrefs(); if (!prefs.narrate) caption.classList.remove("is-shown"); });
    item("settings", "模型与参数", openSettings, "也可右键");
    menu.classList.add("is-shown");
    menu.inert = false; figure.setAttribute("aria-expanded", "true");
  };

  const openSettings = async () => {
    hideMenu(); hideBubble();
    if (settingsDialog?.open) { settingsDialog.focus(); return; }
    settingsDialog?.remove();
    const originMode=mode(), ticket=++settingsRequest;
    const dialog=el("dialog","pinkie-buddy-settings"); settingsDialog=dialog;
    dialog.setAttribute("aria-labelledby","pinkie-buddy-settings-title");
    const heading=el("div","pinkie-buddy-settings__heading");
    const title=el("h2","",`${MODE_NAMES[originMode]}小碧琪 · 模型与参数`); title.id="pinkie-buddy-settings-title";
    const close=el("button","pinkie-buddy-settings__close","×"); close.type="button"; close.setAttribute("aria-label","关闭模型设置");
    close.addEventListener("click",()=>dialog.close()); heading.append(title,close);
    const note=el("p","pinkie-buddy-settings__note","这组设置用于小碧琪的解释、总结和提问整理。");
    const form=el("form","pinkie-buddy-settings__form"), fields=el("fieldset","pinkie-buddy-settings__fields");
    fields.disabled=true;
    const field=(label,input,hint="")=>{const row=el("label","pinkie-buddy-settings__field");row.append(el("span","",label),input);if(hint)row.append(el("small","",hint));fields.append(row);return input;};
    const model=field("模型",el("select"));
    const thinking=field("思考强度",el("select"));
    const temperature=field("随机程度",el("input"),"留空使用模型默认值"); temperature.type="number";temperature.min="0";temperature.max="2";temperature.step="0.1";temperature.placeholder="默认";
    const maxTokens=field("输出上限（Token）",el("input"));maxTokens.type="number";maxTokens.min="256";maxTokens.max="32000";maxTokens.step="1";maxTokens.required=true;
    const timeout=field("等待时间（秒）",el("input"));timeout.type="number";timeout.min="5";timeout.max="120";timeout.step="1";timeout.required=true;
    const sync=el("label","pinkie-buddy-settings__sync"), allModes=el("input");allModes.type="checkbox";sync.append(allModes,el("span","","同步到所有模式"));
    const status=el("p","pinkie-buddy-settings__status","正在读取设置…");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const actions=el("div","pinkie-buddy-settings__actions"), test=el("button","pinkie-buddy-settings__button","测试连接"), save=el("button","pinkie-buddy-settings__button is-primary","保存设置");
    test.type="button";save.type="submit";test.disabled=save.disabled=true;actions.append(test,save);
    form.append(fields,sync,status,actions);dialog.append(heading,note,form);document.body.append(dialog);
    dialog.addEventListener("close",()=>{settingsRequest++;if(figure?.isConnected)figure.focus();});
    dialog.showModal();
    let catalog=[], data=null;
    const live=()=>settingsDialog===dialog && dialog.open && settingsRequest===ticket && mode()===originMode;
    const showStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle("is-error",error);};
    const capabilities=()=>{
      const current=catalog.find(item=>item.id===(model.value || data?.defaultModel));
      const previous=thinking.value, levels=current?.thinkingLevels || ["auto"];
      thinking.textContent="";
      for(const level of levels){const o=el("option","",{auto:"自动",low:"低",medium:"标准",high:"高"}[level] || level);o.value=level;thinking.append(o);}
      thinking.value=levels.includes(previous)?previous:"auto";thinking.disabled=levels.length===1;
      temperature.disabled=current?.temperatureSupported===false;if(temperature.disabled)temperature.value="";
      maxTokens.max=String(Math.min(32000,current?.maxTokens || 32000));
    };
    const render=(result)=>{
      data=result;catalog=Array.isArray(result?.models)?result.models:[];
      model.textContent="";
      const fallback=el("option","",`默认 · ${result.defaultModel || result.model || "未配置"}`);fallback.value="";model.append(fallback);
      for(const item of catalog){const o=el("option","",`${item.name} · ${item.id}`);o.value=item.id;model.append(o);}
      const value=result.settings || {model:"",thinking:"auto",temperature:null,maxTokens:1600,timeoutSeconds:25};
      if(value.model && !catalog.some(item=>item.id===value.model)){const missing=el("option","",`${value.model}（暂时不可用）`);missing.value=value.model;model.append(missing);}
      model.value=value.model || "";capabilities();thinking.value=[...thinking.options].some(o=>o.value===value.thinking)?value.thinking:"auto";
      temperature.value=value.temperature==null?"":String(value.temperature);if(temperature.disabled)temperature.value="";
      maxTokens.value=String(value.maxTokens);timeout.value=String(value.timeoutSeconds);
      fields.disabled=false;test.disabled=save.disabled=!catalog.length;
      showStatus(result.available?"设置会记住，切回这个模式时继续使用。":"当前模型暂时不可用，请换一个模型后测试连接。",!result.available);
    };
    const values=()=>({model:model.value,thinking:thinking.value || "auto",temperature:temperature.value===""?null:Number(temperature.value),maxTokens:Number(maxTokens.value),timeoutSeconds:Number(timeout.value)});
    model.addEventListener("change",()=>{capabilities();showStatus("参数已修改，保存后生效。");});
    form.addEventListener("input",()=>showStatus("参数已修改，保存后生效。"));
    form.addEventListener("submit",async(event)=>{
      event.preventDefault();if(!live())return;
      const settings=values(), syncAll=allModes.checked;fields.disabled=allModes.disabled=true;test.disabled=save.disabled=true;showStatus("正在保存…");
      try{const result=await helperRpc("pinkie.companion.settings.set",{mode:originMode,settings,allModes:syncAll});if(live()){render(result);showStatus(syncAll?"已保存到所有模式。":"已保存。下一次小碧琪回复会使用这组设置。");}}
      catch(error){if(live())showStatus(error.message || "保存失败，请再试一次。",true);}
      finally{if(live()){fields.disabled=allModes.disabled=false;test.disabled=save.disabled=!catalog.length;}}
    });
    test.addEventListener("click",async()=>{
      if(!form.reportValidity() || !live())return;
      const settings=values(), snapshot=JSON.stringify(settings);test.disabled=save.disabled=true;showStatus("正在测试连接…");
      try{const result=await helperRpc("pinkie.companion.test",{mode:originMode,settings},135000);if(live())showStatus(JSON.stringify(values())===snapshot?`连接正常 · ${Math.max(.1,result.latencyMs/1000).toFixed(1)} 秒`:"参数已修改，请用当前设置重新测试。");}
      catch(error){if(live())showStatus(error.message || "未连接成功，可以换模型或调整参数后再试。",true);}
      finally{if(live())test.disabled=save.disabled=!catalog.length;}
    });
    try{const result=await helperRpc("pinkie.companion.status",{mode:originMode});if(live()){if(!Array.isArray(result?.models))throw new Error("设置服务需要更新，重开 App 后再试。");render(result);model.focus();}}
    catch(error){if(live())showStatus(error.message || "暂时读不到设置，请稍后重新打开。",true);}
  };

  /* ── 功能 ─────────────────────────────────────────────────────────────── */
  const latestReply = () => {
    const groups = [...document.querySelectorAll(".chat-thread .chat-group.assistant:not(.chat-group--timeline-step)")];
    for (let i = groups.length - 1; i >= 0; i--) {
      const t = [...groups[i].querySelectorAll(".chat-text")].map((n) => n.innerText).join("\n").trim();
      if (t) return {text: t, group: groups[i]};
    }
    return {text: "", group: null};
  };
  const pickTerms = (group) => {
    if (!group) return [];
    const seen = new Set(); const out = [];
    const add = (t) => { t = t.trim().replace(/[，。：:；;,.]+$/, ""); if (t.length < 2 || t.length > 24 || seen.has(t.toLowerCase())) return; seen.add(t.toLowerCase()); out.push(t); };
    group.querySelectorAll(".chat-text code").forEach((c) => { const t = c.textContent; if (t.split(/\s+/).length <= 3) add(t); });
    const text = [...group.querySelectorAll(".chat-text")].map((n) => n.innerText).join(" ");
    (text.match(/\b[A-Z][A-Za-z0-9.+#-]{1,}(?:\s[A-Z][A-Za-z0-9.+#-]+)?\b|\b[a-z]+(?:[-_.][a-z0-9]+)+\b/g) || []).forEach(add);
    return out.slice(0, 6);
  };
  const thinkingDots = '<span class="pinkie-buddy__dots"><i></i><i></i><i></i></span>';
  const explain = async (term) => {
    const ticket = ++requestVersion, originMode = mode();
    setState("working");
    say(`碧琪在想「${esc(term)}」怎么说最好懂 ${thinkingDots}`, {sticky: true, close: false});
    const res = await ask("explain", {text: term, context: latestReply().text.slice(0, 1200)});
    if (ticket !== requestVersion || originMode !== mode()) return;
    happyUntil = Date.now() + 1800; setState("happy");
    say(res.html, {sticky: true});
  };
  const explainFlow = () => {
    const sel = String(window.getSelection?.() || "").trim();
    if (sel && sel.length <= 60) return explain(sel);
    const terms = pickTerms(latestReply().group);
    if (!terms.length) return say(`${callUser()}在聊天里选中看不懂的词，碧琪就用大白话讲给你听。`);
    say(`最新回复里这几个词可能不好懂，点一个：<div class="pinkie-buddy__chips"></div>`, {sticky: true});
    const box = bubble.querySelector(".pinkie-buddy__chips");
    terms.forEach((t) => { const c = el("button", "pinkie-buddy__chip", t); c.type = "button"; c.addEventListener("click", (e) => { e.stopPropagation(); explain(t); }); box.append(c); });
  };
  const summaryFlow = async () => {
    const reply = latestReply().text;
    if (reply.length < 120) return say("最新这条回复本来就挺短的，碧琪就不画蛇添足啦。");
    const ticket = ++requestVersion, originMode = mode();
    setState("working"); say(`碧琪正在把它缩成一句话 ${thinkingDots}`, {sticky: true, close: false});
    const res = await ask("summary", {text: reply.slice(0, 6000)});
    if (ticket !== requestVersion || originMode !== mode()) return;
    happyUntil = Date.now() + 1800; setState("happy"); say(res.html, {sticky: true});
  };
  const clarifyFlow = async () => {
    const ta = document.querySelector(".agent-chat__composer-combobox textarea");
    const draft = (ta?.value || "").trim();
    if (!draft) return say(`${callUser()}先在输入框里随便写几句，碧琪帮你整理成更清楚的问题。`);
    const ticket = ++requestVersion, originMode = mode();
    setState("working"); say(`碧琪在帮你理一理 ${thinkingDots}`, {sticky: true, close: false});
    const res = await ask("clarify", {text: draft, context: latestReply().text.slice(0, 1200)});
    if (ticket !== requestVersion || originMode !== mode()) return;
    setState("rest");
    if (res.text && ta) {
      say(`这样问会更清楚：<div class="pinkie-buddy__quote">${esc(res.text)}</div><div class="pinkie-buddy__chips"><button class="pinkie-buddy__chip is-primary" type="button" data-use>用这个</button><button class="pinkie-buddy__chip" type="button" data-keep>保留原来的</button></div>`, {sticky: true});
      bubble.querySelector("[data-use]").addEventListener("click", (e) => {
        e.stopPropagation();
        if (ta.value.trim() !== draft) return say("输入框里的内容已经变了，碧琪先保留你现在写的。", {sticky: true});
        ta.value = res.text; ta.dispatchEvent(new Event("input", {bubbles: true})); ta.focus(); hideBubble();
      });
      bubble.querySelector("[data-keep]").addEventListener("click", (e) => { e.stopPropagation(); hideBubble(); });
    } else say(res.html || "碧琪这次没整理出来。", {sticky: true});
  };

  /* 专注计时：输入框上边沿一条细细的进度线 + 碧琪身边的小时间 */
  const startFocus = () => {
    focus = {start: Date.now(), end: Date.now() + FOCUS_MINUTES * 60_000};
    document.documentElement.setAttribute("data-pinkie-focus", "");
    say(`好，接下来 ${FOCUS_MINUTES} 分钟碧琪陪${callUser()}专心，时间到了叫你休息。`);
  };
  const stopFocus = (done = false) => {
    focus = null; document.documentElement.removeAttribute("data-pinkie-focus");
    document.documentElement.style.removeProperty("--pinkie-focus-progress");
    caption.classList.remove("is-shown");
    if (done === true) { happyUntil = Date.now() + 3000; setState("happy"); burstFrom(figure, "done"); say(`${callUser()}专注了 ${FOCUS_MINUTES} 分钟，超棒！起来伸个懒腰、看看远处、喝口水吧。`, {sticky: true}); }
  };
  const tickFocus = () => {
    if (!focus) return;
    const left = Math.max(0, focus.end - Date.now());
    document.documentElement.style.setProperty("--pinkie-focus-progress", String(1 - left / (focus.end - focus.start)));
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    caption.textContent = `专注 ${m}:${String(s).padStart(2, "0")}`; caption.classList.add("is-shown");
    if (!left) stopFocus(true);
  };

  /* 进度翻译（不调模型） */
  const PLAIN = [
    [/list files|\bls\b|find files|查看目录/i, "在翻文件夹"], [/读取文件|\bread\b|show .*\.(md|txt|json)/i, "在读一份文件"],
    [/写入文件|\bwrite\b|编辑文件|\bedit\b|apply_patch/i, "在改文件"], [/web_search|搜索/i, "在网上查资料"],
    [/web_fetch|读取网页|browser|浏览器/i, "在看网页"], [/ffmpeg|视频|剪辑|渲染/i, "在处理视频"],
    [/\btest\b|测试|pytest/i, "在跑测试"], [/\bgit\b/i, "在看改动记录"], [/npm|pip|brew|install|安装/i, "在装工具"],
    [/exec|执行命令/i, "在电脑上执行命令"],
  ];
  const narrate = () => {
    if (!prefs.narrate || focus) return;
    const rows = document.querySelectorAll(".pinkie-process .chat-tool-msg-summary");
    const last = rows[rows.length - 1];
    const raw = last ? last.textContent.replace(/\s+/g, " ").trim() : "";
    if (!raw || raw === lastNarrated || Date.now() - lastNarrateAt < 2500) return;
    lastNarrated = raw; lastNarrateAt = Date.now();
    const hit = PLAIN.find(([re]) => re.test(raw));
    caption.textContent = `碧琪${hit ? hit[1] : "在忙一个小步骤"}`;
    caption.classList.add("is-shown");
  };

  /* ── 按模式的发送 / 完成点缀 ───────────────────────────────────────── */
  const fx = (() => {
    let canvas, ctx, parts = [], raf = 0;
    const fit = () => { const d = Math.min(2, devicePixelRatio || 1); canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const ensure = () => { if (canvas) return; canvas = el("canvas", "pinkie-burst"); document.body.append(canvas); ctx = canvas.getContext("2d"); fit(); addEventListener("resize", fit); };
    const PALETTE = {
      chat: ["#ff8fbf", "#ffd36e", "#8fd3ff", "#c9a7ff"], project: ["#59b7b4", "#a8e0dc", "#ffd9a0", "#7fa8d6"],
      thinking: ["#c8a8ff", "#fff3b0", "#ffd1f0", "#a9c8ff"], learning: ["#ffd27a", "#ffb2c8", "#b9a7ff", "#ffe7b8"],
      unrestricted: ["#ff5f9e", "#ffb84d", "#ffe45c", "#5fd38d", "#59b6ff", "#a77bff"],
    };
    const SHAPE = {chat: "balloon", project: "spark", thinking: "star", learning: "star", unrestricted: "ribbon"};
    const spawn = (x, y, kind) => {
      ensure();
      const m = mode(), colors = PALETTE[m], shape = SHAPE[m];
      // 发送只点到为止：四粒、小、飞得近；完成时多一点
      const send = kind === "send", n = send ? 4 : 16;
      for (let i = 0; i < n; i++) {
        const spread = send ? .7 : 1.25, ang = -Math.PI / 2 + (Math.random() - .5) * Math.PI * spread;
        const sp = (send ? 1.1 : 2.2) + Math.random() * (shape === "balloon" ? (send ? .6 : 1.2) : (send ? 1.1 : 2.4));
        parts.push({x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: Math.random() * 6, vr: (Math.random() - .5) * .2,
          c: colors[i % colors.length], s: (shape === "balloon" ? 5 + Math.random() * 3 : 2.5 + Math.random() * 2.5) * (send ? .75 : 1), life: send ? .8 : 1,
          decay: (shape === "balloon" ? .007 : .013) * (send ? 1.6 : 1), shape, ph: Math.random() * 6});
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const draw = (p) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.shape === "balloon") {
        ctx.beginPath(); ctx.ellipse(0, 0, p.s * .82, p.s, Math.sin(p.ph) * .15, 0, 6.29); ctx.fill();
        ctx.globalAlpha *= .6; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(0, p.s); ctx.quadraticCurveTo(3, p.s + 6, -1, p.s + 11); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.ellipse(-p.s * .3, -p.s * .35, p.s * .18, p.s * .28, -.5, 0, 6.29); ctx.fill();
      } else if (p.shape === "ribbon") {
        ctx.rotate(p.rot); ctx.lineWidth = 2.2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-p.s * 1.6, 0); ctx.bezierCurveTo(-p.s * .5, -p.s * 1.4, p.s * .5, p.s * 1.4, p.s * 1.6, 0); ctx.stroke();
      } else if (p.shape === "star") {
        ctx.rotate(p.rot); const r = p.s * 1.25;
        ctx.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? r * .32 : r; const a = k * Math.PI / 4; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
      } else {
        ctx.rotate(p.rot); ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
        ctx.globalAlpha *= .7; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-p.s * 1.4, 0); ctx.lineTo(p.s * 1.4, 0); ctx.moveTo(0, -p.s * 1.4); ctx.lineTo(0, p.s * 1.4); ctx.stroke();
      }
      ctx.restore();
    };
    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        if (p.shape === "balloon") { p.vy = p.vy * .985 - .02; p.vx *= .985; p.ph += .05; p.x += Math.sin(p.ph) * .25; }
        else { p.vy += .07; p.vx *= .99; }
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay; draw(p);
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

  /* 发送：按钮按下的回弹 + 一小撮点缀；输入框里文字往上飘走 */
  const onSend = () => {
    if (running() || !document.querySelector(".agent-chat__composer-combobox textarea")?.value.trim()) return;
    const btn = document.querySelector(".agent-chat__input .chat-send-btn:not(.chat-send-btn--stop)");
    const box = document.querySelector(".agent-chat__input");
    if (btn) burstFrom(btn, "send");
    lookUpAtThread();
    if (box) { box.classList.remove("is-sent"); void box.offsetWidth; box.classList.add("is-sent"); setTimeout(() => box.classList.remove("is-sent"), 700); }
  };
  document.addEventListener("click", (e) => { if (e.target.closest?.(".agent-chat__input .chat-send-btn:not(.chat-send-btn--stop)")) onSend(); }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.altKey) return;
    const ta = e.target.closest?.(".agent-chat__composer-combobox textarea");
    if (ta && ta.value.trim()) onSend();
  }, true);

  /* 视线：碧琪在写回复时看着回复，你在打字时看你打的字，刚发出去时抬头看一眼聊天 */
  let lookUpUntil = 0;
  const gaze = (run, typing, ta) => {
    if (!rig) return;
    if (Date.now() < lookUpUntil) return;
    if (run) {
      const bubbles = document.querySelectorAll(".chat-thread .chat-group.assistant .chat-bubble");
      const r = bubbles[bubbles.length - 1]?.getBoundingClientRect();
      if (r && r.bottom > 0 && r.top < innerHeight) { rig.attend(r.left + Math.min(r.width * .4, 420), Math.min(r.bottom, innerHeight - 160) - 30); return; }
    }
    if (typing && ta) { const r = ta.getBoundingClientRect(); rig.attend(r.left + r.width * .3, r.top + r.height / 2); return; }
    rig.attend(null);
  };
  const lookUpAtThread = () => {
    if (!rig) return;
    const r = document.querySelector(".chat-thread")?.getBoundingClientRect();
    if (!r) return;
    lookUpUntil = Date.now() + 1500;
    rig.attend(r.left + r.width * .45, r.bottom - 260, 1500);
    rig.impulse("pulse");
  };
  // 转场失败时不会发 finished，最多停 15 秒就自己恢复
  let rigResume = 0;
  window.addEventListener("laolao:mode-transition-start", () => { rig?.pause(true); clearTimeout(rigResume); rigResume = setTimeout(() => rig?.pause(false), 15000); });
  window.addEventListener("laolao:mode-transition-finished", () => { clearTimeout(rigResume); rig?.pause(false); });

  /* 滚动聊天时头发跟着惯性晃 */
  let scrollSum = 0, scrollPending = false;
  document.addEventListener("wheel", (e) => {
    if (!rig || !e.target.closest?.(".chat-thread")) return;
    scrollSum += e.deltaY;
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => { scrollPending = false; rig?.impulse("scroll", scrollSum); scrollSum = 0; });
  }, {passive: true, capture: true});

  /* ── 状态循环 ─────────────────────────────────────────────────────────── */
  const running = () => Boolean(document.querySelector(".chat-send-btn--stop"));
  const loop = () => {
    mount();
    if (!buddy?.isConnected) return;
    const now = Date.now(), run = running();
    document.documentElement.toggleAttribute("data-pinkie-running", run || (preview && previewUntil > now && previewState === "working"));
    if (wasRunning && !run) {
      happyUntil = now + 2200; lastNarrated = ""; caption.classList.remove("is-shown");
      setTimeout(() => burstFrom(figure, "done"), 120);
    }
    wasRunning = run;
    const ta = document.querySelector(".agent-chat__composer-combobox textarea");
    const typing = Boolean(ta && document.activeElement === ta && ta.value.trim());
    const helping = [...helperRequests].some(job => job.mode === mode());
    if (run || typing || helping) lastActivity = now;
    let next = "rest";
    if (run || helping) next = "working";
    else if (now < happyUntil) next = "happy";
    else if (typing) next = "typing";
    else if (now - lastActivity > SLEEPY_AFTER && !focus) next = "sleepy";
    if (preview && previewUntil > now) next = previewState;
    setState(next);
    gaze(run, typing, ta);
    if (run) narrate(); else if (!focus) caption.classList.remove("is-shown");
    tickFocus();
  };
  /* 会动的碧琪：打字时每敲一下跟着点一下头；鼠标靠近时头偏向鼠标 */
  document.addEventListener("input", (e) => { if (rig && e.target.closest?.(".agent-chat__composer-combobox textarea")) rig.impulse("key"); }, true);
  let lookPending = false, lookAt = null;
  document.addEventListener("pointermove", (e) => {
    if (!rig || e.pointerType === "touch") return;
    lookAt = [e.clientX, e.clientY];
    if (lookPending) return;
    lookPending = true;
    requestAnimationFrame(() => { lookPending = false; if (state !== "sleepy") rig?.look(...lookAt); });
  }, {passive: true});
  document.documentElement.addEventListener("pointerleave", () => rig?.look(null));
  ["keydown", "pointerdown", "wheel"].forEach((t) => window.addEventListener(t, () => { lastActivity = Date.now(); }, {passive: true}));
  if (preview) window.addEventListener("pinkie:preview-state", (event) => {
    if (!["rest", "typing", "working", "happy", "sleepy"].includes(event.detail)) return;
    mount(); previewState = event.detail; previewUntil = Date.now() + 10000; setState(previewState);
    if (previewState === "happy") burstFrom(figure, "done");
  });

  /* 选中聊天文字时出现「问碧琪」 */
  window.__pinkieSelectionActions?.register('ask', {
    order: 2,
    when: ({text, library}) => library ? text.length <= 20000 : text.length <= 60,
    create: () => {
      const askChip = el("button", "pinkie-buddy-ask");
      const ico = el("span", "pinkie-buddy__ico"); ico.innerHTML = ICON.explain;
      askChip.append(ico, el("span", "", "问碧琪"));
      return askChip;
    },
    run: selected => selected.library ? void window.__pinkieLibrary.askSelection(selected).catch(error => say(esc(error.message))) : explain(selected.text),
  });

  /* ── 氛围画布 ─────────────────────────────────────────────────────────── */
  const ambient = (() => {
    let canvas = null, ctx = null, raf = 0, last = 0, flow = 1, w = 0, h = 0, currentMode = "", parts = [], t0 = performance.now();
    let layer = null;   // 不动的部分（学习的光束、项目的网格）只画一次，每帧贴上去
    const rnd = (a, b) => a + Math.random() * (b - a);
    /* 柔光点预先画成小贴图，每帧只贴图、调透明度，不再每个点每帧新建渐变 */
    const sprites = new Map();
    const glow = (key, inner, outer, size = 64) => {
      if (sprites.has(key)) return sprites.get(key);
      const c = document.createElement("canvas"); c.width = c.height = size;
      const x = c.getContext("2d"), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, inner); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, size, size);
      sprites.set(key, c); return c;
    };
    const seed = () => {
      parts = []; const m = currentMode;
      if (m === "chat") for (let i = 0; i < 7; i++) parts.push({x: rnd(0, w), y: rnd(0, h), r: rnd(9, 16), v: rnd(6, 13), sway: rnd(0, 6.28), hue: [340, 50, 200, 280][i % 4]});
      if (m === "thinking") for (let i = 0; i < 26; i++) parts.push({x: rnd(0, w), y: rnd(0, h), r: rnd(1.5, 4.5), vx: rnd(-4, 4), vy: rnd(-7, -2), ph: rnd(0, 6.28)});
      if (m === "learning") for (let i = 0; i < 34; i++) parts.push({x: rnd(0, w * .75), y: rnd(0, h), r: rnd(1.2, 3.2), vx: rnd(2, 7), vy: rnd(-3, 3), ph: rnd(0, 6.28)});
      if (m === "unrestricted") for (let i = 0; i < 3; i++) parts.push({ph: rnd(0, 6.28), sp: rnd(.05, .12), hue: [330, 270, 190][i]});
    };
    const bakeLayer = (d) => {
      layer = null;
      const m = currentMode;
      if (m !== "learning" && m !== "project") return;
      layer = document.createElement("canvas");
      const pad = m === "project" ? 36 : 0;
      layer.width = Math.round((w + pad) * d); layer.height = Math.round(h * d);
      const x = layer.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0);
      if (m === "learning") {
        // 三道斜光按满透明度画好，每帧用整体透明度做呼吸
        x.translate(w * .08, -h * .05); x.rotate(.52);
        for (let i = 0; i < 3; i++) {
          const bx = i * w * .16, bw = w * (.09 + i * .03), g = x.createLinearGradient(bx, 0, bx + bw, 0), a = 1 - i * .22;
          g.addColorStop(0, "rgba(255,222,170,0)"); g.addColorStop(.5, `rgba(255,222,170,${a})`); g.addColorStop(1, "rgba(255,222,170,0)"); x.fillStyle = g; x.fillRect(bx, 0, bw, h * 1.6);
        }
      } else {
        const grid = 36; x.strokeStyle = "rgba(63,143,146,.07)"; x.lineWidth = 1; x.beginPath();
        for (let gx = 0; gx < w + pad; gx += grid) { x.moveTo(gx, 0); x.lineTo(gx, h); }
        for (let gy = 0; gy < h; gy += grid) { x.moveTo(0, gy); x.lineTo(w + pad, gy); }
        x.stroke();
      }
    };
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      // 柔光类（学习、想法、无限制）糊糊的，一倍分辨率看不出差别，像素少一半多；气球和网格保留高清
      const soft = ["learning", "thinking", "unrestricted"].includes(currentMode);
      const d = soft ? 1 : Math.min(1.5, devicePixelRatio || 1);
      w = r.width; h = r.height; canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); ctx.setTransform(d, 0, 0, d, 0, 0);
      seed(); bakeLayer(d);
    };
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      const imm = window.__pinkieImmersion, ptr = imm?.pointer && now - imm.pointer.t < 1500 ? imm.pointer : null;
      // 你打字、碧琪干活时，氛围跟着稍微快一点；停下来又慢慢回到原样
      const boost = 1 + (document.documentElement.hasAttribute("data-pinkie-running") ? .7 : 0) + (imm?.energy || 0) * .9;
      flow += (boost - flow) * .06;
      const dt = Math.min(.1, (now - last) / 1000) * flow; last = now;
      const t = (now - t0) / 1000, m = currentMode;
      // 鼠标附近的粒子会被轻轻推开
      const repel = (p, radius = 120, force = 60) => {
        if (!ptr) return;
        const dx = p.x - ptr.x, dy = p.y - ptr.y, d = Math.hypot(dx, dy);
        if (d > radius || d < 1) return;
        const k = (1 - d / radius) * force * dt / d; p.x += dx * k; p.y += dy * k;
      };
      ctx.clearRect(0, 0, w, h); ctx.globalAlpha = 1;
      if (m === "chat") {
        for (const p of parts) {
          p.y -= p.v * dt; p.sway += dt * .8; repel(p, 140, 90); if (p.y < -40) { p.y = h + 30; p.x = rnd(0, w); }
          const x = p.x + Math.sin(p.sway) * 10;
          ctx.globalAlpha = .22; ctx.fillStyle = `hsl(${p.hue} 80% 75%)`; ctx.beginPath(); ctx.ellipse(x, p.y, p.r * .82, p.r, 0, 0, 6.29); ctx.fill();
          ctx.globalAlpha = .16; ctx.strokeStyle = `hsl(${p.hue} 40% 55%)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, p.y + p.r); ctx.quadraticCurveTo(x + 4, p.y + p.r + 12, x - 2, p.y + p.r + 24); ctx.stroke();
        }
      } else if (m === "thinking") {
        const dot = glow("thinking", "rgba(255,250,255,1)", "rgba(200,170,240,0)");
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt; repel(p); if (p.y < -10) { p.y = h + 10; p.x = rnd(0, w); }
          const r = p.r * 4;
          ctx.globalAlpha = Math.min(1, .38 + .14 * Math.sin(p.ph)); ctx.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2);
        }
      } else if (m === "learning") {
        const breathe = .5 + .5 * Math.sin(t * .35);
        if (layer) { ctx.globalAlpha = .07 + .03 * breathe; ctx.drawImage(layer, 0, 0, w, h); }
        const dot = glow("learning", "rgba(255,236,190,1)", "rgba(255,226,170,0)");
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(p.ph) * .08; p.ph += dt * .6; repel(p, 100, 45); if (p.x > w * .85) { p.x = rnd(-20, w * .2); p.y = rnd(0, h); }
          const r = p.r * 3;
          ctx.globalAlpha = Math.max(0, .35 + .25 * Math.sin(p.ph * 1.7)); ctx.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2);
        }
      } else if (m === "project") {
        const grid = 36;
        if (layer) { ctx.globalAlpha = 1; ctx.drawImage(layer, (t * 2) % grid - grid, 0, w + grid, h); }
        const s = (t % 14) / 14, sx = -w * .3 + s * w * 1.6, sweep = glow("project-sweep", "rgba(140,220,220,.12)", "rgba(140,220,220,0)");
        ctx.globalAlpha = 1; ctx.drawImage(sweep, 0, 31, 64, 2, sx - 160, 0, 320, h);
      } else if (m === "unrestricted") {
        for (const p of parts) {
          p.ph += p.sp * dt; const cx = w * (.5 + .38 * Math.sin(p.ph)), cy = h * (.25 + .18 * Math.cos(p.ph * 1.3)), r = Math.max(w, h) * .45;
          const blob = glow(`unrestricted-${p.hue}`, `hsla(${p.hue}, 90%, 78%, .16)`, `hsla(${p.hue}, 90%, 78%, 0)`, 128);
          ctx.globalAlpha = 1; ctx.drawImage(blob, cx - r, cy - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const sync = () => {
      const card = document.querySelector(".card.chat");
      const want = prefs.ambient && !reduced() && !document.hidden && card && !document.documentElement.hasAttribute("data-laolao-mode-pending") && !document.getElementById("laolao-splash");
      if (!want) { stop(); canvas?.classList.remove("is-on"); return; }
      if (!canvas || canvas.parentElement !== card) { canvas?.remove(); canvas = el("canvas", "pinkie-ambient"); ctx = canvas.getContext("2d"); card.prepend(canvas); currentMode = ""; new ResizeObserver(() => canvas && resize()).observe(card); }
      if (currentMode !== mode()) { currentMode = mode(); resize(); }
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
  window.__pinkieBuddy = {get rig() { return rig; }, say: (t) => say(esc(t)), setState, explain, startFocus, stopFocus, ambient, prefs, burst: (k) => burstFrom(figure, k), onSend, toggleMenu, openSettings};
})();
