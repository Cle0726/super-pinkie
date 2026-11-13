(() => {
  "use strict";

  // 碧琪口吻的系统提示：错误 / 警告提示框、聊天顶部的红色横幅、聊天里网关发来的
  // 「⚠️ …」系统消息，全部换成碧琪自己说的话。原始英文收进「原文」小按钮里，
  // 排查时还能看到。只改显示，不动消息数据。
  //
  // 性能：首次扫一遍；之后只看新增节点和文字变化，不在流式输出时重扫整页。

  if (window.__pinkieBiqiNotices) return;
  window.__pinkieBiqiNotices = true;

  const CJK = /[㐀-鿿]/;
  const LATIN_WORD = /[A-Za-z]{3,}/;

  // 顺序 = 优先级：越具体越靠前。
  const RULES = [
    [/session file changed while embedded prompt lock was released|EmbeddedAttemptSessionTakeoverError/i,
      '碧琪刚才写这段对话的时候，另一个任务也在改它，两边撞了一下，这条没回出来。再发一次就好～'],
    [/Previous run is still shutting down/i,
      '上一轮碧琪还在收拾桌子，等两秒再发给我吧。'],
    [/Gateway is restarting/i,
      '碧琪的后台正在重启，几秒钟就回来，稍等再发～'],
    [/Rate-limited — ready in ~(\d+)\s*s/i,
      (m) => `模型那边要碧琪先歇 ${m[1]} 秒，马上就能继续。`],
    [/Rate-limited — ready in ~(\d+)\s*min/i,
      (m) => `模型那边要碧琪先歇大约 ${m[1]} 分钟，之后再继续。`],
    [/All models are temporarily rate-limited|rate.?limit|too many requests|\b429\b/i,
      '模型那边排队的人太多了，碧琪被请到队尾。过一会儿再试就好。'],
    [/insufficient[_ ]?(quota|balance|credit)|quota exceeded|billing|payment required|\b402\b|余额不足/i,
      '这个模型的额度用完啦。换一个模型，或者给它充点能量再来。'],
    [/invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|authentication|\b401\b|api key/i,
      '模型的钥匙对不上（密钥错了或过期了）。去设置里换一把新钥匙吧。'],
    [/forbidden|permission denied by (the )?provider|\b403\b|not allowed to access/i,
      '模型那边不让碧琪进门，这个账号可能没开通这个模型。'],
    [/context[_ ]?(length|window)|maximum context|too many tokens|prompt is too long|token limit|context_length_exceeded/i,
      '这段对话太长啦，碧琪一口装不下。先整理一下（容量圈里的「手动整理」）再继续吧。'],
    [/model[_ ]?not[_ ]?found|unknown model|does not exist|no such model/i,
      '找不到这个模型，可能名字变了。换一个模型试试。'],
    [/overloaded|\b529\b|\b503\b|service unavailable|server is busy|capacity/i,
      '模型那边太忙了，喘不过气。稍等一会儿再试。'],
    [/timed? ?out|timeout|ETIMEDOUT|deadline exceeded/i,
      '模型太久没回话，碧琪等不及先停下了。再发一次试试。'],
    [/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network ?error|getaddrinfo|connection (reset|refused|closed)/i,
      '网络断了一下，碧琪没够着模型。看看网络或代理，再发一次。'],
    [/disconnected|not connected|websocket|gateway closed|connection lost|\b1006\b/i,
      '碧琪和后台断开了一下，正在重新连。'],
    [/content[_ ]?(policy|filter)|safety|flagged|moderation|refus/i,
      '模型那边不肯接这段内容。换个说法再试试。'],
    [/aborted|cancell?ed|stopped by user/i,
      '这一轮已经停下啦。'],
    [/File too large\. Maximum size is (\d+)\s*MB/i,
      (m) => `文件太大啦，碧琪最多只能抱 ${m[1]} MB 的。`],
    [/ENOSPC|no space left/i,
      '电脑的磁盘满了，碧琪放不下新东西了。清理一点空间再来。'],
    [/EACCES|EPERM|permission denied|operation not permitted/i,
      '碧琪没有权限动这个文件或文件夹。'],
    [/Missing session key|session.*not found|unknown session/i,
      '这段对话碧琪找不着了，新开一个对话试试。'],
    [/ENOENT|no such file|not found/i,
      '碧琪没找到要用的文件，可能被移走或删掉了。'],
    [/requires gateway scope|invalid gateway scope|pairing required|device.*(not paired|unpaired)|token mismatch/i,
      '这个窗口和碧琪的后台还没认好亲，重新连接一下就好。'],
    [/Agent couldn't generate a response/i,
      '碧琪这次没能憋出回答，再发一次试试。'],
    [/The agent run failed before producing a reply/i,
      '这次模型调用失败，碧琪暂时没能完成回复。'],
    [/invalid request|bad request|\b400\b|invalid_argument|unsupported/i,
      '模型不认这次的请求格式，换个模型或者再试一次。'],
    [/\b5\d\d\b|internal (server )?error/i,
      '模型那边自己出了点故障，过一会儿再试。'],
  ];

  const clean = (raw) => String(raw || '')
    .replace(/\s*Logs:\s*openclaw logs --follow\s*$/i, '')
    .replace(/^\s*(?:⚠️|⚠|❌)\s*/, '')
    .trim();

  // 返回碧琪的话；不需要改（已经是中文、或看不出是报错）就返回 null。
  const translate = (raw, { fallback = true } = {}) => {
    const text = clean(raw);
    if (!text) return null;
    if (CJK.test(text) && !LATIN_WORD.test(text.replace(/[㐀-鿿].*/s, ''))) return null;
    const beforeReply = /^Agent failed before reply:/i.test(text);
    for (const [re, say] of RULES) {
      const m = text.match(re);
      if (m) return typeof say === 'function' ? say(m) : say;
    }
    if (beforeReply) return '碧琪还没来得及回话就卡住了。再发一次试试；还不行就点「原文」看看具体原因。';
    if (!fallback || CJK.test(text) || !LATIN_WORD.test(text)) return null;
    return '碧琪这里碰到一点小状况，没能做完。点「原文」能看到具体信息。';
  };

  const STYLE = `
.pinkie-biqi-notice-raw-toggle{all:unset;cursor:pointer;margin-left:8px;padding:0 7px;border-radius:999px;font-size:11.5px;line-height:18px;opacity:.7;border:1px solid currentColor;white-space:nowrap;vertical-align:1px}
.pinkie-biqi-notice-raw-toggle:hover{opacity:1}
.pinkie-biqi-notice-raw{display:block;margin-top:6px;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.72;white-space:pre-wrap;word-break:break-all;user-select:text}
.pinkie-biqi-notice-raw[hidden]{display:none!important}
`;
  const ensureStyle = () => {
    if (document.getElementById('pinkie-biqi-notices-style')) return;
    const s = document.createElement('style');
    s.id = 'pinkie-biqi-notices-style';
    s.textContent = STYLE;
    (document.head || document.documentElement).appendChild(s);
  };

  // 「原文」按钮 + 折叠的原始报错，挂在提示框末尾（不插在 Lit 管理的文字中间）。
  const attachRaw = (host, raw) => {
    let toggle = host.querySelector(':scope > .pinkie-biqi-notice-raw-toggle');
    let box = host.querySelector(':scope > .pinkie-biqi-notice-raw');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pinkie-biqi-notice-raw-toggle';
      toggle.textContent = '原文';
      toggle.setAttribute('aria-label', '显示原始报错');
      box = document.createElement('span');
      box.className = 'pinkie-biqi-notice-raw';
      box.hidden = true;
      toggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        box.hidden = !box.hidden;
        toggle.textContent = box.hidden ? '原文' : '收起';
      });
      host.append(toggle, box);
    }
    if (box.textContent !== raw) box.textContent = raw;
  };

  const textNodesOf = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement?.closest('.pinkie-biqi-notice-raw, .pinkie-biqi-notice-raw-toggle, button, a, code, pre, input, textarea')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = w.nextNode())) if (n.nodeValue.trim()) out.push(n);
    return out;
  };

  // 把 el 里的报错文字换成碧琪的话：第一个文字节点放译文，其余清空。
  // Lit 之后改写这些节点时，characterData 观察会再换一次。
  const rewrite = (el, { fallback = true, rawHost = el } = {}) => {
    const nodes = textNodesOf(el);
    if (!nodes.length) return;
    const current = nodes.map((n) => n.nodeValue).join('').trim();
    if (el.dataset.pinkieBiqiSaid && current === el.dataset.pinkieBiqiSaid) return;
    const said = translate(current, { fallback });
    if (!said) {
      delete el.dataset.pinkieBiqiSaid;
      return;
    }
    nodes[0].nodeValue = said;
    for (const n of nodes.slice(1)) n.nodeValue = '';
    el.dataset.pinkieBiqiSaid = said;
    el.setAttribute('title', clean(current));
    attachRaw(rawHost, clean(current));
  };

  const NOTICE_SELECTOR = [
    '.callout.danger', '.callout.warn', '.callout.warning', '.callout.error',
    '.update-banner', '.sw-action-toast', '.connection-banner__state',
    '[role="alert"]:not(.chat-bubble)',
  ].join(',');

  // 只有真正的错误框才用兜底话术；警告、更新横幅等只换对得上规则的。
  const ERROR_BOX = '.callout.danger:not(.update-banner), .callout.error, [role="alert"]:not(.update-banner)';
  const handleNotice = (box) => {
    if (box.closest('.chat-text, .chat-bubble, pre, code, [contenteditable="true"]')) return;
    const content = box.querySelector(':scope > .callout__content') || box;
    rewrite(content, { fallback: box.matches(ERROR_BOX), rawHost: content });
  };

  // 聊天里网关代发的系统消息：只认「⚠️ 」开头、且能对上规则的，不碰碧琪的正常回复。
  const handleBubble = (bubble) => {
    const raw = bubble.getAttribute('data-message-text') || '';
    if (!/^\s*⚠️/.test(raw)) return;
    const text = bubble.querySelector('.chat-text');
    if (!text) return;
    rewrite(text, { fallback: /^\s*⚠️\s*Agent failed before reply:/i.test(raw), rawHost: text });
  };

  const scan = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.matches?.(NOTICE_SELECTOR)) handleNotice(root);
    root.querySelectorAll?.(NOTICE_SELECTOR).forEach(handleNotice);
    const bubbles = root.matches?.('.chat-group.assistant .chat-bubble[data-message-text]') ? [root] : [];
    root.querySelectorAll?.('.chat-group.assistant .chat-bubble[data-message-text]').forEach((b) => bubbles.push(b));
    bubbles.forEach(handleBubble);
  };

  const ownerOf = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el.closest('.pinkie-biqi-notice-raw, .pinkie-biqi-notice-raw-toggle')) return null;
    return el.closest(NOTICE_SELECTOR) || el.closest('.chat-group.assistant .chat-bubble[data-message-text]');
  };

  let queued = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const items = queued;
    queued = new Set();
    for (const el of items) if (el.isConnected) scan(el);
  };
  const queue = (el) => {
    if (!el) return;
    queued.add(el);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 16);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') {
        queue(ownerOf(r.target));
      } else if (r.type === 'attributes') {
        queue(ownerOf(r.target));
      } else {
        const owner = ownerOf(r.target);
        if (owner) queue(owner);
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && !n.classList?.contains('pinkie-biqi-notice-raw') && !n.classList?.contains('pinkie-biqi-notice-raw-toggle')) queue(n);
          else if (n.nodeType === 3) queue(ownerOf(n));
        }
      }
    }
  });

  const start = () => {
    ensureStyle();
    scan(document.body);
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-message-text'],
    });
  };

  window.__pinkieBiqiTranslateNotice = translate;
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
