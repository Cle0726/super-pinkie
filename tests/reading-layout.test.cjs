const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "ui", "injections", name), "utf8");
const css = read("laolao-redesign.css");
const immersion = read("laolao-immersion.js");

test("chat column follows the window width with a cap, and the composer matches it", () => {
  assert.match(css, /--r4-col:\s*min\(1440px, calc\(100% - 152px\)\)/);
  assert.match(css, /@media \(min-width: 1600px\) \{\s*html:not\(\[data-laolao-plain-composer\]\):not\(\[data-r2-off\]\) \.chat-group\.assistant \.chat-text \{ font-size: 16px !important; \}/);
  assert.match(css, /\.chat-thread-inner \{[^}]*max-width: var\(--r4-col\) !important/);
  assert.match(css, /\.agent-chat__composer-shell,\s*\n[^{]*\.chat-queue \{\s*width: calc\(var\(--r4-col\) - 92px\) !important;\s*max-width: none !important;/);
  assert.doesNotMatch(css, /max-width: 840px/);
});

test("reading typography: roomier default, learning mode keeps its paper type", () => {
  assert.match(css, /\.chat-group\.assistant \.chat-text \{\s*font-size: 15px !important;\s*line-height: 1\.75 !important;/);
  assert.match(css, /html\[data-laolao-mode="learning"\]:not\(\[data-laolao-plain-composer\]\):not\(\[data-r2-off\]\) \.chat-group\.assistant \.chat-text \{\s*font-size: 15\.5px !important;\s*line-height: 1\.85 !important;/);
});

test("decorative layers cannot be selected; message text still can", () => {
  const block = css.slice(css.indexOf(".pinkie-ambient, .pinkie-burst"), css.indexOf("::selection"));
  for (const sel of [".pinkie-ambient", ".pinkie-burst", ".pinkie-buddy", ".card.chat canvas", ".chat-thread {"]) assert.ok(block.includes(sel), sel);
  assert.match(block, /user-select: none !important/);
  assert.match(block, /\.chat-thread :is\(\.chat-text, \.chat-text \*, pre, code, table, input, textarea, \[contenteditable="true"\]\) \{\s*-webkit-user-select: text !important;/);
});

test("bold fixer turns **x** next to CJK punctuation into <strong>, leaves code alone", () => {
  const re = new RegExp(immersion.match(/const BOLD = \/(.+)\/g;/)[1], "g");
  const fix = (s) => s.replace(re, "<b>$1</b>");
  assert.equal(fix("咱们运用**【斜线断句法】**：不要"), "咱们运用<b>【斜线断句法】</b>：不要");
  assert.equal(fix("**a** 和 **b**"), "<b>a</b> 和 <b>b</b>");
  assert.equal(fix("2 ** 3 ** 4"), "2 ** 3 ** 4");
  assert.match(immersion, /closest\("code, pre, textarea, a"\)/);
});

test("continuous effects stay cheap: hidden glow paused, no animated blur, sheen moves by transform", () => {
  assert.match(css, /animation: r2-spin 7s linear infinite;\s*\/\*[^*]*\*\/\s*animation-play-state: paused;/);
  assert.match(css, /\.agent-chat__input:focus-within::after \{ opacity: \.55; animation-play-state: running; \}/);
  const entrance = css.match(/@keyframes r3-in-assistant \{[^}]*\}[^}]*\}/)[0];
  assert.doesNotMatch(entrance, /filter/);
  assert.match(css, /@keyframes r3-sheen \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(330%\); \} \}/);
  assert.doesNotMatch(css, /background-position: 120% 0/);
  assert.match(css, /\.chat-thread :is\(\.btn, \.chat-expand-btn, \.chat-group-footer button\) \{\s*-webkit-backdrop-filter: none !important;\s*backdrop-filter: none !important;/);
});

test("composer hint speaks in each mode's voice", () => {
  const shell = read("laolao-classic-shell.js");
  assert.match(shell, /learning: "先生，今天想学点什么？"/);
  assert.match(shell, /project: "老板，这次要碧琪做什么？"/);
  assert.match(shell, /\|\| "给碧琪发消息"/);
});

test("phrase localizer skips whitespace-only text nodes before any lookup", () => {
  const phrases = read("laolao-phrases.js");
  assert.match(phrases, /if \(node\.nodeType !== Node\.TEXT_NODE\) return;\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(!node\.nodeValue \|\| !node\.nodeValue\.trim\(\)\) return;/);
});
