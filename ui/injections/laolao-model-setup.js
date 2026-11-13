/* 小白配模型（设定防护 B）：设置里的「模型服务」卡片 + 没有可用模型时主界面的引导。
 * 后端：services/mode-architecture/model-setup.mjs（pinkie.modelSetup.*）。
 * 密钥只在输入框里出现一次，发给本机网关保存；之后界面只显示末四位。 */
(() => {
  "use strict";
  if (window.__pinkieModelSetup) return;
  const FOCUS_FLAG = "pinkie-model-setup-focus";
  const DISMISS_FLAG = "pinkie-model-setup-later";
  const rpc = () => window.__laolaoSidebar?.gwRequest;
  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.appendChild(node);
    return node;
  };
  const btn = (label, className, parent, onClick) => {
    const node = el("button", className, parent, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };
  const B = "pinkie-user-settings__button";
  const plainError = (error) => {
    const text = String(error?.message || error || "");
    return /[㐀-鿿]/.test(text) ? text.replace(/^Error:\s*/, "") : "操作没有完成，请稍后重试。";
  };
  async function call(method, params = {}, timeout = 20000) {
    const request = rpc();
    if (typeof request !== "function") throw new Error("还没连上碧琪，请稍等几秒再试。");
    return request(method, params, timeout);
  }

  const state = {card: null, list: null, wizard: null, status: null, presets: [], data: null};

  function setStatus(text, tone = "") {
    if (!state.status) return;
    state.status.textContent = text || "";
    state.status.dataset.tone = tone;
    state.status.hidden = !text;
  }

  function renderList() {
    const host = state.list;
    if (!host) return;
    host.replaceChildren();
    const rows = state.data?.providers || [];
    if (!rows.length) {
      el("p", "pinkie-model-setup__empty", host, "还没有接上任何服务商。点「添加服务商」，选一家、粘贴密钥就行。");
      return;
    }
    for (const row of rows) {
      const item = el("div", "pinkie-model-setup__provider", host);
      item.dataset.enabled = String(row.enabled);
      const copy = el("div", "pinkie-model-setup__provider-copy", item);
      const title = el("div", "pinkie-model-setup__provider-title", copy, row.label);
      if (row.isDefault) el("span", "pinkie-model-setup__badge pinkie-model-setup__badge--default", title, "默认");
      if (!row.enabled) el("span", "pinkie-model-setup__badge", title, "已停用");
      if (!row.managed) el("span", "pinkie-model-setup__badge", title, "本机已有");
      const meta = [row.modelCount ? `${row.modelCount} 个模型` : "", row.keyTail ? `密钥 ${row.keyTail}` : (row.hasKey ? "" : "没有密钥")].filter(Boolean).join(" · ");
      el("div", "pinkie-model-setup__provider-meta", copy, meta);
      if (!row.managed) continue;
      const actions = el("div", "pinkie-model-setup__provider-actions", item);
      if (row.enabled) btn("编辑", `${B} ${B}--small`, actions, () => openWizard(row));
      btn(row.enabled ? "停用" : "启用", `${B} ${B}--small`, actions, () => act(row.enabled ? "disable" : "enable", row));
      btn("删除", `${B} ${B}--small pinkie-model-setup__danger`, actions, () => {
        if (window.confirm(`删除「${row.label}」？它的密钥也会从这台电脑上删掉。`)) act("remove", row);
      });
    }
  }

  async function act(method, row) {
    setStatus("正在处理…");
    try {
      state.data = await call(`pinkie.modelSetup.${method}`, {providerId: row.id});
      renderList();
      setStatus({disable: "已停用。", enable: "已重新启用。", remove: "已删除。"}[method], "success");
    } catch (error) { setStatus(plainError(error), "error"); }
  }

  async function refresh() {
    try {
      const [presets, data] = await Promise.all([state.presets.length ? {presets: state.presets} : call("pinkie.modelSetup.presets"), call("pinkie.modelSetup.list")]);
      state.presets = presets.presets || [];
      state.data = data;
      renderList();
      if (data.needsSetup && !state.wizard?.isConnected) openWizard();
    } catch (error) { setStatus(`暂时读不到模型服务：${plainError(error)}`, "error"); }
  }

  function closeWizard() { state.wizard?.remove(); state.wizard = null; }

  function openWizard(editing = null) {
    closeWizard();
    const wizard = state.wizard = el("div", "pinkie-model-setup__wizard", null);
    state.list.after(wizard);
    const preset = editing ? state.presets.find((p) => p.id === editing.preset) : null;
    if (preset) return renderForm(wizard, preset, editing);
    el("div", "pinkie-model-setup__step", wizard, "第 1 步 · 选一家服务商");
    const grid = el("div", "pinkie-model-setup__grid", wizard);
    for (const item of state.presets) {
      const card = btn("", "pinkie-model-setup__preset", grid, () => renderForm(wizard, item, null));
      el("span", "pinkie-model-setup__preset-name", card, item.label);
      el("span", "pinkie-model-setup__preset-tag", card, item.region === "cn" ? "国内" : item.region === "intl" ? "国外 · 可能要代理" : "自己填地址");
    }
    const foot = el("div", "pinkie-user-settings__actions", wizard);
    btn("取消", `${B}`, foot, closeWizard);
    wizard.scrollIntoView?.({block: "nearest", behavior: "smooth"});
  }

  function renderForm(wizard, preset, editing) {
    wizard.replaceChildren();
    el("div", "pinkie-model-setup__step", wizard, editing ? `编辑 · ${editing.label}` : `第 2 步 · ${preset.label}`);
    if (preset.steps?.length) {
      const help = el("div", "pinkie-model-setup__help", wizard);
      const ol = el("ol", "", help);
      for (const step of preset.steps) el("li", "", ol, step);
      if (preset.keyUrl) {
        const link = el("a", "pinkie-model-setup__link", help, "去拿密钥 ↗");
        link.href = preset.keyUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
      }
    }
    const field = (label, input) => { const wrap = el("label", "pinkie-model-setup__field", wizard); el("span", "", wrap, label); wrap.appendChild(input); return input; };
    const name = field("名字（可不改）", el("input", "pinkie-model-setup__input"));
    name.value = editing?.label || preset.label; name.maxLength = 40;
    let baseUrl = null;
    if (preset.id === "custom" || editing) {
      baseUrl = field("接口地址", el("input", "pinkie-model-setup__input"));
      baseUrl.placeholder = "https://…/v1"; baseUrl.value = editing?.baseUrl || preset.baseUrl || ""; baseUrl.spellcheck = false;
    }
    const key = field(editing ? "密钥（不改就留空）" : "密钥", el("input", "pinkie-model-setup__input"));
    key.type = "password"; key.autocomplete = "off"; key.spellcheck = false;
    key.placeholder = editing ? `现在的密钥 ${editing.keyTail || ""}` : "把复制的密钥粘贴到这里";
    const actions = el("div", "pinkie-user-settings__actions", wizard);
    const testButton = btn("测试连接", `${B} ${B}--primary`, actions, () => runTest());
    btn("返回", `${B}`, actions, () => (editing ? closeWizard() : openWizard()));
    const result = el("p", "pinkie-model-setup__result", wizard); result.hidden = true;
    const pick = el("div", "pinkie-model-setup__pick", wizard); pick.hidden = true;
    const show = (text, tone) => { result.textContent = text; result.dataset.tone = tone; result.hidden = !text; };
    const params = () => ({preset: preset.id, providerId: editing?.id, apiKey: key.value, baseUrl: baseUrl?.value || undefined});
    let tested = null;

    async function runTest() {
      if (!key.value.trim() && !editing) { show("先粘贴密钥。", "error"); key.focus(); return; }
      testButton.disabled = true; show("正在连接…", "");
      try {
        const res = await call("pinkie.modelSetup.test", params(), 45000);
        if (!res.ok) { show(res.message, "error"); pick.hidden = true; return; }
        tested = res; show(res.message, "success"); renderPick(res);
      } catch (error) { show(plainError(error), "error"); }
      finally { testButton.disabled = false; }
    }

    function renderPick(res) {
      pick.replaceChildren(); pick.hidden = false;
      el("div", "pinkie-model-setup__step", pick, "第 3 步 · 勾选要用的模型");
      const already = new Set((editing?.models || []).map((m) => m.id));
      const recommended = new Set(res.recommended || []);
      const all = res.models.length ? res.models : (res.recommended || []).map((id) => ({id, name: id}));
      all.sort((a, b) => Number(recommended.has(b.id)) - Number(recommended.has(a.id)));
      let filter = null;
      if (all.length > 12) { filter = el("input", "pinkie-model-setup__input pinkie-model-setup__filter", pick); filter.placeholder = `搜索 ${all.length} 个模型`; }
      const box = el("div", "pinkie-model-setup__models", pick);
      const checks = [];
      for (const model of all) {
        const label = el("label", "pinkie-model-setup__model", box);
        const check = el("input", "", label); check.type = "checkbox"; check.value = model.id;
        check.checked = already.size ? already.has(model.id) : recommended.has(model.id) || (!recommended.size && checks.length < 3);
        el("span", "", label, model.name && model.name !== model.id ? `${model.name}（${model.id}）` : model.id);
        if (recommended.has(model.id)) el("span", "pinkie-model-setup__badge", label, "推荐");
        check.addEventListener("change", syncDefault);
        checks.push(check);
      }
      if (preset.id === "custom" || !all.length) {
        const manual = el("input", "pinkie-model-setup__input", pick); manual.placeholder = "列表里没有？手动填模型名，回车添加";
        manual.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || !manual.value.trim()) return;
          all.push({id: manual.value.trim(), name: manual.value.trim()}); renderPick({...res, models: all}); });
      }
      filter?.addEventListener("input", () => { const q = filter.value.trim().toLowerCase(); for (const c of checks) c.parentElement.hidden = q && !c.value.toLowerCase().includes(q); });
      const defRow = el("label", "pinkie-model-setup__field", pick);
      el("span", "", defRow, "默认模型");
      const select = el("select", "pinkie-model-setup__input", defRow);
      const everywhereRow = el("label", "pinkie-model-setup__model", pick);
      const everywhere = el("input", "", everywhereRow); everywhere.type = "checkbox"; everywhere.checked = true;
      el("span", "", everywhereRow, "聊天、项目、想法、学习四个模式都用它（之后可在模型匣里单独换）");
      function syncDefault() {
        const keep = select.value;
        select.replaceChildren();
        el("option", "", select, "不改默认模型").value = "";
        for (const c of checks.filter((c) => c.checked)) el("option", "", select, c.value).value = c.value;
        select.value = [...select.options].some((o) => o.value === keep) ? keep : (state.data?.needsSetup || !state.data?.defaultModel ? (checks.find((c) => c.checked)?.value || "") : "");
      }
      syncDefault();
      const saveRow = el("div", "pinkie-user-settings__actions", pick);
      const save = btn("保存", `${B} ${B}--primary`, saveRow, async () => {
        const models = checks.filter((c) => c.checked).map((c) => ({id: c.value, name: all.find((m) => m.id === c.value)?.name}));
        if (!models.length) { show("至少勾选一个模型。", "error"); return; }
        save.disabled = true;
        try {
          if (select.value) {
            show(`正在用「${select.value}」试说一句话…`, "");
            const probe = await call("pinkie.modelSetup.test", {...params(), model: select.value}, 60000);
            if (!probe.ok) { show(probe.message, "error"); return; }
          }
          state.data = await call("pinkie.modelSetup.save", {...params(), label: name.value, models, defaultModel: select.value || undefined, everywhere: everywhere.checked}, 30000);
          key.value = "";
          renderList(); closeWizard();
          setStatus(select.value ? `已保存，默认模型换成了 ${select.value}。在模型匣里也能看到。` : "已保存。在模型匣里能看到新加的模型。", "success");
          window.dispatchEvent(new CustomEvent("pinkie:models-changed"));
          hideGuide();
        } catch (error) { show(plainError(error), "error"); }
        finally { save.disabled = false; }
      });

    }
    key.focus?.();
  }

  // 设置页里的卡片（laolao-settings-user.js 调用）。
  function mount(parent, before = null) {
    const card = el("section", "pinkie-user-settings__card pinkie-model-setup", null);
    card.id = "pinkie-model-setup";
    parent.insertBefore(card, before || null);
    const header = el("header", "pinkie-user-settings__card-header", card);
    el("span", "pinkie-user-settings__icon", header, "🔑").setAttribute("aria-hidden", "true");
    el("h3", "pinkie-user-settings__card-title", header, "模型服务");
    el("p", "pinkie-user-settings__card-hint", card, "用你自己的服务商和密钥。密钥只存在这台电脑上，界面只显示末四位，碧琪在聊天里也改不了。");
    state.card = card;
    state.list = el("div", "pinkie-model-setup__list", card);
    const actions = el("div", "pinkie-user-settings__actions", card);
    btn("＋ 添加服务商", `${B} ${B}--primary`, actions, () => openWizard());
    state.status = el("p", "pinkie-user-settings__status pinkie-model-setup__status", card); state.status.hidden = true;
    const start = () => { if (typeof rpc() === "function") { void refresh(); return true; } return false; };
    if (!start()) { let tries = 0; const timer = setInterval(() => { if (start() || ++tries > 60) clearInterval(timer); }, 500); }
    try {
      if (sessionStorage.getItem(FOCUS_FLAG)) {
        sessionStorage.removeItem(FOCUS_FLAG);
        setTimeout(() => card.scrollIntoView({block: "start", behavior: "smooth"}), 300);
      }
    } catch {}
    return card;
  }

  // 主界面引导：没有任何能用的模型时，不等用户发消息报错，直接请他去配。
  let guide = null;
  function hideGuide() { guide?.remove(); guide = null; }
  function openSettings() {
    try { sessionStorage.setItem(FOCUS_FLAG, "1"); } catch {}
    hideGuide();
    const link = document.querySelector('a[href="/settings/general"], a[href$="/settings/general"]');
    if (link) link.click(); else location.assign("/settings/general" + location.hash);
    setTimeout(() => document.getElementById("pinkie-model-setup")?.scrollIntoView({block: "start", behavior: "smooth"}), 600);
  }
  function showGuide() {
    if (guide || String(location.pathname).startsWith("/settings")) return;
    try { if (sessionStorage.getItem(DISMISS_FLAG)) return; } catch {}
    guide = el("div", "pinkie-model-guide", document.body);
    guide.setAttribute("role", "dialog"); guide.setAttribute("aria-label", "先配一个模型");
    el("strong", "pinkie-model-guide__title", guide, "先给碧琪接上一个模型");
    el("p", "pinkie-model-guide__text", guide, "现在还没有能用的模型。选一家服务商、粘贴密钥，一分钟就好，然后就能开始聊天。");
    const row = el("div", "pinkie-model-guide__actions", guide);
    btn("去配置", "pinkie-model-guide__primary", row, openSettings);
    btn("稍后", "pinkie-model-guide__later", row, () => { try { sessionStorage.setItem(DISMISS_FLAG, "1"); } catch {} hideGuide(); });
  }
  async function checkGuide(attempt = 0) {
    if (typeof rpc() !== "function") { if (attempt < 120) setTimeout(() => checkGuide(attempt + 1), 1000); return; }
    try { const data = await call("pinkie.modelSetup.list", {}, 10000); if (data?.needsSetup) showGuide(); else hideGuide(); }
    catch { if (attempt < 5) setTimeout(() => checkGuide(attempt + 1), 3000); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => checkGuide(), {once: true});
  else checkGuide();

  window.__pinkieModelSetup = Object.freeze({mount, refresh, openSettings, checkGuide});
})();
