// Engine menu, night (assist pre-review of #120, 11-25 04:36): the line under the "Engine" title was #272725 on the
// #232321 panel (1.05:1) and the hovered row was --mk-hover, mixed over --metre-bg (darker than the panel at night),
// so it came out 1.01:1 — you could not tell which row the pointer was on. Now the separator and the hovered / pressed
// rows are mixed over the panel colour itself, so they show in day and night alike, and text on them stays readable.
// Measured on real computed styles (the Metre skin + keys + engine CSS), day and night, with a counter-example that puts
// main's colours back and checks the same measurement would have failed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const js = read('laolao-metre-engine.js');
const css = ['laolao-metre-skin.css', 'laolao-metre-board.css', 'laolao-metre-keys.css', 'laolao-metre-engine.css'].map(read).join('\n');
// What main had: separator on --metre-line, hover on the keys file's own --mk-hover (6% text over --metre-bg).
const MAIN = `.pk-eng-menu { --pk-menu-rule: var(--metre-line); --mk-hover: color-mix(in srgb, var(--metre-text) 6%, var(--metre-bg)); }`;

const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

test('in a browser: the engine menu separator and hovered row can be seen on the panel, day and night', {timeout: 90_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    for (const [night, old] of [[false, false], [true, false], [false, true], [true, true]]) {
      const tab = await browser.newPage({viewport: {width: 1024, height: 768}});
      const page = `<!doctype html><html data-laolao-mode="metre"${night ? ' data-pinkie-night="1"' : ''}><head><style>${css}</style>${old ? `<style>${MAIN}</style>` : ''}</head><body style="margin:0">
        <div class="chat-main" style="position:relative;height:100vh"><div class="chat-thread">native</div>
        <div class="agent-chat__composer-controls"><div class="pinkie-chip pinkie-baton"></div></div></div></body></html>`;
      await tab.route('http://127.0.0.1:30118/**', route => route.fulfill({contentType: 'text/html', body: page}));
      await tab.goto('http://127.0.0.1:30118/chat?session=agent%3Ametre%3Ab');
      await tab.evaluate(() => {
        const row = (id, name) => ({id, name, state: 'ready', text: '', enabled: true, installed: true, signedIn: true, quota: {state: 'unknown'},
          setup: {canInstall: false, canAuthenticate: false}, guide: {install: '', login: '', loginHint: '', link: '', note: '', managedInstall: false, managedSignin: false},
          models: [{slug: 'm1', name: 'Model One', isDefault: true}]});
        const levels = [{id: 'ask', name: '先问我', hint: ''}, {id: 'auto', name: '只改文件', hint: ''}];
        window.__laolaoToast = () => {};
        window.__laolaoSidebar = {gwRequest: async method => {
          if (method === 'pinkie.engines.session') return {sessionKey: 'agent:metre:b', pref: {engine: 'metre'}, summary: null, error: '', service: {running: true}};
          if (method === 'pinkie.engines.catalog') return {enabled: true, running: true, source: 'live', levels, engines: [row('claudeAgent', 'Claude Code'), row('codex', 'Codex')]};
          return {};
        }};
      });
      await tab.addScriptTag({content: js});
      const chip = tab.locator('.agent-chat__composer-controls > .pk-eng-chip');
      await chip.waitFor({timeout: 10_000});
      await chip.click();
      await tab.locator('.pk-eng-menu__levels').waitFor();
      const item = tab.locator('.pk-eng-menu__item:not([aria-checked="true"])').first();
      await item.hover();
      await tab.waitForTimeout(300); // the keys file fades the hover in over 120ms
      const got = await tab.evaluate(() => {
        const rgb = text => { const n = (text.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(text) ? n.slice(0, 3).map(v => Math.round(v * 255)) : n.slice(0, 3); };
        const menu = document.querySelector('.pk-eng-menu'), s = e => getComputedStyle(e);
        const hovered = [...menu.querySelectorAll('.pk-eng-menu__item')].find(e => e.matches(':hover'));
        const probe = document.createElement('i'); probe.style.color = 'var(--mk-run)'; menu.append(probe);
        const out = {panel: rgb(s(menu).backgroundColor), head: rgb(s(menu.querySelector('.pk-eng-menu__head')).borderBottomColor),
          levels: rgb(s(menu.querySelector('.pk-eng-menu__levels')).borderTopColor), hover: rgb(s(hovered).backgroundColor),
          text: rgb(s(hovered.querySelector('.pk-eng-menu__name')).color), focus: rgb(s(probe).color)};
        probe.remove();
        const note = hovered.querySelector('.pk-eng-menu__note'); if (note) out.note = rgb(s(note).color);
        return out;
      });
      const at = `${night ? 'night' : 'day'}${old ? ' (main colours)' : ''}`;
      const head = ratio(got.head, got.panel), levels = ratio(got.levels, got.panel), hover = ratio(got.hover, got.panel);
      if (old) {
        assert.ok(Math.min(head, hover) < 1.3, `${at}: counter-example — with main's colours the same measurement is too faint (head ${head}, hover ${hover})`);
      } else {
        assert.ok(head >= 1.5, `${at}: the line under the title shows on the panel (${head}:1, got ${got.head} on ${got.panel})`);
        assert.ok(levels >= 1.5, `${at}: the line above the levels shows on the panel (${levels}:1)`);
        assert.ok(hover >= 1.3, `${at}: the hovered row shows on the panel (${hover}:1, got ${got.hover} on ${got.panel})`);
        assert.ok(ratio(got.text, got.hover) >= 4.5, `${at}: the row name stays readable on the hover (${ratio(got.text, got.hover)}:1)`);
        if (got.note) assert.ok(ratio(got.note, got.hover) >= 3, `${at}: the grey note stays readable on the hover (${ratio(got.note, got.hover)}:1)`);
        assert.ok(ratio(got.focus, got.panel) >= 3, `${at}: the keyboard focus ring shows on the panel (${ratio(got.focus, got.panel)}:1)`);
      }
      await tab.close();
    }
  } finally { await browser.close(); }
});
