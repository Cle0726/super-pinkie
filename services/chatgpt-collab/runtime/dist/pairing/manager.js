import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
// No ambiguous characters (I, L, O, 0, 1).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode(length = 8) {
    const chars = [];
    while (chars.length < length) {
        const bytes = randomBytes(length * 2);
        for (const byte of bytes) {
            // rejection sampling for uniformity
            if (byte < Math.floor(256 / ALPHABET.length) * ALPHABET.length) {
                chars.push(ALPHABET[byte % ALPHABET.length]);
                if (chars.length === length)
                    break;
            }
        }
    }
    return chars.join("");
}
function hashCode(code) {
    return createHash("sha256").update(code).digest();
}
export function formatPairingCode(raw) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
export function normalizePairingCode(input) {
    return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}
export class PairingManager {
    workspaceId;
    sessions = new Map();
    ipHits = new Map();
    ttlMs;
    maxAttempts;
    ipRateLimit;
    ipRateWindowMs;
    constructor(workspaceId, opts = {}) {
        this.workspaceId = workspaceId;
        this.ttlMs = opts.ttlMs ?? 5 * 60_000;
        this.maxAttempts = opts.maxAttempts ?? 5;
        this.ipRateLimit = opts.ipRateLimit ?? 10;
        this.ipRateWindowMs = opts.ipRateWindowMs ?? 60_000;
    }
    /** Create a new pairing session. Invalidates previous sessions (one active at a time). */
    create() {
        this.sessions.clear();
        const raw = generateCode();
        const session = {
            id: randomBytes(16).toString("hex"),
            codeHash: hashCode(raw),
            workspaceId: this.workspaceId,
            createdAt: Date.now(),
            expiresAt: Date.now() + this.ttlMs,
            attemptsLeft: this.maxAttempts,
            used: false,
        };
        this.sessions.set(session.id, session);
        return { sessionId: session.id, code: formatPairingCode(raw), expiresAt: session.expiresAt };
    }
    checkIpRate(ip) {
        if (!ip)
            return true;
        const now = Date.now();
        const entry = this.ipHits.get(ip);
        if (!entry || now > entry.resetAt) {
            this.ipHits.set(ip, { count: 1, resetAt: now + this.ipRateWindowMs });
            return true;
        }
        entry.count++;
        return entry.count <= this.ipRateLimit;
    }
    verify(codeInput, ip) {
        if (!this.checkIpRate(ip)) {
            return { ok: false, reason: "rate_limited" };
        }
        const normalized = normalizePairingCode(codeInput);
        const inputHash = hashCode(normalized);
        const now = Date.now();
        const active = [...this.sessions.values()].filter((s) => !s.used);
        if (active.length === 0)
            return { ok: false, reason: "no_active_session" };
        for (const session of active) {
            if (now > session.expiresAt) {
                this.sessions.delete(session.id);
                return { ok: false, reason: "expired" };
            }
            if (session.attemptsLeft <= 0) {
                this.sessions.delete(session.id);
                return { ok: false, reason: "too_many_attempts" };
            }
            const match = timingSafeEqual(inputHash, session.codeHash);
            if (match) {
                // one-time use: destroy immediately
                session.used = true;
                this.sessions.delete(session.id);
                return { ok: true, sessionId: session.id };
            }
            session.attemptsLeft--;
            if (session.attemptsLeft <= 0) {
                this.sessions.delete(session.id);
                return { ok: false, reason: "too_many_attempts" };
            }
            return { ok: false, reason: "invalid", attemptsLeft: session.attemptsLeft };
        }
        return { ok: false, reason: "no_active_session" };
    }
    hasActiveSession() {
        const now = Date.now();
        for (const session of this.sessions.values()) {
            if (!session.used && now <= session.expiresAt)
                return true;
        }
        return false;
    }
    invalidateAll() {
        this.sessions.clear();
    }
}
//# sourceMappingURL=manager.js.map