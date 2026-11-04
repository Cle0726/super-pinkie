import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// 与 services/mode-architecture/first-person.mjs 同一份规则（测试检查一致），见那里的说明。
// --- first-person rules begin ---
const KEEP_WORDS = ['唯我独尊', '唯我獨尊', '尔虞我诈', '爾虞我詐', '卿卿我我', '我行我素', '舍我其谁', '捨我其誰',
  '自我', '忘我', '无我', '無我', '本我', '超我', '敌我', '敵我', '我们', '我們'];
const KEEP = new RegExp(KEEP_WORDS.join('|'), 'g');
// 围栏代码块、行内代码、Markdown 链接地址、裸网址
const PROTECTED = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\]\([^)\s]*\)|https?:\/\/[^\s)）]+/g;

const replacePlain = (text) => {
  let out = '', last = 0;
  for (const match of text.matchAll(KEEP)) {
    out += text.slice(last, match.index).replaceAll('我', '碧琪') + match[0];
    last = match.index + match[0].length;
  }
  return out + text.slice(last).replaceAll('我', '碧琪');
};

function renderFirstPerson(value) {
  if (typeof value !== 'string' || !value.includes('我')) return value;
  let out = '', last = 0;
  for (const match of value.matchAll(PROTECTED)) {
    out += replacePlain(value.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + replacePlain(value.slice(last));
}
// --- first-person rules end ---
const replaceFirstPerson = renderFirstPerson;

export default definePluginEntry({
  id: "pinkie-first-person-renderer",
  name: "Pinkie First-Person Renderer",
  register(api) {
    api.on(
      "message_sending",
      async (event) => ({ content: replaceFirstPerson(event.content) }),
      { priority: 1000 },
    );

    api.on(
      "reply_payload_sending",
      async (event) => {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;

        return {
          payload: {
            ...payload,
            text: replaceFirstPerson(payload.text),
            content: replaceFirstPerson(payload.content),
            caption: replaceFirstPerson(payload.caption),
          },
        };
      },
      { priority: 1000 },
    );
  },
});
