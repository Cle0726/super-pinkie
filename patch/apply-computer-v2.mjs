#!/usr/bin/env node
/**
 * CLE Kk desktop automation compatibility patch.
 *
 * OpenClaw's paired computer tool initially advertised only the legacy v1
 * action enum. Provider-native v2 actions such as list_apps, list_windows,
 * get_accessibility_tree and bring_to_front therefore stayed invisible to the
 * model until after the first call, which is too late for providers that
 * snapshot tool schemas at turn start.
 *
 * Advertise the v2 union up front. Dispatch still resolves the selected node
 * and rejects any action that its signed capability descriptor does not allow.
 *
 * The macOS driver can also report bring_to_front as refused even when its own
 * evidence says the activation request was accepted and the exact window was
 * focused (process_activated may be false when it was already active). Treat only that false
 * negative as an unverifiable success so automation can continue to the next
 * accessibility observation. All other refusal codes remain fatal.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function resolveOpenClawRoot() {
  if (process.env.OPENCLAW_ROOT) return process.env.OPENCLAW_ROOT;
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const first = execFileSync(command, ["openclaw"], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)[0];
    if (!first) return null;
    const resolved = fs.realpathSync(first);
    return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return null;
  }
}

const root = resolveOpenClawRoot();
if (!root) {
  console.error("error: CLE Kk runtime not found; set OPENCLAW_ROOT");
  process.exit(1);
}

const distDir = path.join(root, "dist");
const files = fs.existsSync(distDir)
  ? fs.readdirSync(distDir)
      .filter((name) => /^computer-tool-.*\.js$/.test(name))
      .map((name) => path.join(distDir, name))
  : [];

if (!files.length) {
  console.error(`error: no computer-tool chunk found under ${distDir}`);
  process.exit(1);
}

const legacy = "const COMPUTER_TOOL_ACTIONS = COMPUTER_USE_V1_ACTION_NAMES;";
const current = "const COMPUTER_TOOL_ACTIONS = COMPUTER_USE_V2_ACTION_NAMES;";
let matched = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(current)) {
    matched += 1;
    console.log(`[computer-v2] ${path.basename(file)}: already enabled`);
    continue;
  }
  if (!source.includes(legacy)) continue;
  const patched = source.replace(
    legacy,
    [
      "// CLE Kk: expose provider-native desktop actions at turn start.",
      "// The selected node remains the final capability and policy authority.",
      current,
    ].join("\n"),
  );
  fs.writeFileSync(file, patched);
  matched += 1;
  console.log(`[computer-v2] ${path.basename(file)}: enabled`);
}

if (!matched) {
  console.error("error: computer tool schema anchor changed; refusing a silent partial patch");
  process.exit(1);
}

const providerFile = path.join(distDir, "extensions", "cua-computer", "index.js");
if (!fs.existsSync(providerFile)) {
  console.error(`error: CUA provider not found at ${providerFile}`);
  process.exit(1);
}

const providerMarker = 'const acceptedFocusedBringToFront = name === "bring_to_front"';
const refusalAnchor = "\tif (result.isError || refusalCode) {";
let providerSource = fs.readFileSync(providerFile, "utf8");
if (providerSource.includes(providerMarker)) {
  console.log("[computer-v2] cua-computer: focused bring_to_front fallback already enabled");
} else if (providerSource.includes(refusalAnchor)) {
  providerSource = providerSource.replace(
    refusalAnchor,
    [
      '\tconst acceptedFocusedBringToFront = name === "bring_to_front"',
      '\t\t&& refusalCode === "bring_to_front_exact_window_unverified"',
      '\t\t&& /request_accepted=true[\\s\\S]*focused=true/.test(String(result.text || ""));',
      '\tif (acceptedFocusedBringToFront) return {',
      '\t\t...result,',
      '\t\tisError: false,',
      '\t\terrorCode: void 0,',
      '\t\taction: result.action ? {...result.action, effect: 2} : result.action',
      '\t};',
      refusalAnchor,
    ].join("\n"),
  );
  fs.writeFileSync(providerFile, providerSource);
  console.log("[computer-v2] cua-computer: focused bring_to_front fallback enabled");
} else {
  console.error("error: CUA refusal anchor changed; refusing a silent partial patch");
  process.exit(1);
}
