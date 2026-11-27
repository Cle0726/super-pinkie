// B11·C1 (#375 chat walkthrough, docs/b11-walkthrough/chat.md C1): on the day chat start page the pink chat glyph left of
// each "继续之前的工作" row was the bare accent #e94f91 on a 14% accent square, under the 3:1 a UI icon needs. The page behind
// the rows is itself tinted (real page and real baselines read ~rgb(252,233..238,241)), so the bare accent is near 3:1 before
// any square is added and lightening the square cannot get there; on day pages the glyph is now the accent mixed with 15% black.
// Measured on real computed styles (theme + night + start page CSS) for all five modes, day over white and over the tinted
// backdrop, night over a dark backdrop, with a counter-example that puts main's glyph back and checks it would have failed.
// The DOM mirrors the real start page: the recent list is a sibling of .laolao-startup-home, not inside it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = name => fs.readFileSync(fileURLToPath(new URL('../ui/injections/' + name, import.meta.url)), 'utf8');
const css = ['laolao-theme.css', 'laolao-night.css', 'laolao-startup-home.css'].map(read).join('\n');
const MAIN = `html .laolao-startup-home__recent .laolao-startup-home__icon { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }`;
const MODES = ['chat', 'project', 'thinking', 'learning', 'unrestricted'];
const BACKDROPS = {day: ['#ffffff', 'rgb(252, 233, 241)', 'rgb(252, 238, 241)'], night: ['#141017']};

const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };

test('in a browser: the start page chat glyph shows on its square at 3:1, every mode, day and night', {timeout: 120_000}, async t => {
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  try {
    const failedOnMain = [];
    for (const old of [false, true]) {
      // One page per stylesheet set; mode and night are switched on <html> in place (a fresh WebKit page per
      // combination is slow enough on a loaded runner to blow the timeout).
      const tab = await browser.newPage({viewport: {width: 800, height: 600}});
      const page = `<!doctype html><html data-theme="light" data-laolao-startup-home="1" data-laolao-startup-ready="1">
        <head><style>${css}</style>${old ? `<style>${MAIN}</style>` : ''}</head><body style="margin:0"><div class="chat-main">
        <div class="laolao-startup-home"></div>
        <section class="laolao-startup-home__recent"><h3>继续之前的工作</h3>
        <button class="laolao-startup-home__item" type="button"><span class="laolao-startup-home__icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg></span>
        <span class="laolao-startup-home__item-body"><span class="laolao-startup-home__item-title">单词小游戏</span></span></button></section></div></body></html>`;
      await tab.route('http://127.0.0.1:30119/**', route => route.request().resourceType() === 'document'
        ? route.fulfill({contentType: 'text/html', body: page}) : route.fulfill({status: 204, body: ''}));
      await tab.goto('http://127.0.0.1:30119/chat', {waitUntil: 'domcontentloaded'});
      for (const night of [false, true]) {
        for (const mode of MODES) {
          const got = await tab.evaluate(({mode, night, backdrops}) => {
            const html = document.documentElement;
            html.setAttribute('data-laolao-mode', mode);
            if (night) html.setAttribute('data-pinkie-night', '1'); else html.removeAttribute('data-pinkie-night');
            // Composite each computed colour over what is under it on a 1x1 canvas, so the browser itself turns whatever
            // color-mix() serialises to into opaque sRGB 0–255.
            const ctx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
            const paint = (...layers) => {
              ctx.clearRect(0, 0, 1, 1);
              for (const c of layers) { ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
              return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
            };
            const icon = document.querySelector('.laolao-startup-home__recent .laolao-startup-home__icon'), svg = icon.querySelector('svg');
            const square = getComputedStyle(icon).backgroundColor, stroke = getComputedStyle(svg).stroke;
            return backdrops.map(backdrop => ({backdrop, bg: paint(backdrop, square), fg: paint(backdrop, square, stroke), raw: `${square} | ${stroke}`}));
          }, {mode, night, backdrops: BACKDROPS[night ? 'night' : 'day']});
          for (const one of got) {
            const k = ratio(one.fg, one.bg), at = `${mode} ${night ? 'night' : 'day'} over ${one.backdrop}`;
            if (old) { if (k < 3) failedOnMain.push(`${at} ${k}`); }
            else assert.ok(k >= 3, `${at}: the chat glyph shows on its square (${k}:1, got ${one.fg} on ${one.bg}; computed: ${one.raw})`);
          }
        }
      }
      await tab.close();
    }
    assert.ok(failedOnMain.some(s => s.startsWith('chat day over rgb')),
      `counter-example — with main's glyph the day chat icon on the tinted page measures under 3:1 (under 3 on main: ${failedOnMain.join(', ') || 'none'})`);
  } finally { await browser.close(); }
});
