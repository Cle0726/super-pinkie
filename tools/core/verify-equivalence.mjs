#!/usr/bin/env node
// K2 proof that C.le. is the same core as npm openclaw: same dependency tree in
// the same places, same bytes in every file that is executed or served.
// Run it on freshly installed prefixes and again after patching both of them.
//
//   node tools/core/verify-equivalence.mjs --openclaw-prefix <dir> --cle-prefix <dir>
//
// The screenshot and unit suites render repository fixtures and do not load the
// installed core, so they cannot replace this check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Files that legitimately differ between two builds of the same source and are
// neither executed nor served to the page.
const IGNORED = [
  /(^|\/)\.pinkie-backups\//, // timestamped backups written by the patches
  /\.d\.[cm]?ts$/, // type declarations
  /^dist\/(.+\/)?\.[^/]*(stamp|hash)$/, // build cache stamps
  /^dist\/(build-info|postinstall-inventory|cli-startup-metadata)\.json$/, // timestamps and file lists
  /^CHANGELOG\.md$/,
  /^docs\//,
  /^cle-vendor\//, // the @openclaw/ai tarball, compared below as installed files
  /^(package|npm-shrinkwrap)\.json$/, // compared field by field below
];
const PACKAGE_FIELDS = ['name', 'version', 'type', 'main', 'bin', 'exports', 'dependencies', 'optionalDependencies', 'engines'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = (value) => JSON.stringify(value, (_key, inner) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
    : inner
));

function listFiles(root, dir = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') listFiles(root, rel, out);
    } else if (!IGNORED.some((pattern) => pattern.test(rel))) {
      out.push(rel);
    }
  }
  return out;
}

function dependencyTree(modules, prefix = '', out = new Map()) {
  if (!fs.existsSync(modules)) return out;
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    const names = entry.startsWith('@')
      ? fs.readdirSync(path.join(modules, entry)).map((child) => `${entry}/${child}`)
      : [entry];
    for (const name of names) {
      const manifest = path.join(modules, name, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const key = `${prefix}node_modules/${name}`;
      out.set(key, readJson(manifest).version);
      dependencyTree(path.join(modules, name, 'node_modules'), `${key}/`, out);
    }
  }
  return out;
}

function compareFiles(expected, actual, label, problems) {
  const want = new Set(listFiles(expected));
  const have = new Set(listFiles(actual));
  for (const file of want) {
    if (!have.has(file)) problems.push(`${label}: missing ${file}`);
    else if (!fs.readFileSync(path.join(expected, file)).equals(fs.readFileSync(path.join(actual, file)))) {
      problems.push(`${label}: changed ${file}`);
    }
  }
  for (const file of have) if (!want.has(file)) problems.push(`${label}: unexpected ${file}`);
  return want.size;
}

export function compareCores(openclawPrefix, clePrefix) {
  const problems = [];
  const wantTree = dependencyTree(path.join(openclawPrefix, 'node_modules'));
  const haveTree = dependencyTree(path.join(clePrefix, 'node_modules'));
  for (const key of new Set([...wantTree.keys(), ...haveTree.keys()])) {
    if (wantTree.get(key) !== haveTree.get(key)) {
      problems.push(`dependency ${key}: ${wantTree.get(key) ?? 'absent'} -> ${haveTree.get(key) ?? 'absent'}`);
    }
  }

  const wantRoot = path.join(openclawPrefix, 'node_modules/openclaw');
  const haveRoot = path.join(clePrefix, 'node_modules/openclaw');
  const wantPkg = readJson(path.join(wantRoot, 'package.json'));
  const havePkg = readJson(path.join(haveRoot, 'package.json'));
  for (const field of PACKAGE_FIELDS) {
    if (canonical(wantPkg[field]) !== canonical(havePkg[field])) problems.push(`package.json: changed ${field}`);
  }

  let files = compareFiles(wantRoot, haveRoot, 'openclaw', problems);
  const ai = 'node_modules/@openclaw/ai/dist';
  if (!fs.existsSync(path.join(wantRoot, ai)) || !fs.existsSync(path.join(haveRoot, ai))) {
    problems.push(`@openclaw/ai: ${ai} must exist inside both cores`);
  } else {
    files += compareFiles(path.join(wantRoot, ai), path.join(haveRoot, ai), '@openclaw/ai', problems);
  }
  return { dependencies: wantTree.size, files, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) {
      console.error(`[verify-equivalence] ${name} <dir> is required`);
      process.exit(2);
    }
    return path.resolve(process.argv[index + 1]);
  };
  const result = compareCores(arg('--openclaw-prefix'), arg('--cle-prefix'));
  console.log(`[verify-equivalence] dependencies=${result.dependencies} files=${result.files} problems=${result.problems.length}`);
  for (const problem of result.problems.slice(0, 80)) console.log(`  ${problem}`);
  if (result.problems.length) process.exitCode = 1;
}
