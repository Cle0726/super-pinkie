// The transcript as the original app wrote it (laolao-tool-rows v7):
//
//   我先依次运行系统命令并读取 USER.md。          ← narration, in the flow
//   ● 已运行 3 步   1 条命令 · 2 次读取  ›        ← consecutive tools, one line, a dot per kind
//   ● 读取 USER.md ›                               ← a single tool: the dot and its argument
//   当前系统时间为 …                               ← the reply, written in
//
// Two jobs, both presentation only and never through Lit-owned text:
//   · tag rows with their kind (data-cle-kind) and an activity group's label with its step
//     count (data-cle-total) — CSS draws the dot and the "已运行 N 步" from the attributes;
//   · reveal what is *new* in the live turn: each block of a reply that just arrived is
//     written in behind a transparent gradient, block after block, and new tool rows fade in
//     in order. History that was already on screen, or that a scroll re-renders, never plays.
import './transcript.css';

const KIND_OF_WORD = [
  [/命令|执行|运行|exec|bash|shell/i, 'exec'],
  [/修改|编辑|补丁|替换|edit|patch/i, 'edit'],
  [/写入|新建|创建|保存|write|create/i, 'write'],
  [/读取|搜索|查找|浏览|网页|列出|read|search|fetch|web|list/i, 'read'],
];
const kindOfText = (text) => (KIND_OF_WORD.find(([re]) => re.test(text)) || [, 'exec'])[1];

export function summarizedTools(text) {
  const parts = text.split(/[·•,，]/).map((s) => s.trim()).filter(Boolean);
  let total = 0, top = 0, kind = 'exec';
  for (const part of parts) {
    // A work/process card can say "已处理 14秒钟". Its duration (or a
    // filename/version number) says nothing about how many tools ran.
    const count = part.match(/^(\d+)\s*(?:(?:条|次|个|项)\s*(?:命令|读取|写入|编辑|修改|搜索|查询|浏览|执行|运行|工具调用|步骤|操作)|commands?|reads?|writes?|edits?|search(?:es)?|tool\s+calls?|steps?)(?=\s|$)/i);
    if (!count) continue;
    const n = Number(count[1]);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    total += n;
    if (n > top) { top = n; kind = kindOfText(part); }
  }
  return {total, kind};
}

const ROW = '.chat-tool-row';
const GROUP = '.chat-activity-group';
const BUBBLE = '.chat-bubble[data-message-id]';
const LATEST = '.chat-group--latest-assistant, .chat-group--working';
const BLOCKS = ':scope .chat-text > :is(p, ul, ol, pre, blockquote, h1, h2, h3, h4, table, hr), :scope .chat-text > div > :is(p, ul, ol, pre, blockquote, h1, h2, h3, h4, table)';
const STEP_MS = 90;          // stagger between blocks / rows
const MAX_STAGGER = 14;      // a long reply does not keep the reader waiting

// Only identities are retained across native row unmounts; node ownership stays
// with Lit. The bound also covers sessions left open for days in the same window.
const MAX_SEEN_IDS = 4096;
const MAX_ACTIVE_REVEALS = 64;
const CANDIDATES = `${BUBBLE}, ${ROW}, ${GROUP}`;
const VISIBLE_PANE = '.chat-pane-cache__pane--visible, .chat-pane-cache__pane--active';

