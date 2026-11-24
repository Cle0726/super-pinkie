// M3-1 region ownership guard:
// 1. Every file in ui/injections/laolao-head.fragment.html must be assigned in ui/injections/regions.json.
// 2. Every file listed in regions.json must exist under ui/injections/.
// 3. No non-owning CSS file may author a selector starting with another region's root selector.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const INJECTIONS_DIR = path.join(REPO_ROOT, 'ui/injections');
const REGIONS_PATH = path.join(INJECTIONS_DIR, 'regions.json');
const HEAD_PATH = path.join(INJECTIONS_DIR, 'laolao-head.fragment.html');

function extractTopLevelSelectors(cssText) {
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '{') {
      const header = buf.trim();
      buf = '';
      if (header && !header.startsWith('@')) {
        for (const part of header.split(',')) {
          const sel = part.trim();
          if (sel) selectors.push(sel);
        }
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      buf = '';
    } else if (ch === ';' && depth === 0) {
      buf = '';
    } else if (depth === 0 || (depth === 1 && !buf.includes(':'))) {
      buf += ch;
    }
  }
  return selectors;
}

function selectorStartsWithRoot(selector, root) {
  if (!selector.startsWith(root)) return false;
  const next = selector[root.length];
  return next === undefined || /[\s>+~:.[,\[]/.test(next);
}

test('regions.json covers every injection file in laolao-head.fragment.html and all paths exist', () => {
  const config = JSON.parse(fs.readFileSync(REGIONS_PATH, 'utf8'));
  const head = fs.readFileSync(HEAD_PATH, 'utf8');
  const headFiles = [...new Set([...head.matchAll(/(?:href|src)="\/([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]))];

  const mapped = new Set();
  const missingOnDisk = [];
  for (const region of config.regions) {
    for (const file of region.files) {
      mapped.add(file);
      const full = path.join(INJECTIONS_DIR, file);
      if (!fs.existsSync(full)) missingOnDisk.push(`${region.id}:${file}`);
    }
  }

  const unmapped = headFiles.filter((f) => !mapped.has(f));
  assert.deepEqual(unmapped, [], `head fragment files missing from regions.json: ${unmapped.join(', ')}`);
  assert.deepEqual(missingOnDisk, [], `files in regions.json missing on disk: ${missingOnDisk.join(', ')}`);
});

test('non-owning CSS files must not start selectors with another region root selector', () => {
  const config = JSON.parse(fs.readFileSync(REGIONS_PATH, 'utf8'));
  const commonCss = new Set(config.commonCrossCuttingCss || []);
  const cssFiles = fs.readdirSync(INJECTIONS_DIR).filter((f) => f.endsWith('.css')).sort();

  const violations = [];
  for (const cssFile of cssFiles) {
    if (commonCss.has(cssFile)) continue;
    const text = fs.readFileSync(path.join(INJECTIONS_DIR, cssFile), 'utf8');
    const selectors = extractTopLevelSelectors(text);

    for (const region of config.regions) {
      if (!region.rootSelectors || region.rootSelectors.length === 0) continue;
      const owners = new Set([...(region.files || []), ...(region.allowedCrossRegionCss || [])]);
      if (owners.has(cssFile)) continue;

      for (const sel of selectors) {
        for (const root of region.rootSelectors) {
          if (selectorStartsWithRoot(sel, root)) {
            violations.push(`${cssFile} -> forbidden selector "${sel}" (owned by region "${region.id}" root "${root}")`);
          }
        }
      }
    }
  }

  assert.deepEqual(violations, [], `CSS region ownership violations:\n${violations.join('\n')}`);
});
