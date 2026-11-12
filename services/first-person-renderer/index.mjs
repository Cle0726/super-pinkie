import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// 与 services/mode-architecture/first-person.mjs 同一份规则（测试检查一致），见那里的说明。
// --- first-person rules begin ---
const KEEP_WORDS = ['唯我独尊', '唯我獨尊', '尔虞我诈', '爾虞我詐', '卿卿我我', '我行我素', '舍我其谁', '捨我其誰',
  '时不我待', '時不我待', '我见犹怜', '我見猶憐', '依然故我', '我思故我在', '人不犯我', '我不犯人', '你死我活', '你情我愿', '你來我往', '你来我往',
  '自我', '忘我', '无我', '無我', '本我', '超我', '真我', '非我', '大我', '小我', '物我', '我执', '我執', '敌我', '敵我', '你我', '我们', '我們', '我俩', '我倆', '我辈', '我輩',
  // 「我国、我方」这类里的「我」是「我们这边」，不是碧琪自己
  '我国(?!庆)', '我國(?!慶)', '我方(?![案法便向式才面])', '我军', '我軍', '我党', '我黨', '我省(?=[的各内]|[\\s，。；：！？、]|$)', '我市(?=[的各内]|[\\s，。；：！？、]|$)', '我县', '我縣', '我校(?![对验正准])', '我院', '我司', '我局(?![限部])', '我厂', '我廠', '我单位', '我公司',
  // 系统和软件里的名字，改了用户就找不到了
  '我的电脑', '我的電腦', '我的文档', '我的文檔', '我的图片', '我的音乐', '我的视频', '我的下载', '我的收藏', '我的订单', '我的訂單', '我的主页', '我的账户', '我的帐户', '我的钱包', '我的关注', '我的云盘'];
const KEEP = new RegExp(KEEP_WORDS.join('|'), 'g');
const STOP = '\\s，。；：！？、「」『』“”（）()';
// 这些地方的字不是碧琪在说自己，原样留着（留着「我」只是不够可爱，换错了会把意思说错）：
// 围栏代码块、行内代码、Markdown 链接地址、裸网址；
// 引用行（> 开头）和两条分隔线之间的整段——那是替用户起草的稿子或转述别人的话；
// 各种引号里的话——按钮名、用户的原话、起草的句子；
// 路径和文件名（「我的简历.docx」改了就和真实文件对不上）。
const PROTECTED = new RegExp([
  '```[\\s\\S]*?(?:```|$)', '~~~[\\s\\S]*?(?:~~~|$)', '`[^`\\n]*`', '\\]\\([^)\\s]*\\)', 'https?:\\/\\/[^\\s)）]+',
  '^[ \\t]*>[^\\n]*',
  '^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*\\n[\\s\\S]*?\\n[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$',
  '「[^」\\n]{0,200}」', '『[^』\\n]{0,200}』', '“[^”\\n]{0,200}”', '‘[^’\\n]{0,200}’', '"[^"\\n]{0,200}"',
  `(?:~|\\.{1,2})?[\\\\/][^${STOP}]+`, `[A-Za-z]:\\\\[^${STOP}]*`,
  `我[^${STOP}/\\\\]{0,30}\\.[A-Za-z][A-Za-z0-9]{1,5}(?![A-Za-z0-9])`,
].join('|'), 'gm');
// 这一行是在替用户写第一人称的自我介绍（「大家好，我叫小王」「我是一名设计师」），整行不动。
const SPOKEN_FOR_USER = /我叫(?!碧琪)|我是(?:一名|一位|来自)/;

// 同一句话里已经说过一次「碧琪」，逗号后面紧跟着的主语「我」就省掉：
// 「我看了一下，我觉得可以」读成「碧琪看了一下，觉得可以」，不是一句里连着两三个「碧琪」。
// 只在不会改变意思的时候省：中间没有换人（你 / 他 / 她），后面不是「我的 / 我这边」这类。
const SENTENCE_END = '。！？!?；;';
const OTHER_PERSON = '你您他她它';
const NOT_SUBJECT = '的们們这這那俩倆';
const replaceLine = (text) => {
  if (SPOKEN_FOR_USER.test(text)) return text;
  const kept = new Map();
  for (const match of text.matchAll(KEEP)) kept.set(match.index, match[0]);
  let out = '', said = false;
  for (let i = 0; i < text.length; i += 1) {
    const word = kept.get(i);
    if (word) { out += word; i += word.length - 1; said = false; continue; }
    const ch = text[i];
    if (ch !== '我') {
      if (SENTENCE_END.includes(ch) || OTHER_PERSON.includes(ch)) said = false;
      out += ch;
      continue;
    }
    const next = text[i + 1] || '';
    const subject = next && !NOT_SUBJECT.includes(next);
    if (said && subject && /[，,]\s*$/.test(out)) continue;
    out += '碧琪';
    if (subject) said = true;
  }
  return out;
};
const replacePlain = (text) => text.split('\n').map(replaceLine).join('\n');

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
