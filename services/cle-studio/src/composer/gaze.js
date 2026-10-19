import './models.css';
import {LEVELS, levelOf, eyeSvg} from './gaze-levels.js';

// 凝视 — the thinking level as a gaze. The native picker keeps every behaviour (values,
// routing, disabled reasons); we replace only the dial with an eye that opens with the
// level. A poetic word never replaces the real tier name: High / Max / Ultra stay visible.
export {LEVELS, levelOf, tierLabel, tierWord, eyeSvg, stopIndex} from './gaze-levels.js';

const EFFORT_PICKER = '.chat-controls__effort-picker';
const MODEL_PICKER = '.chat-controls__model-picker';
const PICKER = `${EFFORT_PICKER}, ${MODEL_PICKER}`;

function readLevel(summary) {
  // the semantic value the native picker committed; never inferred from pixels
  const raw = summary?.dataset?.chatThinkingValue;
  if (raw) { const known = levelOf(raw); if (known) return known; }
  const label = summary?.querySelector?.('.chat-controls__inline-select-label');
  return levelOf(label?.textContent) || null;
}

function ensureEye(summary) {
  // The native gauge is display:none outside the mobile toolbar, so an eye placed inside it
  // would simply vanish on desktop. The summary owns the eye instead; the dial is hidden.
  let eye = summary.querySelector(':scope > .cle-eye');
  if (!eye) {
    eye = document.createElement('span');
    eye.className = 'cle-eye';
    // marked so the mount observer can tell our own insertion from a Lit re-render
    eye.dataset.cleOwned = '1';
    eye.setAttribute('aria-hidden', 'true');
    const label = summary.querySelector('.chat-controls__inline-select-label');
    if (label) summary.insertBefore(eye, label); else summary.prepend(eye);
  }
  return eye;
}

/* Each available stop, in the model's real order. A model with three stops shows three;
   nothing is invented, and a disabled slider states why instead of looking broken. */
function readStops(details) {
  const menu = details.querySelector('.chat-controls__effort-menu, .chat-controls__model-menu, .chat-controls__inline-select-menu');
  const range = menu?.querySelector?.('input.chat-controls__reasoning-range');
  if (!range) return null;
  const raw = range.dataset?.chatThinkingValues || range.getAttribute?.('data-chat-thinking-values') || '';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const min = Number(range.min || 0), max = Number(range.max || values.length - 1);
  const span = Math.max(1, max - min);
  const index = values.length ? Math.max(0, Math.min(values.length - 1,
    Math.round((Number(range.value || 0) - min) / span * Math.max(0, values.length - 1)))) : 0;
  const disabled = Boolean(range.disabled) || summaryDisabled(details);
  return {menu, range, values, index, disabled};
}

function summaryDisabled(details) {
  const summary = details.querySelector(':scope > summary');
  if (!summary) return false;
  return summary.dataset.chatThinkingDisabled === 'true'
    || summary.getAttribute('aria-disabled') === 'true'
    || details.hasAttribute('data-chat-thinking-disabled')
    || summary.classList.contains('chat-controls__inline-select-trigger--disabled');
}

function reasonFor(details) {
  const summary = details.querySelector(':scope > summary');
  /* The live title first: the native picker rewrites it whenever the reason changes. Only if
     it is still our own description do we fall back to a reason captured earlier, so a
     stale "high 认真推敲" can never masquerade as the reason a control is locked. */
  const live = summary?.getAttribute('title')?.trim() || '';
  const own = summary?.dataset?.cleOwnTitle?.trim() || '';
  const captured = summary?.dataset?.cleNativeTitle?.trim() || '';
  const liveIsOurs = Boolean(live) && live === own;
  const title = live && !liveIsOurs ? live : captured && captured !== own ? captured : '';
  if (title) return title;
  return '此刻不可调整（会话运行中，或此模型不支持更多档位）';
}

