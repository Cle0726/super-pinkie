/* A compact view over OpenClaw's model picker. When the native catalog goes
   stale, recover from the gateway without reloading the user's chat. */
(() => {
  "use strict";
  if (window.__pinkieCompactModelPicker) return;
  window.__pinkieCompactModelPicker = true;

  let scheduled = false;
  let nativeMotionActive = null;
  const ENHANCEMENT_KEY = (sessionKey) => `laolao:reasoning-enhance:v1:${sessionKey}`;
  const rangeStates = new WeakMap();
  const pickerStates = new WeakMap();
  const nativeInputEvents = new WeakSet();
  const autoSaveTimers = new WeakMap();
  const pendingPatches = new WeakMap();
  const pendingSessionKeys = new WeakMap();
  const activeSaves = new WeakMap();
  const saveRevisions = new WeakMap();
  const triggerObservers = new Map();
  const triggerStates = new WeakMap();
  const effortTriggers = new WeakMap();
  const effortOwners = new WeakMap();
  const restartingMenus = new WeakSet();
  const stopStates = new WeakMap();
  const pointerToggles = new WeakMap();
  const fallbackStates = new WeakMap();
  const catalogRequests = new Map();
  const popupLayouts = new Map();
  let popupLayoutFrame = 0;

  function releasePopupLayout(details) {
    const state = popupLayouts.get(details);
    state?.observer?.disconnect();
    popupLayouts.delete(details);
  }

  function layoutPopup(details) {
    if (!details?.isConnected || !details.open) {
      releasePopupLayout(details);
      return;
    }
    const menu = details.querySelector(":scope > .chat-controls__inline-select-menu--combined");
    const composer = details.closest(".agent-chat__composer-shell");
    const pane = details.closest(".chat-main") || details.closest(".card.chat");
    if (!menu || !composer || !pane) return;
    // 档位按钮的文字随档位变宽变窄（Low ↔ Adaptive），会把这一行往左右推；
    // 也盯着它，弹层才能在拖动时贴住原位，滑块不在指针下面移动。
    const effortButton = effortTriggers.get(details) || null;
    let state = popupLayouts.get(details);
    if (!state || state.menu !== menu || state.composer !== composer || state.pane !== pane || state.effortButton !== effortButton) {
      releasePopupLayout(details);
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedulePopupLayouts) : null;
      for (const node of [menu, composer, pane, effortButton]) if (node) observer?.observe(node);
      state = {menu, composer, pane, effortButton, observer};
      popupLayouts.set(details, state);
    }

    // Keep Lit's nodes in place. Coordinates are relative to the actual
    // offset parent; viewport-wide media queries cannot locate a split pane.
    details.dataset.pinkiePopupBounded = "1";
    const viewport = window.visualViewport;
    const vx = viewport?.offsetLeft || 0, vy = viewport?.offsetTop || 0;
    const vw = viewport?.width || window.innerWidth, vh = viewport?.height || window.innerHeight;
    const bounds = pane.getBoundingClientRect(), anchor = composer.getBoundingClientRect();
    const left = Math.max(vx, bounds.left) + 8, right = Math.min(vx + vw, bounds.right) - 8;
    const top = Math.max(vy, bounds.top) + 8, bottom = Math.min(vy + vh, bounds.bottom) - 8;
    const effortView = details.dataset.pinkiePickerView === "effort";
    const trigger = (effortView ? effortTriggers.get(details) : details.querySelector(":scope > summary"))?.getBoundingClientRect() || anchor;
    // Keep a fixed label column so changing tiers never shifts the slider under the pointer.
    const width = Math.max(1, Math.min(effortView ? 296 : 360, right - left));
    const above = Math.max(0, trigger.top - top - 8), below = Math.max(0, bottom - trigger.bottom - 8);
    const upward = above >= 148 || above >= below;
    const available = upward ? above : below;
    const set = (name, value) => {
      if (menu.style.getPropertyValue(name) !== value) menu.style.setProperty(name, value);
    };
    set("--pinkie-popup-width", `${width}px`);
    set("--pinkie-popup-max-height", `${Math.max(1, Math.min(effortView ? 200 : 360, available))}px`);
    const height = menu.getBoundingClientRect().height;
    const x = Math.max(left, Math.min(trigger.right - width, right - width));
    const y = Math.max(top, Math.min(upward ? trigger.top - 8 - height : trigger.bottom + 8, bottom - height));
    const parent = menu.offsetParent || details, origin = parent.getBoundingClientRect();
    set("--pinkie-popup-left", `${x - origin.left + parent.scrollLeft - parent.clientLeft}px`);
    set("--pinkie-popup-top", `${y - origin.top + parent.scrollTop - parent.clientTop}px`);
  }

  function schedulePopupLayouts() {
    if (popupLayoutFrame) return;
    popupLayoutFrame = requestAnimationFrame(() => {
      popupLayoutFrame = 0;
      for (const details of popupLayouts.keys()) layoutPopup(details);
    });
  }
  window.addEventListener("resize", schedulePopupLayouts);
  document.addEventListener("scroll", schedulePopupLayouts, true);
  window.visualViewport?.addEventListener("resize", schedulePopupLayouts);
  window.visualViewport?.addEventListener("scroll", schedulePopupLayouts);

  function loadCatalog(rpc, agentId) {
    const cached = catalogRequests.get(agentId);
    if (cached && Date.now() - cached.at < 300_000) return cached.promise;
    const promise = rpc("chat.metadata", agentId ? {agentId} : {}, 15_000).then((metadata) =>
      (Array.isArray(metadata?.models) ? metadata.models : [])
        .filter((model) => model?.available !== false && model?.provider && model?.id)
    ).catch((error) => {
      if (catalogRequests.get(agentId)?.promise === promise) catalogRequests.delete(agentId);
      throw error;
    });
    catalogRequests.set(agentId, {at: Date.now(), promise});
    return promise;
  }

  function currentSessionKey(details) {
    const localKey = details?.closest?.("[data-session-key]")?.dataset?.sessionKey;
    if (localKey) return localKey;
    const paneKey = typeof HTMLElement !== "undefined" && details instanceof HTMLElement ? details.closest("openclaw-chat-pane")?.state?.sessionKey : "";
    if (paneKey) return paneKey;
    const encoded = window.location?.search?.match(/[?&]session=([^&]+)/)?.[1];
    if (encoded) {
      try { return decodeURIComponent(encoded.replace(/\+/g, " ")); } catch { /* fall through */ }
    }
    return document.querySelector?.(".sidebar-recent-session--active[data-session-key]")?.dataset?.sessionKey || "";
  }

  function selectedEnhancement(key = currentSessionKey()) {
    if (!key) return "";
    try {
      const value = window.localStorage?.getItem(ENHANCEMENT_KEY(key));
      return value === "max" || value === "ultra" ? value : "";
    } catch { return ""; }
  }

  function setEnhancement(tier, key = currentSessionKey()) {
    if (!key) return false;
    try {
      if (tier) window.localStorage?.setItem(ENHANCEMENT_KEY(key), tier);
      else { window.localStorage?.removeItem(ENHANCEMENT_KEY(key)); saveTierChoice(null, key); }
      return true;
    } catch { return false; }
  }

  const isPicker = (node) => node?.closest?.("details.chat-controls__model, details.chat-controls__model-picker");
  const isMax = (range) => range && !range.disabled && Number(range.max) > Number(range.min)
    && Number(range.value) >= Number(range.max);

  /* The upstream slider is not always the same length. Some models expose only
     low/high, while others expose the full off -> ultra ladder. Never infer a
     material from a percentage: use the actual semantic value supplied by the
     model picker so "high" cannot accidentally receive a middle-step skin. */
  const MATERIALS = ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra"];
  const MATERIAL_RANK = new Map(MATERIALS.map((name, index) => [name, index]));
  const LEVEL_LABELS = {off: "关闭", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", adaptive: "Adaptive", max: "Max", ultra: "Ultra"};
  // The nine visual choices belong to Pinkie, not to a provider's effort
  // enum. Keep the UI preference separate from the verified wire parameter.
  const TIER_CHOICE_KEY = key => `pinkie:effort-choice:v1:${key}`;
  function tierChoice(key = currentSessionKey()) {
    try {
      const value = JSON.parse(window.localStorage?.getItem(TIER_CHOICE_KEY(key)) || "null");
      return value && MATERIALS.includes(value.tier) ? value : null;
    } catch { return null; }
  }
  function saveTierChoice(value, key = currentSessionKey()) {
    if (!key) return;
    try {
      if (value) window.localStorage?.setItem(TIER_CHOICE_KEY(key), JSON.stringify(value));
      else window.localStorage?.removeItem(TIER_CHOICE_KEY(key));
    } catch { /* Persistence is optional in a private web view. */ }
  }
  function chosenTier(state, key = state?.key || currentSessionKey()) {
    const value = tierChoice(key);
    if (!value) return "";
    if (state?.selectedModel && value.model && value.model !== state.selectedModel) return "";
    if (state?.session?.thinkingLevel && value.backend && value.backend !== state.session.thinkingLevel) return "";
    return value.tier;
  }
  function nativeTierFor(tier, values, defaultLevel = "") {
    const native = values.filter(value => MATERIAL_RANK.has(value));
    if (!native.length) return "off";
    if (native.includes(tier)) return tier;
    if (tier === "adaptive") return native.includes(defaultLevel) ? defaultLevel
      : native.includes("medium") ? "medium" : native.filter(value => value !== "off")[0] || native[0];
    const target = MATERIAL_RANK.get(tier) ?? MATERIAL_RANK.get("high");
    return [...native].sort((a, b) => Math.abs(MATERIAL_RANK.get(a) - target) - Math.abs(MATERIAL_RANK.get(b) - target)
      || MATERIAL_RANK.get(a) - MATERIAL_RANK.get(b))[0];
  }
  function selectionFor(state, tier, backendValues) {
    const model = familyTargetModel(state, tier) || state?.selectedModel || "";
    const entry = state?.models?.find(item => `${item.provider}/${item.id}` === model);
    const declared = entry?.compat?.supportedReasoningEfforts?.map(value => value === "none" ? "off" : value);
    const targetValues = model && state?.selectedModel && model !== state.selectedModel
      ? declared?.length ? declared : entry?.reasoning === false || FAMILY_SUFFIX.test(entry?.id || "") ? ["off"] : backendValues
      : backendValues;
    return {model, backend: nativeTierFor(tier, targetValues, state?.session?.thinkingDefault)};
  }

  /* Fold endpoint-level effort variants into the existing reasoning slider.
     Lite, image, agent and fast endpoints remain distinct models. */
  const MODEL_FAMILIES = [
    {
      provider: "mm", label: "Gemini 2.5 Flash", canonical: "gemini-2.5-flash",
      ids: ["gemini-2.5-flash", "gemini-2.5-flash-thinking"],
      byLevel: {off: "gemini-2.5-flash", minimal: "gemini-2.5-flash-thinking", low: "gemini-2.5-flash-thinking", medium: "gemini-2.5-flash-thinking", high: "gemini-2.5-flash-thinking", xhigh: "gemini-2.5-flash-thinking", adaptive: "gemini-2.5-flash-thinking", max: "gemini-2.5-flash-thinking", ultra: "gemini-2.5-flash-thinking"},
      implied: {},
    },
    {
      provider: "mm", label: "Gemini 3.5 Flash", canonical: "gemini-3.5-flash-low",
      ids: ["gemini-3.5-flash-extra-low", "gemini-3.5-flash-low"],
      byLevel: {off: "gemini-3.5-flash-extra-low", minimal: "gemini-3.5-flash-extra-low", low: "gemini-3.5-flash-low", medium: "gemini-3.5-flash-low", high: "gemini-3.5-flash-low", xhigh: "gemini-3.5-flash-low", adaptive: "gemini-3.5-flash-low", max: "gemini-3.5-flash-low", ultra: "gemini-3.5-flash-low"},
      implied: {"gemini-3.5-flash-extra-low": "minimal", "gemini-3.5-flash-low": "low"},
    },
    {
      provider: "mm", label: "Gemini 3.6 Flash", canonical: "gemini-3.6-flash-tiered",
      ids: ["gemini-3.6-flash-high", "gemini-3.6-flash-low", "gemini-3.6-flash-medium", "gemini-3.6-flash-tiered"],
      byLevel: {off: "gemini-3.6-flash-tiered", minimal: "gemini-3.6-flash-tiered", low: "gemini-3.6-flash-low", medium: "gemini-3.6-flash-medium", high: "gemini-3.6-flash-high", xhigh: "gemini-3.6-flash-tiered", adaptive: "gemini-3.6-flash-tiered", max: "gemini-3.6-flash-tiered", ultra: "gemini-3.6-flash-tiered"},
      implied: {"gemini-3.6-flash-low": "low", "gemini-3.6-flash-medium": "medium", "gemini-3.6-flash-high": "high"},
    },
  ];

  // These six fixed-effort endpoints are the Antigravity source shown by the user.
  // Their unsuffixed Claude 5.5 siblings are a different upstream source.
  function modelOrigin(model) {
    const provider = String(model?.provider || "").toLowerCase();
    if (/^(?:antigravity|tab)$/.test(provider)) return "antigravity";
    return provider === "mm" && /^claude-(?:sonnet|opus)-5-5-(?:low|medium|high)$/.test(model?.id || "") ? "antigravity" : "";
  }
  function modelSourceLabel(model, name) {
    return modelOrigin(model) === "antigravity" ? String(name).replace(/\s*[·•]\s*At$/i, "") + " ·At" : name;
  }

  const FAMILY_SUFFIX = /-(extra-low|non-reasoning|reasoning|thinking|tiered|adaptive|minimal|xhigh|high|medium|low|off|max|ultra)$/;
  function dynamicFamily(model, catalog) {
    const base = model.id.replace(FAMILY_SUFFIX, "");
    const variants = catalog.filter(entry => entry.provider === model.provider && entry.available !== false && modelOrigin(entry) === modelOrigin(model) &&
      (entry.id === base || (FAMILY_SUFFIX.test(entry.id) && entry.id.replace(FAMILY_SUFFIX, "") === base)));
    if (variants.length < 2) return null;
    // Context length and reasoning flags can legitimately differ by effort
    // endpoint. Modalities and API families still delimit distinct models.
    const signatures = variants.filter(entry => Array.isArray(entry.input)).map(entry => JSON.stringify([...entry.input].sort()));
    if (new Set(signatures).size > 1 || new Set(variants.map(entry => entry.api).filter(Boolean)).size > 1) return null;
    const canonicalModel = variants.find(entry => entry.id === base)
      || variants.find(entry => entry.id === `${base}-tiered`)
      || variants.find(entry => entry.id === `${base}-reasoning` || entry.id === `${base}-thinking`)
      || variants.find(entry => entry.id === `${base}-low`) || variants[0];
    const ids = variants.map(entry => entry.id), byLevel = {}, implied = {};
    let flexibleRoute = "";
    for (const entry of variants) {
      const suffix = entry.id === base ? "" : entry.id.slice(base.length + 1);
      if (MATERIAL_RANK.has(suffix) || suffix === "extra-low") {
        const level = suffix === "extra-low" ? "minimal" : suffix;
        byLevel[level] = entry.id; implied[entry.id] = level;
      }
      if (suffix === "non-reasoning") { byLevel.off = entry.id; implied[entry.id] = "off"; }
      const nativeEfforts = entry.compat?.supportedReasoningEfforts?.length;
      if (/^(?:reasoning|thinking)$/.test(suffix) && !nativeEfforts) {
        byLevel.high ||= entry.id; implied[entry.id] = "high";
      }
      if (suffix === "tiered" || (/^(?:reasoning|thinking)$/.test(suffix) && nativeEfforts)
        || (!suffix && entry.reasoning !== false && nativeEfforts)) flexibleRoute ||= entry.id;
      if (!suffix && entry.reasoning === false) byLevel.off ||= entry.id;
    }
    flexibleRoute = variants.find(entry => entry.id === `${base}-tiered`)?.id
      || variants.find(entry => (entry.id === `${base}-reasoning` || entry.id === `${base}-thinking`) && entry.compat?.supportedReasoningEfforts?.length)?.id || flexibleRoute;
    const known = MODEL_FAMILIES.find(entry => entry.provider === model.provider && entry.ids.some(id => ids.includes(id)));
    if (known?.byLevel.off === base && ids.includes(base)) byLevel.off ||= known.byLevel.off;
    const endpointLevels = MATERIALS.filter(level => Object.hasOwn(byLevel, level));
    const highest = [...endpointLevels].filter(level => !["off", "adaptive"].includes(level)).at(-1);
    const enhancedRoute = flexibleRoute || byLevel[highest] || canonicalModel.id;
    byLevel.max ||= enhancedRoute; byLevel.ultra ||= enhancedRoute;
    const label = known?.label || String(canonicalModel.name && canonicalModel.name !== canonicalModel.id ? canonicalModel.name : base.split("-").map(part => part[0]?.toUpperCase() + part.slice(1)).join(" ")).replace(/\s*[·•]\s*At$/i, "").replace(/(?:[\s·_-]+)(?:extra[ -]low|non[ -]reasoning|reasoning|thinking|tiered|adaptive|minimal|xhigh|high|medium|low|off|max|ultra)$/i, "").trim();
    return {provider: model.provider, label: modelSourceLabel(model, label || base), canonical: canonicalModel.id, ids, byLevel, implied,
      endpointLevels, flexibleRoute, dynamic: true};
  }

  function modelFamily(model, catalog) {
    return model && Array.isArray(catalog) ? dynamicFamily(model, catalog) : null;
  }

  function routedFamilyId(family, level) {
    if (family.byLevel[level]) return family.byLevel[level];
    if (family.flexibleRoute) return family.flexibleRoute;
    const ranked = family.endpointLevels.filter(value => value !== "adaptive");
    return ranked.sort((a, b) => Math.abs(MATERIAL_RANK.get(a) - (MATERIAL_RANK.get(level) ?? 4))
      - Math.abs(MATERIAL_RANK.get(b) - (MATERIAL_RANK.get(level) ?? 4)))[0]
      ? family.byLevel[ranked[0]] : family.canonical;
  }

  function presentationModels(models, selectedModel = "") {
    models = models.map((model) => {
      let name = String(model.name || model.id).replace(/\s*[·•]\s*Work\s*Buddy\s*$/i, "");
      if (/^workbuddy\/deepseek(?:[-_.:]|$)/i.test(model.id) && !/\s*[·•]\s*WB$/i.test(name)) name += " · WB";
      return {...model, name: modelSourceLabel(model, name)};
    });
    const seenFamilies = new Set();
    const folded = models.flatMap((model) => {
      const family = modelFamily(model, models);
      if (!family) return [{...model, family: null,
        sources: [`${model.provider}/${model.id}`]}];
      const key = `${family.provider}/${family.canonical}`;
      if (seenFamilies.has(key)) return [];
      seenFamilies.add(key);
      const representative = models.find(entry => entry.provider === family.provider && family.ids.includes(entry.id) && `${entry.provider}/${entry.id}` === selectedModel)
        || models.find(entry => entry.provider === family.provider && entry.id === family.canonical) || model;
      return [{...representative, id: family.canonical, name: family.label, family,
        sources: family.ids.map(id => `${family.provider}/${id}`)}];
    });
    const byId = new Map();
    for (const model of folded) {
      // Provider names are routing details. The same model ID is one choice,
      // but keep every backing route so an existing session stays selected.
      const key = model.id.toLowerCase() + "|" + modelOrigin(model);
      const previous = byId.get(key);
      if (!previous) { byId.set(key, model); continue; }
      const sources = [...new Set([...previous.sources, ...model.sources])];
      const score = (entry) => (/^(?:gpt|codex)[-_.]/i.test(entry.id)
        && entry.provider === "clekk" ? 200 : 0)
        + (entry.provider === selectedModel.slice(0, selectedModel.indexOf("/"))
          && entry.sources.includes(selectedModel) ? 100 : 0);
      byId.set(key, {...(score(model) > score(previous) ? model : previous), sources});
    }
    return [...byId.values()];
  }

  const MODEL_GROUP_ORDER = ["GPT", "Codex", "Gemini", "Gemma", "Claude", "Grok",
    "DeepSeek", "Qwen", "Kimi", "GLM", "MiniMax", "混元", "Mistral", "Llama", "豆包", "Perplexity", "其他模型"];
  const MODEL_NAME_ORDER = new Intl.Collator("en", {numeric: true, sensitivity: "base"});
  // Availability comes from the gateway catalog, never a client-side list of
  // model-name prefixes: an older model may still be deliberately configured.
  function hiddenPickerModel(model) { return model?.available === false; }
  function modelGroup(model) {
    const fullId = String(model.id || "").toLowerCase();
    const id = fullId.split("/").at(-1);
    if (/^gpt[-_.]/.test(id)) return "GPT";
    if (/^codex[-_.]/.test(id)) return "Codex";
    if (/^gemini[-_.]/.test(id)) return "Gemini";
    if (/^gemma[-_.]/.test(id)) return "Gemma";
    if (/^claude[-_.]/.test(id)) return "Claude";
    if (/^grok[-_.]/.test(id)) return "Grok";
    if (/^deepseek[-_.]/.test(id)) return "DeepSeek";
    if (/^(?:qwen|qwq)[-_.]/.test(id)) return "Qwen";
    if (/^(?:kimi|moonshot)[-_.]/.test(id)) return "Kimi";
    if (/^(?:glm|zai)[-_.]/.test(id)) return "GLM";
    if (/^mistral[-_.]/.test(id)) return "Mistral";
    if (/^(?:llama|ollama)[-_.]/.test(id)) return "Llama";
    if (/^minimax(?:[-_.:]|$)/.test(id)) return "MiniMax";
    if (/^(?:hunyuan|hy\d+)(?:[-_.:]|$)/.test(id)) return "混元";
    if (/^doubao(?:[-_.:]|$)/.test(id)) return "豆包";
    if (/^perplexity(?:[-_.:]|$)/.test(id)) return "Perplexity";
    if (/^tab(?:[-_.:]|$)/.test(id)) return "Antigravity";
    if (fullId.startsWith("workbuddy/")) return "WorkBuddy";
    return "其他模型";
  }

  function groupedPresentationModels(models, selectedModel = "") {
    return presentationModels(models, selectedModel).filter((model) => !hiddenPickerModel(model)).sort((left, right) => {
      const groupDifference = MODEL_GROUP_ORDER.indexOf(modelGroup(left))
        - MODEL_GROUP_ORDER.indexOf(modelGroup(right));
      return groupDifference || MODEL_NAME_ORDER.compare(left.name || left.id, right.name || right.id)
        || MODEL_NAME_ORDER.compare(left.id, right.id);
    });
  }

  function modelBrand(provider, id) {
    const model = String(id || "").toLowerCase().split("/").at(-1);
    const source = String(provider || "").toLowerCase();
    if (/^(?:gemini|gemma|veo)(?:[-_.:]|$)/.test(model)) return "gemini";
    if (/^(?:claude)(?:[-_.:]|$)/.test(model)) return "claude";
    if (/^codex(?:[-_.:]|$)/.test(model)) return "codex";
    if (/^(?:gpt|o1|o3|o4)(?:[-_.:]|$)/.test(model)) return "openai";
    if (/^grok(?:[-_.:]|$)/.test(model)) return "grok";
    if (/^groq(?:[-_.:]|$)/.test(model)) return "groq";
    if (/^deepseek(?:[-_.:]|$)/.test(model)) return "deepseek";
    if (/^mistral(?:[-_.:]|$)/.test(model)) return "mistral";
    if (/^(?:kimi|moonshot)(?:[-_.:]|$)/.test(model)) return "kimi";
    if (/^(?:qwen|qwq)(?:[-_.:]|$)/.test(model)) return "alibaba";
    if (/^(?:glm|zai)(?:[-_.:]|$)/.test(model)) return "zai";
    if (/^(?:llama|ollama)(?:[-_.:]|$)/.test(model)) return "ollama";
    if (/^minimax(?:[-_.:]|$)/.test(model)) return "minimax";
    if (/^doubao(?:[-_.:]|$)/.test(model)) return "doubao";
    if (/^perplexity(?:[-_.:]|$)/.test(model)) return "perplexity";
    if (/^(?:hunyuan|hy\d+)(?:[-_.:]|$)/.test(model)) return "hunyuan";
    if (/^tab(?:[-_.:]|$)/.test(model)) return "antigravity";
    if (String(id || "").toLowerCase().startsWith("workbuddy/")) return "workbuddy";
    return ({anthropic: "claude", openai: "openai", google: "gemini", xai: "grok",
      deepseek: "deepseek", mistral: "mistral", moonshot: "kimi", alibaba: "alibaba",
      zai: "zai", ollama: "ollama", groq: "groq", minimax: "minimax", doubao: "doubao"})[source] || "crossmodel";
  }

  // The user-facing settings page shares this exact catalog, family folding,
  // retirement filter and brand ordering so the two model pickers never drift.
  window.__laolaoModelPickerCatalog = Object.freeze({
    load(agentId = "main") {
      const rpc = window.__laolaoSidebar?.gwRequest;
      if (typeof rpc !== "function") return Promise.reject(new Error("模型目录暂时不可用"));
      return loadCatalog(rpc, agentId);
    },
    present: groupedPresentationModels,
    group: modelGroup,
    brand: modelBrand,
  });

  function syncModelBrands(browser, hideRetired = true) {
    browser?.querySelectorAll?.("[data-chat-model-option]")?.forEach((option) => {
      const value = option.getAttribute?.("data-chat-model-option") || "";
      const separator = value.indexOf("/");
      const provider = separator < 0 ? "" : value.slice(0, separator);
      const id = separator < 0 ? value : value.slice(separator + 1);
      if (option.dataset) {
        option.dataset.pinkieBrand = modelBrand(provider, id);
        if (hideRetired && hiddenPickerModel({id})) option.dataset.pinkieHiddenModel = "1";
        else delete option.dataset.pinkieHiddenModel;
      }
    });
  }

  function fallbackThinkingLevel(state) {
    const session = state?.session;
    if (!session) return "";
    const levels = session.thinkingLevels?.length ? session.thinkingLevels : session.thinkingOptions || [];
    const first = levels[0];
    return familyForSession(state)?.implied[session.model] || session.thinkingLevel
      || session.thinkingDefault || (typeof first === "string" ? first : first?.id) || "";
  }

  // A model without native levels was forced to "off"; that is not a choice to carry into the next model.
  function carriedThinkingLevel(state) {
    const level = fallbackThinkingLevel(state), session = state?.session;
    const levels = session?.thinkingLevels?.length ? session.thinkingLevels : session?.thinkingOptions || [];
    if (level === "off" && !familyForSession(state)
      && !levels.map(item => typeof item === "string" ? item : item?.id).some(item => item && item !== "off")) return "";
    return level;
  }

  function familyForSession(state) {
    const session = state?.session;
    if (!session?.model) return null;
    return modelFamily({provider: session.modelProvider, id: session.model}, state.models);
  }

  function familyTargetModel(state, level) {
    const family = familyForSession(state);
    if (!family) return "";
    const id = routedFamilyId(family, level);
    return state.models.some((model) => model.provider === family.provider && model.id === id)
      ? `${family.provider}/${id}` : `${family.provider}/${family.canonical}`;
  }
  const frameLoads = new Map();
  const frameStates = new WeakMap();
  let framesWarmed = false;

  function preloadFrame(material) {
    if (!window.Image) return Promise.resolve(true);
    if (frameLoads.has(material)) return frameLoads.get(material);
    const loaded = new Promise((resolve) => {
      const image = new window.Image();
      image.decoding = "async";
      image.onload = () => {
        try { void image.decode?.().catch(() => {}); } catch { /* A loaded image is still usable. */ }
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = `./laolao-reasoning-frame-${material}.png?v=1`;
    });
    frameLoads.set(material, loaded);
    return loaded;
  }

  function warmFrames() {
    if (framesWarmed || !window.Image) return;
    framesWarmed = true;
    const warm = () => MATERIALS.forEach((material) => { void preloadFrame(material); });
    if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 1800 });
    else window.setTimeout(warm, 220);
  }

  function syncFrame(details, material) {
    if (details?.dataset?.pinkieEnhanced !== "1") return;
    const menu = details.querySelector?.(":scope > .chat-controls__inline-select-menu--combined");
    if (!menu) return;
    let state = frameStates.get(menu);
    if (state && menu.contains?.(state.layers[0]) === false) {
      frameStates.delete(menu);
      details.removeAttribute?.("data-pinkie-frame-ready");
      state = null;
    }
    if (!state) {
      const layers = [0, 1].map(() => {
        const layer = document.createElement("span");
        layer.className = "pinkie-model-frame";
        layer.setAttribute("aria-hidden", "true");
        const art = document.createElement("span");
        art.className = "pinkie-model-frame__art";
        layer.append(art);
        return layer;
      });
      menu.prepend(...layers);
      layers[0].dataset.pinkieFrame = material;
      layers[0].classList.add("is-active");
      layers[0].classList.add("is-initial");
      /* Freeze the outgoing image while the first frame loads. Otherwise a
         quick drag makes the old CSS background switch before the fade exists. */
      menu.style.backgroundImage = `url("./laolao-reasoning-frame-${material}.png?v=1"), linear-gradient(145deg, rgba(252, 250, 252, .88), rgba(239, 235, 242, .78) 58%, rgba(250, 247, 248, .84))`;
      state = { layers, active: 0, material, pending: null, token: 0, initialLoad: null };
      frameStates.set(menu, state);
      state.initialLoad = preloadFrame(material).then((loaded) => {
        if (loaded && menu.isConnected) {
          details.dataset.pinkieFrameReady = "1";
          menu.style.removeProperty("background-image");
        }
        return loaded;
      });
      return;
    }
    if (state.material === material && state.pending === null) return;
    if (state.material === material) {
      state.token++;
      state.pending = null;
      return;
    }
    if (state.pending === material) return;
    const token = ++state.token;
    state.pending = material;
    void Promise.all([state.initialLoad, preloadFrame(material)]).then(([, loaded]) => {
      if (token !== state.token || !menu.isConnected) return;
      if (!loaded) {
        state.pending = null;
        return;
      }
      const next = 1 - state.active;
      const layer = state.layers[next];
      layer.dataset.pinkieFrame = material;
      requestAnimationFrame(() => {
        if (token !== state.token || !menu.isConnected) return;
        state.layers[state.active].classList.remove("is-initial");
        state.layers[state.active].classList.remove("is-active");
        layer.classList.add("is-active");
        state.active = next;
        state.material = material;
        state.pending = null;
        details.dataset.pinkieFrameReady = "1";
        menu.style.removeProperty("background-image");
      });
    });
  }

  function normalizeMaterial(raw, index, count) {
    const value = String(raw || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (/^(off|none|disabled|false)$/.test(value)) return "off";
    if (/^(minimal|min|tiny)$/.test(value)) return "minimal";
    if (/^(low|light)$/.test(value)) return "low";
    if (/^(medium|med|standard|normal)$/.test(value)) return "medium";
    if (/^(high|strong)$/.test(value)) return "high";
    if (/^(xhigh|extra-high|extra-highest|very-high)$/.test(value)) return "xhigh";
    if (/^(adaptive|auto|dynamic)$/.test(value)) return "adaptive";
    if (/^(max|maximum)$/.test(value)) return "max";
    if (/^(ultra|extreme)$/.test(value)) return "ultra";
    /* Missing metadata is not evidence that a five-stop slider ends at Ultra.
       Stay conservative until the native picker supplies real semantic ids. */
    const fallback = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
    return fallback[Math.min(index, Math.min(count - 1, fallback.length - 1))];
  }

  /* How a stop is actually carried out on the current route, mirroring
     recipeFor() in services/mode-architecture/reasoning.mjs:
     native = the model takes this effort directly; fill = the gap upward is
     made up by process (independent solves, a critic, send-backs) on the same model;
     down = the model cannot go this low, so only the answer gets shorter. */
  function routeKind(level, natives) {
    if (!MATERIAL_RANK.has(level)) return "native";
    if (level === "max" || level === "ultra") return "fill";
    const pool = natives.filter(value => MATERIAL_RANK.has(value));
    if (!pool.length) return "native";
    if (pool.includes(level)) return "native";
    if (level === "adaptive") return "fill";
    const nearest = nativeTierFor(level, pool);
    return MATERIAL_RANK.get(nearest) > MATERIAL_RANK.get(level) ? "down" : "fill";
  }

  function routeDescription(level, natives) {
    const pool = natives.filter(value => MATERIAL_RANK.has(value) && value !== "adaptive");
    const top = pool.at(-1) || "off", bottom = pool[0] || "off";
    const name = value => LEVEL_LABELS[value] || value;
    const kind = routeKind(level, natives);
    if (level === "max") return "用当前模型做 2 份独立解答（各换一种做法）+ 批评 + 交付验收，最多打回 2 轮";
    if (level === "ultra") return "用当前模型做 3 份独立解答（直接解、换方法、列清单自查）+ 批评兼仲裁 + 交付验收，最多打回 3 轮";
    if (kind === "native") return "当前模型原生支持这一档";
    if (level === "adaptive") return "按每条消息的难度：难题按 XHigh 做，简单题按 Low 做（模拟）";
    if (kind === "down") return `当前模型最低只到 ${name(bottom)}；这一档让回答直接给结论、更快（模拟）`;
    if (level === "xhigh") return `当前模型原生最高到 ${name(top)}；另做 1 份独立解答 + 批评，打回 1 轮（模拟）`;
    return `当前模型原生最高到 ${name(top)}；回答前先拆清要求和约束（模拟）`;
  }

  function syncStops(slider, values, selectedIndex, natives = []) {
    if (!slider?.querySelector || !document.createElement || values.length < 2) return;
    let layer = slider.querySelector(":scope > .pinkie-reasoning-stops");
    if (!layer) {
      layer = document.createElement("span");
      layer.className = "pinkie-reasoning-stops";
      layer.setAttribute("aria-hidden", "true");
      slider.prepend(layer);
    }
    const signature = values.join(",");
    let state = stopStates.get(layer);
    if (!state || state.signature !== signature) {
      const markers = values.map((_, index) => {
        const marker = document.createElement("span");
        marker.className = "pinkie-reasoning-stop";
        marker.style.setProperty("--pinkie-stop-position", `${(index / (values.length - 1) * 100).toFixed(3)}%`);
        return marker;
      });
      layer.replaceChildren(...markers);
      state = {signature, markers};
      stopStates.set(layer, state);
    }
    state.markers.forEach((marker, index) => {
      marker.dataset.pinkieCovered = index <= selectedIndex ? "1" : "0";
      // Only the nine Pinkie stops get a route mark; a provider's own ladder is native by definition.
      if (natives.length && MATERIAL_RANK.has(values[index])) marker.dataset.pinkieRoute = routeKind(values[index], natives);
      else delete marker.dataset.pinkieRoute;
    });
  }

  /* Keep the painted fill on the thumb's actual travel path. The native 26px
     drag target starts at 13px and moves across width - 26px, so a plain
     percentage fill drifts away from it. Publish the offset on every input. */
  function syncReasoning(range) {
    if (!range) return;
    const slider = range.closest?.(".chat-controls__reasoning-slider");
    if (!slider) return;
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    const step = Math.max(Number(range.step || 1), 1);
    const span = max - min;
    const ratio = Math.max(0, Math.min(1, span > 0 ? (Number(range.value || 0) - min) / span : 0));
    slider.style?.setProperty("--reasoning-fill", `${(ratio * 100).toFixed(2)}%`);
    slider.style?.setProperty("--reasoning-scale", String(ratio));
    slider.style?.setProperty("--reasoning-end-offset", `${(26 * ratio).toFixed(2)}px`);

    const encodedValues = range.dataset?.chatThinkingValues
      || range.getAttribute?.("data-chat-thinking-values")
      || "";
    const values = encodedValues ? encodedValues.split(",").map((value) => value.trim()) : [];
    const count = values.length || Math.max(1, Math.round(span / step) + 1);
    const index = Math.max(0, Math.min(count - 1, Math.round((Number(range.value || 0) - min) / step)));
    const natives = String(range.dataset?.pinkieRouteValues || range.dataset?.pinkieNativeValues || "").split(",").map(value => value.trim()).filter(Boolean);
    syncStops(slider, values.length ? values : Array.from({length: count}, (_, index) => String(index)), index,
      values.length === MATERIALS.length ? natives : []);
    const spokenValue = range.getAttribute?.("aria-valuetext") || range.ariaValueText || "";
    const nativeMaterial = normalizeMaterial(values[index] || spokenValue, index, count);
    const details = range.closest?.("details.chat-controls__model");
    if (details?.dataset) details.dataset.pinkieRangeDisabled = range.disabled ? "1" : "0";
    const material = selectedEnhancement(currentSessionKey(details)) || nativeMaterial;
    const visualLevel = Math.min(4, Math.floor(ratio * 4 + 1e-9));
    details?.setAttribute?.("data-pinkie-level", String(visualLevel));
    details?.setAttribute?.("data-pinkie-step-index", String(index));
    details?.setAttribute?.("data-pinkie-material", material);
    details?.setAttribute?.("data-pinkie-outside-material", material);
    details?.style?.setProperty?.("--pinkie-material-rank", String(MATERIAL_RANK.get(material) ?? index));
    syncFrame(details, material);
  }

  function pickerState(details, range) {
    const key = currentSessionKey(details);
    let state = pickerStates.get(details);
    if (!state || state.key !== key) {
      const rangeState = rangeStates.get(range);
      state = {key, initialTier: selectedEnhancement(key), initialChoice: tierChoice(key), initialNativeValue: rangeState?.nativeValue ?? Number(range?.value || 0)};
      pickerStates.set(details, state);
    }
    return state;
  }

  function finishPicker(details) {
    releasePopupLayout(details);
    if (details?.dataset) details.dataset.pinkiePickerView = "model";
    const surface = surfaceStates.get(details);
    if (surface) { surface.brand = "common"; const search = surface.menu.querySelector?.(".chat-controls__model-search"); if (search) search.value = ""; }
    effortTriggers.get(details)?.setAttribute("aria-expanded", "false");
    const timer = autoSaveTimers.get(details);
    if (timer !== undefined) window.clearTimeout?.(timer);
    autoSaveTimers.delete(details);
    pendingPatches.delete(details);
    pendingSessionKeys.delete(details);
    const state = pickerStates.get(details);
    if (state && selectedEnhancement(state.key) !== state.initialTier) setEnhancement(state.initialTier, state.key);
    if (state) saveTierChoice(state.initialChoice, state.key);
    pickerStates.delete(details);
    syncTrigger(details);
  }

  function closePicker(details) {
    if (!details?.open) return;
    const close = () => {
      if (!details.open) return;
      details.removeAttribute("open");
      finishPicker(details);
    };
    /* A click-away after a selection waits for its in-flight session patch.
       The user's chosen tier must never be reverted by the close transition. */
    if (autoSaveTimers.has(details) || pendingPatches.has(details)) {
      void persistPending(details).then((saved) => { if (saved) close(); });
      return;
    }
    const active = activeSaves.get(details);
    if (active) { void active.then((saved) => { if (saved) close(); }); return; }
    close();
  }

  function splitModelTier(text) {
    const match = /^(.*?)\s*[·•]\s*(off|minimal|low|medium|high|xhigh|adaptive|max|ultra)\s*$/i.exec(String(text || ""));
    return match ? {name: match[1].trim(), tier: match[2].toLowerCase()} : {name: String(text || "").trim(), tier: ""};
  }

  /* The native label is Lit's live `${label}` binding. Replacing its children
     deletes Lit's markers, and the next model/thinking change then throws in
     the chat pane render: the pane stops committing new replies and stops
     scrolling to them until the app is reopened. Leave the native label
     untouched (only hidden) and draw the decorated label in a sibling the
     picker owns. */
  function writeTriggerLabel(label, name, tier) {
    const display = tier ? `${name} · ${LEVEL_LABELS[tier]}` : name;
    const sibling = label.nextElementSibling;
    let owned = sibling?.classList?.contains("pinkie-trigger-label") ? sibling : null;
    if (!tier && display === (label.textContent?.trim() || "")) {
      owned?.remove();
      label.style?.removeProperty?.("display");
      return display;
    }
    if (!owned) {
      owned = document.createElement("span");
      owned.className = "chat-controls__inline-select-label pinkie-trigger-label";
      // The summary's aria-label already announces the model and tier.
      owned.setAttribute?.("aria-hidden", "true");
      label.after(owned);
    }
    label.style?.setProperty?.("display", "none", "important");
    const decorated = owned.querySelector?.(":scope > .pinkie-external-tier");
    if (owned.textContent === display && Boolean(decorated) === Boolean(tier)) return display;
    if (!tier || !document.createTextNode || !owned.replaceChildren) {
      owned.textContent = display;
      return display;
    }
    const model = document.createElement("span");
    model.className = "pinkie-external-model-name";
    model.textContent = name;
    const level = document.createElement("span");
    level.className = "pinkie-external-tier";
    level.textContent = LEVEL_LABELS[tier];
    level.dataset.pinkieTierLabel = LEVEL_LABELS[tier];
    owned.replaceChildren(model, document.createTextNode(" · "), level);
    return display;
  }

  function syncBrandMotion(details) {
    // WKWebView can report hidden until after the native foreground event.
    // Trust that event so a background launch cannot leave the material frozen.
    const paused = nativeMotionActive === null ? Boolean(document.hidden) : !nativeMotionActive;
    details?.toggleAttribute?.("data-pinkie-brand-motion-paused", paused);
  }

  function syncPickerMotion(active = nativeMotionActive) {
    nativeMotionActive = active;
    for (const details of triggerObservers.keys()) syncBrandMotion(details);
  }

  /* Keep the upstream details and all Lit-owned controls in place. Two quiet
     sibling triggers choose which half of that popup is visible; no cloned range
     or second save path can drift away from the session that owns the picker. */
  function syncEffortTrigger(details, tier = "") {
    const menu = details?.querySelector?.(":scope > .chat-controls__inline-select-menu--combined") || details?.querySelector?.(".chat-controls__inline-select-menu--combined");
    if (!menu?.matches?.(".chat-controls__inline-select-menu--combined") || !details.after) return null;
    let button = effortTriggers.get(details);
    const nativeButton = details.dataset?.pinkieModern === "1" ? details.parentElement?.querySelector?.(".chat-controls__effort-trigger") || details.closest?.(".chat-controls")?.querySelector?.(".chat-controls__effort-trigger") : null;
    if (nativeButton && button !== nativeButton) {
      if (button && button.dataset?.pinkieNativeEffort !== "1") button.remove();
      button = nativeButton; button.dataset.pinkieNativeEffort = "1"; button.classList.add("pinkie-effort-trigger");
      effortTriggers.set(details, button); effortOwners.set(button, details);
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "pinkie-effort-trigger";
      button.setAttribute("aria-haspopup", "dialog");
      effortTriggers.set(details, button);
      effortOwners.set(button, details);
    }
    if (button !== nativeButton && (button.parentElement !== details.parentElement || !button.isConnected)) details.after(button);
    if (!details.dataset.pinkiePickerView) details.dataset.pinkiePickerView = "model";
    const name = LEVEL_LABELS[tier] || tier || "默认";
    let level = button.querySelector(":scope > .pinkie-external-tier");
    if (!level) {
      level = document.createElement("span");
      level.className = "pinkie-external-tier";
      if (button === nativeButton) {
        for (const child of button.children) if (child.matches?.("span")) child.style.setProperty("display", "none", "important");
        button.append(level);
      } else button.replaceChildren(level);
    }
    if (level.textContent !== name) level.textContent = name;
    if (button.dataset.pinkieMaterial !== (tier || "default")) button.dataset.pinkieMaterial = tier || "default";
    const expanded = Boolean(details.open && details.dataset.pinkiePickerView === "effort");
    const aria = `思考强度，当前 ${name}`;
    if (button.getAttribute("aria-label") !== aria) button.setAttribute("aria-label", aria);
    if (button.getAttribute("aria-expanded") !== String(expanded)) button.setAttribute("aria-expanded", String(expanded));
    if (button.title !== aria) button.title = aria;
    return button;
  }

  function restartPopupMotion(details) {
    const menu = details?.querySelector?.(":scope > .chat-controls__inline-select-menu--combined");
    if (!menu?.setAttribute || !window.getComputedStyle) return;
    // WebKit can retain a stopped timeline after a details subtree is hidden.
    // Commit a local animation reset before the next frame recreates it. Keep
    // CSS in charge of playback so background and reduced-motion still apply.
    menu.setAttribute("data-pinkie-motion-reset", "");
    const probe = menu.querySelector?.(".chat-controls__reasoning-slider") || menu;
    void window.getComputedStyle(probe, "::before").animationName;
    if (restartingMenus.has(menu)) return;
    restartingMenus.add(menu);
    requestAnimationFrame(() => {
      restartingMenus.delete(menu);
      menu.removeAttribute("data-pinkie-motion-reset");
    });
  }

  function openPickerView(details, view) {
    // Opening an interactive picker is a fresh foreground signal. A missed
    // native activation event must not carry a paused material into this open.
    syncPickerMotion(true);
    for (const picker of triggerObservers.keys()) {
      if (picker !== details && picker.open && effortTriggers.has(picker)) closePicker(picker);
    }
    if (view === "model") {
      const surface = surfaceStates.get(details);
      if (surface) { surface.brand = "common"; const search = surface.menu.querySelector?.(".chat-controls__model-search"); if (search) search.value = ""; }
    }
    details.dataset.pinkiePickerView = view;
    details.dataset.pinkieModelsOpen = view === "model" ? "1" : "0";
    if (!details.open) details.setAttribute("open", "");
    refreshFallbackSession(details);
    sync(details);
    if (view === "effort") restartPopupMotion(details);
  }

  function syncTrigger(details) {
    syncBrandMotion(details);
    const summary = details?.querySelector?.(":scope > summary.chat-controls__inline-select-trigger");
    const label = summary?.querySelector?.(".chat-controls__inline-select-label");
    if (!label) return;
    const text = label.textContent?.trim() || "";
    const aria = summary.getAttribute?.("aria-label") || "";
    let state = triggerStates.get(summary);
    if (!state || state.label !== label) {
      state = {label, nativeText: text, nativeAria: aria, appliedText: "", appliedAria: ""};
      triggerStates.set(summary, state);
    }
    // writeTriggerLabel never rewrites the native label, so it is always native.
    state.nativeText = text;
    if (aria !== state.appliedAria) state.nativeAria = aria;
    const native = splitModelTier(state.nativeText);
    const fallback = fallbackStates.get(details);
    const matchingFallback = fallback?.key === currentSessionKey(details) && fallback.session;
    const effectiveTier = matchingFallback && !fallback.switchingModel ? fallbackThinkingLevel(fallback) : "";
    const fallbackTier = MATERIAL_RANK.has(effectiveTier) ? effectiveTier : "";
    const tier = selectedEnhancement(currentSessionKey(details)) || (matchingFallback ? chosenTier(fallback) : chosenTier(null, currentSessionKey(details))) || fallbackTier
      || (matchingFallback && fallback.switchingModel ? "" : native.tier);
    if (tier) details?.setAttribute?.("data-pinkie-outside-material", tier);
    else details?.removeAttribute?.("data-pinkie-outside-material");
    const base = matchingFallback ? fallback.modelName || native.name : native.name;
    const selectedRef = matchingFallback ? fallback.selectedModel
      : details.querySelector?.('[data-chat-model-option][aria-selected="true"]')?.getAttribute?.("data-chat-model-option") || "";
    const separator = String(selectedRef || "").indexOf("/");
    const brand = selectedRef ? modelBrand(separator < 0 ? "" : selectedRef.slice(0, separator),
      separator < 0 ? selectedRef : selectedRef.slice(separator + 1))
      : modelBrand("", base.replace(/\s+/g, "-"));
    if (summary.dataset && summary.dataset.pinkieBrand !== brand) summary.dataset.pinkieBrand = brand;
    const display = writeTriggerLabel(label, base, "");
    syncEffortTrigger(details, tier);
    if (effortTriggers.has(details)) {
      const expanded = Boolean(details.open && details.dataset.pinkiePickerView !== "effort");
      if (summary.getAttribute?.("aria-expanded") !== String(expanded)) summary.setAttribute?.("aria-expanded", String(expanded));
    }
    const displayAria = `选择模型，当前 ${display}`;
    if (aria !== displayAria) summary.setAttribute?.("aria-label", displayAria);
    state.appliedText = display;
    state.appliedAria = displayAria;
  }

  function watchPicker(details) {
    if (!details || triggerObservers.has(details)) return;
    prepareModernPicker(details);
    const watcher = new MutationObserver((changes = []) => {
      syncTrigger(details);
      if (details.open && changes.some((change) => change.type === "attributes" && change.attributeName === "disabled"
        && change.target?.matches?.("[data-chat-model-option]:not(.pinkie-fallback-option)"))) refreshFallbackSession(details);
      if (details.open) schedule(details);
    });
    watcher.observe(details, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-selected", "disabled"]});
    triggerObservers.set(details, watcher);
    syncTrigger(details);
    const browser = details.querySelector?.(".chat-controls__model-browser");
    if (browser) ensureFallbackData(details, browser);
  }

  function prepareModernPicker(details) {
    const summary = details?.querySelector?.(":scope > summary.chat-controls__model-trigger");
    if (!summary || !details.classList) return;
    details.dataset.pinkieModern = "1";
    details.classList.add("chat-controls__model");
    summary.classList?.add("chat-controls__inline-select-trigger");
    details.querySelector?.(".chat-controls__model-menu")?.classList?.add("chat-controls__inline-select-menu--combined");
    details.querySelector?.(".chat-controls__model-options")?.classList?.add("chat-controls__model-browser");
    const native = details.parentElement?.querySelector?.(".chat-controls__effort-trigger")
      || details.closest?.(".chat-controls")?.querySelector?.(".chat-controls__effort-trigger");
    if (native) {
      const previous = effortTriggers.get(details);
      if (previous && previous !== native && previous.dataset?.pinkieNativeEffort !== "1") previous.remove();
      native.dataset.pinkieNativeEffort = "1";
      native.classList.add("pinkie-effort-trigger");
      effortTriggers.set(details, native); effortOwners.set(native, details);
    }
  }

  function scanPickers(root = document) {
    if (root.matches?.("details.chat-controls__model, details.chat-controls__model-picker")) watchPicker(root);
    root.querySelectorAll?.("details.chat-controls__model, details.chat-controls__model-picker")?.forEach(watchPicker);
  }

  function extendNativeRange(range, details) {
    if (!range || range.disabled) return null;
    const encoded = String(range.dataset?.chatThinkingValues || range.getAttribute?.("data-chat-thinking-values") || "");
    let state = rangeStates.get(range);
    if (!state || (encoded !== state.extended && encoded !== state.nativeEncoded)) {
      const values = encoded.split(",").map(value => value.trim()).filter(Boolean);
      if (!values.length) return null;
      state = {nativeEncoded: encoded, nativeMax: values.length - 1, nativeValue: Number(range.value || 0), extended: MATERIALS.join(",")};
      rangeStates.set(range, state);
    } else if (encoded === state.nativeEncoded && encoded !== state.extended) {
      state.nativeValue = Math.max(0, Math.min(state.nativeMax, Number(range.value || 0)));
    }
    const values = state.nativeEncoded.split(",");
    const tier = selectedEnhancement(currentSessionKey(details)) || chosenTier(null, currentSessionKey(details)) || values[state.nativeValue] || values[0];
    range.max = String(MATERIALS.length - 1);
    range.dataset.chatThinkingValues = state.extended;
    range.dataset.pinkieNativeValues = state.nativeEncoded;
    range.dataset.pinkieExtended = "1";
    if (range.dataset.pinkieDragging !== "1") range.value = String(Math.max(0, MATERIALS.indexOf(tier)));
    return state;
  }

  function syncLevelName(details, menu, range) {
    const panel = menu?.querySelector?.(".chat-controls__reasoning-panel");
    if (!panel || !range) return;
    let label = panel.querySelector?.(":scope > .pinkie-reasoning-current");
    if (!label) {
      label = document.createElement("span");
      label.className = "pinkie-reasoning-current";
      panel.prepend(label);
    }
    const values = String(range.dataset?.chatThinkingValues || "").split(",");
    const index = Math.max(0, Math.min(values.length - 1, Number(range.value || 0)));
    const tier = selectedEnhancement(currentSessionKey(details));
    const material = tier || normalizeMaterial(values[index], index, values.length);
    const name = LEVEL_LABELS[material] || material;
    const fallback = fallbackStates.get(details);
    const native = String(range.dataset.pinkieNativeValues || "").split(",").filter(Boolean);
    const actual = selectionFor(fallback, material, native);
    // 还不知道模型原生支持哪几档时不下结论，免得把「关闭」说成原生支持。
    const known = native.length > 0;
    const endpoints = String(range.dataset.pinkieRouteValues || "").split(",").filter(Boolean);
    const route = endpoints.length ? endpoints : known ? native : [actual.backend];
    const kind = known ? routeKind(material, route) : "pending";
    // Routing details belong in the tooltip; every visible tier uses the same compact label.
    const caption = name;
    if (label.textContent !== caption) label.textContent = caption;
    label.dataset.pinkieRoute = kind;
    const description = known ? routeDescription(material, route) : "正在读取当前模型支持的思考档位…";
    range.setAttribute?.("aria-valuetext", `${name}，${description}`);
    details.dataset.pinkieEnhancement = tier || "off";
    syncEffortTrigger(details, material);
    const effective = familyForSession(fallback)?.implied[actual.model?.slice(actual.model.indexOf("/") + 1)] || actual.backend;
    const captionNative = LEVEL_LABELS[effective] || effective;
    const sent = effective !== material && !["max", "ultra"].includes(material) ? `；实际发送 ${captionNative}` : "";
    const tooltip = `${name}：${description}${known ? sent : ""}`;
    details.dataset.pinkieRoute = kind;
    if (range.title !== tooltip) range.title = tooltip;
    if (label.title !== tooltip) label.title = tooltip;
    pickerState(details, range);
  }

  function showSaveError(details, error) {
    const menu = details?.querySelector?.(".chat-controls__inline-select-menu--combined");
    if (!menu) return;
    let label = menu.querySelector?.(":scope > .pinkie-picker-save-error");
    if (!label) {
      label = document.createElement("span");
      label.className = "pinkie-picker-save-error";
      label.setAttribute("role", "alert");
      menu.append(label);
    }
    label.textContent = `保存失败：${error?.message || "请重试"}`;
  }

  function persistPending(details) {
    const timer = autoSaveTimers.get(details);
    if (timer !== undefined) window.clearTimeout?.(timer);
    autoSaveTimers.delete(details);
    const patch = pendingPatches.get(details);
    const key = pendingSessionKeys.get(details) || currentSessionKey(details);
    pendingPatches.delete(details);
    pendingSessionKeys.delete(details);
    if (!patch) return activeSaves.get(details) || Promise.resolve(true);
    // A queued click belongs to the session that was visible when it happened.
    // Changing panes before the debounce fires must never save it to the new one.
    if (!key || currentSessionKey(details) !== key) return Promise.resolve(false);
    const agentId = /^agent:([^:]+):/.exec(key)?.[1];
    const revision = saveRevisions.get(details) || 0;
    const current = () => currentSessionKey(details) === key && (saveRevisions.get(details) || 0) === revision;
    const prior = activeSaves.get(details) || Promise.resolve(true);
    const save = prior.then(async () => {
      if (!key || currentSessionKey(details) !== key || !details.isConnected) return false;
      const rpc = window.__laolaoSidebar?.gwRequest;
      if (typeof rpc !== "function") throw new Error("连接尚未就绪");
      await rpc("sessions.patch", {key, ...(agentId ? {agentId} : {}), ...patch}, 15_000);
      // Saves are serialized, but the user may already be on a later step.
      // An older response must not replace that newer optimistic selection.
      if (!current()) return true;
      const fallback = fallbackStates.get(details);
      if (fallback?.key === key) {
        try {
          const listed = await rpc("sessions.list", agentId ? {agentId, limit: 1000} : {limit: 1000}, 15_000);
          if (!current()) return true;
          fallback.session = listed?.sessions?.find?.((session) => session.key === key) || fallback.session;
          fallback.selectedModel = fallback.session?.model ? `${fallback.session.modelProvider || ""}/${fallback.session.model}` : "";
          fallback.modelName = fallbackModelName(fallback);
          fallback.switchingModel = false;
          fallback.previousSession = null;
          schedule(details);
        } catch {
          if (!current()) return true;
          fallback.switchingModel = false;
          fallback.session = null;
          fallback.models = [];
          fallback.error = "";
          fallback.failedAt = 0;
          fallback.previousSession = null;
          details.querySelector?.('.chat-controls__reasoning-range[data-pinkie-fallback]')?.remove?.();
          details.removeAttribute?.("data-pinkie-fallback-range");
          schedule(details);
        }
      }
      const state = pickerStates.get(details);
      if (state?.key === key) { state.initialTier = selectedEnhancement(key); state.initialChoice = tierChoice(key); }
      details.querySelector?.(".pinkie-picker-save-error")?.remove?.();
      window.PinkieSessionList?.invalidate?.();
      window.dispatchEvent?.(new Event("laolao:sessions-changed"));
      return true;
    }).catch((error) => {
      if (!current()) return false;
      const state = pickerStates.get(details);
      if (state?.key === key) { setEnhancement(state.initialTier, key); saveTierChoice(state.initialChoice, key); }
      const fallback = fallbackStates.get(details);
      if (fallback?.key === key) {
        fallback.switchingModel = false;
        if (fallback.previousSession) fallback.session = fallback.previousSession;
        fallback.previousSession = null;
        fallback.selectedModel = fallback.session?.model ? `${fallback.session.modelProvider || ""}/${fallback.session.model}` : "";
        fallback.modelName = fallbackModelName(fallback);
      }
      showSaveError(details, error);
      sync(details);
      return false;
    }).finally(() => {
      if (activeSaves.get(details) === save) activeSaves.delete(details);
    });
    activeSaves.set(details, save);
    return save;
  }

  function modelSelectionPatch(value, family, models = [], level = "") {
    let selected = models.find(model => `${model.provider}/${model.id}` === value);
    const routeFamily = family && modelFamily(selected, models);
    let thinkingLevel;
    if (routeFamily) {
      const id = routedFamilyId(routeFamily, level || routeFamily.implied[selected.id] || selected.thinkingDefault || "high");
      value = `${routeFamily.provider}/${id}`;
      selected = models.find(model => model.provider === routeFamily.provider && model.id === id) || selected;
      const requested = routeFamily.implied[id] || level || "high";
      const fixedEffort = FAMILY_SUFFIX.test(selected.id) && !selected.compat?.supportedReasoningEfforts?.length;
      thinkingLevel = selected.reasoning === false || fixedEffort ? "off" : ["max", "ultra"].includes(requested) ? "high" : requested;
    }
    const workBuddy = selected?.provider === "mm" && selected?.id?.startsWith("workbuddy/") && selected.reasoning === true;
    return {model: value || null,
      ...(family ? {thinkingLevel: routeFamily ? thinkingLevel : null} : {}),
      ...(workBuddy ? {thinkingLevel: "high", reasoningLevel: "stream"} : {}),
    };
  }

  function scheduleAutoSave(details, patch) {
    if (!details?.open || !patch) return;
    const key = currentSessionKey(details);
    if (!key) return;
    if (pendingSessionKeys.get(details) && pendingSessionKeys.get(details) !== key) pendingPatches.delete(details);
    pendingSessionKeys.set(details, key);
    saveRevisions.set(details, (saveRevisions.get(details) || 0) + 1);
    pendingPatches.set(details, {...(pendingPatches.get(details) || {}), ...patch});
    const previous = autoSaveTimers.get(details);
    if (previous !== undefined) window.clearTimeout?.(previous);
    const timer = window.setTimeout?.(() => { void persistPending(details); }, 180);
    if (timer !== undefined) autoSaveTimers.set(details, timer);
  }

  function fallbackModelName(state) {
    const session = state.session;
    if (!session?.model) return "";
    const family = familyForSession(state);
    if (family) return family.label;
    const selected = `${session.modelProvider || ""}/${session.model}`;
    const presentation = presentationModels(state.models, selected)
      .find((item) => item.sources.includes(selected));
    if (presentation) return presentation.name || presentation.id;
    const model = state.models.find((item) => item.id === session.model && item.provider === session.modelProvider)
      || state.models.find((item) => item.id === session.model);
    return model?.name || session.model;
  }

  function renderFallbackCatalog(details, browser, state) {
    if (!browser?.querySelector || !document.createElement) return;
    let list = browser.querySelector(":scope > .pinkie-fallback-catalog");
    if (!list) {
      list = document.createElement("div");
      list.className = "pinkie-fallback-catalog";
      browser.append(list);
    }
    if (details.dataset) details.dataset.pinkieFoldedCatalog = "1";
    const items = groupedPresentationModels(state.models, state.selectedModel);
    const groups = [...new Set(items.map(modelGroup))];
    const selected = items.find((model) => model.sources.includes(state.selectedModel));
    const selectedId = state.selectedModel?.slice(state.selectedModel.indexOf("/") + 1) || state.session?.model || "";
    const selectedGroup = selected ? modelGroup(selected) : selectedId ? modelGroup({id: selectedId}) : "";
    const activeGroup = groups.includes(state.activeGroup) ? state.activeGroup
      : groups.includes(selectedGroup) ? selectedGroup : groups[0] || "";
    state.activeGroup = activeGroup;
    const signature = `${items.map((model) => `${model.provider}/${model.id}/${model.name}/${model.contextWindow || ""}`).join("|")}:${state.selectedModel || ""}:${activeGroup}:${state.session?.hasActiveRun ? 1 : 0}:${state.surface ? 1 : 0}`;
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    const fragment = document.createDocumentFragment();
    const brandTabs = document.createElement("div");
    brandTabs.className = "pinkie-model-brand-tabs";
    brandTabs.setAttribute("role", "group");
    brandTabs.setAttribute("aria-label", "选择 AI 品牌");
    const tabFragment = document.createDocumentFragment();
    for (const group of groups) {
      const representative = items.find((model) => modelGroup(model) === group);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "pinkie-model-brand-tab";
      tab.dataset.pinkieModelGroup = group;
      tab.dataset.pinkieBrand = modelBrand(representative.provider, representative.id);
      tab.setAttribute("aria-pressed", String(group === activeGroup));
      tab.textContent = group;
      tabFragment.append(tab);
    }
    brandTabs.replaceChildren(tabFragment);
    fragment.append(brandTabs);
    for (const model of items.filter((item) => state.surface || modelGroup(item) === activeGroup)) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chat-controls__combined-model-option pinkie-fallback-option";
      option.dataset.chatModelOption = `${model.provider}/${model.id}`;
      option.dataset.pinkieSources = JSON.stringify(model.sources);
      option.dataset.pinkieBackingRoute = model.sources.includes(state.selectedModel) ? state.selectedModel : `${model.provider}/${model.id}`;
      option.dataset.pinkieBrand = modelBrand(model.provider, model.id);
      option.dataset.pinkieContext = formatModelContext(model.contextWindow);
      option.dataset.pinkieCatalogContext = model.contextWindow || "";
      if (model.family) option.dataset.pinkieFamily = `${model.family.provider}/${model.family.canonical}`;
      const selected = model.sources.includes(state.selectedModel);
      option.setAttribute("aria-selected", String(selected));
      option.disabled = Boolean(state.session?.hasActiveRun);
      option.textContent = model.name || model.id;
      fragment.append(option);
    }
    list.replaceChildren(fragment);
  }

  function ensureFallbackRange(details, menu, state) {
    const native = menu?.querySelector?.('.chat-controls__reasoning-range:not([data-pinkie-fallback])');
    let slider = native?.closest?.(".chat-controls__reasoning-slider")
      || menu?.querySelector?.(".chat-controls__reasoning-slider");
    const rawLevels = state.session?.thinkingLevels?.length
      ? state.session.thinkingLevels : state.session?.thinkingOptions || [];
    const backendValues = rawLevels
      .map((value) => typeof value === "string" ? value : value?.id)
      .filter((value) => typeof value === "string" && value);
    if (!backendValues.length) backendValues.push("off");
    const family = familyForSession(state);
    const values = MATERIALS;
    if (!slider && values.length > 0 && document.createElement) {
      let panel = menu?.querySelector?.(".chat-controls__reasoning-panel");
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "chat-controls__reasoning-panel";
        const actions = menu?.querySelector?.(".chat-controls__picker-actions");
        if (actions) menu.insertBefore(panel, actions);
        else menu.append(panel);
      }
      slider = document.createElement("div");
      slider.className = "chat-controls__reasoning-slider pinkie-fallback-slider";
      panel.append(slider);
    }
    if (!slider || !values.length || state.session?.hasActiveRun) {
      slider?.querySelector?.('.chat-controls__reasoning-range[data-pinkie-fallback]')?.remove?.();
      details.removeAttribute?.("data-pinkie-fallback-range");
      if (details.dataset) details.dataset.pinkieNoReasoning = !values.length && !state.session?.hasActiveRun ? "1" : "0";
      return null;
    }
    details.dataset.pinkieNoReasoning = "0";
    let range = slider.querySelector?.('.chat-controls__reasoning-range[data-pinkie-fallback]');
    if (!range) {
      range = document.createElement("input");
      range.type = "range";
      range.className = "chat-controls__reasoning-range pinkie-fallback-range";
      range.dataset.pinkieFallback = "1";
      range.setAttribute("aria-label", "思考等级");
      slider.append(range);
    }
    const tiers = MATERIALS;
    range.min = "0";
    range.max = String(tiers.length - 1);
    range.step = "1";
    range.dataset.chatThinkingValues = tiers.join(",");
    range.dataset.pinkieNativeValues = backendValues.join(",");
    range.dataset.pinkieRouteValues = (family?.endpointLevels || []).join(",");
    const enhanced = selectedEnhancement(state.key);
    const choice = chosenTier(state);
    const staleNativeTier = state.session?.thinkingLevel && !backendValues.includes(state.session.thinkingLevel);
    if ((enhanced || staleNativeTier) && !family && !state.switchingModel && !state.session?.hasActiveRun) {
      const requested = enhanced || choice || state.session?.thinkingDefault || "medium";
      const target = nativeTierFor(requested, backendValues, state.session?.thinkingDefault);
      if (state.session && state.session.thinkingLevel !== target) {
        if (!state.previousSession) state.previousSession = {...state.session};
        state.session.thinkingLevel = target;
        if (choice) saveTierChoice({tier:choice,model:state.selectedModel,backend:target}, state.key);
        scheduleAutoSave(details, {thinkingLevel: target});
      }
    }
    const selected = enhanced || choice || fallbackThinkingLevel(state) || values[0];
    if (range.dataset.pinkieDragging !== "1") range.value = String(Math.max(0, tiers.indexOf(selected)));
    range.disabled = Boolean(state.switchingModel);
    details.dataset.pinkieFallbackRange = "1";
    return range;
  }

  function ensureFallbackData(details, browser) {
    if (!browser?.querySelectorAll) return null;
    const key = currentSessionKey(details);
    if (!key) return null;
    let state = fallbackStates.get(details);
    if (state?.key !== key) {
      const timer = autoSaveTimers.get(details);
      if (timer !== undefined) window.clearTimeout?.(timer);
      autoSaveTimers.delete(details);
      pendingPatches.delete(details);
      pendingSessionKeys.delete(details);
      state = {key, models: [], session: null, selectedModel: "", modelName: "", loading: false};
      fallbackStates.set(details, state);
    }
    details.dataset.pinkieFallback = "1";
    if (!state.loading && !state.models.length && (!state.failedAt || Date.now() - state.failedAt > 10_000)) {
      const rpc = window.__laolaoSidebar?.gwRequest;
      if (typeof rpc === "function") {
        state.loading = true;
        state.lastSessionRefreshAt = Date.now();
        const agentId = /^agent:([^:]+):/.exec(key)?.[1];
        void Promise.all([
          loadCatalog(rpc, agentId || ""),
          rpc("sessions.list", agentId ? {agentId, limit: 1000} : {limit: 1000}, 15_000),
        ]).then(([models, sessions]) => {
          if (fallbackStates.get(details) !== state) return;
          state.models = [...models];
          state.loadedAt = Date.now();
          state.error = state.models.length ? "" : "暂无可选模型";
          state.session = sessions?.sessions?.find?.((session) => session.key === key) || null;
          const currentProvider = state.session?.modelProvider;
          if (currentProvider) state.models.sort((left, right) => (right.provider === currentProvider) - (left.provider === currentProvider));
          state.selectedModel = state.session?.model ? `${state.session.modelProvider || ""}/${state.session.model}` : "";
          state.modelName = fallbackModelName(state);
          state.loading = false;
          state.failedAt = state.models.length ? 0 : Date.now();
          schedule(details);
        }).catch((error) => {
          if (fallbackStates.get(details) !== state) return;
          state.loading = false;
          state.error = error?.message || "模型列表暂时不可用";
          state.failedAt = Date.now();
          schedule(details);
        });
      }
    }
    if (state.models.length) {
      browser.querySelector?.(":scope > .pinkie-fallback-message")?.remove?.();
      renderFallbackCatalog(details, browser, state);
    } else if (state.error && document.createElement) {
      let message = browser.querySelector(":scope > .pinkie-fallback-message");
      if (!message) {
        message = document.createElement("div");
        message.className = "pinkie-fallback-message";
        browser.append(message);
      }
      message.textContent = `模型列表暂时不可用：${state.error}`;
    }
    details.dataset.pinkieFallbackReady = state.models.length || state.error ? "1" : "0";
    return state;
  }

  function refreshFallbackSession(details, state = fallbackStates.get(details)) {
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!state?.models?.length || state.loading || state.sessionRefreshing || typeof rpc !== "function"
      || pendingPatches.has(details) || activeSaves.has(details)
      || Date.now() - (state.lastSessionRefreshAt || 0) < 250) return;
    const key = state.key;
    if (currentSessionKey(details) !== key) return;
    state.sessionRefreshing = true;
    state.lastSessionRefreshAt = Date.now();
    const revision = saveRevisions.get(details) || 0;
    const agentId = /^agent:([^:]+):/.exec(key)?.[1];
    void rpc("sessions.list", agentId ? {agentId, limit: 1000} : {limit: 1000}, 15_000).then((listed) => {
      if (fallbackStates.get(details) !== state || currentSessionKey(details) !== key
        || (saveRevisions.get(details) || 0) !== revision
        || pendingPatches.has(details) || activeSaves.has(details)) return;
      const session = listed?.sessions?.find?.((entry) => entry.key === key);
      if (!session) return;
      state.session = session;
      state.selectedModel = session.model ? `${session.modelProvider || ""}/${session.model}` : "";
      state.modelName = fallbackModelName(state);
      schedule(details);
    }).catch(() => { /* Retain the last usable snapshot if a refresh fails. */ })
      .finally(() => { state.sessionRefreshing = false; });
  }

  function refreshFallbackCatalog(details) {
    const state = fallbackStates.get(details);
    const rpc = window.__laolaoSidebar?.gwRequest;
    if (!state || typeof rpc !== "function" || state.refreshing ||
        Date.now() - (state.lastRefreshAt || 0) < 60_000) return;
    state.refreshing = true;
    state.lastRefreshAt = Date.now();
    const agentId = /^agent:([^:]+):/.exec(state.key)?.[1] || "";
    void rpc("pinkie.models.sync", {}, 15_000).catch(() => null).then(async () => {
      catalogRequests.delete(agentId);
      const models = await loadCatalog(rpc, agentId);
      if (fallbackStates.get(details) !== state || !models.length) return;
      state.models = [...models];
      state.loadedAt = Date.now();
      schedule(details);
    }).catch(() => {}).finally(() => { state.refreshing = false; });
  }

  /* One catalog surface for both host generations. Native buttons stay in place:
     selection, authentication, runtime routing and saving remain with their owner. */
  const surfaceStates = new WeakMap();
  const RECENT_MODELS_KEY = "pinkie:model-picker:recent:v1";
  const SURFACE_BRANDS = ["gemini", "openai", "codex", "deepseek", "minimax", "grok", "crossmodel", "zai", "kimi", "doubao", "claude", "alibaba", "mistral", "ollama", "hunyuan", "perplexity", "groq"];
  const BRAND_NAMES = {gemini: "Gemini", openai: "OpenAI", codex: "Codex", deepseek: "DeepSeek", minimax: "MiniMax", grok: "Grok", crossmodel: "其他", zai: "GLM", kimi: "Kimi", doubao: "豆包", claude: "Claude", alibaba: "Qwen", mistral: "Mistral", ollama: "Llama", hunyuan: "混元", perplexity: "Perplexity", groq: "Groq"};
  function recentModels() {
    try {
      const rows = JSON.parse(window.localStorage?.getItem(RECENT_MODELS_KEY) || "[]");
      return Array.isArray(rows) ? rows.filter((value) => typeof value === "string").slice(0, 64) : [];
    } catch { return []; }
  }
  function rememberModel(value) {
    if (!value || value.length > 500) return;
    try { window.localStorage?.setItem(RECENT_MODELS_KEY, JSON.stringify([value, ...recentModels().filter((item) => item !== value)].slice(0, 6))); } catch { /* private browsing still works */ }
  }
  function formatModelContext(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
  }
  function modelSurfaceRows(menu) {
    // The old host keeps its Lit-owned options under a hidden provider panel.
    // Its recovered catalog is the single visible, authoritative option set.
    const catalog = menu.querySelector(".pinkie-fallback-catalog") || menu;
    return [...catalog.querySelectorAll("[data-chat-model-option]")].filter((row) => row.dataset.pinkieHiddenModel !== "1");
  }
  function rowBrand(row) {
    const value = row.getAttribute("data-chat-model-option") || "";
    const slash = value.indexOf("/");
    const brand = modelBrand(slash < 0 ? "" : value.slice(0, slash), slash < 0 ? value : value.slice(slash + 1));
    return SURFACE_BRANDS.includes(brand) ? brand : "crossmodel";
  }
  function surfaceBrand(node, brand) {
    if (node.dataset.pinkieBrand !== brand) node.dataset.pinkieBrand = brand;
    const modern = document.documentElement.hasAttribute("data-cle");
    const asset = modern ? `/cle/static/legacy/brand/${brand}.svg`
      : brand === "crossmodel" ? "/provider-icons/ProviderIcon-crossmodel.svg" : `/laolao-provider-${brand}.svg`;
    const mono = ["crossmodel", "openai", "codex", "grok", "groq", "kimi", "zai", "ollama"].includes(brand);
    const set = (key, value) => { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); };
    set("--model-brand-mask", mono ? `url("${asset}")` : "none");
    set("--model-brand-image", mono ? "none" : `url("${asset}")`);
    set("--model-brand-ink", mono ? "currentColor" : "transparent");
  }
  function syncCatalogSurface(details, menu, browser) {
    if (!menu?.querySelectorAll || !browser?.querySelectorAll || !document.createElement) return;
    menu.dataset.pinkiePickerSurface = "1";
    const rows = modelSurfaceRows(menu);
    if (!rows.length) return;
    let state = surfaceStates.get(details);
    if (!state || state.menu !== menu) {
      state = {menu, brand: "common", signature: "", bar: null, empty: null};
      surfaceStates.set(details, state);
    }
    let search = menu.querySelector(".chat-controls__model-search");
    if (!search) {
      const wrap = document.createElement("div");
      wrap.className = "chat-controls__model-search-wrap";
      wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"></circle><path d="m16 16 5 5"></path></svg>';
      search = document.createElement("input");
      search.type = "search";
      search.className = "chat-controls__model-search";
      search.dataset.pinkieFilterSearch = "1";
      search.placeholder = "搜索模型";
      search.setAttribute("aria-label", "搜索模型");
      search.setAttribute("autocomplete", "off");
      wrap.append(search);
      menu.prepend(wrap);
    }
    for (const row of rows) {
      const brand = rowBrand(row);
      surfaceBrand(row, brand);
      const route = row.dataset.pinkieBackingRoute || row.getAttribute("data-chat-model-option") || "";
      const oldTitle = row.getAttribute("title") || "";
      if (oldTitle !== row.dataset.pinkieOwnRouteTitle) row.dataset.pinkieNativeTitle = oldTitle;
      const title = [row.dataset.pinkieNativeTitle, `模型来源：${route}`].filter(Boolean).join("\n");
      if (oldTitle !== title) { row.setAttribute("title", title); row.dataset.pinkieOwnRouteTitle = title; }
      const oldAria = row.getAttribute("aria-label") || "";
      if (oldAria !== row.dataset.pinkieOwnRouteAria) row.dataset.pinkieNativeAria = oldAria || row.textContent.trim();
      const aria = `${row.dataset.pinkieNativeAria}，模型来源 ${route}`;
      if (oldAria !== aria) { row.setAttribute("aria-label", aria); row.dataset.pinkieOwnRouteAria = aria; }
      const meta = row.querySelector(".chat-controls__model-option-meta")?.textContent?.trim() || "";
      const context = meta.match(/(?:^|\s|·)(\d+(?:\.\d+)?\s*[kmb])(?:\b|$)/i)?.[1]?.replace(/\s/g, "") || formatModelContext(row.dataset.pinkieCatalogContext);
      if (row.dataset.pinkieContext !== context) row.dataset.pinkieContext = context;
    }
    const brands = SURFACE_BRANDS.filter((brand) => rows.some((row) => row.dataset.pinkieBrand === brand));
    if (!["all", "common"].includes(state.brand) && !brands.includes(state.brand)) state.brand = "common";
    if (!state.bar?.isConnected) {
      state.bar = document.createElement("div");
      state.bar.className = "pinkie-model-filters";
      state.bar.setAttribute("role", "group");
      state.bar.setAttribute("aria-label", "按模型品牌筛选，左右方向键切换");
      menu.insertBefore(state.bar, browser);
    }
    const signature = ["common", "all", ...brands].join("|") + rows.length;
    if (state.signature !== signature) {
      state.signature = signature;
      const fragment = document.createDocumentFragment();
      for (const brand of ["common", "all", ...brands]) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "pinkie-model-filter";
        tab.dataset.pinkieModelFilter = brand;
        const label = brand === "all" ? `全部 ${rows.length}` : brand === "common" ? "常用模型" : BRAND_NAMES[brand] || "其他";
        if (!["all", "common", "crossmodel"].includes(brand)) surfaceBrand(tab, brand);
        tab.textContent = label;
        tab.title = brand === "all" ? `全部 ${rows.length} 个可选项` : brand === "common" ? "最近使用的6个模型" : label;
        tab.setAttribute("aria-label", label);
        fragment.append(tab);
      }
      state.bar.replaceChildren(fragment);
    }
    const query = search.value.trim().toLocaleLowerCase();
    const selected = rows.find(row => row.getAttribute("aria-selected") === "true");
    const selectedValue = selected?.getAttribute("data-chat-model-option");
    const normalize = value => rows.find(row => row.getAttribute("data-chat-model-option") === value
      || (() => { try { return JSON.parse(row.dataset.pinkieSources || "[]").includes(value); } catch { return false; } })())?.getAttribute("data-chat-model-option");
    const fallback = fallbackStates.get(details);
    const confirmed = !fallback?.switchingModel && !activeSaves.has(details) && !pendingPatches.has(details);
    const recentOrder = [...new Set([...(selectedValue && confirmed && state.selected !== selectedValue ? [selectedValue] : []),
      ...recentModels().map(normalize).filter(Boolean), ...(selectedValue ? [selectedValue] : [])])].slice(0, 6);
    if (confirmed) {
      if (selectedValue) state.selected = selectedValue;
      try {
        const encoded = JSON.stringify(recentOrder);
        if (window.localStorage?.getItem(RECENT_MODELS_KEY) !== encoded) window.localStorage?.setItem(RECENT_MODELS_KEY, encoded);
      } catch { /* Browser storage can be unavailable. */ }
    }
    const common = new Set(recentOrder);
    let visible = 0;
    for (const [index, row] of rows.entries()) {
      const value = row.getAttribute("data-chat-model-option");
      const order = query ? Number(row.dataset.chatModelRank ?? index)
        : state.brand === "common" ? row === selected ? -1 : recentOrder.indexOf(value) >= 0 ? recentOrder.indexOf(value) : rows.length + index : row === selected ? -1 : index;
      if (row.style.getPropertyValue("--pinkie-model-order") !== String(order)) row.style.setProperty("--pinkie-model-order", String(order));
      const haystack = [row.dataset.chatModelName, row.dataset.chatModelKeywords, row.dataset.chatModelProviderLabel,
        row.getAttribute("data-chat-model-option"), row.dataset.pinkieSources, row.querySelector(".chat-controls__model-option-name")?.textContent || row.textContent].join(" ").toLocaleLowerCase();
      // The default All tab always searches the authoritative complete catalog.
      const included = state.brand === "all" || (state.brand === "common"
        ? Boolean(query) || common.has(row.getAttribute("data-chat-model-option")) : row.dataset.pinkieBrand === state.brand);
      const hidden = !included || Boolean(query && !haystack.includes(query));
      if (row.hidden !== hidden) row.hidden = hidden;
      if (row.hasAttribute("data-pinkie-filter-hidden") !== hidden) row.toggleAttribute("data-pinkie-filter-hidden", hidden);
      if (!hidden) visible += 1;
    }
    state.bar.querySelectorAll("[data-pinkie-model-filter]").forEach((tab) => {
      const active = tab.dataset.pinkieModelFilter === state.brand;
      if (tab.getAttribute("aria-pressed") !== String(active)) tab.setAttribute("aria-pressed", String(active));
    });
    // Native search ranks options and owns ids. Keep its keyboard highlight on a
    // visible row after a brand filter so Enter cannot select a hidden model.
    const enabled = rows.filter((row) => !row.hidden && !row.disabled);
    let highlighted = enabled.find((row) => row.hasAttribute("data-chat-model-highlighted"));
    highlighted ||= enabled.find((row) => row.getAttribute("aria-selected") === "true") || enabled[0];
    for (const row of rows) {
      const active = row === highlighted;
      if (row.hasAttribute("data-chat-model-highlighted") !== active) row.toggleAttribute("data-chat-model-highlighted", active);
    }
    if (highlighted?.id) search.setAttribute("aria-activedescendant", highlighted.id);
    else search.removeAttribute("aria-activedescendant");
    if (!state.empty?.isConnected) {
      state.empty = document.createElement("div");
      state.empty.className = "pinkie-model-empty";
      state.empty.setAttribute("role", "status");
      state.empty.textContent = "没有匹配的模型，试试其他关键词或品牌";
      menu.insertBefore(state.empty, browser.nextSibling);
    }
    if (state.empty.hidden !== (visible > 0)) state.empty.hidden = visible > 0;
    const nativeEmpty = menu.querySelector("[data-chat-model-search-empty]");
    if (nativeEmpty && !nativeEmpty.hidden) nativeEmpty.hidden = true;
    const settings = menu.querySelector("[data-chat-model-provider-settings]");
    if (settings && !menu.querySelector(".pinkie-model-manage")) {
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "pinkie-model-manage";
      manage.textContent = "管理模型来源";
      manage.setAttribute("aria-expanded", "false");
      manage.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = menu.toggleAttribute("data-pinkie-routes-open");
        manage.setAttribute("aria-expanded", String(expanded));
      });
      menu.append(manage);
    }
  }

  document.addEventListener("input", (event) => {
    if (!event.target.matches?.(".chat-controls__model-search")) return;
    const details = event.target.closest("details.chat-controls__model, details.chat-controls__model-picker");
    if (details) schedule(details);
  });
  document.addEventListener("click", (event) => {
    const tab = event.target.closest?.("[data-pinkie-model-filter]");
    if (tab) {
      const details = tab.closest("details.chat-controls__model, details.chat-controls__model-picker");
      const state = surfaceStates.get(details);
      if (!state) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.brand = tab.dataset.pinkieModelFilter;
      const browser = state.menu.querySelector(".chat-controls__model-options, .chat-controls__model-browser");
      syncCatalogSurface(details, state.menu, browser);
      if (browser) browser.scrollTop = 0;
      return;
    }
    const row = event.target.closest?.("[data-chat-model-option]");
    if (row && !row.disabled && row.closest("[data-pinkie-picker-surface]")) {
      // Remember confirmed native selection on the next render, not a failed save.
      const details = row.closest("details");
      window.setTimeout?.(() => {
        if (row.isConnected && row.getAttribute("aria-selected") === "true") rememberModel(row.getAttribute("data-chat-model-option"));
        if (details?.open) schedule(details);
      }, 0);
    }
  }, true);
  document.addEventListener("pointerdown", (event) => {
    event.target.closest?.("[data-pinkie-picker-surface]")?.removeAttribute("data-pinkie-keyboard");
  }, true);
  document.addEventListener("keydown", (event) => {
    const menu = event.target.closest?.("[data-pinkie-picker-surface]");
    if (!menu || event.isComposing || event.keyCode === 229) return;
    const tab = event.target.closest?.("[data-pinkie-model-filter]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...tab.parentElement.querySelectorAll("[data-pinkie-model-filter]")];
      const at = tabs.indexOf(tab), delta = event.key === "ArrowLeft" ? -1 : 1;
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + delta + tabs.length) % tabs.length;
      event.preventDefault(); event.stopImmediatePropagation();
      tabs[index].focus({preventScroll: true}); tabs[index].click();
      tabs[index].scrollIntoView({block: "nearest", inline: "nearest"});
      return;
    }
    if (!event.target.matches?.(".chat-controls__model-search") || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const rows = modelSurfaceRows(menu).filter((row) => !row.hidden && !row.disabled)
      .sort((a, b) => Number(a.style.getPropertyValue("--pinkie-model-order") || 0) - Number(b.style.getPropertyValue("--pinkie-model-order") || 0));
    if (!rows.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    menu.dataset.pinkieKeyboard = "1";
    const current = rows.findIndex((row) => row.hasAttribute("data-chat-model-highlighted"));
    if (event.key === "Enter") { rows[Math.max(0, current)].click(); return; }
    const index = current < 0 ? 0 : (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
    for (const row of modelSurfaceRows(menu)) row.toggleAttribute("data-chat-model-highlighted", row === rows[index]);
    if (rows[index].id) event.target.setAttribute("aria-activedescendant", rows[index].id);
    rows[index].scrollIntoView({block: "nearest"});
  }, true);


  function sync(details) {
    prepareModernPicker(details);
    syncTrigger(details);
    if (!details?.isConnected || !details.open) {
      if (details && !details.open) finishPicker(details);
      details?.removeAttribute("data-pinkie-max");
      return;
    }
    const menu = details.querySelector(".chat-controls__inline-select-menu--combined") || details.querySelector(".chat-controls__inline-select-menu--combined, .chat-controls__model-menu");
    const nativeRange = menu?.querySelector('.chat-controls__reasoning-range:not([data-pinkie-fallback])')
      || menu?.querySelector('.chat-controls__reasoning-range');
    const browser = menu?.querySelector(".chat-controls__model-browser") || menu?.querySelector(".chat-controls__model-browser, .chat-controls__model-options");
    if (!menu || !browser) return;
    const fallback = ensureFallbackData(details, browser);
    if (fallback) {
      fallback.surface = true;
      if (fallback.models.length) renderFallbackCatalog(details, browser, fallback);
    }
    syncModelBrands(browser, false);
    syncCatalogSurface(details, menu, browser);
    // 模型目录已到、会话信息还没到时也要扩成 9 档：否则刚打开的几秒里只有原生几档，标记和提示也会算错。
    if (!fallback?.session) extendNativeRange(nativeRange, details);
    const fallbackRange = fallback?.session ? ensureFallbackRange(details, menu, fallback) : null;
    const visibleRange = fallbackRange || nativeRange;
    syncReasoning(visibleRange);

    watchPicker(details);

    if (!details.dataset.pinkiePickerView) details.dataset.pinkiePickerView = "model";
    details.dataset.pinkieModelsOpen = details.dataset.pinkiePickerView === "model" ? "1" : "0";
    details.dataset.pinkieEnhanced = "1";
    warmFrames();
    if (fallback?.session && !visibleRange && !fallback.session.hasActiveRun) {
      details.dataset.pinkieMaterial = "off";
      details.dataset.pinkieLevel = "0";
      syncFrame(details, "off");
    }
    let button = menu.querySelector(":scope > .pinkie-model-current");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "pinkie-model-current";
      button.setAttribute("aria-label", "选择模型");
      button.innerHTML = '<span class="pinkie-model-current__icon" aria-hidden="true"><svg viewBox="0 0 18 18"><path d="M9 2.4v13.2M2.4 9h13.2"></path><path d="M4.3 4.3l9.4 9.4M13.7 4.3l-9.4 9.4"></path></svg></span><span class="pinkie-model-current__text"><span class="pinkie-model-current__name"></span></span><span class="pinkie-model-current__chevron" aria-hidden="true"></span>';
      menu.insertBefore(button, browser);
    }
    const current = details.querySelector(".chat-controls__inline-select-label")?.textContent?.trim() || "选择模型";
    const draftName = menu.querySelector('[data-chat-model-option][aria-selected="true"] .chat-controls__model-option-title')?.textContent?.trim();
    const modelName = fallback?.modelName || draftName || current.replace(/\s*[·•]\s*[^·•]+$/, "").trim() || current;
    const name = button.querySelector(".pinkie-model-current__name");
    if (name.textContent !== modelName) name.textContent = modelName;
    const selectedRef = fallback?.selectedModel
      || menu.querySelector?.('[data-chat-model-option][aria-selected="true"]')?.getAttribute?.("data-chat-model-option") || "";
    if (selectedRef && button.dataset) {
      const separator = selectedRef.indexOf("/");
      button.dataset.pinkieBrand = modelBrand(separator < 0 ? "" : selectedRef.slice(0, separator),
        separator < 0 ? selectedRef : selectedRef.slice(separator + 1));
    } else if (button.dataset) delete button.dataset.pinkieBrand;
    const expanded = details.dataset.pinkieModelsOpen === "1";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "收起模型列表" : "选择模型"}，当前 ${modelName}`);
    button.title = modelName;
    const range = visibleRange;
    syncLevelName(details, menu, range);
    details.toggleAttribute("data-pinkie-max", Boolean(isMax(range)));
    layoutPopup(details);
  }

  function schedule(details) {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync(details?.isConnected ? details : document.querySelector?.("details.chat-controls__model[open]"));
    });
  }

  document.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!details?.matches?.("details.chat-controls__model, details.chat-controls__model-picker")) return;
    watchPicker(details);
    if (!details.open) {
      finishPicker(details);
      details.removeAttribute("data-pinkie-models-open");
      details.removeAttribute("data-pinkie-max");
    } else {
      refreshFallbackSession(details);
      schedule(details);
    }
  }, true);

  document.addEventListener("click", (event) => {
    const effortButton = (event.target.closest?.(".pinkie-effort-trigger") || event.target.closest?.(".chat-controls__effort-trigger"));
    const effortOwner = effortButton && effortOwners.get(effortButton);
    if (effortOwner?.isConnected) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      if (effortOwner.open && effortOwner.dataset.pinkiePickerView === "effort") closePicker(effortOwner);
      else openPickerView(effortOwner, "effort");
      return;
    }
    const details = isPicker(event.target);
    if (!details) {
      for (const picker of triggerObservers.keys()) {
        if (picker.open && !picker.contains?.(event.target)) closePicker(picker);
      }
      return;
    }
    const summary = event.target.closest?.(".chat-controls__inline-select-trigger");
    if (summary?.parentElement === details) {
      if (details.open) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        if (details.dataset.pinkiePickerView === "effort") openPickerView(details, "model");
        else closePicker(details);
        return;
      }
      if (details.dataset) details.dataset.pinkiePickerView = "model";
    }
    const button = event.target.closest?.(".pinkie-model-current");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - (pointerToggles.get(details) || 0) < 600) return;
      const expanding = details.dataset.pinkieModelsOpen !== "1";
      details.dataset.pinkieModelsOpen = expanding ? "1" : "0";
      if (expanding) {
        const fallback = fallbackStates.get(details);
        if (fallback) fallback.activeGroup = "";
      }
      sync(details);
      if (details.dataset.pinkieModelsOpen === "1") refreshFallbackCatalog(details);
      return;
    }
    const brandTab = event.target.closest?.(".pinkie-model-brand-tab");
    if (brandTab) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      const fallback = fallbackStates.get(details);
      if (fallback?.models?.length) {
        fallback.activeGroup = brandTab.dataset?.pinkieModelGroup || "";
        const browser = details.querySelector?.(".chat-controls__model-browser");
        renderFallbackCatalog(details, browser, fallback);
        if (browser) browser.scrollTop = 0;
      }
      return;
    }
    const modelOption = event.target.closest?.("[data-chat-model-option]");
    if (modelOption) {
      const fallbackOption = modelOption.classList?.contains?.("pinkie-fallback-option");
      if (fallbackOption) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
      details.dataset.pinkieModelsOpen = "0";
      const value = modelOption.getAttribute?.("data-chat-model-option") || "";
      const selectedRoute = fallbackStates.get(details)?.selectedModel || "";
      if (!modelOption.disabled && (modelOption.getAttribute?.("aria-selected") !== "true"
        || (fallbackOption && selectedRoute && value !== selectedRoute))) {
        setEnhancement("", currentSessionKey(details));
        pendingPatches.delete(details);
        const patch = modelSelectionPatch(value, modelOption.dataset?.pinkieFamily,
          fallbackStates.get(details)?.models || [], carriedThinkingLevel(fallbackStates.get(details)));
        if (fallbackOption) {
          const fallback = fallbackStates.get(details);
          if (fallback) {
            if (fallback.session) {
              if (!fallback.previousSession) fallback.previousSession = {...fallback.session};
              const route = patch.model || value, slash = route.indexOf("/");
              fallback.session = {...fallback.session, modelProvider: route.slice(0, slash), model: route.slice(slash + 1),
                ...(Object.hasOwn(patch, "thinkingLevel") ? {thinkingLevel: patch.thinkingLevel} : {}),
                ...(Object.hasOwn(patch, "reasoningLevel") ? {reasoningLevel: patch.reasoningLevel} : {})};
            }
            fallback.selectedModel = patch.model || value;
            fallback.switchingModel = true;
            const family = presentationModels(fallback.models).find((entry) =>
              `${entry.family?.provider}/${entry.family?.canonical}` === modelOption.dataset?.pinkieFamily)?.family;
            const selected = fallback.models.find((model) => `${model.provider}/${model.id}` === value);
            fallback.modelName = family?.label || selected?.name || selected?.id || value;
          }
        }
        scheduleAutoSave(details, patch);
      }
    }
    const immediateOption = event.target.closest?.(".chat-controls__use-default-model, .chat-controls__reasoning-default, [data-chat-thinking-option], [data-chat-speed-option]");
    if (immediateOption && !immediateOption.disabled && immediateOption.getAttribute?.("aria-pressed") !== "true") {
      if (immediateOption.matches?.(".chat-controls__use-default-model")) {
        setEnhancement("", currentSessionKey(details));
        pendingPatches.delete(details);
        scheduleAutoSave(details, {model: null});
      } else if (immediateOption.matches?.(".chat-controls__reasoning-default")) {
        setEnhancement("", currentSessionKey(details));
        scheduleAutoSave(details, {thinkingLevel: null});
      } else if (immediateOption.hasAttribute?.("data-chat-thinking-option")) {
        setEnhancement("", currentSessionKey(details));
        scheduleAutoSave(details, {thinkingLevel: immediateOption.getAttribute("data-chat-thinking-option") || null});
      } else if (immediateOption.hasAttribute?.("data-chat-speed-option")) {
        scheduleAutoSave(details, {fastMode: immediateOption.getAttribute("data-chat-speed-option") || null});
      }
    }
    schedule(details);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const details = isPicker(event.target);
    const button = event.target.closest?.(".pinkie-model-current");
    if (!details?.open || !button) return;
    pointerToggles.set(details, Date.now());
    details.dataset.pinkieModelsOpen = details.dataset.pinkieModelsOpen === "1" ? "0" : "1";
    sync(details);
    if (details.dataset.pinkieModelsOpen === "1") refreshFallbackCatalog(details);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const picker of triggerObservers.keys()) {
      if (!picker.open) continue;
      event.preventDefault();
      closePicker(picker);
    }
  }, true);

  function syncAllPickers() {
    scanPickers();
    for (const details of triggerObservers.keys()) {
      const browser = details.querySelector?.(".chat-controls__model-browser");
      if (browser) ensureFallbackData(details, browser);
      sync(details);
    }
  }
  document.addEventListener("visibilitychange", () => syncPickerMotion());
  window.addEventListener?.("pinkie:app-foreground", () => syncPickerMotion(true));
  window.addEventListener?.("pinkie:app-background", () => syncPickerMotion(false));
  window.addEventListener?.("focus", () => syncPickerMotion(true));
  window.addEventListener?.("blur", () => syncPickerMotion(null));
  window.addEventListener?.("pageshow", () => syncPickerMotion(null));
  window.addEventListener?.("pinkie:session-selected", syncAllPickers);
  window.addEventListener?.("popstate", syncAllPickers);
  window.addEventListener?.("storage", (event) => {
    if (event.key?.startsWith("laolao:reasoning-enhance:v1:") || event.key?.startsWith("pinkie:effort-choice:v1:")) syncAllPickers();
  });

  scanPickers();
  if (document.body) {
    new MutationObserver((changes) => {
      for (const [details, watcher] of triggerObservers) {
        if (!details.isConnected) {
          watcher.disconnect(); triggerObservers.delete(details); releasePopupLayout(details);
          if (effortTriggers.get(details)?.matches?.(".pinkie-effort-trigger") && effortTriggers.get(details).dataset?.pinkieNativeEffort !== "1") effortTriggers.get(details).remove(); effortTriggers.delete(details);
        } else if (effortTriggers.has(details) && !effortTriggers.get(details).isConnected) syncTrigger(details);
      }
      for (const change of changes) {
        for (const node of change.addedNodes || []) if (node.nodeType === 1) scanPickers(node);
      }
    }).observe(document.body, {childList: true, subtree: true});
  }

  document.addEventListener("pinkie:reasoning-preparing", (event) => {
    const state = event.detail || {};
    let panel = document.getElementById?.("pinkie-reasoning-progress");
    if (state.active) {
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "pinkie-reasoning-progress";
        panel.innerHTML = '<span class="pinkie-reasoning-progress__motion" aria-hidden="true"></span><span class="pinkie-reasoning-progress__text"></span><button type="button" aria-label="取消增强推演">取消</button>';
        panel.querySelector("button").addEventListener("click", () => {
          document.dispatchEvent(new CustomEvent("pinkie:reasoning-cancel", {detail: {sessionKey: panel.dataset.sessionKey, requestId: panel.dataset.requestId}}));
        });
        document.body.append(panel);
      }
      panel.dataset.sessionKey = state.sessionKey || "";
      panel.dataset.requestId = state.requestId || "";
      panel.querySelector(".pinkie-reasoning-progress__text").textContent = state.text || (state.tier === "ultra" ? "Ultra · 交付验收 + 独立复算" : "Max · 交付验收");
      panel.querySelector("button").hidden = state.cancellable === false;
      panel.dataset.phase = state.phase || "";
      panel.hidden = false;
    } else if (panel && (!state.requestId || panel.dataset.requestId === state.requestId)) {
      panel.hidden = true;
    }
  });

  document.addEventListener("input", (event) => {
    const details = isPicker(event.target);
    if (!details) return;
    if (event.target.matches?.(".chat-controls__reasoning-range")) {
      const range = event.target;
      if (range.dataset?.pinkieFallback === "1") {
        if (fallbackStates.get(details)?.switchingModel) {
          event.stopImmediatePropagation?.();
          return;
        }
        const values = String(range.dataset.chatThinkingValues || "").split(",");
        const nativeValues = String(range.dataset.pinkieNativeValues || "").split(",");
        const index = Math.max(0, Math.min(values.length - 1, Math.round(Number(range.value))));
        const tier = values[index];
        const fallback = fallbackStates.get(details);
        const selected = selectionFor(fallback, tier, nativeValues);
        const backendTier = selected.backend, targetModel = familyTargetModel(fallback, tier);
        if (tier === "max" || tier === "ultra") setEnhancement(tier, currentSessionKey(details));
        else setEnhancement("", currentSessionKey(details));
        saveTierChoice({tier,model:selected.model,backend:backendTier}, currentSessionKey(details));
        if (fallback?.session) {
          if (!fallback.previousSession) fallback.previousSession = {...fallback.session};
          fallback.session.thinkingLevel = backendTier;
          if (targetModel) fallback.selectedModel = targetModel;
        }
        syncReasoning(range);
        syncLevelName(details, details.querySelector?.(".chat-controls__inline-select-menu--combined"), range);
        scheduleAutoSave(details, {thinkingLevel: backendTier, ...(targetModel ? {model: targetModel} : {})});
        event.stopImmediatePropagation?.();
        return;
      }
      if (nativeInputEvents.has(range)) return;
      const state = rangeStates.get(range);
      if (state && range.dataset?.pinkieExtended === "1") {
        const index = Math.max(0, Math.min(MATERIALS.length - 1, Math.round(Number(range.value || 0))));
        const tier = MATERIALS[index], nativeValues = state.nativeEncoded.split(",");
        const backend = nativeTierFor(tier, nativeValues);
        const nativeIndex = Math.max(0, nativeValues.indexOf(backend));
        event.stopImmediatePropagation?.();
        setEnhancement(tier === "max" || tier === "ultra" ? tier : "", currentSessionKey(details));
        saveTierChoice({tier,backend}, currentSessionKey(details));
        const nativeChanged = state.nativeValue !== nativeIndex;
        state.nativeValue = nativeIndex;
        // Host handlers must see their own index and enum, never a UI index.
        if (nativeChanged) nativeInputEvents.add(range);
        const encoded = range.dataset.chatThinkingValues;
        try {
          if (nativeChanged) {
            range.dataset.chatThinkingValues = state.nativeEncoded;
            range.value = String(nativeIndex);
            range.dispatchEvent(new Event("input", {bubbles: true}));
          }
        } finally {
          range.dataset.chatThinkingValues = encoded;
          range.value = String(index);
          nativeInputEvents.delete(range);
        }
      }
      syncReasoning(range);
      syncLevelName(details, details.querySelector?.(".chat-controls__inline-select-menu--combined"), range);
      details.toggleAttribute("data-pinkie-max", Boolean(isMax(range)));
      schedule(details);
    }
  }, true);

  /* WebKit sends change after the final pointer/keyboard input. The upstream
     handler indexes only its native options, so never let it read our two
     virtual positions as undefined. The native top step was already sent
     through a real input event above. */
  document.addEventListener("change", (event) => {
    const range = event.target;
    if (!range?.matches?.(".chat-controls__reasoning-range")) return;
    const details = isPicker(range);
    if (!details) return;
    if (range.dataset?.pinkieFallback === "1") {
      event.stopImmediatePropagation?.();
      return;
    }
    const state = rangeStates.get(range);
    if (state && range.dataset?.pinkieExtended === "1") event.stopImmediatePropagation?.();
    const values = String(state?.nativeEncoded || range.dataset?.chatThinkingValues || "").split(",");
    const index = state ? state.nativeValue : Math.round(Number(range.value || 0));
    const thinkingLevel = values[index]?.trim();
    if (thinkingLevel) scheduleAutoSave(details, {thinkingLevel});
  }, true);
})();
