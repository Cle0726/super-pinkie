import path from "node:path";
import fs from "node:fs";
import { getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
export const PROTOCOL_STATES = [
    "INIT",
    "PLAN_RECEIVED",
    "EXECUTING",
    "EXECUTED_LOCAL",
    "EXECUTED_SENT",
    "DONE",
    "BLOCKED",
];
export const WAITING_FOR = ["none", "GPT_PLAN", "GPT_REVIEW", "USER"];
export function sessionFile(workspaceId) {
    return path.join(getStateDir(), "sessions", `${workspaceId}.json`);
}
export function readSession(workspaceId) {
    return readJsonIfExists(sessionFile(workspaceId));
}
export function writeSession(workspaceId, session) {
    writeSecureJson(sessionFile(workspaceId), session);
    return session;
}
export function normalizeProjectUrl(url) {
    try {
        const parsed = new URL(url.trim());
        if (parsed.hostname !== "chatgpt.com" && parsed.hostname !== "www.chatgpt.com")
            return null;
        const match = parsed.pathname.match(/^\/g\/(g-p-[a-zA-Z0-9]+)\/project\/?$/);
        if (!match)
            return null;
        return `https://chatgpt.com/g/${match[1]}/project`;
    }
    catch {
        return null;
    }
}
export function projectIdFromUrl(url) {
    const normalized = normalizeProjectUrl(url);
    if (!normalized)
        return null;
    return normalized.match(/\/g\/(g-p-[a-zA-Z0-9]+)\/project/)?.[1] ?? null;
}
export function resolveConversation(session) {
    if (!session) {
        return {
            mode: "project",
            reason: "new-workspace",
            projectUrl: null,
            projectReady: false,
            chatUrl: null,
            connectorName: null,
            reuseSavedChat: false,
        };
    }
    const projectUrl = session.projectUrl ? normalizeProjectUrl(session.projectUrl) : null;
    const projectReady = Boolean(projectUrl);
    if (session.conversationMode === "long-chat") {
        return {
            mode: "long-chat",
            reason: "existing-long-chat",
            projectUrl: null,
            projectReady: false,
            chatUrl: session.url ?? null,
            connectorName: session.connectorName ?? null,
            reuseSavedChat: Boolean(session.url),
        };
    }
    if (session.conversationMode === "project" || projectReady) {
        return {
            mode: "project",
            reason: "project",
            projectUrl,
            projectReady,
            chatUrl: session.url ?? null,
            connectorName: session.connectorName ?? null,
            reuseSavedChat: false,
        };
    }
    return {
        mode: "long-chat",
        reason: "existing-long-chat",
        projectUrl: null,
        projectReady: false,
        chatUrl: session.url ?? null,
        connectorName: session.connectorName ?? null,
        reuseSavedChat: Boolean(session.url),
    };
}
const CHECKPOINT_LIMITS = {
    originalGoal: 500,
    completedSubtasks: 800,
    knownIssues: 800,
    nextExpectedStep: 400,
};
function capCheckpointText(value, max) {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
export function mergeSession(previous, patch) {
    const conversationMode = patch.conversationMode ?? previous?.conversationMode;
    const rawProjectUrl = patch.projectUrl ?? previous?.projectUrl;
    let projectUrl = rawProjectUrl;
    if (rawProjectUrl) {
        const normalized = normalizeProjectUrl(rawProjectUrl);
        if (!normalized) {
            throw new Error("project URL must look like https://chatgpt.com/g/g-p-…/project");
        }
        projectUrl = normalized;
    }
    if (conversationMode === "project" && !projectUrl && !previous?.projectUrl) {
        throw new Error("project mode requires --project-url");
    }
    const url = patch.url ?? previous?.url;
    const hasChat = Boolean(url);
    const hasProject = Boolean(projectUrl);
    const hasTask = Boolean(patch.taskId ?? previous?.taskId);
    const hasCheckpoint = Boolean(patch.checkpoint || patch.clearCheckpoint || previous?.checkpoint);
    if (!hasChat && !hasProject && conversationMode !== "long-chat" && !hasTask && !hasCheckpoint) {
        throw new Error("nothing to save: pass --url, --project-url, or --mode");
    }
    let checkpoint = previous?.checkpoint;
    if (patch.clearCheckpoint) {
        checkpoint = undefined;
    }
    else if (patch.checkpoint) {
        const taskId = patch.checkpoint.taskId ?? patch.taskId ?? previous?.checkpoint?.taskId ?? previous?.taskId;
        const iteration = patch.checkpoint.iteration ??
            patch.iteration ??
            previous?.checkpoint?.iteration ??
            previous?.iteration ??
            0;
        const protocolState = patch.checkpoint.protocolState ?? previous?.checkpoint?.protocolState;
        if (!taskId || !protocolState) {
            throw new Error("checkpoint requires task id and protocol state");
        }
        if (!PROTOCOL_STATES.includes(protocolState)) {
            throw new Error(`protocol-state must be one of ${PROTOCOL_STATES.join(", ")}`);
        }
        const waitingFor = patch.checkpoint.waitingFor ?? previous?.checkpoint?.waitingFor ?? "none";
        if (!WAITING_FOR.includes(waitingFor)) {
            throw new Error(`waiting-for must be one of ${WAITING_FOR.join(", ")}`);
        }
        checkpoint = {
            taskId,
            iteration,
            protocolState,
            waitingFor,
            originalGoal: capCheckpointText(patch.checkpoint.originalGoal ?? previous?.checkpoint?.originalGoal, CHECKPOINT_LIMITS.originalGoal),
            completedSubtasks: capCheckpointText(patch.checkpoint.completedSubtasks ?? previous?.checkpoint?.completedSubtasks, CHECKPOINT_LIMITS.completedSubtasks),
            knownIssues: capCheckpointText(patch.checkpoint.knownIssues ?? previous?.checkpoint?.knownIssues, CHECKPOINT_LIMITS.knownIssues),
            nextExpectedStep: capCheckpointText(patch.checkpoint.nextExpectedStep ?? previous?.checkpoint?.nextExpectedStep, CHECKPOINT_LIMITS.nextExpectedStep),
            chatUrl: patch.checkpoint.chatUrl ?? previous?.checkpoint?.chatUrl ?? url,
            projectUrl: patch.checkpoint.projectUrl ?? previous?.checkpoint?.projectUrl ?? projectUrl,
            updatedAt: new Date().toISOString(),
        };
    }
    return {
        url,
        title: patch.title ?? previous?.title,
        taskId: patch.taskId ?? previous?.taskId,
        iteration: patch.iteration ?? previous?.iteration,
        lastState: patch.lastState ?? previous?.lastState,
        conversationMode: conversationMode === "project" && projectUrl ? "project" : conversationMode,
        projectUrl,
        connectorName: patch.connectorName ?? previous?.connectorName,
        checkpoint,
        savedAt: new Date().toISOString(),
    };
}
/** Drop the current chat pointer. Keep Project binding so the collection stays. */
export function clearChatPointer(workspaceId) {
    const previous = readSession(workspaceId);
    if (!previous)
        return { cleared: false, keptProject: false };
    const view = resolveConversation(previous);
    if (view.mode === "project" && view.projectUrl) {
        writeSession(workspaceId, {
            conversationMode: "project",
            projectUrl: view.projectUrl,
            connectorName: previous.connectorName,
            checkpoint: previous.checkpoint,
            savedAt: new Date().toISOString(),
        });
        return { cleared: true, keptProject: true };
    }
    fs.rmSync(sessionFile(workspaceId), { force: true });
    return { cleared: true, keptProject: false };
}
//# sourceMappingURL=state.js.map