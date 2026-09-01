/* 超級碧琪 · 四模式与派对共用的累计用量胶囊
   派对 /api/usage 与四模式 laolao-stats.json 共用本机 SQLite 累计计数。
   配额来自接口本地缓存；累计估算费用不是账户余额。旧版数据保留兼容读取。
   特效：任一数值上涨时对应胶囊脉冲一次。 */
(() => {
  "use strict";

  /* 仅兼容旧版统计的展示系数，不是模型真实单价；新版优先显示统计源估算。 */
  const PRICING = {
    default: { input: 0.2, output: 1.5, cacheRead: 0.02, cacheWrite: 0 },
  };
  const REFRESH_MS = 15000;

  const $sidebar = () => window.__laolaoSidebar;

  const fmtTok = (n) => {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  };
  const fmtCost = (usd) => "$" + (usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4));

  const pricingEnabled = Object.values(PRICING).some(
    (p) => p.input > 0 || p.output > 0 || p.cacheRead > 0 || p.cacheWrite > 0
  );

  /* ---------- 数据 ---------- */
  let view = null; // {input, output, cacheRead, quota, quotaNote, requests, successRate, source}
  let refreshing = false;

  const num = (v) => (Number.isFinite(v) ? v : 0);
  const pick = (s, keys) => {
    for (const k of keys) if (Number.isFinite(s[k])) return s[k];
    return null;
  };

  async function fetchJson(path) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const stats = await fetchJson(document.getElementById('party-usage') ? '/api/usage' : './laolao-stats.json');
      if (stats && (stats.scope === 'lifetime' || Number.isFinite(stats.input))) {
        view = {
          input: Number.isFinite(stats.input) ? stats.input : null,
          output: Number.isFinite(stats.output) ? stats.output : null,
          cacheRead: Number.isFinite(stats.cacheRead) ? stats.cacheRead : null,
          cacheWrite: Number.isFinite(stats.cacheWrite) ? stats.cacheWrite : null,
          cost: Number.isFinite(stats.cost) ? stats.cost : null,
          persistent: stats.scope === 'lifetime',
          costNote: stats.costNote || '按内置展示系数估算，不是实际账单或余额',
          stale: !!stats.stale,
          sourceUpdatedAt: stats.sourceUpdatedAt,
          quota: stats.quota || null,
          quotaNote: stats.quotaNote || "",
          requests: stats.requests || null,
          successRate: stats.successRate ?? null,
          source: stats.source || (stats.scope === "daily" ? "今日 · C.le 本地统计" : "累计 · C.le 本地统计"),
        };
      } else {
        const [quotaFile, payload] = await Promise.all([
          fetchJson("./laolao-quota.json"),
          $sidebar() ? $sidebar().gwRequest("sessions.list", { limit: 1000 }) : null,
        ]);
        const arr = (payload && (payload.sessions || payload.items)) || [];
        let input = 0, output = 0, cacheRead = 0, hasCache = false;
        for (const s of arr) {
          input += num(s.inputTokens ?? s.input);
          output += num(s.outputTokens ?? s.output);
          const cr = pick(s, ["cacheRead", "cacheReadTokens", "cache_read_input_tokens"]);
          if (cr != null) hasCache = true;
          cacheRead += num(cr);
        }
        view = {
          input, output,
          cacheRead: hasCache ? cacheRead : null,
          quota: quotaFile && quotaFile.value && !/示例/.test(quotaFile.note || '') ? String(quotaFile.value) : null,
          quotaNote: (quotaFile && quotaFile.note) || "",
          requests: null, successRate: null,
          source: "累计 · 网关会话",
        };
      }
      render();
    } catch {} finally { refreshing = false; }
  }

  function costOf(v) {
    if (v.persistent) return v.cost;
    if (Number.isFinite(v.cost)) return v.cost;
    if (!pricingEnabled) return null;
    const p = PRICING.default;
    return (v.input / 1e6) * p.input + (v.output / 1e6) * p.output
         + (num(v.cacheRead) / 1e6) * p.cacheRead;
  }

  /* ---------- UI ---------- */
  let wrap = null;
  let chips = null; // [{el, labelEl, valueEl, key}]
  let liveActive = false; // 模型正在思考/输出（发送按钮变成停止键时为真）
  const prevRaw = {};

  function syncLive() {
    const live = Boolean(document.querySelector(".chat-send-btn--stop, #jobs .job"));
    if (live === liveActive) return;
    liveActive = live;
    if (wrap) wrap.classList.toggle("laolao-usage--live", live);
  }

  const CHIP_DEFS = [
    { key: "input", label: "输入" },
    { key: "output", label: "输出" },
    { key: "cacheRead", label: "缓存读", naWhenNull: true },
    { key: "cacheWrite", label: "缓存写", naWhenNull: true },
    { key: "quota", label: "额度", cls: "laolao-usage__chip--quota", naWhenNull: true },
    { key: "cost", label: "累计估算", cls: "laolao-usage__chip--cost", naWhenNull: true },
  ];

  function ensureChips() {
    const header = document.getElementById('party-usage') || document.querySelector(".dashboard-header");
    if (!header) return null;
    if (wrap && wrap.isConnected && header.contains(wrap) && chips) return chips;
    wrap = document.createElement("div");
    wrap.className = "laolao-usage";
    wrap.classList.toggle("laolao-usage--live", liveActive);
    header.appendChild(wrap);
    chips = CHIP_DEFS.map((def) => {
      const el = document.createElement("span");
      el.className = "laolao-usage__chip" + (def.cls ? " " + def.cls : "");
      const labelEl = document.createElement("span");
      labelEl.className = "laolao-usage__label";
      labelEl.textContent = def.label;
      const valueEl = document.createElement("span");
      valueEl.className = "laolao-usage__value";
      el.appendChild(labelEl);
      el.appendChild(document.createTextNode(" "));
      el.appendChild(valueEl);
      wrap.appendChild(el);
      return { el, valueEl, key: def.key, def };
    });
    return chips;
  }

  function pulse(el) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (el.closest?.(".laolao-usage--live")) return;
    el.__pinkieUsagePulse?.cancel?.();
    if (typeof el.animate !== "function") return;
    el.__pinkieUsagePulse = el.animate([
      { transform: "scale(1)" },
      {
        transform: "scale(1.18)",
        background: "var(--accent, #e94f91)",
        color: "#ffffff",
        boxShadow: "0 0 0 4px var(--accent-glow, rgba(233, 79, 145, 0.2))",
        offset: 0.35,
      },
      { transform: "scale(1)" },
    ], { duration: 600, easing: "ease-out" });
  }

  function render() {
    const list = ensureChips();
    if (!list || !view) return;

    const cost = costOf(view);
    const values = {
      input: { text: fmtTok(view.input), raw: view.input },
      output: { text: fmtTok(view.output), raw: view.output },
      cacheRead: { text: view.cacheRead != null ? fmtTok(view.cacheRead) : "—", raw: view.cacheRead },
      cacheWrite: { text: fmtTok(view.cacheWrite), raw: view.cacheWrite },
      quota: { text: view.quota || "—", raw: view.quota },
      cost: { text: cost != null ? fmtCost(cost) : "—", raw: cost },
    };

    for (const c of list) {
      const v = values[c.key];
      if (!v) continue;
      const prev = prevRaw[c.key];
      const increased =
        typeof v.raw === "number" && typeof prev === "number" && v.raw > prev;
      const changed = c.valueEl.textContent !== v.text;
      if (changed) c.valueEl.textContent = v.text;
      if (increased || (changed && c.key === "quota" && prev != null && prev !== v.raw)) {
        pulse(c.el.closest ? c.el : c.el);
      }
      if (c.def.naWhenNull) {
        c.el.classList.toggle("laolao-usage__chip--na", v.raw == null);
      }
      prevRaw[c.key] = v.raw;
    }

    wrap.title = [
      `${view.source}：输入 ${fmtTok(view.input)} · 输出 ${fmtTok(view.output)}` +
        (view.cacheRead != null ? ` · 缓存读 ${fmtTok(view.cacheRead)}` : ""),
      view.requests != null
        ? `请求 ${view.requests} 次` + (view.successRate != null ? ` · 成功率 ${view.successRate}%` : "")
        : null,
      view.quota ? `上游额度 ${view.quota}${view.quotaNote ? "（" + view.quotaNote + "）" : ""}` : "上游额度未知",
      cost != null ? `累计估算 ${fmtCost(cost)}（${view.costNote || '按内置展示系数计算，不是实际账单'}）` : "费用未知，不虚构金额",
      view.persistent ? '累计记录保存在本机，重启不清零；重复刷新不重复累加。' : null,
      view.stale ? '统计源暂不可用，显示最后保存的累计值。' : null,
      view.sourceUpdatedAt ? '统计源更新时间：'+new Date(view.sourceUpdatedAt).toLocaleString() : null,
    ].filter(Boolean).join("\n");
  }

  /* ---------- 启动 ---------- */
  window.__laolaoUsage = {
    refresh,
    render,
    get view() { return view; },
    get chips() { return chips; },
  };

  function boot() {
    if (!document.getElementById('party-usage') && !$sidebar()) return setTimeout(boot, 500);

    setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });

    // header 可能被 Lit 重渲染掉：observer 调 render 重建并回填数值。
    // render 只在内容变化时写 DOM，写完后 mutation 再触发 render 也是空操作，不会死循环。
    // class 变化也要盯：发送键 ⇄ 停止键的切换是流式状态信号（syncLive）。
    new MutationObserver(() => { render(); syncLive(); }).observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["class"],
    });

    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