function renderStops(details, stops) {
  const panel = stops.menu.querySelector('.chat-controls__reasoning-panel');
  if (!panel) return;
  let host = panel.querySelector(':scope > .cle-gaze-stops');
  const values = stops.values;
  if (!values.length) return;
  if (values.length < 2) {
    const only = LEVELS[levelOf(values[0]) || 'medium']?.tier || values[0];
    const note = `此模型只有一个思考档位 · ${only}`;
    if (!host || !host.classList.contains('is-note') || host.dataset.cleNote !== note) {
      if (!host) { host = document.createElement('div'); host.className = 'cle-gaze-stops is-note'; host.dataset.cleOwned = '1'; panel.append(host); }
      host.classList.add('is-note');
      host.removeAttribute('role');
      host.dataset.cleNote = note;
      host.textContent = note;
    }
    return;
  }
  if (!host || host.dataset.cleSignature !== values.join(',')) {
    if (!host) { host = document.createElement('div'); host.className = 'cle-gaze-stops'; host.dataset.cleOwned = '1'; panel.append(host); }
    host.classList.remove('is-note');
    delete host.dataset.cleNote;
    host.dataset.cleSignature = values.join(',');
    // how many stops this model really exposes: the stylesheet uses it to keep the names
    // legible on a nine-stop ladder instead of shrinking all of them to one size
    host.dataset.cleStops = String(values.length);
    host.setAttribute('role', 'list');
    host.setAttribute('aria-label', '可用思考档位');
    const frag = document.createDocumentFragment();
    const names = [];
    values.forEach((value, index) => {
      const level = levelOf(value) || 'medium';
      const name = LEVELS[level]?.tier || value;
      names.push(name);
      const item = document.createElement('span');
      item.className = 'cle-gaze-stop';
      item.dataset.cleOwned = '1';
      item.setAttribute('role', 'listitem');
      item.dataset.stop = String(index);
      const tick = document.createElement('span');
      tick.className = 'cle-gaze-stop__tick';
      tick.dataset.cleOwned = '1';
      tick.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'cle-gaze-stop__name';
      text.dataset.cleOwned = '1';
      text.textContent = name;
      item.append(tick, text);
      frag.append(item);
    });
    host.replaceChildren(frag);
    host.setAttribute('aria-description', names.join('，'));
  }
  const items = host.querySelectorAll('.cle-gaze-stop');
  items.forEach((item, index) => {
    item.toggleAttribute('data-current', index === stops.index);
    item.toggleAttribute('data-past', index < stops.index);
    if (index === stops.index) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
  host.toggleAttribute('data-disabled', stops.disabled);
  const why = stops.disabled ? reasonFor(details) : '';
  if (why) {
    if (host.dataset.cleWhy !== why) { host.dataset.cleWhy = why; host.title = why; }
    let note = host.querySelector(':scope > .cle-gaze-stops__why');
    if (!note) { note = document.createElement('span'); note.className = 'cle-gaze-stops__why'; note.dataset.cleOwned = '1'; host.append(note); }
    if (note.textContent !== why) note.textContent = why;
  } else {
    delete host.dataset.cleWhy;
    host.removeAttribute('title');
    host.querySelector(':scope > .cle-gaze-stops__why')?.remove();
  }
}

function decorateEffort(details) {
  const summary = details.querySelector(':scope > .chat-controls__effort-trigger');
  if (!summary) return;
  const level = readLevel(summary);
  if (level) {
    const L = LEVELS[level];
    if (summary.dataset.cleLevel !== level) summary.dataset.cleLevel = level;
    // The tier name rides on the label as a CSS suffix; the native text is never rewritten,
    // so Lit keeps owning that node and localization keeps working.
    const label = summary.querySelector('.chat-controls__inline-select-label');
    const native = label?.textContent?.trim() || '';
    const alreadyNamed = native && native.toLowerCase() === L.tier.toLowerCase();
    if (label) {
      if (alreadyNamed) { delete label.dataset.cleTier; delete label.dataset.cleWord; }
      else {
        if (label.dataset.cleTier !== L.tier) label.dataset.cleTier = L.tier;
        if (label.dataset.cleWord !== L.zh) label.dataset.cleWord = L.zh;
      }
    }
    // A disabled control's title explains *why* it cannot move (a run in progress, a locked
    // model). That reason outranks our description, so we never overwrite it.
    const disabled = summary.dataset.chatThinkingDisabled === 'true'
      || summary.getAttribute('aria-disabled') === 'true'
      || summary.classList.contains('chat-controls__inline-select-trigger--disabled');
    const nativeTitle = summary.getAttribute('title');
    if (disabled) {
      /* Only a real native reason may be remembered. A descriptive title we wrote in an
         earlier pass is not a reason, and capturing it would later hide the genuine one. */
      const ours = summary.dataset.cleOwnTitle;
      const looksOurs = Boolean(nativeTitle) && nativeTitle === ours;
      if (nativeTitle && !looksOurs) {
        summary.dataset.cleNativeTitle = nativeTitle;
      } else if (looksOurs) {
        // keep whatever real reason was captured before; never let our own text win
        delete summary.dataset.cleNativeTitle;
      }
    } else {
      const title = `思考强度 · ${L.tier}（${L.zh}）：${L.hint}`;
      if (summary.title !== title) { summary.title = title; summary.dataset.cleOwnTitle = title; }
    }
    const eye = ensureEye(summary);
    const sig = `${level}|${L.open >= .8 ? 1 : 0}`;
    if (eye.dataset.cleSig !== sig) {
      eye.innerHTML = eyeSvg(level);
      eye.dataset.cleSig = sig;
      eye.toggleAttribute('data-lit', L.open >= .8);
      eye.dataset.cleOpen = String(L.open);
    }
    details.dataset.cleTier = L.tier;
  }
  const stops = readStops(details);
  if (stops) renderStops(details, stops);
}

function decorateModel(details) {
  // the reasoning panel inside the model menu is the same control, styled the same way
  const stops = readStops(details);
  if (stops && details.open) renderStops(details, stops);
}

export function decoratePicker(details) {
  if (!details?.isConnected) return;
  if (details.matches(EFFORT_PICKER)) decorateEffort(details);
  else if (details.matches(MODEL_PICKER)) decorateModel(details);
}

function eachPicker(root, fn) {
  if (root.matches?.(PICKER)) fn(root);
  root.querySelectorAll?.(PICKER)?.forEach(fn);
}

/* Which pickers does an added node actually affect? A Lit re-render can add the summary
   itself, a label inside it, or a whole pane; and several pickers can arrive in one frame.
   Every added node is normalised to the picker it belongs to, so no root is ever dropped and
   nothing outside a picker is scanned. */
function pickersFor(node) {
  if (!node || node.nodeType !== 1) return [];
  const own = node.closest?.(PICKER);
  if (own) return [own];
  const found = [];
  if (node.matches?.(PICKER)) found.push(node);
  node.querySelectorAll?.(PICKER)?.forEach((picker) => found.push(picker));
  return found;
}

export function mountGaze(signal) {
  if (signal?.aborted) return;
  const pending = new Set();
  let frame = 0;
  let stopped = false;

  const flush = () => {
    frame = 0;
    if (stopped) return;
    const batch = [...pending];
    pending.clear();
    // Snapshot first: decorating one picker can add nodes that would otherwise grow the
    // set while it is being iterated.
    for (const picker of batch) {
      if (!picker?.isConnected) continue;
      try { decoratePicker(picker); } catch (e) { console.warn('[cle] gaze', e); }
    }
  };

  const schedule = (...nodes) => {
    if (stopped) return;
    let added = false;
    for (const node of nodes) {
      for (const picker of pickersFor(node)) { pending.add(picker); added = true; }
    }
    if (!added) return;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  // First paint: both panes can already be mounted, or arrive one frame later.
  for (const picker of document.querySelectorAll(PICKER)) { pending.add(picker); }
  if (pending.size) frame = requestAnimationFrame(flush);

  /* The native picker commits a new level by rewriting summary attributes and its label
     text — no node is added, so a childList-only observer never hears about it. Those
     attribute names are exact and only ever appear on a picker trigger, so watching just
     them is bounded: streaming prose changes text nodes, not these attributes. */
  const WATCHED_ATTRS = [
    'data-chat-thinking-value', 'data-chat-thinking-values',
    'data-chat-thinking-disabled', 'aria-disabled', 'aria-label', 'title',
  ];
  const mo = new MutationObserver((records) => {
    if (stopped) return;
    const roots = [];
    for (const record of records) {
      const target = record.target;
      if (record.type === 'attributes') {
        // Our own hint title must not re-arm the observer. Compare against the stored copy:
        // by the time a record is delivered the attribute may already hold a newer value.
        if (record.attributeName === 'title' && record.oldValue
            && record.oldValue === target?.dataset?.cleOwnTitle) continue;
        const owner = target?.nodeType === 1 ? target.closest?.(PICKER) : null;
        if (owner) roots.push(owner);
        continue;
      }
      const owner = target?.nodeType === 1 ? target.closest?.(PICKER) : null;
      for (const node of record.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        // our own eye / stop row being attached must not schedule another pass
        if (node.dataset?.cleOwned === '1') continue;
        roots.push(node);
      }
      if (owner && record.removedNodes?.length) roots.push(owner);
    }
    if (roots.length) schedule(...roots);
  });
  mo.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: WATCHED_ATTRS, attributeOldValue: true,
  });

  const onEvent = (event) => {
    const picker = event.target?.closest?.(PICKER);
    if (picker && !stopped) {
      try { decoratePicker(picker); } catch (e) { console.warn('[cle] gaze', e); }
    }
  };
  for (const type of ['input', 'change', 'click', 'toggle']) document.addEventListener(type, onEvent, true);
  const onVisibility = () => { if (!document.hidden && !stopped) schedule(...document.querySelectorAll(PICKER)); };
  document.addEventListener('visibilitychange', onVisibility);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mo.disconnect();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    pending.clear();
    for (const type of ['input', 'change', 'click', 'toggle']) document.removeEventListener(type, onEvent, true);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  signal?.addEventListener('abort', stop, {once: true});
  return stop;
}
