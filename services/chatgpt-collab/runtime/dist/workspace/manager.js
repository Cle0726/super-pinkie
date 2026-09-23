import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { IgnoreRules } from "./ignore.js";
import { readJsonIfExists } from "../config/paths.js";
export class WorkspaceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkspaceError";
    }
}
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
const normCase = (p) => (CASE_INSENSITIVE ? p.toLowerCase() : p);
function parseProjectConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const raw = value;
    const config = {};
    if (typeof raw.name === "string")
        config.name = raw.name;
    if (typeof raw.maxIterations === "number")
        config.maxIterations = raw.maxIterations;
    return config;
}
function stringRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const entries = Object.entries(value).filter((entry) => typeof entry[1] === "string");
    return Object.fromEntries(entries);
}
const DEFAULT_MAX_LINES = 400;
const HARD_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 256 * 1024;
export class Workspace {
    root;
    id;
    name;
    ignoreRules;
    projectConfig;
    constructor(rootInput) {
        const resolved = path.resolve(rootInput);
        let real;
        try {
            real = fs.realpathSync.native(resolved);
        }
        catch {
            throw new WorkspaceError("FILE_NOT_FOUND", `Workspace root does not exist: ${rootInput}`);
        }
        if (!fs.statSync(real).isDirectory()) {
            throw new WorkspaceError("NOT_A_DIRECTORY", `Workspace root is not a directory: ${rootInput}`);
        }
        this.root = real;
        this.id = createHash("sha256").update(normCase(real)).digest("hex").slice(0, 12);
        this.ignoreRules = new IgnoreRules(real);
        this.projectConfig = parseProjectConfig(readJsonIfExists(path.join(real, ".c2c.json")));
        this.name = this.projectConfig.name ?? path.basename(real);
    }
    contains(candidate) {
        const r = normCase(this.root);
        const c = normCase(candidate);
        return c === r || c.startsWith(r + path.sep);
    }
    /**
     * Canonicalize a path by realpath-ing its deepest existing ancestor.
     * Defends against symlink escapes even for not-yet-existing leaf segments.
     */
    canonicalize(abs) {
        let current = abs;
        const suffix = [];
        for (;;) {
            try {
                const real = fs.realpathSync.native(current);
                return suffix.length > 0 ? path.join(real, ...suffix) : real;
            }
            catch {
                const parent = path.dirname(current);
                if (parent === current)
                    return abs;
                suffix.unshift(path.basename(current));
                current = parent;
            }
        }
    }
    /**
     * Resolve an untrusted path to a canonical absolute path inside the workspace.
     * Throws PATH_OUTSIDE_WORKSPACE or ACCESS_DENIED_SENSITIVE_FILE.
     */
    resolve(requested, opts = {}) {
        if (typeof requested !== "string" || requested.includes("\0")) {
            throw new WorkspaceError("INVALID_PATH", "Invalid path");
        }
        let p = requested.trim();
        if (p === "" || p === "/")
            p = ".";
        // Normalize separators so Windows-style input behaves identically everywhere.
        p = p.replace(/\\/g, "/");
        // Strip a "workspace:/" alias prefix if the model echoes it back.
        p = p.replace(/^workspace:\/*/i, "");
        if (p === "")
            p = ".";
        const abs = path.resolve(this.root, p);
        const canonical = this.canonicalize(abs);
        if (!this.contains(canonical)) {
            throw new WorkspaceError("PATH_OUTSIDE_WORKSPACE", `Path resolves outside the connected workspace: ${requested}`);
        }
        const rel = path.relative(this.root, canonical).split(path.sep).join("/");
        if (rel.startsWith("..")) {
            throw new WorkspaceError("PATH_OUTSIDE_WORKSPACE", `Path resolves outside the connected workspace: ${requested}`);
        }
        if (!opts.allowSensitive && rel !== "" && this.ignoreRules.isSensitive(rel)) {
            throw new WorkspaceError("ACCESS_DENIED_SENSITIVE_FILE", `ACCESS_DENIED_SENSITIVE_FILE: '${rel}' matches the sensitive-file policy and cannot be read.`);
        }
        return { abs: canonical, rel };
    }
    async isBinary(abs) {
        const fd = await fs.promises.open(abs, "r");
        try {
            const buf = Buffer.alloc(8192);
            const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
            for (let i = 0; i < bytesRead; i++) {
                if (buf[i] === 0)
                    return true;
            }
            return false;
        }
        finally {
            await fd.close();
        }
    }
    async readFile(requested, opts = {}) {
        const { abs, rel } = this.resolve(requested);
        let stat;
        try {
            stat = await fs.promises.stat(abs);
        }
        catch {
            throw new WorkspaceError("FILE_NOT_FOUND", `File not found: ${rel}`);
        }
        if (!stat.isFile()) {
            throw new WorkspaceError("NOT_A_FILE", `Not a regular file: ${rel}`);
        }
        if (await this.isBinary(abs)) {
            throw new WorkspaceError("BINARY_FILE", `Binary file (${stat.size} bytes): ${rel}. Content is not returned.`);
        }
        const startLine = Math.max(1, Math.floor(opts.startLine ?? 1));
        const maxLines = Math.min(HARD_MAX_LINES, Math.max(1, Math.floor(opts.maxLines ?? DEFAULT_MAX_LINES)));
        const endLimit = opts.endLine
            ? Math.min(Math.floor(opts.endLine), startLine + HARD_MAX_LINES - 1)
            : startLine + maxLines - 1;
        const maxBytes = Math.min(1024 * 1024, Math.max(1024, Math.floor(opts.maxBytes ?? DEFAULT_MAX_BYTES)));
        const lines = [];
        let totalLines = 0;
        let collectedBytes = 0;
        let byteTruncated = false;
        let actualEnd = startLine - 1;
        const stream = fs.createReadStream(abs, { encoding: "utf8" });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
            totalLines++;
            if (totalLines >= startLine && totalLines <= endLimit && !byteTruncated) {
                const cost = Buffer.byteLength(line, "utf8") + 1;
                if (collectedBytes + cost > maxBytes && lines.length > 0) {
                    byteTruncated = true;
                }
                else {
                    lines.push(line);
                    collectedBytes += cost;
                    actualEnd = totalLines;
                }
            }
        }
        rl.close();
        const remaining = Math.max(0, totalLines - actualEnd);
        return {
            path: rel,
            sizeBytes: stat.size,
            totalLines,
            startLine: Math.min(startLine, Math.max(totalLines, 1)),
            endLine: actualEnd,
            truncated: remaining > 0,
            remainingLines: remaining,
            nextStartLine: remaining > 0 ? actualEnd + 1 : null,
            content: lines.join("\n"),
        };
    }
    async listDirectory(requested, opts = {}) {
        const { abs, rel } = this.resolve(requested);
        let stat;
        try {
            stat = await fs.promises.stat(abs);
        }
        catch {
            throw new WorkspaceError("FILE_NOT_FOUND", `Directory not found: ${rel || "."}`);
        }
        if (!stat.isDirectory()) {
            throw new WorkspaceError("NOT_A_DIRECTORY", `Not a directory: ${rel}`);
        }
        const depth = Math.min(4, Math.max(1, Math.floor(opts.depth ?? 1)));
        const limit = Math.min(1000, Math.max(1, Math.floor(opts.limit ?? 200)));
        const offset = Math.max(0, Math.floor(opts.offset ?? 0));
        const all = [];
        const walk = async (dirAbs, dirRel, level) => {
            let entries;
            try {
                entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
            }
            catch {
                return;
            }
            entries.sort((a, b) => {
                const ad = a.isDirectory() ? 0 : 1;
                const bd = b.isDirectory() ? 0 : 1;
                return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
            });
            for (const entry of entries) {
                const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
                if (this.ignoreRules.isHidden(childRel) || this.ignoreRules.isHidden(childRel + "/"))
                    continue;
                if (entry.isDirectory()) {
                    all.push({ path: childRel + "/", type: "dir" });
                    if (level < depth)
                        await walk(path.join(dirAbs, entry.name), childRel, level + 1);
                }
                else if (entry.isFile()) {
                    let size;
                    try {
                        size = (await fs.promises.stat(path.join(dirAbs, entry.name))).size;
                    }
                    catch {
                        size = undefined;
                    }
                    all.push({ path: childRel, type: "file", sizeBytes: size });
                }
                if (all.length >= offset + limit + 2000)
                    return; // hard cap for huge trees
            }
        };
        await walk(abs, rel, 1);
        const page = all.slice(offset, offset + limit);
        return {
            path: rel || ".",
            entries: page,
            total: all.length,
            offset,
            limit,
            hasMore: offset + page.length < all.length,
        };
    }
    /** Lightweight project detection for workspace_info. */
    detectProject() {
        const has = (f) => fs.existsSync(path.join(this.root, f));
        const languages = new Set();
        const frameworks = new Set();
        let projectType = "unknown";
        let packageManager = null;
        let scripts = {};
        if (has("package.json")) {
            projectType = "node";
            languages.add("JavaScript");
            const rawPackage = readJsonIfExists(path.join(this.root, "package.json"));
            const pkg = rawPackage && typeof rawPackage === "object" && !Array.isArray(rawPackage)
                ? rawPackage
                : {};
            scripts = stringRecord(pkg.scripts);
            const deps = { ...stringRecord(pkg.dependencies), ...stringRecord(pkg.devDependencies) };
            const known = {
                next: "Next.js",
                react: "React",
                vue: "Vue",
                svelte: "Svelte",
                express: "Express",
                fastify: "Fastify",
                "@nestjs/core": "NestJS",
                electron: "Electron",
                vitest: "Vitest",
                jest: "Jest",
            };
            for (const [dep, label] of Object.entries(known)) {
                if (deps[dep])
                    frameworks.add(label);
            }
            if (has("pnpm-lock.yaml"))
                packageManager = "pnpm";
            else if (has("yarn.lock"))
                packageManager = "yarn";
            else if (has("bun.lockb") || has("bun.lock"))
                packageManager = "bun";
            else if (has("package-lock.json"))
                packageManager = "npm";
        }
        if (has("tsconfig.json"))
            languages.add("TypeScript");
        if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
            languages.add("Python");
            if (projectType === "unknown")
                projectType = "python";
        }
        if (has("Cargo.toml")) {
            languages.add("Rust");
            if (projectType === "unknown")
                projectType = "rust";
        }
        if (has("go.mod")) {
            languages.add("Go");
            if (projectType === "unknown")
                projectType = "go";
        }
        if (has("Package.swift")) {
            languages.add("Swift");
            if (projectType === "unknown")
                projectType = "swift";
        }
        return {
            projectType,
            languages: [...languages],
            frameworks: [...frameworks],
            packageManager,
            scripts,
        };
    }
}
//# sourceMappingURL=manager.js.map