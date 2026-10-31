const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const inj = (name) => read(`ui/injections/${name}`);

test("sidebar collapse: no grid-column animation, flush slide-out, card look only while peeking", () => {
  const css = inj("laolao-sidebar-surface.css");
  assert.match(css, /\.shell\.shell--chat \{ transition: none !important; \}/);
  assert.match(css, /html\[data-pinkie-sidebar-auto="1"\] \.shell--chat > \.shell-nav \{\s*position: fixed !important; inset: 0 auto 0 0 !important;/);
  assert.match(css, /html\[data-pinkie-sidebar-auto="1"\]\[data-pinkie-sidebar-card="1"\] \.shell--chat > \.shell-nav \.sidebar \{\s*border-radius: 18px !important;/);
  assert.doesNotMatch(css, /html\[data-pinkie-sidebar-auto="1"\] \.shell--chat > \.shell-nav \.sidebar \{\s*border-radius/);
  assert.match(css, /\.shell--chat \.chat-thread \{ will-change: transform; \}/);
  assert.match(inj("laolao-night.css"), /\[data-pinkie-sidebar-auto="1"\]\[data-pinkie-sidebar-card="1"\]:not\(#_n\) \.shell--chat > \.shell-nav \.sidebar/);
});

test("sidebar script: card stays while sliding back, native collapse waits until the panel is gone, content glides", () => {
  const js = inj("laolao-sidebar-autohide.js");
  assert.match(js, /cardUntil = performance\.now\(\) \+ 220;/);
  // The attribute is written through a helper that takes the computed value.
  assert.match(js, /setAttr\(root, 'data-pinkie-sidebar-card', active && \(peek \|\| performance\.now\(\) < cardUntil\) \? '1' : null\)/);
  assert.match(js, /collapseTimer = setTimeout\(\(\) => \{\s*if \(!peek && auto && !collapsed\(\)\) nativeToggle\(\);/);
  assert.match(js, /if \(!auto && !collapsed\(\)\) \{\s*\/\/[^\n]*\n\s*event\.preventDefault\(\); event\.stopImmediatePropagation\(\);/);
  assert.match(js, /\['\.shell--chat \.chat-thread-inner', '\.shell--chat \.chat-thread'\]/);
  assert.match(js, /target\.animate\(\[\{transform: `translateX\(\$\{dx\.toFixed\(1\)\}px\)`\}, \{transform: 'translateX\(0\)'\}\]/);
});

test("the native session list can never show up next to ours", () => {
  assert.match(inj("laolao-sidebar.css"), /html\[data-laolao-sessions-managed\] \.shell--chat \.sidebar \.sidebar-recent-sessions\{display:none!important\}/);
  assert.match(inj("laolao-session-list.js"), /document\.documentElement\.setAttribute\('data-laolao-sessions-managed','1'\);/);
});

test("entry splash: the hole reveals the App at night, and the takeover never refocuses from blurry", () => {
  const night = inj("laolao-night.css");
  assert.match(night, /\.laolao-splash\.laolao-splash--fx \{ background-color: transparent !important; \}/);
  assert.match(night, /\.laolao-splash\.is-fx-leaving \.laolao-splash__gl \{ filter: brightness\(\.38\)/);
  const css = inj("laolao-splash.css");
  assert.match(css, /\.laolao-splash\.laolao-splash--fx::after \{ opacity: 0; transition: opacity 220ms linear; \}/);
  assert.doesNotMatch(css, /\.laolao-splash--fx::after \{ animation: none/);
  const fx = inj("laolao-splash-fx.js");
  assert.match(fx, /const m = \/blur\\\(\(\[\\d\.\]\+\)px\\\)\/\.exec\(filter\);/);
  assert.match(fx, /offset = focus >= \.995 \? OPENING : focus > 0 \? 300 \+ 850 \* unsmooth\(focus\) : 0;/);
});

test("finished entrance animations do not hold their last frame (keeps long threads cheap to resize)", () => {
  assert.match(inj("laolao-redesign.css"), /\.chat-thread :is\(\.chat-bubble, \.chat-group\) \{ animation-fill-mode: backwards !important; \}/);
  const card = inj("laolao-process-card.css");
  assert.doesNotMatch(card, /pinkie-process-in [^;]* both;/);
  assert.equal((card.match(/pinkie-process-in [^;]* backwards;/g) || []).length, 3);
});

test("fog layer uses pre-blurred small wallpapers instead of a live blur, and installers ship them", () => {
  const css = inj("laolao-redesign.css");
  assert.match(css, /html:not\(\[data-laolao-plain-composer\]\) \.card\.chat::before \{\s*background: var\(--laolao-wallpaper-soft\) center \/ cover fixed !important;\s*filter: none !important;/);
  assert.doesNotMatch(inj("laolao-night.css"), /\.card\.chat::before \{[^}]*blur\(/);
  const mac = read("installer/macos/apply-theme.sh"), win = read("installer/windows/apply-theme.ps1");
  for (const m of ["", "-project", "-thinking", "-learning", "-unrestricted"]) {
    const name = `laolao-wallpaper-soft${m}.jpg`;
    assert.ok(fs.existsSync(path.join(root, "ui/assets", name)), name);
    assert.ok(fs.statSync(path.join(root, "ui/assets", name)).size < 8000, `${name} stays tiny`);
    assert.ok(mac.includes(`    ${name} \\`), `mac ships ${name}`);
    assert.ok(win.includes(`"${name}",`), `windows ships ${name}`);
    assert.ok(css.includes(name), `css uses ${name}`);
  }
});

test("demo tool settings: values never clip, clean type, filled tracks, colours as a labelled row", () => {
  const js = inj("laolao-laser-pointer.js");
  assert.match(js, /#pinkie-laser-settings \.laser-row\{display:grid;grid-template-columns:60px minmax\(0,1fr\) 46px;/);
  assert.match(js, /#pinkie-laser-settings input\[type="range"\]\{--p:50%;width:100%;min-width:0;/);
  assert.match(js, /#pinkie-laser-settings\{[^}]*overflow-x:hidden;/);
  assert.doesNotMatch(js.slice(js.indexOf("#pinkie-laser-settings{"), js.indexOf("@keyframes laser-settings-in")), /letter-spacing/);
  assert.match(js, /input\.style\.setProperty\('--p', `\$\{\(\(Number\(input\.value\) - min\) \/ \(max - min\)\) \* 100\}%`\)/);
  assert.match(js, /colorLabel\.textContent = '颜色';/);
  assert.match(inj("laolao-night.css"), /#pinkie-laser-settings \.laser-row output \{ background: rgba\(255, 255, 255, \.08\) !important;/);
});

test("macOS installer bumps the sidebar surface and auto-hide cache keys on upgrade, not only on first install", () => {
  const mac = read("installer/macos/apply-theme.sh");
  assert.match(mac, /elif ! grep -Fq 'laolao-sidebar-surface\.css\?v=sidebarsurface7' "\$index_file"; then/);
  assert.match(mac, /elif ! grep -Fq 'laolao-sidebar-autohide\.js\?v=sidebarautohide8' "\$index_file"; then/);
});
