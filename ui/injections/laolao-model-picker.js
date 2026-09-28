/* A compact view over OpenClaw's model picker. When the native catalog goes
   stale, recover from the gateway without reloading the user's chat. */
(() => {
  "use strict";
  if (window.__pinkieCompactModelPicker) return;
  window.__pinkieCompactModelPicker = true;

  let scheduled = false;
  const ENHANCEMENT_KEY = (sessionKey) => `laolao:reasoning-enhance:v1:${sessionKey}`;
  const rangeStates = new WeakMap();
  const pickerStates = new WeakMap();
  const nativeInputEvents = new WeakSet();
  const autoSaveTimers = new WeakMap();
  const pendingPatches = new WeakMap();
  const activeSaves = new WeakMap();
  const triggerObservers = new Map();
  const triggerStates = new WeakMap();
  const stopStates = new WeakMap();
  const pointerToggles = new WeakMap();
  const fallbackStates = new WeakMap();
  const catalogRequests = new Map();

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
      else window.localStorage?.removeItem(ENHANCEMENT_KEY(key));
      return true;
    } catch { return false; }
  }

  const isPicker = (node) => node?.closest?.("details.chat-controls__model");
  const isMax = (range) => range && !range.disabled && Number(range.max) > Number(range.min)
    && Number(range.value) >= Number(range.max);

  /* The upstream slider is not always the same length. Some models expose only
     low/high, while others expose the full off -> ultra ladder. Never infer a
     material from a percentage: use the actual semantic value supplied by the
     model picker so "high" cannot accidentally receive a middle-step skin. */
  const MATERIALS = ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra"];
  const MATERIAL_RANK = new Map(MATERIALS.map((name, index) => [name, index]));
  const LEVEL_LABELS = {off: "关闭", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", adaptive: "Adaptive", max: "Max", ultra: "Ultra"};
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

  const FAMILY_SUFFIX = /-(extra-low|non-reasoning|reasoning|thinking|tiered|adaptive|xhigh|high|medium|low)$/;
  function dynamicFamily(model, catalog) {
    if (model.provider !== "mm") return null;
    const base = model.id.replace(FAMILY_SUFFIX, "");
    const variants = catalog.filter((entry) => entry.provider === model.provider &&
      (entry.id === base || (FAMILY_SUFFIX.test(entry.id) && entry.id.replace(FAMILY_SUFFIX, "") === base)));
    if (variants.length < 2) return null;
    const signature = (entry) => JSON.stringify([entry.input, entry.contextWindow]);
    if (variants.some((entry) => signature(entry) !== signature(variants[0]))) return null;
    const canonical = variants.find((entry) => entry.id === base || entry.id === `${base}-tiered`)?.id
      || variants.find((entry) => entry.id === `${base}-reasoning` || entry.id === `${base}-thinking`)?.id
      || variants.find((entry) => entry.id === `${base}-low`)?.id || variants[0].id;
    const ids = variants.map((entry) => entry.id);
    const byLevel = {};
    const implied = {};
    for (const entry of variants) {
      const suffix = entry.id.slice(base.length + 1);
      if (["extra-low", "low", "medium", "high", "xhigh", "adaptive"].includes(suffix)) {
        const level = suffix === "extra-low" ? "minimal" : suffix;
        byLevel[level] = entry.id;
        implied[entry.id] = level;
      }
      if (suffix === "non-reasoning") byLevel.off = entry.id;
      if (suffix === "reasoning" || suffix === "thinking") {
        for (const level of ["minimal", "low", "medium", "high", "xhigh", "adaptive"]) byLevel[level] ||= entry.id;
      }
    }
    byLevel.off ||= ids.includes(base) ? base : canonical;
    byLevel.max = ids.includes(`${base}-tiered`) ? `${base}-tiered` : canonical;
    byLevel.ultra = byLevel.max;
    const label = variants.find((entry) => entry.id === base)?.name
      || base.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
    return {provider: model.provider, label, canonical, ids, byLevel, implied, dynamic: true};
  }

  function modelFamily(model, catalog) {
    if (!model || !Array.isArray(catalog)) return null;
    const family = MODEL_FAMILIES.find((entry) => entry.provider === model.provider && entry.ids.includes(model.id))
      || dynamicFamily(model, catalog);
    if (!family) return null;
    const variants = catalog.filter((entry) => entry.provider === family.provider && family.ids.includes(entry.id));
    if (variants.length < 2 || !variants.some((entry) => entry.id === family.canonical)) return null;
    const signature = (entry) => JSON.stringify([...(family.dynamic ? [] : [entry.reasoning]), entry.input, entry.contextWindow]);
    if (variants.some((entry) => signature(entry) !== signature(variants[0]))) return null;
    return family;
  }

  function presentationModels(models) {
    const seen = new Set();
    return models.flatMap((model) => {
      const family = modelFamily(model, models);
      if (!family) return [{...model, family: null}];
      const key = `${family.provider}/${family.canonical}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{...model, id: family.canonical, name: family.label, family}];
    });
  }

  function modelBrand(provider, id) {
    const model = String(id || "").toLowerCase().split("/").at(-1);
    const source = String(provider || "").toLowerCase();
    if (/^(?:gemini|gemma|veo)(?:[-_.:]|$)/.test(model)) return "gemini";
    if (/^(?:claude)(?:[-_.:]|$)/.test(model)) return "claude";
    if (/^(?:gpt|codex|o1|o3|o4)(?:[-_.:]|$)/.test(model)) return "codex";
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
    return ({anthropic: "claude", openai: "codex", google: "gemini", xai: "grok",
      deepseek: "deepseek", mistral: "mistral", moonshot: "kimi", alibaba: "alibaba",
      zai: "zai", ollama: "ollama", groq: "groq", minimax: "minimax", doubao: "doubao"})[source] || "crossmodel";
  }

  function syncModelBrands(browser) {
    browser?.querySelectorAll?.("[data-chat-model-option]")?.forEach((option) => {
      const value = option.getAttribute?.("data-chat-model-option") || "";
      const separator = value.indexOf("/");
      const provider = separator < 0 ? "" : value.slice(0, separator);
      const id = separator < 0 ? value : value.slice(separator + 1);
      if (option.dataset) option.dataset.pinkieBrand = modelBrand(provider, id);
    });
  }

  function familyForSession(state) {
    const session = state?.session;
    if (!session?.model) return null;
    return modelFamily({provider: session.modelProvider, id: session.model}, state.models);
  }

  function familyTargetModel(state, level) {
    const family = familyForSession(state);
    if (!family) return "";
    const id = family.byLevel[level] || family.canonical;
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

  function syncStops(slider, values, selectedIndex) {
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
    syncStops(slider, values.length ? values : Array.from({length: count}, (_, index) => String(index)), index);
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
      state = {key, initialTier: selectedEnhancement(key), initialNativeValue: rangeState?.nativeValue ?? Number(range?.value || 0)};
      pickerStates.set(details, state);
    }
    return state;
  }

  function finishPicker(details) {
    const timer = autoSaveTimers.get(details);
    if (timer !== undefined) window.clearTimeout?.(timer);
    autoSaveTimers.delete(details);
    pendingPatches.delete(details);
    const state = pickerStates.get(details);
    if (!state) return;
    if (selectedEnhancement(state.key) !== state.initialTier) setEnhancement(state.initialTier, state.key);
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

  function writeTriggerLabel(label, name, tier) {
    const display = tier ? `${name} · ${LEVEL_LABELS[tier]}` : name;
    const decorated = label.querySelector?.(":scope > .pinkie-external-tier");
    if (label.textContent?.trim() === display && Boolean(decorated) === Boolean(tier)) return display;
    if (!tier || !document.createElement || !document.createTextNode || !label.replaceChildren) {
      label.textContent = display;
      return display;
    }
    const model = document.createElement("span");
    model.className = "pinkie-external-model-name";
    model.textContent = name;
    const level = document.createElement("span");
    level.className = "pinkie-external-tier";
    level.textContent = LEVEL_LABELS[tier];
    level.dataset.pinkieTierLabel = LEVEL_LABELS[tier];
    label.replaceChildren(model, document.createTextNode(" · "), level);
    return display;
  }

  function syncTrigger(details) {
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
    if (text !== state.appliedText) state.nativeText = text;
    if (aria !== state.appliedAria) state.nativeAria = aria;
    const native = splitModelTier(state.nativeText);
    const fallback = fallbackStates.get(details);
    const matchingFallback = fallback?.key === currentSessionKey(details) && fallback.session;
    const fallbackTier = matchingFallback && !fallback.switchingModel && MATERIAL_RANK.has(fallback.session.thinkingLevel)
      ? fallback.session.thinkingLevel : "";
    const tier = selectedEnhancement(currentSessionKey(details)) || fallbackTier
      || (matchingFallback && fallback.switchingModel ? "" : native.tier);
    if (tier) details?.setAttribute?.("data-pinkie-outside-material", tier);
    else details?.removeAttribute?.("data-pinkie-outside-material");
    const base = matchingFallback ? fallback.modelName || native.name : native.name;
    const display = writeTriggerLabel(label, base, tier);
    if (!matchingFallback && !tier) {
      if (state.appliedAria && aria === state.appliedAria) summary.setAttribute("aria-label", state.nativeAria);
      state.appliedText = "";
      state.appliedAria = "";
      return;
    }
    const colon = state.nativeAria.lastIndexOf(":");
    const displayAria = colon >= 0 ? `${state.nativeAria.slice(0, colon + 1)} ${display}` : display;
    if (aria !== displayAria) summary.setAttribute?.("aria-label", displayAria);
    state.appliedText = display;
    state.appliedAria = displayAria;
  }

  function watchPicker(details) {
    if (!details || triggerObservers.has(details)) return;
    const watcher = new MutationObserver(() => {
      syncTrigger(details);
      if (details.open) schedule(details);
    });
    watcher.observe(details, {childList: true, subtree: true, characterData: true});
    triggerObservers.set(details, watcher);
    syncTrigger(details);
    const browser = details.querySelector?.(".chat-controls__model-browser");
    if (browser) ensureFallbackData(details, browser);
  }

  function scanPickers(root = document) {
    if (root.matches?.("details.chat-controls__model")) watchPicker(root);
    root.querySelectorAll?.("details.chat-controls__model")?.forEach(watchPicker);
  }

  function extendNativeRange(range, details) {
    if (!range || range.disabled) return null;
    const encoded = String(range.dataset?.chatThinkingValues || range.getAttribute?.("data-chat-thinking-values") || "");
    let state = rangeStates.get(range);
    if (!state || (encoded !== state.extended && encoded !== state.nativeEncoded)) {
      const values = encoded.split(",").map((value) => value.trim()).filter(Boolean);
      if (values.length < 2 || values.includes("max") || values.includes("ultra")) return null;
      state = {nativeEncoded: encoded, nativeMax: values.length - 1, nativeValue: Number(range.value || 0), extended: `${encoded},max,ultra`};
      rangeStates.set(range, state);
    }
    range.max = String(state.nativeMax + 2);
    range.dataset.chatThinkingValues = state.extended;
    range.dataset.pinkieExtended = "1";
    const tier = selectedEnhancement(currentSessionKey(details));
    if (tier) range.value = String(state.nativeMax + (tier === "max" ? 1 : 2));
    else if (Number(range.value) > state.nativeMax) range.value = String(state.nativeValue);
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
    const caption = `思考等级 · ${name}${range.disabled ? "（暂不可调整）" : ""}`;
    if (label.textContent !== caption) label.textContent = caption;
    range.setAttribute?.("aria-valuetext", material === "max" ? "Max，额外两轮审阅" : material === "ultra" ? "Ultra，额外三轮交叉推演" : name);
    details.dataset.pinkieEnhancement = tier || "off";
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
    pendingPatches.delete(details);
    if (!patch) return activeSaves.get(details) || Promise.resolve(true);
    const key = currentSessionKey(details);
    const agentId = /^agent:([^:]+):/.exec(key)?.[1];
    const prior = activeSaves.get(details) || Promise.resolve(true);
    const save = prior.then(async () => {
      if (!key || currentSessionKey(details) !== key || !details.isConnected) return false;
      const rpc = window.__laolaoSidebar?.gwRequest;
      if (typeof rpc !== "function") throw new Error("连接尚未就绪");
      await rpc("sessions.patch", {key, ...(agentId ? {agentId} : {}), ...patch}, 15_000);
      const fallback = fallbackStates.get(details);
      if (fallback?.key === key) {
        try {
          const listed = await rpc("sessions.list", agentId ? {agentId, limit: 1000} : {limit: 1000}, 15_000);
          fallback.session = listed?.sessions?.find?.((session) => session.key === key) || fallback.session;
          fallback.selectedModel = fallback.session?.model ? `${fallback.session.modelProvider || ""}/${fallback.session.model}` : "";
          fallback.modelName = fallbackModelName(fallback);
          fallback.switchingModel = false;
          fallback.previousSession = null;
          schedule(details);
        } catch {
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
      if (state?.key === key) state.initialTier = selectedEnhancement(key);
      details.querySelector?.(".pinkie-picker-save-error")?.remove?.();
      window.PinkieSessionList?.invalidate?.();
      window.dispatchEvent?.(new Event("laolao:sessions-changed"));
      return true;
    }).catch((error) => {
      const state = pickerStates.get(details);
      if (state?.key === key) setEnhancement(state.initialTier, key);
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

  function scheduleAutoSave(details, patch) {
    if (!details?.open || !patch) return;
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
    const items = presentationModels(state.models);
    const signature = `${items.map((model) => `${model.provider}/${model.id}`).join("|")}:${state.selectedModel || ""}:${state.session?.hasActiveRun ? 1 : 0}`;
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    const fragment = document.createDocumentFragment();
    let previousProvider = "";
    for (const model of items) {
      if (model.provider !== previousProvider) {
        const heading = document.createElement("span");
        heading.className = "pinkie-fallback-provider";
        heading.textContent = model.provider;
        fragment.append(heading);
        previousProvider = model.provider;
      }
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chat-controls__combined-model-option pinkie-fallback-option";
      option.dataset.chatModelOption = `${model.provider}/${model.id}`;
      option.dataset.pinkieBrand = modelBrand(model.provider, model.id);
      if (model.family) option.dataset.pinkieFamily = `${model.family.provider}/${model.family.canonical}`;
      const selected = model.family
        ? model.family.ids.some((id) => state.selectedModel === `${model.provider}/${id}`)
        : option.dataset.chatModelOption === state.selectedModel;
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
    const values = rawLevels
      .map((value) => typeof value === "string" ? value : value?.id)
      .filter((value) => typeof value === "string" && value);
    if (!slider && values.length > 1 && document.createElement) {
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
    if (!slider || values.length < 2 || state.session?.hasActiveRun) {
      slider?.querySelector?.('.chat-controls__reasoning-range[data-pinkie-fallback]')?.remove?.();
      details.removeAttribute?.("data-pinkie-fallback-range");
      if (details.dataset) details.dataset.pinkieNoReasoning = values.length < 2 && !state.session?.hasActiveRun ? "1" : "0";
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
    const tiers = [...values, ...(values.includes("max") ? [] : ["max"]), ...(values.includes("ultra") ? [] : ["ultra"])];
    range.min = "0";
    range.max = String(tiers.length - 1);
    range.step = "1";
    range.dataset.chatThinkingValues = tiers.join(",");
    range.dataset.pinkieNativeValues = values.join(",");
    const enhanced = selectedEnhancement(state.key);
    const family = familyForSession(state);
    const selected = enhanced || state.session?.thinkingLevel || family?.implied[state.session?.model]
      || state.session?.thinkingDefault || values[0];
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
      state = {key, models: [], session: null, selectedModel: "", modelName: "", loading: false};
      fallbackStates.set(details, state);
    }
    details.dataset.pinkieFallback = "1";
    if (!state.loading && !state.models.length && (!state.failedAt || Date.now() - state.failedAt > 10_000)) {
      const rpc = window.__laolaoSidebar?.gwRequest;
      if (typeof rpc === "function") {
        state.loading = true;
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

  function sync(details) {
    syncTrigger(details);
    if (!details?.isConnected || !details.open) {
      if (details && !details.open) finishPicker(details);
      details?.removeAttribute("data-pinkie-max");
      return;
    }
    const menu = details.querySelector(".chat-controls__inline-select-menu--combined");
    const nativeRange = menu?.querySelector('.chat-controls__reasoning-range:not([data-pinkie-fallback])')
      || menu?.querySelector('.chat-controls__reasoning-range');
    const browser = menu?.querySelector(".chat-controls__model-browser");
    if (!menu || !browser) return;
    const fallback = ensureFallbackData(details, browser);
    syncModelBrands(browser);
    if (!fallback) extendNativeRange(nativeRange, details);
    const fallbackRange = fallback?.session ? ensureFallbackRange(details, menu, fallback) : null;
    const visibleRange = fallbackRange || nativeRange;
    syncReasoning(visibleRange);

    watchPicker(details);

    if (!details.hasAttribute("data-pinkie-models-open")) details.dataset.pinkieModelsOpen = "0";
    details.dataset.pinkieEnhanced = "1";
    warmFrames();
    if (fallback?.session && (fallback.session.thinkingOptions || []).length < 2 && !fallback.session.hasActiveRun) {
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
    if (!details?.matches?.("details.chat-controls__model")) return;
    watchPicker(details);
    if (!details.open) {
      finishPicker(details);
      details.removeAttribute("data-pinkie-models-open");
      details.removeAttribute("data-pinkie-max");
    } else schedule(details);
  }, true);

  document.addEventListener("click", (event) => {
    const details = isPicker(event.target);
    if (!details) {
      for (const picker of triggerObservers.keys()) {
        if (picker.open && !picker.contains?.(event.target)) closePicker(picker);
      }
      return;
    }
    const summary = event.target.closest?.(".chat-controls__inline-select-trigger");
    if (summary?.parentElement === details && details.open) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      closePicker(details);
      return;
    }
    const button = event.target.closest?.(".pinkie-model-current");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() - (pointerToggles.get(details) || 0) < 600) return;
      details.dataset.pinkieModelsOpen = details.dataset.pinkieModelsOpen === "1" ? "0" : "1";
      sync(details);
      if (details.dataset.pinkieModelsOpen === "1") refreshFallbackCatalog(details);
      return;
    }
    const modelOption = event.target.closest?.("[data-chat-model-option]");
    if (modelOption) {
      if (modelOption.classList?.contains?.("pinkie-fallback-option")) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
      details.dataset.pinkieModelsOpen = "0";
      if (!modelOption.disabled && modelOption.getAttribute?.("aria-selected") !== "true") {
        setEnhancement("", currentSessionKey(details));
        pendingPatches.delete(details);
        if (modelOption.classList?.contains?.("pinkie-fallback-option")) {
          const fallback = fallbackStates.get(details);
          const value = modelOption.getAttribute("data-chat-model-option");
          if (fallback) {
            fallback.selectedModel = value;
            fallback.switchingModel = true;
            const family = presentationModels(fallback.models).find((entry) =>
              `${entry.family?.provider}/${entry.family?.canonical}` === modelOption.dataset?.pinkieFamily)?.family;
            const selected = fallback.models.find((model) => `${model.provider}/${model.id}` === value);
            fallback.modelName = family?.label || selected?.name || selected?.id || value;
          }
        }
        scheduleAutoSave(details, {
          model: modelOption.getAttribute("data-chat-model-option") || null,
          ...(modelOption.dataset?.pinkieFamily ? {thinkingLevel: null} : {}),
        });
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
  window.addEventListener?.("pinkie:session-selected", syncAllPickers);
  window.addEventListener?.("popstate", syncAllPickers);
  window.addEventListener?.("storage", (event) => {
    if (event.key?.startsWith("laolao:reasoning-enhance:v1:")) syncAllPickers();
  });

  scanPickers();
  if (document.body) {
    new MutationObserver((changes) => {
      for (const [details, watcher] of triggerObservers) {
        if (!details.isConnected) { watcher.disconnect(); triggerObservers.delete(details); }
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
      panel.querySelector(".pinkie-reasoning-progress__text").textContent = state.tier === "ultra" ? "Ultra · 交叉推演中" : "Max · 复核中";
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
        const virtualTier = (tier === "max" || tier === "ultra") && !nativeValues.includes(tier);
        const backendTier = virtualTier ? nativeValues.at(-1) : tier;
        if (virtualTier) setEnhancement(tier, currentSessionKey(details));
        else setEnhancement("", currentSessionKey(details));
        const fallback = fallbackStates.get(details);
        const targetModel = familyTargetModel(fallback, tier);
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
        const index = Math.round(Number(range.value || 0));
        if (index > state.nativeMax) {
          event.stopImmediatePropagation?.();
          setEnhancement(index === state.nativeMax + 1 ? "max" : "ultra", currentSessionKey(details));
          if (state.nativeValue !== state.nativeMax) {
            range.value = String(state.nativeMax);
            nativeInputEvents.add(range);
            try { range.dispatchEvent(new Event("input", {bubbles: true})); }
            finally { nativeInputEvents.delete(range); }
            state.nativeValue = state.nativeMax;
          }
          range.value = String(index);
        } else {
          state.nativeValue = index;
          setEnhancement("", currentSessionKey(details));
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
    if (state && Number(range.value) > state.nativeMax) event.stopImmediatePropagation?.();
    const values = String(state?.nativeEncoded || range.dataset?.chatThinkingValues || "").split(",");
    const index = state ? state.nativeValue : Math.round(Number(range.value || 0));
    const thinkingLevel = values[index]?.trim();
    if (thinkingLevel) scheduleAutoSave(details, {thinkingLevel});
  }, true);
})();
