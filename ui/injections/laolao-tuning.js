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
    const out = {version: VERSION, level: "standard", values: {}};
    if (!raw || typeof raw !== "object" || raw.version !== VERSION) return out;
    if (LEVELS.includes(raw.level)) out.level = raw.level;
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
      if (config.level === "standard" && !Object.keys(config.values).length) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(config));
    } catch {}
    const after = snapshot();
    emit(Object.keys(after).filter((key) => after[key] !== before[key]));
  };

  // What a script should use; `fallback` is the script's own constant.
  const get = (key, fallback) => {
    if (Object.prototype.hasOwnProperty.call(config.values, key)) return config.values[key];
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
    // Pick a level; hand-made changes are cleared so the level reads cleanly.
    setLevel(level) {
      if (!LEVELS.includes(level)) return;
      save({version: VERSION, level, values: {}});
    },
    // Change one control. Picking the level's own value drops the override.
    set(key, value) {
      if (!valid(key, value)) return false;
      const values = {...config.values};
      const preset = PRESETS[config.level];
      const levelValue = Object.prototype.hasOwnProperty.call(preset, key) ? preset[key] : DEFAULTS[key];
      if (value === levelValue) delete values[key];
      else values[key] = value;
      save({version: VERSION, level: config.level, values});
      return true;
    },
    reset() { save({version: VERSION, level: "standard", values: {}}); },
  });
})();
