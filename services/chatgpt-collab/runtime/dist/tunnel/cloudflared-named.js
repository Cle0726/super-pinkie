import { spawn } from "node:child_process";
import readline from "node:readline";
import { nullLogger } from "../logger/index.js";
import { findBinary } from "./detect.js";
import { tunnelProtocolArgs } from "./protocol.js";
const CONNECTED_RE = /registered tunnel connection/i;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export function normalizeNamedTunnelHostname(hostname) {
    const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
    if (!HOSTNAME_RE.test(normalized)) {
        throw new Error(`Invalid named tunnel hostname: ${hostname}`);
    }
    return normalized;
}
/**
 * Locally-managed Cloudflare named tunnel.
 *
 * The tunnel object and its DNS route are provisioned once with cloudflared.
 * This provider only starts and monitors the connector process, so the public
 * URL remains stable across bridge restarts.
 */
export class CloudflaredNamedTunnel {
    name = "cloudflare-named";
    tunnelName;
    hostname;
    logger;
    binaryOverride;
    startTimeoutMs;
    child = null;
    connected = false;
    lastError = null;
    constructor(opts) {
        const tunnelName = opts.tunnelName.trim();
        if (!tunnelName || tunnelName.length > 128) {
            throw new Error("Named tunnel name must be between 1 and 128 characters");
        }
        this.tunnelName = tunnelName;
        this.hostname = normalizeNamedTunnelHostname(opts.hostname);
        this.logger = opts.logger ?? nullLogger;
        this.binaryOverride = opts.binaryOverride;
        this.startTimeoutMs = opts.startTimeoutMs ?? 45_000;
    }
    binary() {
        return this.binaryOverride ?? findBinary("cloudflared");
    }
    publicUrl() {
        return `https://${this.hostname}`;
    }
    async start(localPort) {
        if (this.child && this.connected)
            return this.publicUrl();
        const bin = this.binary();
        if (!bin) {
            throw new Error("cloudflared is not installed. Install it (e.g. `brew install cloudflared`) and retry.");
        }
        return new Promise((resolve, reject) => {
            const child = spawn(bin, [
                "tunnel",
                "--no-autoupdate",
                "--url",
                `http://127.0.0.1:${localPort}`,
                ...tunnelProtocolArgs(),
                "run",
                this.tunnelName,
            ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            this.child = child;
            this.connected = false;
            this.lastError = null;
            let settled = false;
            const finish = (fn) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                fn();
            };
            const timeout = setTimeout(() => {
                if (!this.connected) {
                    this.lastError = "Named tunnel start timed out";
                    child.kill("SIGTERM");
                    finish(() => reject(new Error(this.lastError ?? "Named tunnel start timed out")));
                }
            }, this.startTimeoutMs);
            const scan = (stream) => {
                const rl = readline.createInterface({ input: stream });
                rl.on("line", (line) => {
                    if (CONNECTED_RE.test(line) && !this.connected) {
                        this.connected = true;
                        const url = this.publicUrl();
                        this.logger.info(`Named tunnel established: ${url}`);
                        finish(() => resolve(url));
                    }
                    if (/\b(error|failed|fatal)\b/i.test(line)) {
                        this.lastError = line.slice(0, 400);
                        this.logger.debug(`cloudflared: ${line.slice(0, 400)}`);
                    }
                });
            };
            if (child.stdout)
                scan(child.stdout);
            if (child.stderr)
                scan(child.stderr);
            child.on("error", (error) => {
                this.child = null;
                this.connected = false;
                finish(() => reject(error));
            });
            child.on("exit", (code) => {
                const wasStarting = !this.connected;
                this.logger.warn(`cloudflared named tunnel exited with code ${code}`);
                this.child = null;
                this.connected = false;
                if (wasStarting) {
                    finish(() => reject(new Error(`cloudflared exited (code ${code}) before establishing the named tunnel${this.lastError ? `: ${this.lastError}` : ""}`)));
                }
            });
        });
    }
    async stop() {
        if (this.child) {
            this.child.kill("SIGTERM");
            this.child = null;
        }
        this.connected = false;
    }
    async restart(localPort) {
        await this.stop();
        return this.start(localPort);
    }
    status() {
        return {
            running: this.child !== null && this.connected,
            url: this.connected ? this.publicUrl() : null,
            provider: this.name,
            detail: this.lastError ?? undefined,
        };
    }
    getPublicUrl() {
        return this.connected ? this.publicUrl() : null;
    }
    async doctor() {
        const bin = this.binary();
        const problems = [];
        if (!bin)
            problems.push("cloudflared binary not found");
        if (bin && !this.child)
            problems.push("named tunnel process not running");
        if (this.child && !this.connected)
            problems.push("named tunnel is not connected yet");
        return {
            provider: this.name,
            binaryFound: bin !== null,
            binaryPath: bin,
            running: this.child !== null && this.connected,
            url: this.connected ? this.publicUrl() : null,
            problems,
        };
    }
}
//# sourceMappingURL=cloudflared-named.js.map