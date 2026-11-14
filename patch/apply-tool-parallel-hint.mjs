#!/usr/bin/env node
/**
 * read / web_fetch descriptions end with Fable's "batch independent calls" sentence (tools-health-1113 C1).
 *
 * The runtime already runs several tool calls from one reply in parallel
 * (executeToolCalls: toolExecution defaults to "parallel", no tool is marked
 * sequential) and openai-completions leaves parallel_tool_calls to the
 * upstream default (allowed). What was missing is the model being told to do
 * it. pinkie_search and code_search are plugin tools and carry the sentence
 * in services/; read and web_fetch are runtime tools, so their description
 * strings are extended here. Text only: no behaviour, no config key.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const HINT = "互不依赖的几次调用，放在同一条回复里一起发，不要一条一条来。";
export const marker = "pinkie-tool-parallel-hint:v1";

// [file pattern, unique anchor (end of the description), replacement]
const EDITS = [
  {
    file: /^sessions-[^.]+\.m?js$/u,
    anchor: "When you need the full file, continue with offset until complete.`,",
    replace: `When you need the full file, continue with offset until complete. ${HINT}\`, /* ${marker} */`,
  },
  {
    file: /^openclaw-tools-[^.]+\.m?js$/u,
    anchor: 'description: "Fetch URL and extract readable markdown/text. Lightweight page access; no browser automation.",',
    replace: `description: "Fetch URL and extract readable markdown/text. Lightweight page access; no browser automation. ${HINT}", /* ${marker} */`,
  },
];

export function transform(original, edit) {
  if (original.includes(marker)) return original;
  const parts = original.split(edit.anchor);
  if (parts.length !== 2) throw new Error(`工具说明结构已变化（${edit.anchor.slice(0, 40)}… 出现 ${parts.length - 1} 次），未覆盖`);
  return parts.join(edit.replace);
}

export function findTargets(root) {
  const dist = path.join(root, "dist");
  return EDITS.map((edit) => {
    const hits = fs.readdirSync(dist).filter((n) => edit.file.test(n))
      .filter((n) => {
        const text = fs.readFileSync(path.join(dist, n), "utf8");
        return text.includes(edit.anchor) || text.includes(marker);
      });
    if (hits.length !== 1) throw new Error("无法唯一确认工具说明所在模块: " + edit.file + " → " + hits.join(", "));
    return {edit, file: path.join(dist, hits[0])};
  });
}

export function apply(root, {backupRoot} = {}) {
  const targets = findTargets(root);
  const changed = [];
  let backup;
  for (const {edit, file} of targets) {
    const original = fs.readFileSync(file, "utf8");
    const next = transform(original, edit);
    if (next === original) continue;
    backup ||= backupRoot || path.join(process.env.PINKIE_STATE_ROOT
      || path.join(os.homedir(), process.platform === "win32" ? "AppData/Local/SuperPinkie" : "Library/Application Support/SuperPinkie"),
    "backups", `tool-parallel-hint-${Date.now()}`);
    fs.mkdirSync(backup, {recursive: true});
    fs.copyFileSync(file, path.join(backup, path.basename(file)));
    fs.writeFileSync(file, next);
    changed.push(path.basename(file));
  }
  return {changed: changed.length > 0, files: changed, backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error("请设置 OPENCLAW_ROOT");
  console.log(JSON.stringify(apply(root, {backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined})));
}
