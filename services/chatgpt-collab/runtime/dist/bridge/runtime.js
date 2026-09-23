import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
import { SERVICE_NAME, VERSION } from "../version.js";
export function runtimeFile(workspaceId) {
    return path.join(ensureDir(path.join(getStateDir(), "runtime")), `${workspaceId}.json`);
}
export function writeRuntimeState(state) {
    writeSecureJson(runtimeFile(state.workspaceId), state);
}
export function readRuntimeState(workspaceId) {
    return readJsonIfExists(runtimeFile(workspaceId));
}
export function clearRuntimeState(workspaceId) {
    try {
        fs.rmSync(runtimeFile(workspaceId), { force: true });
    }
    catch {
        // ignore
    }
}
/** Probe a port and check whether a healthy c2c bridge for the workspace answers. */
export async function probeBridge(port, timeoutMs = 2000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok)
            return null;
        const body = (await response.json());
        if (body.service !== SERVICE_NAME)
            return null;
        return body;
    }
    catch {
        return null;
    }
}
function observePid(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return "unknown";
    try {
        process.kill(pid, 0);
        return "present";
    }
    catch (error) {
        return error.code === "ESRCH" ? "missing" : "unknown";
    }
}
/**
 * Distinguish a dead bridge from a probe that simply failed.
 * Read-only: never starts, stops, or clears runtime.
 */
export async function findBridgeObservation(workspaceId) {
    const runtime = readRuntimeState(workspaceId);
    if (!runtime)
        return { state: "stopped", runtime: null, reason: "runtime_missing" };
    const health = await probeBridge(runtime.port);
    if (health && health.workspaceId === workspaceId) {
        return { state: "healthy", runtime };
    }
    if (health) {
        return { state: "unknown", runtime, reason: "workspace_mismatch" };
    }
    const pid = observePid(runtime.pid);
    if (pid === "missing")
        return { state: "stopped", runtime, reason: "pid_missing" };
    return { state: "unknown", runtime, reason: pid === "unknown" ? "pid_unknown" : "probe_failed" };
}
export async function findLiveBridge(workspaceId) {
    const observation = await findBridgeObservation(workspaceId);
    return observation.state === "healthy" ? observation.runtime : null;
}
export { SERVICE_NAME, VERSION };
//# sourceMappingURL=runtime.js.map