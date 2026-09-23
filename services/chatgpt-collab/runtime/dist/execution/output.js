import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
import { redact } from "../logger/index.js";
import { sanitizeExecutionOutput } from "./sanitize.js";
export const MAX_OUTPUT_RECORDS = 40;
function outputDir(workspaceId) {
    return ensureDir(path.join(getStateDir(), "execution-outputs", workspaceId));
}
function indexFile(workspaceId) {
    return path.join(outputDir(workspaceId), "index.json");
}
function bodyFile(workspaceId, id) {
    return path.join(outputDir(workspaceId), "bodies", `${id}.txt`);
}
function readIndex(workspaceId) {
    return (readJsonIfExists(indexFile(workspaceId)) ?? {
        nextId: 1,
        items: [],
    });
}
function writeIndex(workspaceId, index) {
    writeSecureJson(indexFile(workspaceId), index);
}
export function saveExecutionOutput(workspaceId, input) {
    const sanitized = sanitizeExecutionOutput(input.raw);
    const index = readIndex(workspaceId);
    const id = index.nextId;
    const timestamp = new Date().toISOString();
    const allowed = sanitized.allowed;
    const text = allowed ? sanitized.text : "";
    const truncated = allowed ? sanitized.truncated : false;
    const meta = {
        id,
        command: redact(input.command).slice(0, 200),
        exitCode: input.exitCode ?? null,
        timestamp,
        taskId: input.taskId,
        iteration: input.iteration,
        allowed,
        restrictedReason: allowed ? undefined : sanitized.reason,
        truncated,
        sizeBytes: Buffer.byteLength(text, "utf8"),
    };
    if (allowed && text) {
        const file = bodyFile(workspaceId, id);
        ensureDir(path.dirname(file));
        fs.writeFileSync(file, text, { mode: 0o600 });
        try {
            fs.chmodSync(file, 0o600);
        }
        catch {
            /* ignore */
        }
    }
    index.nextId = id + 1;
    index.items.push(meta);
    while (index.items.length > MAX_OUTPUT_RECORDS) {
        const dropped = index.items.shift();
        if (dropped) {
            fs.rmSync(bodyFile(workspaceId, dropped.id), { force: true });
        }
    }
    writeIndex(workspaceId, index);
    return meta;
}
export function listExecutionOutputs(workspaceId, limit = 20) {
    const items = readIndex(workspaceId).items;
    return items.slice(-Math.max(1, Math.min(50, limit)));
}
export function readExecutionOutput(workspaceId, id) {
    const meta = readIndex(workspaceId).items.find((item) => item.id === id);
    if (!meta)
        return { ok: false, error: "NOT_FOUND" };
    if (!meta.allowed)
        return { ok: false, error: "OUTPUT_RESTRICTED" };
    const file = bodyFile(workspaceId, id);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return { ok: true, meta, text };
}
//# sourceMappingURL=output.js.map