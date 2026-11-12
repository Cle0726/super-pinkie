/* 进阶调节 · one versioned config for every built-in "saving" limit.
 *
 * Stored in localStorage["pinkie.tuning.v1"] as
 *   {version: 1, level: "saver" | "standard" | "max", values: {key: value}}
 * `values` holds only the controls the user changed by hand; everything else
 * comes from the chosen level. The "standard" level is empty on purpose, so a
 * user who never opens the page gets exactly the numbers each script passes as
 * its own fallback — nothing changes for them.
 *
 * Scripts read a value at the moment they use it:
 *   window.PinkieTuning.get("history.maxChars", 240000)
 * and may listen for "pinkie:tuning-change" to apply a change right away.
 *
 * No hardware, GPU, memory or OS flag is ever consulted here: effects look the
 * same on every machine unless the user picks something on the page.
 *
 * 自动减负 (laolao-rest.js) may lay a temporary "ease" overlay on top while the
 * page is measurably dropping frames. It is not a hardware guess: it comes from
 * frame times actually observed, steps back up when they recover, only applies
 * on the untouched 标准 level, never beats a control the user set by hand, and
 * can be switched off on the page (`auto: false` in the stored config).
 * Must load right after laolao-motion-preference.js, before any other injection. */
(() => {
  "use strict";
  if (window.PinkieTuning) return;
  const KEY = "pinkie.tuning.v1";
  const VERSION = 1;

  // [key, default (today's hard-coded number), saver, max, allowed options]
  // Defaults must match the constants in the scripts that read them;
  // tests/tuning.test.cjs checks every pair.
  const SPEC = [
    ["effects.ambientFps", 30, 20, 60, [20, 30, 60]],
    ["effects.particles", 1, 0.5, 2, [0.5, 1, 1.5, 2]],
    ["render.pixelRatio", "standard", "low", "native", ["low", "standard", "native"]],
    ["history.liveWindow", 512, 256, 2000, [256, 512, 1000, 2000]],
    ["history.pageSize", 128, 64, 500, [64, 128, 256, 500]],
    ["history.scanPages", 12, 6, 24, [6, 12, 24, 48]],
    ["history.maxChars", 240000, 120000, 500000, [120000, 240000, 500000]],
    ["process.maxCards", 80, 40, 300, [40, 80, 150, 300]],
    ["process.maxText", 8000, 4000, 50000, [4000, 8000, 20000, 50000]],
    ["warmup.idleRoutes", 3, 1, 6, [0, 1, 3, 6]],
    ["warmup.maxRoutes", 8, 4, 16, [4, 8, 16]],
    ["ink.scale", 1, 0.5, 3, [0.5, 1, 2, 3]],
  ];
  const LEVELS = ["saver", "standard", "max"];
  const DEFAULTS = Object.freeze(Object.fromEntries(SPEC.map(([k, d]) => [k, d])));
  const OPTIONS = Object.freeze(Object.fromEntries(SPEC.map(([k, , , , o]) => [k, Object.freeze(o.slice())])));
  const PRESETS = Object.freeze({
    saver: Object.freeze(Object.fromEntries(SPEC.map(([k, , s]) => [k, s]))),
    standard: Object.freeze({}),
    max: Object.freeze(Object.fromEntries(SPEC.map(([k, , , m]) => [k, m]))),
  });

  const valid = (key, value) => Object.prototype.hasOwnProperty.call(OPTIONS, key)
    && OPTIONS[key].some((option) => option === value);
  const clean = (raw) => {
    const out = {version: VERSION, level: "standard", values: {}, auto: true};
    if (!raw || typeof raw !== "object" || raw.version !== VERSION) return out;
    if (LEVELS.includes(raw.level)) out.level = raw.level;
    if (raw.auto === false) out.auto = false;
    if (raw.values && typeof raw.values === "object") {
      for (const [key, value] of Object.entries(raw.values)) if (valid(key, value)) out.values[key] = value;
    }
    return out;
  };
  const load = () => {
    try { return clean(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return clean(null); }
  };
  let config = load();

  const emit = (keys) => {
    try { window.dispatchEvent(new CustomEvent("pinkie:tuning-change", {detail: {keys, level: config.level}})); } catch {}
  };
  const save = (next) => {
    const before = snapshot();
    config = clean(next);
    try {
      if (config.level === "standard" && !Object.keys(config.values).length && config.auto) localStorage.removeItem(KEY);
      // `auto` is written only when switched off, so configs saved before it existed stay byte-identical.
      else localStorage.setItem(KEY, JSON.stringify(config.auto ? {version: config.version, level: config.level, values: config.values} : config));
    } catch {}
    const after = snapshot();
    emit(Object.keys(after).filter((key) => after[key] !== before[key]));
  };

  // 自动减负's temporary overlay: {key: value}, set by laolao-rest.js, never stored.
  let ease = {};
  const easeApplies = (key) => config.auto && config.level === "standard"
    && Object.prototype.hasOwnProperty.call(ease, key)
    && !Object.prototype.hasOwnProperty.call(config.values, key);

  // What a script should use; `fallback` is the script's own constant.
  const get = (key, fallback) => {
    if (Object.prototype.hasOwnProperty.call(config.values, key)) return config.values[key];
    if (easeApplies(key)) return ease[key];
    const preset = PRESETS[config.level];
    if (preset && Object.prototype.hasOwnProperty.call(preset, key)) return preset[key];
    return fallback !== undefined ? fallback : DEFAULTS[key];
  };
  const snapshot = () => Object.fromEntries(SPEC.map(([key, d]) => [key, get(key, d)]));
  const num = (key, fallback) => {
    const value = Number(get(key, fallback));
    return Number.isFinite(value) ? value : fallback;
  };

  // Canvas resolution. "standard" keeps each canvas's own cap; "native" uses the
  // screen's real density; "low" draws at 1×. Same answer on every machine for
  // the same choice — the screen's density is the only input.
  const pixelRatio = (cap = 2) => {
    const device = Number(window.devicePixelRatio) || 1;
    const mode = get("render.pixelRatio", "standard");
    if (mode === "low") return 1;
    if (mode === "native") return Math.max(1, device);
    return Math.min(cap, device);
  };

  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    const before = snapshot();
    config = load();
    const after = snapshot();
    emit(Object.keys(after).filter((key) => after[key] !== before[key]));
  });

  window.PinkieTuning = Object.freeze({
    KEY, VERSION, LEVELS, DEFAULTS, OPTIONS, PRESETS,
    get, num, pixelRatio, snapshot,
    get level() { return config.level; },
    get overrides() { return {...config.values}; },
    // 自动减负: on unless the user switched it off. The overlay only ever holds
    // values from the same OPTIONS lists, and only ones at or below the default.
    get auto() { return config.auto; },
    get easing() { return Object.fromEntries(Object.keys(ease).filter(easeApplies).map((key) => [key, ease[key]])); },
    setAuto(on) { save({version: VERSION, level: config.level, values: config.values, auto: Boolean(on)}); },
    setEase(next) {
      const before = snapshot();
      const cleaned = {};
      for (const [key, value] of Object.entries(next && typeof next === "object" ? next : {})) {
        if (!valid(key, value)) continue;
        const options = OPTIONS[key];
        if (options.indexOf(value) <= options.indexOf(DEFAULTS[key])) cleaned[key] = value;
      }
      ease = cleaned;
      const after = snapshot();
      const keys = Object.keys(after).filter((key) => after[key] !== before[key]);
      if (keys.length) emit(keys);
      return keys;
    },
    // Pick a level; hand-made changes are cleared so the level reads cleanly.
    setLevel(level) {
      if (!LEVELS.includes(level)) return;
      save({version: VERSION, level, values: {}, auto: config.auto});
    },
    // Change one control. Picking the level's own value drops the override.
    set(key, value) {
      if (!valid(key, value)) return false;
      const values = {...config.values};
      const preset = PRESETS[config.level];
      const levelValue = Object.prototype.hasOwnProperty.call(preset, key) ? preset[key] : DEFAULTS[key];
      if (value === levelValue) delete values[key];
      else values[key] = value;
      save({version: VERSION, level: config.level, values, auto: config.auto});
      return true;
    },
    reset() { save({version: VERSION, level: "standard", values: {}, auto: true}); },
  });
})();
