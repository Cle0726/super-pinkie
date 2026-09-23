import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBinary } from "./detect.js";
import { suggestedNamedHostname } from "./hostname.js";
import { normalizeNamedTunnelHostname } from "./cloudflared-named.js";
import { NAMED_FALLBACK_MESSAGE, writeTunnelState, } from "./state.js";
const TUNNEL_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 45_000;
export function cloudflaredCertPath() {
    const override = process.env.TUNNEL_ORIGIN_CERT?.trim();
    if (override)
        return override;
    return path.join(os.homedir(), ".cloudflared", "cert.pem");
}
export function hasCloudflaredCert() {
    try {
        return fs.statSync(cloudflaredCertPath()).isFile();
    }
    catch {
        return false;
    }
}
export function parseTunnelList(output) {
    const trimmed = output.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed);
            const rows = Array.isArray(parsed) ? parsed : parsed.tunnels;
            if (!Array.isArray(rows))
                return [];
            return rows.flatMap((row) => {
                if (!row || typeof row !== "object")
                    return [];
                const record = row;
                if (typeof record.id !== "string" || typeof record.name !== "string")
                    return [];
                return [{ id: record.id, name: record.name }];
            });
        }
        catch {
            // fall through to the table parser
        }
    }
    const found = [];
    for (const line of output.split(/\r?\n/)) {
        const id = line.match(TUNNEL_ID_RE)?.[0];
        if (!id)
            continue;
        const after = line.slice(line.indexOf(id) + id.length).trim();
        const name = after.split(/\s+/)[0];
        if (name && name !== "NAME")
            found.push({ id, name });
    }
    return found;
}
export function parseCreatedTunnel(output, name) {
    const id = output.match(TUNNEL_ID_RE)?.[0];
    return id ? { id, name } : null;
}
export function isBenignRouteError(message) {
    return /already exists|duplicate|exists as a cname/i.test(message);
}
export class ProcessCloudflaredAccount {
    binaryOverride;
    constructor(binaryOverride) {
        this.binaryOverride = binaryOverride;
    }
    binary() {
        const bin = this.binaryOverride ?? findBinary("cloudflared");
        if (!bin) {
            throw new Error("NEED_CLOUDFLARED: cloudflared is not installed. Install it first (macOS: brew install cloudflared).");
        }
        return bin;
    }
    hasCert() {
        return hasCloudflaredCert();
    }
    async login() {
        if (this.hasCert())
            return;
        const bin = this.binary();
        await new Promise((resolve, reject) => {
            const child = spawn(bin, ["tunnel", "login"], { stdio: ["ignore", "pipe", "pipe"] });
            let output = "";
            const collect = (chunk) => {
                output += chunk.toString("utf8");
            };
            child.stdout?.on("data", collect);
            child.stderr?.on("data", collect);
            const timer = setTimeout(() => {
                child.kill("SIGTERM");
                reject(new Error("Cloudflare login timed out"));
            }, LOGIN_TIMEOUT_MS);
            child.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on("exit", (code) => {
                clearTimeout(timer);
                if (this.hasCert()) {
                    resolve();
                    return;
                }
                reject(new Error(`Cloudflare login did not finish${code !== 0 ? ` (exit ${code})` : ""}${output.trim() ? `: ${output.trim().slice(0, 400)}` : ""}`));
            });
        });
    }
    async listTunnels() {
        const json = this.run(["tunnel", "list", "--output", "json"]);
        if (json.ok) {
            const parsed = parseTunnelList(json.stdout || json.stderr);
            if (parsed.length > 0 || (json.stdout || json.stderr).trim().startsWith("["))
                return parsed;
        }
        const table = this.run(["tunnel", "list"]);
        if (!table.ok)
            throw new Error(table.stderr || table.stdout || "Unable to list Cloudflare tunnels");
        return parseTunnelList(`${table.stdout}\n${table.stderr}`);
    }
    async createTunnel(name) {
        const existing = (await this.listTunnels()).find((tunnel) => tunnel.name === name);
        if (existing)
            return existing;
        const result = this.run(["tunnel", "create", name]);
        const created = parseCreatedTunnel(`${result.stdout}\n${result.stderr}`, name);
        if (created)
            return created;
        if (/already exists/i.test(`${result.stdout}\n${result.stderr}`)) {
            const again = (await this.listTunnels()).find((tunnel) => tunnel.name === name);
            if (again)
                return again;
        }
        throw new Error(result.stderr || result.stdout || `Unable to create tunnel ${name}`);
    }
    async routeDns(tunnelName, hostname) {
        const result = this.run(["tunnel", "route", "dns", tunnelName, hostname]);
        if (result.ok || isBenignRouteError(`${result.stdout}\n${result.stderr}`))
            return;
        throw new Error(result.stderr || result.stdout || `Unable to route ${hostname}`);
    }
    run(args) {
        const result = spawnSync(this.binary(), args, {
            encoding: "utf8",
            timeout: COMMAND_TIMEOUT_MS,
            windowsHide: true,
        });
        return {
            ok: result.status === 0,
            stdout: (result.stdout ?? "").trim(),
            stderr: (result.stderr ?? "").trim(),
        };
    }
}
export async function provisionNamedTunnel(opts) {
    const account = opts.account ?? new ProcessCloudflaredAccount();
    let hostname;
    try {
        hostname = opts.hostname
            ? normalizeNamedTunnelHostname(opts.hostname)
            : suggestedNamedHostname(opts.zone, opts.workspaceName, opts.workspaceId);
    }
    catch (error) {
        return fallbackState(opts.workspaceId, "invalid_hostname", error.message);
    }
    const tunnelName = `c2c-${opts.workspaceId}`;
    try {
        if (!account.hasCert())
            await account.login();
        const tunnel = await account.createTunnel(tunnelName);
        await account.routeDns(tunnel.name, hostname);
        const state = writeTunnelState({
            workspaceId: opts.workspaceId,
            preference: "named",
            askedAt: new Date().toISOString(),
            provider: "cloudflare-named",
            tunnelName: tunnel.name,
            tunnelId: tunnel.id,
            hostname,
            zone: normalizeNamedTunnelHostname(opts.zone),
            configuredAt: new Date().toISOString(),
        });
        return { ok: true, state, fallback: false };
    }
    catch (error) {
        return fallbackState(opts.workspaceId, "provision_failed", error.message);
    }
}
export function chooseQuickTunnel(workspaceId, fallbackReason) {
    return writeTunnelState({
        workspaceId,
        preference: "quick",
        askedAt: new Date().toISOString(),
        provider: "cloudflare-quick",
        fallbackReason,
    });
}
function fallbackState(workspaceId, reason, error) {
    const state = chooseQuickTunnel(workspaceId, reason);
    return {
        ok: true,
        state,
        fallback: true,
        userMessage: NAMED_FALLBACK_MESSAGE,
        error,
    };
}
//# sourceMappingURL=named-provision.js.map