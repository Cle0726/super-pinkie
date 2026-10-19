// The small keys under the composer, drawn as objects from his world instead of stock glyphs.
// One hand for all of them: a 1.3 px pen line, round ends, the arch of the brand, and a single
// accent — gold leaf for "this is on", the gaze for the eye. The native button and its icon stay
// in place (only the stock glyph is hidden), so every behaviour, title and state is untouched.
const S = (body) => `<svg class="cle-key" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const KEYS = {
  // 深度研究 — a reading glass whose lens holds his slit pupil
  research: S(`<circle class="k" cx="10.2" cy="10.2" r="6.2"/><path class="k" d="M14.7 14.7 20 20"/>
    <path class="k z" d="M10.2 6.6c1.3 1.2 1.3 6 0 7.2c-1.3-1.2-1.3-6 0-7.2Z"/>`),
  // 添加附件 — a sealed letter with its corner turned, waiting for something to be slipped in
  attach: S(`<path class="k" d="M4 7.5h16v10.5H4Z"/><path class="k" d="M4 7.8 12 13.2 20 7.8"/><path class="k g" d="M12 2.8v6M9 5.8h6"/>`),
  // 执行权限 — an old key with a bow like a camellia
  permission: S(`<circle class="k" cx="7.3" cy="12" r="3.6"/><path class="k" d="M7.3 10.3v.1M10.9 12H21M17.6 12v3.1M20 12v2.2"/>
    <path class="k g" d="M5.9 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0Z"/>`),
  // 页内预览 / 浏览器 — an arched window onto a horizon and a moon
  browser: S(`<path class="k" d="M5 20.5V10a7 7 0 0 1 14 0v10.5Z"/><path class="k" d="M5 15.5c3.2-1.6 5.6 1 8.4-.4s3.6-.9 5.6-.1"/>
    <circle class="k g" cx="14.6" cy="9" r="1.6"/>`),
  // 手动整理上下文 — loose pages gathered and tied with a ribbon
  compact: S(`<path class="k" d="M6 4.5h10l2.5 2.5V19.5H6Z"/><path class="k" d="M8.6 9h7M8.6 15h7"/><path class="k g" d="M4 12h16M12 10.4l-1.6 1.6 1.6 1.6 1.6-1.6Z"/>`),
  // 选择思考强度 — the gear: an astrolabe, four watches marked inside its rim, a hand and a star
  deepthink: S(`<circle class="k" cx="12" cy="12" r="8"/><path class="k" d="M12 6.2a5.8 5.8 0 0 1 0 11.6"/>
    <path class="k n1" d="m16.6 7.4-1.1 1.1"/><path class="k n2" d="m16.6 16.6-1.1-1.1"/><path class="k n3" d="m7.4 16.6 1.1-1.1"/><path class="k n4" d="m7.4 7.4 1.1 1.1"/>
    <path class="k g hand" d="M12 12V6.6"/><path class="k z" d="M12 10.6l.45 1 1 .4-1 .45-.45 1-.45-1-1-.45 1-.4Z"/>`),
  // 网页 GPT 协作 — two arched windows overlapping: two rooms sharing one view
  collab: S(`<path class="k" d="M3.5 19.5V10.5a4.6 4.6 0 0 1 9.2 0v9Z"/><path class="k" d="M11.3 19.5V10.5a4.6 4.6 0 0 1 9.2 0v9Z"/>
    <path class="k g" d="M2.5 19.5h19"/>`),
  // 语音 — a ribbon microphone of the old salons
  voice: S(`<rect class="k" x="9" y="3.5" width="6" height="10.5" rx="3"/><path class="k" d="M9.8 7h4.4M9.8 9.5h4.4"/><path class="k" d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3M9 20.5h6"/>`),
  // 发送 — the nib of his pen, pointing up
  send: S(`<path class="k" d="M12 3.2 16.5 11 12 20.8 7.5 11Z"/><path class="k" d="M12 9.2v6.4"/><circle class="k" cx="12" cy="9.2" r=".9"/>`),
};

const TARGETS = [
  ['.laolao-research-btn', 'research'],
  ['.agent-chat__input-btn--attach', 'attach'],
  ['.chat-controls__permission-trigger, .chat-controls__inline-select-trigger[class*="permission"]', 'permission'],
  ['.laolao-browser-entry', 'browser'],
  ['.laolao-context-compact-btn', 'compact'],
  ['.laolao-deep-think-btn', 'deepthink'],
  ['.laolao-web-gpt-collab', 'collab'],
  ['.chat-send-btn--voice', 'voice'],
  ['.chat-send-btn--laolao-dictation', 'voice'],
  ['.chat-send-btn--send', 'send'],
];

export function mountKeys(signal) {
  const dress = () => {
    for (const composer of document.querySelectorAll('.cle-composer')) {
      for (const [sel, key] of TARGETS) {
        for (const btn of composer.querySelectorAll(sel)) {
          if (btn.querySelector(':scope > .cle-key')) continue;
          btn.classList.add('cle-keyed'); btn.dataset.cleKey = key;
          btn.insertAdjacentHTML('afterbegin', KEYS[key]);
        }
      }
    }
  };
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; dress(); }); } };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {childList: true, subtree: true});
  dress();
  signal.addEventListener('abort', () => { mo.disconnect(); document.querySelectorAll('.cle-key').forEach((k) => k.remove());
    document.querySelectorAll('.cle-keyed').forEach((b) => { b.classList.remove('cle-keyed'); delete b.dataset.cleKey; }); }, {once: true});
}