export function mountTranscript(signal) {
  if (signal.aborted) return;
  const seen = new WeakSet();
  const seenIds = new Set();
  const pending = new Set();
  const animations = new Map();
  let frame = 0;
  let primed = false;

  const including = (root, selector) => [
    ...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector),
  ];
  const remember = (node) => {
    const id = node.dataset.messageId;
    if (!id) return false;
    const session = node.closest('openclaw-chat-pane')?.state?.sessionKey || '';
    const key = `${session}\0${id}`;
    if (seenIds.has(key)) return true;
    seenIds.add(key);
    if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value);
    return false;
  };
  const tag = (root) => {
    for (const row of including(root, ROW)) {
      const icon = row.querySelector('.chat-tool-msg-summary__icon');
      const word = icon?.getAttribute('aria-label') || row.querySelector('.chat-tool-row__verb')?.textContent || '';
      const kind = /file/.test(row.className) && !/write|edit/.test(word) ? 'read' : kindOfText(word);
      if (row.dataset.cleKind !== kind) row.dataset.cleKind = kind;
    }
    for (const group of including(root, GROUP)) {
      const label = group.querySelector('.chat-activity-group__label');
      if (!label) continue;
      const text = label.textContent || '';
      if (label.dataset.cleText === text) continue;
      label.dataset.cleText = text;
      const {total, kind} = summarizedTools(text);
      if (total) label.dataset.cleTotal = String(total); else delete label.dataset.cleTotal;
      group.dataset.cleKind = kind;
    }
  };
  const reveal = (node, delay) => {
    if (animations.size >= MAX_ACTIVE_REVEALS || animations.has(node)) return;
    node.style.setProperty('--cle-reveal-delay', `${delay}ms`);
    node.classList.add('cle-reveal');
    let timer;
    const finish = () => {
      clearTimeout(timer);
      node.removeEventListener('animationend', finish);
      node.classList.remove('cle-reveal');
      node.style.removeProperty('--cle-reveal-delay');
      animations.delete(node);
    };
    animations.set(node, finish);
    node.addEventListener('animationend', finish, {once: true});
    // Reduced motion or a removed stylesheet may suppress animationend entirely.
    timer = setTimeout(finish, delay + 2500);
  };
  const scan = (roots) => {
    const fresh = [], candidates = new Set();
    for (const root of roots) {
      if (root !== document && !root.isConnected) continue;
      tag(root);
      for (const node of including(root, CANDIDATES)) candidates.add(node);
    }
    for (const node of candidates) {
      if (seen.has(node)) continue;
      seen.add(node);
      const known = remember(node);
      if (!primed || known || !node.closest(VISIBLE_PANE) || !node.closest(LATEST)) continue;
      if (node.matches(`${ROW}, ${GROUP}`) && node.parentElement?.closest(GROUP)) continue;
      fresh.push(node);
    }
    primed = true;
    let i = 0;
    for (const node of fresh) {
      if (node.matches(BUBBLE)) {
        const blocks = [...node.querySelectorAll(BLOCKS)];
        if (!blocks.length) { reveal(node, Math.min(i++, MAX_STAGGER) * STEP_MS); continue; }
        for (const block of blocks) reveal(block, Math.min(i++, MAX_STAGGER) * STEP_MS);
      } else reveal(node, Math.min(i++, MAX_STAGGER) * STEP_MS);
    }
  };
  const flush = () => {
    frame = 0;
    if (signal.aborted) return;
    for (const [node, finish] of animations) if (!node.isConnected) finish();
    const roots = [...pending];
    pending.clear();
    // A newly inserted card already contains its inserted children. Visit that
    // subtree once even when the browser reports each append as a separate record.
    const rootSet = new Set(roots);
    scan(roots.filter((root) => {
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        if (rootSet.has(parent)) return false;
      }
      return true;
    }));
  };
  const enqueue = (node, subtree = false) => {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    if (!element?.querySelectorAll || !element.isConnected) return;
    // A streamed text node belongs to one message/row/group. Never turn its
    // parent .chat-thread or pane into a request to scan the full history.
    const owner = element.closest?.(CANDIDATES);
    if (owner) pending.add(owner);
    else if (subtree) pending.add(element);
  };
  const observerRoot = document.querySelector('openclaw-app-shell') || document.querySelector('openclaw-app') || document.body;
  const mo = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) enqueue(node, true);
        enqueue(record.target);
      } else enqueue(record.target);
    }
    // A removal can end an animation even when it introduces no new candidates.
    if (!frame && (pending.size || animations.size)) frame = requestAnimationFrame(flush);
  });
  mo.observe(observerRoot, {childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-label']});
  scan([document]);
  signal.addEventListener('abort', () => {
    mo.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending.clear();
    seenIds.clear();
    for (const finish of animations.values()) finish();
    // Teardown is a one-time sweep; streaming updates never query document history.
    for (const n of document.querySelectorAll('[data-cle-kind]')) delete n.dataset.cleKind;
    for (const n of document.querySelectorAll('[data-cle-total], [data-cle-text]')) { delete n.dataset.cleTotal; delete n.dataset.cleText; }
  }, {once: true});
}
