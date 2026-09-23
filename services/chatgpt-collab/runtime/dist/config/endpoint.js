import path from "node:path";
import { getStateDir, readJsonIfExists, writeSecureJson } from "./paths.js";
export const CHATGPT_DEVELOPER_MODE_URL = "https://chatgpt.com/#settings/Security";
export const CHATGPT_PLUGINS_URL = "https://chatgpt.com/plugins";
export const CHATGPT_CREATE_CONNECTOR_URL = "https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins";
export const DEFAULT_CONNECTOR_NAME = "Codex with ChatGPT";
export function endpointFile(workspaceId) {
    return path.join(getStateDir(), "endpoints", `${workspaceId}.json`);
}
export function readLastEndpoint(workspaceId) {
    return readJsonIfExists(endpointFile(workspaceId));
}
export function writeLastEndpoint(endpoint) {
    const saved = { ...endpoint, savedAt: new Date().toISOString() };
    writeSecureJson(endpointFile(saved.workspaceId), saved);
    return saved;
}
export function normalizePublicUrl(url) {
    return url.trim().replace(/\/+$/, "").toLowerCase();
}
export function mcpUrlFromPublic(publicUrl) {
    if (!publicUrl)
        return null;
    const base = normalizePublicUrl(publicUrl).replace(/\/mcp$/, "");
    return `${base}/mcp`;
}
/** What the Skill should do to THIS workspace's ChatGPT connector.
 *  `update` means the public address changed: Delete the old connector
 *  in ChatGPT, then create it again. Never click Reconnect (the old
 *  URL is dead and hangs on "This site cannot be reached"). */
export function connectorAction(previousMcpUrl, nextMcpUrl) {
    if (!nextMcpUrl)
        return "none";
    if (!previousMcpUrl)
        return "create";
    return normalizePublicUrl(previousMcpUrl) === normalizePublicUrl(nextMcpUrl) ? "none" : "update";
}
export function sanitizeConnectorLabel(name, workspaceId) {
    const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "").replace(/\s+/g, " ").trim();
    return cleaned.slice(0, 40) || workspaceId.slice(0, 6);
}
/**
 * Same workspace keeps one connector title forever.
 * A workspace already recorded without a title stays on the original
 * "Codex with ChatGPT" name. A new workspace gets a distinct title.
 */
export function connectorNameFor(opts) {
    if (opts.previousName?.trim())
        return opts.previousName.trim();
    if (opts.hadEndpointBefore)
        return DEFAULT_CONNECTOR_NAME;
    return `${DEFAULT_CONNECTOR_NAME} · ${sanitizeConnectorLabel(opts.workspaceName, opts.workspaceId)}`;
}
export function reclaimUserMessage(connectorName) {
    return `当前项目的安全连接地址已经失效。我会删除「${connectorName}」再按新地址加回去，其它项目的连接不动。请稍等。`;
}
//# sourceMappingURL=endpoint.js.map