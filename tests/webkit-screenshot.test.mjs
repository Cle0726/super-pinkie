// Regression tests for macOS WebKit 0-byte page.screenshot() screencast fallback
// and CI failure artifact capture (tests/visual/lib/webkit-screenshot.mjs & tools/ci/run-macos-webkit.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';
import {decodePng} from './visual/lib/png-diff.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('WebKit page.screenshot() returns non-empty sRGB PNG and supports clip on macOS', {timeout: 60_000}, async (t) => {
  let pw;
  try { pw = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  let browser;
  try { browser = await pw.webkit.launch({headless: true}); }
  catch (err) { t.skip(`WebKit is not installed: ${err.message.split('\n')[0]}`); return; }

  try {
    const page = await browser.newPage({viewport: {width: 240, height: 120}, deviceScaleFactor: 1});
    await page.setContent(
      '<!doctype html><body style="margin:0">'
      + '<div style="position:fixed;left:0;top:0;width:120px;height:120px;background:rgb(255,0,0)"></div>'
      + '<div style="position:fixed;left:120px;top:0;width:120px;height:120px;background:rgb(0,180,60)"></div>'
      + '</body>',
    );
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-wkshot-test-'));
    t.after(() => fs.rmSync(outDir, {recursive: true, force: true}));

    const fullPath = path.join(outDir, 'full.png');
    const fullBuf = await page.screenshot({path: fullPath});
    // The bug was a 0-byte buffer. Two flat colour blocks compress to ~470 bytes on Linux/Windows WebKit, so no size floor.
    assert.ok(fullBuf.length > 0 && fullBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      `expected a non-empty PNG buffer, got ${fullBuf.length} bytes`);
    assert.equal(fs.statSync(fullPath).size, fullBuf.length);
    const fullImg = decodePng(fullBuf);
    assert.equal(fullImg.width, 240);
    assert.equal(fullImg.height, 120);

    // Verify pure sRGB red (255,0,0) does not drift to Display P3 raw (234,51,35) after clip.
    const leftClip = decodePng(await page.screenshot({clip: {x: 10, y: 10, width: 80, height: 80}}));
    assert.equal(leftClip.width, 80);
    assert.equal(leftClip.height, 80);
    const redIdx = (40 * 80 + 40) * 4;
    assert.ok(leftClip.data[redIdx] >= 250 && leftClip.data[redIdx + 1] <= 5 && leftClip.data[redIdx + 2] <= 5,
      `expected sRGB red near (255,0,0), got (${leftClip.data[redIdx]},${leftClip.data[redIdx + 1]},${leftClip.data[redIdx + 2]})`);

    const rightClip = decodePng(await page.screenshot({clip: {x: 130, y: 10, width: 80, height: 80}}));
    const greenIdx = (40 * 80 + 40) * 4;
    assert.ok(rightClip.data[greenIdx] <= 10 && rightClip.data[greenIdx + 1] >= 170 && rightClip.data[greenIdx + 2] <= 70,
      `expected sRGB green near (0,180,60), got (${rightClip.data[greenIdx]},${rightClip.data[greenIdx + 1]},${rightClip.data[greenIdx + 2]})`);
  } finally {
    await browser.close();
  }
});

test('run-macos-webkit saves failure TAP log and non-empty WebKit screenshot on test failure', {
  skip: process.platform !== 'darwin' ? 'macOS WebKit CI runner hook test' : false,
  timeout: 90_000,
}, async (t) => {
  let pw;
  try {
    pw = playwright();
    const probe = await pw.webkit.launch({headless: true});
    await probe.close();
  } catch (err) {
    t.skip(`WebKit is not installed: ${err.message.split('\n')[0]}`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-webkit-runner-test-'));
  t.after(() => fs.rmSync(tmpDir, {recursive: true, force: true}));

  const sampleTest = path.join(tmpDir, 'webkit-only-fail.test.mjs');
  const harnessUrl = new URL('../tools/study-desk/harness.mjs', import.meta.url).href;
  fs.writeFileSync(
    sampleTest,
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\n`
    + `import {playwright} from ${JSON.stringify(harnessUrl)};\n`
    + `const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';\n`
    + `test('deliberate WebKit-only failure captures screenshot', async () => {\n`
    + `  const browser = await playwright()[engine].launch({headless: true});\n`
    + `  try {\n`
    + `    const page = await browser.newPage({viewport: {width: 320, height: 200}});\n`
    + `    await page.setContent('<body style="background:#204080;color:#fff"><h1>webkit-fail</h1></body>');\n`
    + `    const ua = await page.evaluate(() => navigator.userAgent);\n`
    + `    assert.ok(!/AppleWebKit/.test(ua) || /Chrome\\//.test(ua), 'WebKit-only failure triggered: ' + ua);\n`
    + `  } finally { await browser.close(); }\n`
    + `});\n`,
  );

  const listPath = path.join(tmpDir, 'webkit-ci.list');
  const artifactDir = path.join(tmpDir, 'artifacts');
  fs.writeFileSync(listPath, `# sample\n${sampleTest}\n`);

  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools/ci/run-macos-webkit.mjs'), '--list', listPath, '--artifact-dir', artifactDir,
      '--concurrency', '1', '--max-minutes', '5'],
    {cwd: ROOT, env: process.env, encoding: 'utf8'},
  );
  assert.equal(res.status, 1, `runner must exit 1 on failure:\n${res.stdout}\n${res.stderr}`);
  const summary = JSON.parse(fs.readFileSync(path.join(artifactDir, 'summary.json'), 'utf8'));
  assert.equal(summary.ok, false);
  assert.equal(summary.failedFiles, 1);
  assert.ok(summary.failureScreenshots.length >= 1, `expected >= 1 failure screenshot, got ${JSON.stringify(summary)}`);
  const shotFile = path.join(artifactDir, 'screenshots', summary.failureScreenshots[0]);
  assert.ok(fs.statSync(shotFile).size > 500, 'failure screenshot must be non-empty PNG');
  assert.ok(fs.existsSync(path.join(artifactDir, 'logs/webkit-only-fail.test.tap.log')), 'failure TAP log must exist');
});
