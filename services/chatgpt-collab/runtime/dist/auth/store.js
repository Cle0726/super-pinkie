import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
export const SUPPORTED_SCOPES = [
    "workspace.read",
    "workspace.media.read",
    "workspace.search",
    "git.read",
    "execution.read",
    "offline_access",
];
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
function sha256hex(value) {
    return createHash("sha256").update(value).digest("hex");
}
function newToken(prefix) {
    return `${prefix}_${randomBytes(32).toString("base64url")}`;
}
export function base64UrlSha256(value) {
    return createHash("sha256").update(value).digest("base64url");
}
/** Constant-time string comparison for equal-length inputs. */
export function safeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return timingSafeEqual(bufA, bufB);
}
export class AuthStore {
    workspaceId;
    clients = new Map();
    tokens = new Map();
    authCodes = new Map();
    file;
    constructor(workspaceId, opts = {}) {
        this.workspaceId = workspaceId;
        this.file =
            opts.file ?? path.join(ensureDir(path.join(getStateDir(), "auth")), `${workspaceId}.json`);
        this.load();
    }
    load() {
        const data = readJsonIfExists(this.file);
        if (!data)
            return;
        const now = Date.now();
        for (const client of data.clients ?? [])
            this.clients.set(client.clientId, client);
        for (const token of data.tokens ?? []) {
            if (!token.revoked && token.expiresAt > now)
                this.tokens.set(token.hash, token);
        }
    }
    save() {
        const now = Date.now();
        const state = {
            clients: [...this.clients.values()],
            tokens: [...this.tokens.values()].filter((t) => !t.revoked && t.expiresAt > now),
        };
        writeSecureJson(this.file, state);
    }
    // ---- Dynamic Client Registration -------------------------------------
    registerClient(input) {
        const client = {
            clientId: `c2c_client_${randomBytes(12).toString("base64url")}`,
            clientName: input.clientName,
            redirectUris: input.redirectUris,
            createdAt: new Date().toISOString(),
        };
        this.clients.set(client.clientId, client);
        this.save();
        return client;
    }
    getClient(clientId) {
        return this.clients.get(clientId);
    }
    // ---- Authorization codes ----------------------------------------------
    createAuthorizationCode(input) {
        const code = newToken("c2c_ac");
        this.authCodes.set(code, {
            code,
            clientId: input.clientId,
            redirectUri: input.redirectUri,
            codeChallenge: input.codeChallenge,
            scopes: input.scopes,
            workspaceId: this.workspaceId,
            pairingSessionId: input.pairingSessionId,
            resource: input.resource,
            expiresAt: Date.now() + AUTH_CODE_TTL_MS,
        });
        return code;
    }
    /** One-time consumption of an authorization code. */
    consumeAuthorizationCode(code) {
        const record = this.authCodes.get(code);
        if (!record)
            return null;
        this.authCodes.delete(code);
        if (Date.now() > record.expiresAt)
            return null;
        return record;
    }
    // ---- Tokens -------------------------------------------------------------
    issueTokens(input) {
        const now = Date.now();
        const workspaceId = input.workspaceId ?? this.workspaceId;
        const accessTtl = input.accessTtlMs ?? ACCESS_TOKEN_TTL_MS;
        const accessToken = newToken("c2c_at");
        this.tokens.set(sha256hex(accessToken), {
            hash: sha256hex(accessToken),
            kind: "access",
            clientId: input.clientId,
            workspaceId,
            scopes: input.scopes,
            issuedAt: now,
            expiresAt: now + accessTtl,
            revoked: false,
        });
        let refreshToken = null;
        if (input.scopes.includes("offline_access")) {
            refreshToken = newToken("c2c_rt");
            this.tokens.set(sha256hex(refreshToken), {
                hash: sha256hex(refreshToken),
                kind: "refresh",
                clientId: input.clientId,
                workspaceId,
                scopes: input.scopes,
                issuedAt: now,
                expiresAt: now + REFRESH_TOKEN_TTL_MS,
                revoked: false,
            });
        }
        this.save();
        return {
            accessToken,
            refreshToken,
            expiresIn: Math.floor(accessTtl / 1000),
            scopes: input.scopes,
        };
    }
    verifyAccessToken(token) {
        const record = this.tokens.get(sha256hex(token));
        if (!record)
            return { ok: false, reason: "unknown" };
        if (record.kind !== "access")
            return { ok: false, reason: "wrong_kind" };
        if (record.revoked)
            return { ok: false, reason: "revoked" };
        if (Date.now() > record.expiresAt)
            return { ok: false, reason: "expired" };
        return { ok: true, record };
    }
    /** Refresh-token rotation: old refresh token is revoked, a new pair is issued. */
    refresh(refreshToken, clientId) {
        const record = this.tokens.get(sha256hex(refreshToken));
        if (!record || record.kind !== "refresh")
            return { ok: false, reason: "invalid_grant" };
        if (record.revoked)
            return { ok: false, reason: "invalid_grant" };
        if (Date.now() > record.expiresAt)
            return { ok: false, reason: "invalid_grant" };
        if (record.clientId !== clientId)
            return { ok: false, reason: "invalid_client" };
        record.revoked = true;
        this.tokens.delete(record.hash);
        const tokens = this.issueTokens({
            clientId,
            scopes: record.scopes,
            workspaceId: record.workspaceId,
        });
        return { ok: true, tokens };
    }
    revokeToken(token) {
        const record = this.tokens.get(sha256hex(token));
        if (!record)
            return false;
        record.revoked = true;
        this.tokens.delete(record.hash);
        this.save();
        return true;
    }
    /** Used by `c2c unpair`: revoke everything for this workspace. */
    revokeAll() {
        const count = this.tokens.size;
        this.tokens.clear();
        this.authCodes.clear();
        this.save();
        return count;
    }
    tokenCount() {
        return this.tokens.size;
    }
    static deleteStateFile(workspaceId) {
        const file = path.join(getStateDir(), "auth", `${workspaceId}.json`);
        try {
            fs.rmSync(file, { force: true });
        }
        catch {
            // ignore
        }
    }
}
export function filterScopes(requested) {
    if (!requested || requested.trim() === "")
        return [...SUPPORTED_SCOPES];
    const asked = requested.split(/[\s+]+/).filter(Boolean);
    const granted = asked.filter((scope) => SUPPORTED_SCOPES.includes(scope));
    return granted.length > 0 ? granted : [...SUPPORTED_SCOPES];
}
//# sourceMappingURL=store.js.map
