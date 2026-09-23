import { spawnSync } from "node:child_process";
import { nullLogger } from "../logger/index.js";
import { findBinary } from "./detect.js";
import { writeTunnelState } from "./state.js";

const STATUS_TIMEOUT_MS = 10_000;
const HEALTH_WAIT_MS = 12_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resultText(result = {}) {
    return String(result.stderr || result.stdout || result.error?.message || "").trim();
}

function runCommand(runImpl, binary, args, timeout = STATUS_TIMEOUT_MS) {
    const result = runImpl(binary, args, { encoding: "utf8", timeout, windowsHide: true });
    if (result?.error)
        throw result.error;
    if (result?.status !== 0)
        throw new Error(resultText(result) || `tailscale ${args.join(" ")} failed`);
    return result;
}

export function normalizeTailscaleHostname(value) {
    const hostname = String(value || "").trim().toLowerCase().replace(/\.$/, "");
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+\.ts\.net$/i.test(hostname)) {
        throw new Error("Tailscale 没有提供有效的固定 .ts.net 地址");
    }
    return hostname;
}

export function readTailscaleIdentity({ binaryOverride, runImpl = spawnSync } = {}) {
    const binary = binaryOverride ?? findBinary("tailscale");
    if (!binary)
        throw new Error("未安装 Tailscale；请安装并登录后再启用固定地址");
    const result = runCommand(runImpl, binary, ["status", "--json"]);
    let payload;
    try {
        payload = JSON.parse(String(result.stdout || ""));
    }
    catch {
        throw new Error("Tailscale 状态无法读取，请重新登录后重试");
    }
    if (payload?.BackendState !== "Running") {
        throw new Error("Tailscale 尚未登录或未运行；请在 Tailscale App 完成登录");
    }
    const hostname = normalizeTailscaleHostname(payload?.Self?.DNSName);
    return { binary, hostname, publicUrl: `https://${hostname}` };
}

/**
 * Stable public HTTPS endpoint backed by the local Tailscale daemon. The
 * reverse-proxy configuration is reapplied on every bridge start, but the
 * hostname stays tied to this device so ChatGPT only needs one connector URL.
 */
export class TailscaleFunnel {
    name = "tailscale-funnel";
    logger;
    binaryOverride;
    hostname;
    runImpl;
    fetchImpl;
    healthWaitMs;
    running = false;
    lastError = null;
    constructor(opts = {}) {
        this.logger = opts.logger ?? nullLogger;
        this.binaryOverride = opts.binaryOverride;
        this.hostname = opts.hostname ? normalizeTailscaleHostname(opts.hostname) : "";
        this.runImpl = opts.runImpl ?? spawnSync;
        this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
        this.healthWaitMs = opts.healthWaitMs ?? HEALTH_WAIT_MS;
    }
    identity() {
        return readTailscaleIdentity({ binaryOverride: this.binaryOverride, runImpl: this.runImpl });
    }
    async waitForHealth(url) {
        const deadline = Date.now() + this.healthWaitMs;
        let detail = "public health check did not run";
        while (Date.now() < deadline) {
            try {
                const response = await this.fetchImpl(new URL("/health", url).toString(), {
                    redirect: "error",
                    signal: AbortSignal.timeout(5_000),
                });
                const body = response?.ok ? await response.json().catch(() => null) : null;
                if (response?.ok && body?.status === "ok")
                    return true;
                detail = response?.ok ? "health endpoint returned an unexpected body" : `health endpoint returned HTTP ${response?.status ?? "?"}`;
            }
            catch (error) {
                detail = error instanceof Error ? error.message : String(error);
            }
            await sleep(250);
        }
        this.lastError = detail;
        return false;
    }
    async start(localPort) {
        if (!Number.isInteger(Number(localPort)) || Number(localPort) <= 0)
            throw new Error("本地桥接端口无效，不能启动 Tailscale Funnel");
        const identity = this.identity();
        if (this.hostname && this.hostname !== identity.hostname) {
            throw new Error(`Tailscale 设备地址已变为 ${identity.hostname}；请重新选择固定地址，避免 ChatGPT 指向错误设备`);
        }
        this.hostname = identity.hostname;
        try {
            runCommand(this.runImpl, identity.binary, ["funnel", "--bg", "--https=443", `http://127.0.0.1:${Number(localPort)}`]);
            if (!await this.waitForHealth(identity.publicUrl)) {
                throw new Error("Tailscale Funnel 已启动但公网还未就绪；请稍等片刻后重试，首次 DNS 生效可能需要更久");
            }
            this.running = true;
            this.lastError = null;
            this.logger.info(`Tailscale Funnel established: ${identity.publicUrl}`);
            return identity.publicUrl;
        }
        catch (error) {
            this.running = false;
            this.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }
    async stop() {
        try {
            const identity = this.identity();
            runCommand(this.runImpl, identity.binary, ["funnel", "--https=443", "off"]);
        }
        catch {
            // A stopped daemon or an already-disabled Funnel is safe to ignore.
        }
        this.running = false;
    }
    async restart(localPort) {
        await this.stop();
        return this.start(localPort);
    }
    status() {
        return {
            running: this.running,
            url: this.running && this.hostname ? `https://${this.hostname}` : null,
            provider: this.name,
            detail: this.lastError ?? undefined,
        };
    }
    getPublicUrl() {
        return this.running && this.hostname ? `https://${this.hostname}` : null;
    }
    async doctor() {
        try {
            const identity = this.identity();
            return { provider: this.name, binaryFound: true, binaryPath: identity.binary, hostname: identity.hostname, running: this.running, url: this.getPublicUrl(), problems: this.running ? [] : ["Tailscale Funnel is not running"] };
        }
        catch (error) {
            return { provider: this.name, binaryFound: false, running: false, url: null, problems: [error instanceof Error ? error.message : String(error)] };
        }
    }
}

export function chooseTailscaleFunnel(workspaceId, options = {}) {
    const identity = readTailscaleIdentity(options);
    return writeTunnelState({
        workspaceId,
        preference: "tailscale",
        askedAt: new Date().toISOString(),
        provider: "tailscale-funnel",
        hostname: identity.hostname,
        configuredAt: new Date().toISOString(),
    });
}
