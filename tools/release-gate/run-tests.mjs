#!/usr/bin/env node
// Release gate for the Node test suite.
//
// Runs every tests/*.test.{cjs,mjs} file on its own and compares the failures
// with tools/release-gate/known-failures.json.  The gate fails when
//   - a test fails that is not on the list (a new regression), or
//   - a listed test now passes (the list must shrink with the fix).
// Each listed entry carries the reason it is red, so the list is a to-do of
// drift between tests and code, not a place to hide breakage.
//
//   node tools/release-gate/run-tests.mjs [--update] [--jobs 4]
//
// --update rewrites the list from the current results (keeps old reasons).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const listPath = path.join(root, "tools/release-gate/known-failures.json");
const args = process.argv.slice(2);
const update = args.includes("--update");
const jobs = Number(args[args.indexOf("--jobs") + 1]) || Math.max(2, Math.min(6, os.cpus().length));

const files = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
  .sort()
  .map((name) => `tests/${name}`);

function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolve({ file, code, output }));
  });
}

// Top-level and nested `not ok` lines name the failing tests.  A file that
// cannot even load is reported once under its own name.
function failures({ file, code, output }) {
  const names = [];
  for (const line of output.split("\n")) {
    const match = /^\s*not ok \d+ - (.+?)(?: # .*)?$/.exec(line);
    if (match) names.push(match[1].trim());
  }
  if (code !== 0 && names.length === 0) names.push("<file failed>");
  return [...new Set(names)].map((name) => `${file} :: ${name}`);
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < files.length) {
    const file = files[next++];
    results.push(await runFile(file));
  }
}));

const failed = new Set(results.flatMap(failures));
const known = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, "utf8")) : {};
const unexpected = [...failed].filter((key) => !(key in known)).sort();
const fixed = Object.keys(known).filter((key) => !failed.has(key)).sort();

if (update) {
  const next = {};
  for (const key of [...failed].sort()) next[key] = known[key] || "TODO: explain why this test is red";
  fs.writeFileSync(listPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`known-failures.json updated: ${failed.size} entries`);
  process.exit(0);
}

console.log(`${files.length} test files, ${failed.size} failing tests, ${Object.keys(known).length} known`);
for (const key of unexpected) {
  console.log(`NEW FAILURE  ${key}`);
  const result = results.find((item) => key.startsWith(item.file + " ::"));
  if (result) console.log(result.output.split("\n").filter((line) => /not ok|Error|expected|actual/.test(line)).slice(0, 12).join("\n"));
}
for (const key of fixed) console.log(`NOW PASSING  ${key}  (remove it from known-failures.json)`);
process.exit(unexpected.length || fixed.length ? 1 : 0);
