// M5 rework: real-page visual baseline regression suite.
// Installs openclaw@<runtime-manifest> in an isolated temp dir, applies Pinkie UI
// via tools/ui-parity/bundle.py and tools/assets/stamp.mjs, opens the real
// dist/control-ui/index.html with fake-gateway.js, and captures all 12 scenes x 2
// themes (24 PNGs) at fixed 1280x800.
//
// Baselines live ONLY in tests/visual/real-baseline/ (legacy tests/visual/baseline/
// is never modified).
//
// Modes:
// - PINKIE_VISUAL_UPDATE=1  : regenerate tests/visual/real-baseline/*.png
// - PINKIE_VISUAL_REPEAT=3  : capture N times in a row and assert 0.000% jitter
// - PINKIE_VISUAL_COMPARE=1 : force pixel diff against Linux baselines on non-Linux
// - PINKIE_VISUAL_ENGINE=msedge|chrome|chromium : override browser channel
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {allBaselineNames} from './visual/lib/harness.mjs';
import {
  REPO_ROOT,
  THEMES,
  VIEWPORT,
  VISUAL_SCENES,
  captureRealScenePng,
  installRealControlUi,
  launchRealBrowser,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';
import {comparePng, decodePng} from './visual/lib/png-diff.mjs';

const REAL_BASELINE_DIR = path.join(REPO_ROOT, 'tests/visual/real-baseline');
const REAL_DIFF_DIR = path.join(REPO_ROOT, 'tests/visual/diff-real');
const MAX_DIFF_PERCENT = 0.1;

const UPDATE_MODE = process.env.PINKIE_VISUAL_UPDATE === '1';
const REPEAT_COUNT = Math.max(1, Number.parseInt(process.env.PINKIE_VISUAL_REPEAT || '1', 10) || 1);
const STRICT_COMPARE = process.platform === 'linux' || process.env.PINKIE_VISUAL_COMPARE === '1';
const REPORT_DIFFS = process.env.PINKIE_VISUAL_REPORT === '1';

test('real-page visual baseline inventory covers all 12 scenes x 2 themes (24 PNGs)', {skip: UPDATE_MODE}, () => {
  const expected = allBaselineNames();
  assert.equal(expected.length, 24, 'expected 12 scenes x 2 themes = 24 real-page baselines');
  const missing = [];
  for (const name of expected) {
    const p = path.join(REAL_BASELINE_DIR, `${name}.png`);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `missing real-page visual baselines in tests/visual/real-baseline/: ${missing.join(', ')}`,
  );
});

test('real-page visual scenes render deterministically on real Control UI and stay within 0.1% diff', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  const server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT});
  const browser = await launchRealBrowser();
  const summary = [];

  t.after(async () => {
    await browser.close();
    await server.close();
    installed.cleanup();
  });

  if (UPDATE_MODE) {
    fs.mkdirSync(REAL_BASELINE_DIR, {recursive: true});
  }

  for (const scene of VISUAL_SCENES) {
    for (const theme of THEMES) {
      const name = `${scene.id}-${theme}`;
      await t.test(`real-scene ${name}`, async () => {
        const captures = [];
        for (let i = 0; i < REPEAT_COUNT; i += 1) {
          const {png, pageErrors, failedRequests} = await captureRealScenePng(browser, server.origin, scene.id, theme);
          assert.deepEqual(pageErrors, [], `${name} run ${i + 1} had pageerror: ${pageErrors.join('; ')}`);
          assert.deepEqual(failedRequests, [], `${name} run ${i + 1} had failed asset requests: ${failedRequests.join('; ')}`);
          const decoded = decodePng(png);
          assert.equal(decoded.width, VIEWPORT.width, `${name} width mismatch`);
          assert.equal(decoded.height, VIEWPORT.height, `${name} height mismatch`);
          captures.push({png, decoded});
        }

        // Determinism check: repeated captures on the same host must be 0 px different
        for (let i = 1; i < captures.length; i += 1) {
          const repeatDiff = comparePng(captures[0].png, captures[i].png, {channelTolerance: 0});
          assert.equal(
            repeatDiff.diffPixels,
            0,
            `${name} non-deterministic real render: run 1 vs run ${i + 1} differed by ${repeatDiff.diffPixels} px (${repeatDiff.diffPercent.toFixed(4)}%)`,
          );
        }

        const baselinePath = path.join(REAL_BASELINE_DIR, `${name}.png`);
        if (UPDATE_MODE) {
          fs.writeFileSync(baselinePath, captures[0].png);
          summary.push({name, status: 'updated', bytes: captures[0].png.length});
          return;
        }

        assert.ok(fs.existsSync(baselinePath), `missing real baseline file: ${baselinePath}`);
        const baselineBuf = fs.readFileSync(baselinePath);
        const diff = comparePng(baselineBuf, captures[0].png, {channelTolerance: 0, writeDiff: true});
        summary.push({
          name,
          diffPixels: diff.diffPixels,
          diffPercent: Number(diff.diffPercent.toFixed(4)),
          strict: STRICT_COMPARE,
        });

        if (STRICT_COMPARE && diff.diffPercent > MAX_DIFF_PERCENT) {
          fs.mkdirSync(REAL_DIFF_DIR, {recursive: true});
          fs.writeFileSync(path.join(REAL_DIFF_DIR, `${name}.actual.png`), captures[0].png);
          if (diff.diffPng) {
            fs.writeFileSync(path.join(REAL_DIFF_DIR, `${name}.diff.png`), diff.diffPng);
          }
          assert.fail(
            `${name} real-page visual diff ${diff.diffPercent.toFixed(4)}% (${diff.diffPixels}/${diff.totalPixels} px) exceeds ${MAX_DIFF_PERCENT}% limit`,
          );
        }
      });
    }
  }

  if (REPORT_DIFFS) {
    console.log('[real-visual-baseline-report]', JSON.stringify({
      platform: process.platform,
      openclawVersion: installed.version,
      engine: process.env.PINKIE_VISUAL_ENGINE || 'default',
      repeat: REPEAT_COUNT,
      strict: STRICT_COMPARE,
      scenes: summary,
    }));
  }
});
