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
  // a reason captured before we ever touched the title outranks our own description
  const title = summary?.dataset?.cleNativeTitle?.trim() || summary?.getAttribute('title')?.trim();
  if (title) return title;
  return '此模型没有更多思考档位，或会话运行中不可调整';
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
      if (!host) { host = document.createElement('div'); host.className = 'cle-gaze-stops is-note'; panel.append(host); }
      host.classList.add('is-note');
      host.removeAttribute('role');
      host.dataset.cleNote = note;
      host.textContent = note;
    }
    return;
  }
  if (!host || host.dataset.cleSignature !== values.join(',')) {
    if (!host) { host = document.createElement('div'); host.className = 'cle-gaze-stops'; panel.append(host); }
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
      item.setAttribute('role', 'listitem');
      item.dataset.stop = String(index);
      const tick = document.createElement('span');
      tick.className = 'cle-gaze-stop__tick';
      tick.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'cle-gaze-stop__name';
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
    if (!note) { note = document.createElement('span'); note.className = 'cle-gaze-stops__why'; host.append(note); }
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
      // Ignore a title we wrote ourselves in an earlier pass; only a real native reason counts.
      if (nativeTitle && nativeTitle !== summary.dataset.cleOwnTitle && summary.dataset.cleNativeTitle !== nativeTitle) {
        summary.dataset.cleNativeTitle = nativeTitle;
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

export function mountGaze(signal) {
  const sweep = (root = document) => { try { eachPicker(root, decoratePicker); } catch (e) { console.warn('[cle] gaze', e); } };
  sweep();
  // Streaming rewrites text on every token; observing characterData would re-decorate the
  // document dozens of times a second. Structure changes are rare, and real level changes
  // arrive as input/click/toggle events, so those are handled directly per picker.
  let queued = false;
  const schedule = (root) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sweep(root); });
  };
  const mo = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes || []) if (node.nodeType === 1) { schedule(node); return; }
    }
  });
  mo.observe(document.body, {childList: true, subtree: true});
  const onEvent = (event) => {
    const picker = event.target?.closest?.(PICKER);
    if (picker) decoratePicker(picker);
  };
  for (const type of ['input', 'change', 'click', 'toggle']) document.addEventListener(type, onEvent, true);
  const onVisibility = () => { if (!document.hidden) sweep(); };
  document.addEventListener('visibilitychange', onVisibility);
  signal.addEventListener('abort', () => {
    mo.disconnect();
    for (const type of ['input', 'change', 'click', 'toggle']) document.removeEventListener(type, onEvent, true);
    document.removeEventListener('visibilitychange', onVisibility);
  }, {once: true});
}
