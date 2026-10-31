const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const rig = read("ui/injections/laolao-buddy-rig.js");
const companion = read("ui/injections/laolao-companion.js");

test("rig loads before companion everywhere it is installed", () => {
  const head = read("ui/injections/laolao-head.fragment.html");
  assert.ok(head.indexOf("laolao-buddy-rig.js?v=buddyrig2") < head.indexOf("laolao-companion.js?v=companion6"));
  const sh = read("installer/macos/apply-theme.sh");
  assert.match(sh, /laolao-buddy-rig\.js \\\n\s+laolao-companion\.js \\/);
  assert.match(sh, /<script defer src="\.\/laolao-buddy-rig\.js\?v=buddyrig2"><\/script>\$1/);
  const ps = read("installer/windows/apply-theme.ps1");
  assert.match(ps, /"laolao-buddy-rig\.js",/);
  assert.match(ps, /'laolao-buddy-rig\.js' = 'buddyrig2'/);
});

test("companion attaches the rig lazily and keeps the still image as fallback", () => {
  assert.match(companion, /const ensureRig = \(\) => \{/);
  assert.match(companion, /rig\.onReady = \(\) => buddy\.classList\.add\("is-rig"\)/);
  assert.match(companion, /rig\.onDead = \(\) => \{ buddy\.classList\.remove\("is-rig"\); rig = null; \}/);
  assert.match(read("ui/injections/laolao-companion.css"), /\.pinkie-buddy\.is-rig \.pinkie-buddy__img \{ opacity: 0 !important; \}/);
});

test("rig respects reduced motion, hidden pages and WebGL failure", () => {
  assert.match(rig, /prefers-reduced-motion: reduce\)"\)\.matches\) return null/);
  assert.match(rig, /try \{ return new Rig\(figure\); \} catch \{ return null; \}/);
  assert.match(rig, /if \(this\.dead \|\| this\.paused \|\| document\.hidden \|\| !this\.front\) return;/);
  assert.match(rig, /webglcontextlost/);
});

test("motion is large enough to notice (image pixels; 400px image shown at ~168px)", () => {
  const moods = rig.match(/rest: \{breath: \[([\d.]+), ([\d.]+)\], tail: \[([\d.]+), ([\d.]+)\]/);
  assert.ok(Number(moods[2]) >= .02, "breathing");
  assert.ok(Number(moods[4]) >= 5, "tail sway");
  assert.match(rig, /this\.target\.theta = nx \* \.13 \* k \* gain;/);
  assert.match(rig, /s\.vLift = 220;/);
});

test("rig never blocks: analysis is bounded around each eye and pre-warmed one image at a time", () => {
  assert.match(rig, /const reach = R \* 1\.25 \+ 3;/);
  assert.match(rig, /for \(let y = sy0; y <= sy1; y \+= 1\) for \(let x = sx0; x <= sx1; x \+= 1\)/);
  assert.match(rig, /const warm = \(srcs\) => \{/);
  assert.match(companion, /const warmRig = \(\) => window\.__pinkieBuddyRig\?\.warm\?\./);
  // attaching compiles shaders: wait until the splash is gone and the page settled
  assert.match(companion, /return waited > 1500 && !document\.getElementById\("laolao-splash"\)/);
  assert.match(companion, /if \(!pageSettled\(\)\) return;/);
});

test("rig pauses under the mode transition and resumes even if the transition fails", () => {
  assert.match(rig, /pause\(on\) \{ this\.paused = Boolean\(on\);/);
  assert.match(companion, /laolao:mode-transition-start", \(\) => \{ rig\?\.pause\(true\); clearTimeout\(rigResume\); rigResume = setTimeout\(\(\) => rig\?\.pause\(false\), 15000\);/);
  assert.match(rig, /checkVisibility\(\{checkVisibilityCSS: true, checkOpacity: true\}\)/);
});

test("Pinkie looks at what is happening, fidgets when idle, and reacts to scroll and waking up", () => {
  assert.match(rig, /attend\(x, y, ms = 0\)/);
  assert.match(rig, /if \(g\) this\.aim\(g\.x, g\.y, this\.glance \? \.9 : \.7, false\);/);
  assert.match(rig, /kinds = \["tail", "shake", "glance", "blink", "hop"\];/);
  assert.match(rig, /else if \(kind === "scroll"\)/);
  assert.match(rig, /else if \(kind === "wake"\)/);
  assert.match(companion, /const gaze = \(run, typing, ta\) => \{/);
  assert.match(companion, /rig\?\.impulse\("scroll", scrollSum\)/);
  assert.match(companion, /if \(from === "sleepy" && next !== "sleepy" && rig\) \{/);
  assert.match(companion, /lookUpAtThread\(\);/);
});

test("ambient layer reuses pre-rendered glow sprites and bakes static layers once", () => {
  assert.match(companion, /const glow = \(key, inner, outer, size = 64\) => \{/);
  assert.match(companion, /const bakeLayer = \(d\) => \{/);
  const draw = companion.slice(companion.indexOf("const draw = (now) => {"), companion.indexOf("const stop = () =>"));
  assert.doesNotMatch(draw, /createRadialGradient|createLinearGradient/);
  assert.match(companion, /const soft = \["learning", "thinking", "unrestricted"\]\.includes\(currentMode\);/);
});
