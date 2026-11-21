// M5 visual baseline regression suite.
// Captures all 12 Control UI scenes x 2 themes (day/night) = 24 PNGs in a
// deterministic headless browser (fixed 1280x800, bundled font, reduced motion,
// frozen clock, fake gateway) and verifies pixel diff <= 0.1%.
//
// Modes:
// - PINKIE_VISUAL_UPDATE=1  : regenerate tests/visual/baseline/*.png
// - PINKIE_VISUAL_REPEAT=3  : capture N times in a row and assert 0.000% jitter
// - PINKIE_VISUAL_COMPARE=1 : force pixel diff against Linux baselines on non-Linux
// - PINKIE_VISUAL_ENGINE=msedge|chrome|chromium : override browser channel
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REPO_ROOT,
  THEMES,
  VIEWPORT,
  VISUAL_SCENES,
  allBaselineNames,
  captureScenePng,
  launchVisualBrowser,
  startVisualServer,
} from './visual/lib/harness.mjs';
import {comparePng, decodePng} from './visual/lib/png-diff.mjs';

const BASELINE_DIR = path.join(REPO_ROOT, 'tests/visual/baseline');
const DIFF_DIR = path.join(REPO_ROOT, 'tests/visual/diff');
const MAX_DIFF_PERCENT = 0.1;

const UPDATE_MODE = process.env.PINKIE_VISUAL_UPDATE === '1';
const REPEAT_COUNT = Math.max(1, Number.parseInt(process.env.PINKIE_VISUAL_REPEAT || '1', 10) || 1);
const STRICT_COMPARE = process.platform === 'linux' || process.env.PINKIE_VISUAL_COMPARE === '1';
const REPORT_DIFFS = process.env.PINKIE_VISUAL_REPORT === '1';

test('visual baseline inventory covers all 12 scenes x 2 themes (24 PNGs)', {skip: UPDATE_MODE}, () => {
  const expected = allBaselineNames();
  assert.equal(expected.length, 24, 'expected 12 scenes x 2 themes = 24 baselines');
  const missing = [];
  for (const name of expected) {
    const filePath = path.join(BASELINE_DIR, `${name}.png`);
    if (!fs.existsSync(filePath)) {
      missing.push(name);
      continue;
    }
    const buf = fs.readFileSync(filePath);
    const decoded = decodePng(buf);
    assert.equal(decoded.width, VIEWPORT.width, `${name}.png width mismatch`);
    assert.equal(decoded.height, VIEWPORT.height, `${name}.png height mismatch`);
  }
  assert.deepEqual(missing, [], `missing baseline PNGs: ${missing.join(', ')}`);
});

test('visual baseline rendering, determinism, and pixel diff check', async () => {
  const server = await startVisualServer();
  const browser = await launchVisualBrowser();
  const diffSummary = [];

  try {
    if (UPDATE_MODE) {
      fs.mkdirSync(BASELINE_DIR, {recursive: true});
    }

    for (const scene of VISUAL_SCENES) {
      for (const theme of THEMES) {
        const name = `${scene.id}-${theme}`;
        const captures = [];
        for (let run = 0; run < REPEAT_COUNT; run += 1) {
          const {png, pageErrors} = await captureScenePng(browser, server.origin, scene.id, theme);
          assert.deepEqual(pageErrors, [], `${name} run ${run + 1} had pageerror: ${pageErrors.join('; ')}`);
          const decoded = decodePng(png);
          assert.equal(decoded.width, VIEWPORT.width, `${name} width must be ${VIEWPORT.width}`);
          assert.equal(decoded.height, VIEWPORT.height, `${name} height must be ${VIEWPORT.height}`);
          captures.push(png);
        }

        if (REPEAT_COUNT > 1) {
          for (let run = 1; run < captures.length; run += 1) {
            const repeatDiff = comparePng(captures[0], captures[run], {channelTolerance: 0});
            assert.equal(
              repeatDiff.diffPixels,
              0,
              `${name} non-deterministic render: run 1 vs run ${run + 1} differed by ${repeatDiff.diffPixels} px (${repeatDiff.diffPercent.toFixed(4)}%)`,
            );
          }
        }

        const firstPng = captures[0];
        if (UPDATE_MODE) {
          fs.writeFileSync(path.join(BASELINE_DIR, `${name}.png`), firstPng);
          continue;
        }

        if (!STRICT_COMPARE) continue;

        const baselinePath = path.join(BASELINE_DIR, `${name}.png`);
        assert.ok(fs.existsSync(baselinePath), `missing baseline ${baselinePath}`);
        const expectedPng = fs.readFileSync(baselinePath);
        const diff = comparePng(firstPng, expectedPng);
        diffSummary.push({name, diffPercent: diff.diffPercent, diffPixels: diff.diffPixels});

        if (diff.diffPercent > MAX_DIFF_PERCENT) {
          fs.mkdirSync(DIFF_DIR, {recursive: true});
          const actualPath = path.join(DIFF_DIR, `${name}-actual.png`);
          const diffPath = path.join(DIFF_DIR, `${name}-diff.png`);
          fs.writeFileSync(actualPath, firstPng);
          if (diff.diffPngBuffer) fs.writeFileSync(diffPath, diff.diffPngBuffer);
          assert.fail(
            `${name} exceeded visual threshold: ${diff.diffPercent.toFixed(4)}% > ${MAX_DIFF_PERCENT}% `
            + `(${diff.diffPixels}/${diff.totalPixels} px). Actual: ${actualPath}, Diff: ${diffPath}`,
          );
        }
      }
    }

    if (REPORT_DIFFS && diffSummary.length > 0) {
      const lines = diffSummary.map((d) => `${d.name}: ${d.diffPercent.toFixed(4)}% (${d.diffPixels} px)`);
      console.log(`[visual-baseline] summary (${process.platform}, engine=${process.env.PINKIE_VISUAL_ENGINE || 'default'}):\n${lines.join('\n')}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
