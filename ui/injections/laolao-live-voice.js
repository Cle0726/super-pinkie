(() => {
  "use strict";

  // Voice is intentionally opt-in per turn: a typed message stays silent;
  // only a draft filled by the native microphone can arm spoken feedback.
  const tracks = new Map();
  const replyBaselines = new WeakMap();
  let waitingForVoiceReply = false;
  let dictationDraftReady = false;

  const cleanText = (group) => Array.from(group.querySelectorAll(".chat-text"))
    .map((node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll("pre, code, .chat-tool-card, .chat-activity-group").forEach((part) => part.remove());
      return copy.textContent || "";
    })
    .join("\n")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\*`_~#[\]{}|]/g, "")
    .replace(/[,，]+/g, "，")
    .replace(/[;；]+/g, "；")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const say = (text) => {
    const spoken = text.replace(/\s+/g, " ").trim();
    if (!spoken) return;
    window.webkit?.messageHandlers?.laolaoLiveVoice?.postMessage({ text: spoken });
  };

  const stopSpeaking = () => {
    window.webkit?.messageHandlers?.laolaoLiveVoice?.postMessage({ action: "stop" });
  };

  const stopDictationBeforeSend = () => {
    const button = document.getElementById("laolao-native-dictation");
    if (!button?.classList.contains("is-recording")) return;
    window.webkit?.messageHandlers?.laolaoNativeDictation?.postMessage({ action: "stop" });
  };

  const sentenceHighlights = (text) => {
    const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
    const picked = [];
    let length = 0;
    for (const sentence of sentences) {
      const next = sentence.trim();
      if (!next) continue;
      if (picked.length && length + next.length > 175) break;
      picked.push(next);
      length += next.length;
      if (picked.length >= 3 || length >= 125) break;
    }
    return picked.join("");
  };

  const speechVersion = (rawText) => {
    const normalized = rawText.replace(/\s+/g, " ").trim();
    if (normalized.length <= 230) return normalized;

    // Prefer a real list of points or an explicit conclusion. When neither is
    // present, taking the first complete thoughts is the least misleading
    // local fallback; the full answer remains available on screen.
    const bullets = rawText
      .split(/\n+/)
      .map((line) => line.trim().replace(/^(?:[-•*]|\d+[.、)）])\s*/, ""))
      .filter((line) => line.length >= 8)
      .filter((line) => !/^(?:备注|说明|补充|例子)[:：]?$/u.test(line));
    let highlights = "";
    if (bullets.length >= 2) {
      highlights = bullets.slice(0, 3).join("；");
    } else {
      const conclusion = normalized.match(/(?:先说结论|结论|总结|重点|建议|简而言之)\s*[:：]\s*([\s\S]+)/u);
      highlights = sentenceHighlights(conclusion?.[1] || normalized);
    }
    highlights = highlights.slice(0, 190).replace(/[，；、\s]+$/u, "");
    return `先生，这段有点长，碧琪只念重点：${highlights || "重点都在屏幕上啦，先生慢慢看！"}`;
  };

  const cancelTracks = () => {
    tracks.forEach((track) => window.clearTimeout(track.timer));
    tracks.clear();
    stopSpeaking();
  };

  const replyHasFinished = () => !document.querySelector(".agent-chat__composer-actions .chat-send-btn--stop");

  const scheduleSpeech = (group, track) => {
    window.clearTimeout(track.timer);
    track.timer = window.setTimeout(() => {
      // The UI keeps a Stop button for the complete duration of a run. Wait
      // for that to disappear so a long response can be summarized before any
      // audio has started, rather than reading its first paragraph aloud.
      if (!replyHasFinished()) {
        scheduleSpeech(group, track);
        return;
      }
      if (track.spoken) return;
      const finalText = cleanText(group);
      const freshText = finalText.startsWith(track.baseline)
        ? finalText.slice(track.baseline.length).trim()
        : finalText;
      if (!freshText) return;
      track.spoken = true;
      say(speechVersion(freshText));
    }, 650);
  };

  const processGroup = (group) => {
    if (!group.matches(".chat-group.assistant")) return;
    const nextText = cleanText(group);
    if (!nextText) return;
    let track = tracks.get(group);
    if (!track) {
      if (!waitingForVoiceReply) return;
      const baseline = replyBaselines.get(group) || "";
      if (baseline && nextText === baseline) return;
      track = { baseline: nextText.startsWith(baseline) ? baseline : "", timer: 0, spoken: false };
      tracks.set(group, track);
      waitingForVoiceReply = false;
    }
    scheduleSpeech(group, track);
  };

  const collectGroups = (node, groups) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;
    // v3：只用 closest/matches（零分配的指针攀爬），禁止 querySelectorAll——
    // 观察者回调里的 NodeList 工厂是 2026-09-01 冻结实抓的 GC 雪崩主凶。
    // 新增子树里的组由 record.target 的祖先链覆盖；整组新增时组元素本身
    // 就在 addedNodes 里，matches 直接命中。
    const own = element.closest(".chat-group.assistant");
    if (own) groups.add(own);
    if (element.matches?.(".chat-group.assistant")) groups.add(element);
  };

  const dirtyGroups = new Set();
  let processTimer = 0;
  const scheduleProcess = () => {
    if (processTimer) return;
    processTimer = window.setTimeout(() => {
      processTimer = 0;
      dirtyGroups.forEach((group) => {
        if (group.isConnected) processGroup(group);
      });
      dirtyGroups.clear();
    }, 300);
  };

  const armForReply = (fromVoice) => {
    cancelTracks();
    document.querySelectorAll(".chat-group.assistant").forEach((group) => {
      replyBaselines.set(group, cleanText(group));
    });
    waitingForVoiceReply = fromVoice;
  };

  const takeVoiceDraftFlag = () => {
    const input = document.querySelector(".agent-chat__composer-combobox textarea");
    const fromVoice = dictationDraftReady || input?.dataset.laolaoVoiceDraft === "1";
    dictationDraftReady = false;
    if (input) delete input.dataset.laolaoVoiceDraft;
    return fromVoice;
  };

  window.addEventListener("laolao:dictation-draft", () => {
    dictationDraftReady = true;
  });

  document.addEventListener("input", (event) => {
    if (event.isTrusted && event.target?.matches?.(".agent-chat__composer-combobox textarea")) {
      dictationDraftReady = false;
      delete event.target.dataset.laolaoVoiceDraft;
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.(".chat-send-btn:not(.chat-send-btn--stop):not(.chat-send-btn--voice):not(.chat-send-btn--laolao-dictation)");
    if (!button || button.disabled) return;
    stopDictationBeforeSend();
    armForReply(takeVoiceDraftFlag());
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || !event.target?.matches?.(".agent-chat__composer-combobox textarea")) return;
    stopDictationBeforeSend();
    armForReply(takeVoiceDraftFlag());
  }, true);

  new MutationObserver((records) => {
    for (const record of records) {
      collectGroups(record.target, dirtyGroups);
      record.addedNodes.forEach((node) => collectGroups(node, dirtyGroups));
    }
    if (dirtyGroups.size) scheduleProcess();
  // No characterData: streaming rebuilds whole elements anyway (childList
  // still fires), and text-node mutations are the bulk of the mutation record
  // avalanche that pegged the main thread during long sessions.
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
