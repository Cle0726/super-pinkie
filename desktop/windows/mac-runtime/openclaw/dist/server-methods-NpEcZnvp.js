import { i as gatewayStartupUnavailableDetails } from "./startup-unavailable-CRTM-3cy.js";
import { r as getPluginRegistryState } from "./runtime-state-CDEoJIrS.js";
import { n as createCoreGatewayMethodDescriptors, r as isCoreGatewayMethodClassified } from "./core-descriptors-DRUtdasO.js";
import { s as isOperatorScope, t as ADMIN_SCOPE } from "./operator-scopes-CpPJIv7P.js";
import { n as authorizeOperatorScopesForMethod, r as authorizeOperatorScopesForRequiredScope } from "./method-scopes-CwW_Szsp.js";
import { i as createPluginGatewayMethodDescriptors, n as createGatewayMethodRegistry, t as createGatewayMethodDescriptorsFromHandlers } from "./registry-D61Kc28k.js";
import { n as withPluginRuntimeGatewayRequestScope } from "./gateway-request-scope-CiIBNuZX.js";
import "./src-CToKmqGn.js";
import { Gn as errorShape, Wn as ErrorCodes } from "./schema-BuOFpc7K.js";
import { t as consumeControlPlaneWriteBudget } from "./control-plane-rate-limit-Cqz4CBuw.js";
import { n as resolveControlPlaneActor, t as formatControlPlaneActor } from "./control-plane-audit-CN8L3SYx.js";
import { n as parseGatewayRole, t as isRoleAuthorizedForMethod } from "./role-policy-BQfpZQ2J.js";
//#region src/gateway/server-methods.ts
function lazyHandlerModule(loadModule, selectHandlers) {
	let handlersPromise = null;
	return () => handlersPromise ??= loadModule().then(selectHandlers);
}
function createLazyCoreHandlers(params) {
	return Object.fromEntries(params.methods.map((method) => [method, async (opts) => {
		const handler = (await params.loadHandlers())[method];
		if (!handler) throw new Error(`lazy gateway handler not found: ${method}`);
		await handler(opts);
	}]));
}
const loadAgentHandlers = lazyHandlerModule(() => import("./agent-D6kiZtPt.js"), (module) => module.agentHandlers);
const loadAgentsHandlers = lazyHandlerModule(() => import("./agents-CSqXg7aw.js"), (module) => module.agentsHandlers);
const loadAgentsWorkspaceHandlers = lazyHandlerModule(() => import("./agents-workspace-CNrJ9PVa.js"), (module) => module.agentsWorkspaceHandlers);
const loadArtifactsHandlers = lazyHandlerModule(() => import("./artifacts-Dkq8q9JQ.js"), (module) => module.artifactsHandlers);
const loadAuditHandlers = lazyHandlerModule(() => import("./audit--uog9aNn.js"), (module) => module.auditHandlers);
const loadAttachHandlers = lazyHandlerModule(() => import("./attach-CvikiVyi.js"), (module) => module.attachHandlers);
const loadChannelsHandlers = lazyHandlerModule(() => import("./channels-C14vo5_1.js"), (module) => module.channelsHandlers);
const loadChatHandlers = lazyHandlerModule(() => import("./chat-ClpMOi7h.js"), (module) => module.chatHandlers);
const loadCommandsHandlers = lazyHandlerModule(() => import("./commands-CM7DPbT8.js"), (module) => module.commandsHandlers);
const loadConfigHandlers = lazyHandlerModule(() => import("./config-DQFoEP4y.js"), (module) => module.configHandlers);
const loadConnectHandlers = lazyHandlerModule(() => import("./connect-BDnUXWPx.js"), (module) => module.connectHandlers);
const loadControlUiHandlers = lazyHandlerModule(() => import("./control-ui-CofmEM-F.js"), (module) => module.controlUiHandlers);
const loadCronHandlers = lazyHandlerModule(() => import("./cron-BXksovqf.js"), (module) => module.cronHandlers);
const loadDeviceHandlers = lazyHandlerModule(() => import("./devices-BR0MA7nj.js"), (module) => module.deviceHandlers);
const loadDevicePairSetupHandlers = lazyHandlerModule(() => import("./device-pair-setup-Ybbeo4em.js"), (module) => module.devicePairSetupHandlers);
const loadDiagnosticsHandlers = lazyHandlerModule(() => import("./diagnostics-Bc2uEarv.js"), (module) => module.diagnosticsHandlers);
const loadDoctorHandlers = lazyHandlerModule(() => import("./doctor-CY1P6IgW.js"), (module) => module.doctorHandlers);
const loadEnvironmentsHandlers = lazyHandlerModule(() => import("./environments-D6L6OjlQ.js"), (module) => module.environmentsHandlers);
const loadWorktreesHandlers = lazyHandlerModule(() => import("./worktrees-BvudQ8o_.js"), (module) => module.worktreesHandlers);
const loadExecApprovalsHandlers = lazyHandlerModule(() => import("./exec-approvals-EutRadbv.js"), (module) => module.execApprovalsHandlers);
const loadHealthHandlers = lazyHandlerModule(() => import("./health-PXvlA4ys.js"), (module) => module.healthHandlers);
const loadLogsHandlers = lazyHandlerModule(() => import("./logs-BRCf-PEL.js"), (module) => module.logsHandlers);
const loadTerminalHandlers = lazyHandlerModule(() => import("./terminal-BVqQk2aA.js"), (module) => module.terminalHandlers);
const loadModelsAuthStatusHandlers = lazyHandlerModule(() => import("./models-auth-status-D40INXDR.js"), (module) => module.modelsAuthStatusHandlers);
const loadModelsHandlers = lazyHandlerModule(() => import("./models-BxhDHfd4.js"), (module) => module.modelsHandlers);
const loadNativeHookRelayHandlers = lazyHandlerModule(() => import("./native-hook-relay-CU1odSux.js"), (module) => module.nativeHookRelayHandlers);
const loadNodePendingHandlers = lazyHandlerModule(() => import("./nodes-pending-9e9s6oqW.js"), (module) => module.nodePendingHandlers);
const loadNodeHandlers = lazyHandlerModule(() => import("./nodes-Bjs-k_IL.js"), (module) => module.nodeHandlers);
const loadPluginHostHookHandlers = lazyHandlerModule(() => import("./plugin-host-hooks-BhKC1rhk.js"), (module) => module.pluginHostHookHandlers);
const loadPushHandlers = lazyHandlerModule(() => import("./push-DF8HpVbR.js"), (module) => module.pushHandlers);
const loadRestartHandlers = lazyHandlerModule(() => import("./restart-DJLfBy-X.js"), (module) => module.restartHandlers);
const loadSendHandlers = lazyHandlerModule(() => import("./send-D7usXzvP.js"), (module) => module.sendHandlers);
const loadSessionsFilesHandlers = lazyHandlerModule(() => import("./sessions-files-BYbP6v2-.js"), (module) => module.sessionsFilesHandlers);
const loadSessionsHandlers = lazyHandlerModule(() => import("./sessions-UcKjjh_n.js"), (module) => module.sessionsHandlers);
const loadSkillsHandlers = lazyHandlerModule(() => import("./skills-ieKSTXPw.js"), (module) => module.skillsHandlers);
const loadSystemHandlers = lazyHandlerModule(() => import("./system-BWlZ4FPD.js"), (module) => module.systemHandlers);
const loadTalkHandlers = lazyHandlerModule(() => import("./talk-Caq_w59s.js"), (module) => module.talkHandlers);
const loadTasksHandlers = lazyHandlerModule(() => import("./tasks-DCFq6qCJ.js"), (module) => module.tasksHandlers);
const loadToolsCatalogHandlers = lazyHandlerModule(() => import("./tools-catalog-BKVZCAYn.js"), (module) => module.toolsCatalogHandlers);
const loadToolsEffectiveHandlers = lazyHandlerModule(() => import("./tools-effective-DNs36xaT.js"), (module) => module.toolsEffectiveHandlers);
const loadToolsInvokeHandlers = lazyHandlerModule(() => import("./tools-invoke-y1eShjk0.js"), (module) => module.toolsInvokeHandlers);
const loadTtsHandlers = lazyHandlerModule(() => import("./tts-BPYZaOaY.js"), (module) => module.ttsHandlers);
const loadUpdateHandlers = lazyHandlerModule(() => import("./update-B52rOZaz.js"), (module) => module.updateHandlers);
const loadUsageHandlers = lazyHandlerModule(() => import("./usage-Suf4MGML.js"), (module) => module.usageHandlers);
const loadVoicewakeRoutingHandlers = lazyHandlerModule(() => import("./voicewake-routing-bdhj6OIc.js"), (module) => module.voicewakeRoutingHandlers);
const loadVoicewakeHandlers = lazyHandlerModule(() => import("./voicewake-CLonrSMr.js"), (module) => module.voicewakeHandlers);
const loadWebHandlers = lazyHandlerModule(() => import("./web-r7OgLG5f.js"), (module) => module.webHandlers);
const loadCrestodianHandlers = lazyHandlerModule(() => import("./crestodian-BrFw18pX.js"), (module) => module.crestodianHandlers);
const loadWizardHandlers = lazyHandlerModule(() => import("./wizard-Cl5NHpYn.js"), (module) => module.wizardHandlers);
function authorizeGatewayMethod(method, client, params, methodRegistry) {
	if (!client?.connect) return null;
	if (method === "health") return null;
	const roleRaw = client.connect.role ?? "operator";
	const role = parseGatewayRole(roleRaw);
	if (!role) return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${roleRaw}`);
	const scopes = client.connect.scopes ?? [];
	if (!isRoleAuthorizedForMethod(role, method)) return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
	if (role === "node") return null;
	if (scopes.includes("operator.admin")) return null;
	const registeredScope = methodRegistry.getScope(method);
	const scopeAuth = isOperatorScope(registeredScope) ? authorizeOperatorScopesForRequiredScope(registeredScope, scopes) : authorizeOperatorScopesForMethod(method, scopes, params);
	if (!scopeAuth.allowed) return errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${scopeAuth.missingScope}`);
	return null;
}
const coreGatewayHandlers = {
	...createLazyCoreHandlers({
		methods: ["connect"],
		loadHandlers: loadConnectHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["attach.grant", "attach.revoke"],
		loadHandlers: loadAttachHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["logs.tail"],
		loadHandlers: loadLogsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"terminal.open",
			"terminal.input",
			"terminal.resize",
			"terminal.close",
			"terminal.attach",
			"terminal.list",
			"terminal.text"
		],
		loadHandlers: loadTerminalHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["voicewake.get", "voicewake.set"],
		loadHandlers: loadVoicewakeHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["voicewake.routing.get", "voicewake.routing.set"],
		loadHandlers: loadVoicewakeRoutingHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["health", "status"],
		loadHandlers: loadHealthHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"channels.status",
			"channels.start",
			"channels.stop",
			"channels.logout"
		],
		loadHandlers: loadChannelsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"chat.history",
			"chat.startup",
			"chat.metadata",
			"chat.message.get",
			"chat.abort",
			"chat.send",
			"chat.inject"
		],
		loadHandlers: loadChatHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["commands.list"],
		loadHandlers: loadCommandsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"wake",
			"cron.list",
			"cron.status",
			"cron.get",
			"cron.add",
			"cron.update",
			"cron.remove",
			"cron.run",
			"cron.runs"
		],
		loadHandlers: loadCronHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"device.pair.list",
			"device.pair.approve",
			"device.pair.reject",
			"device.pair.remove",
			"device.token.rotate",
			"device.token.revoke"
		],
		loadHandlers: loadDeviceHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["device.pair.setupCode"],
		loadHandlers: loadDevicePairSetupHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["diagnostics.stability"],
		loadHandlers: loadDiagnosticsHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["controlUi.githubPreview"],
		loadHandlers: loadControlUiHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"doctor.memory.status",
			"doctor.memory.dreamDiary",
			"doctor.memory.backfillDreamDiary",
			"doctor.memory.resetDreamDiary",
			"doctor.memory.resetGroundedShortTerm",
			"doctor.memory.repairDreamingArtifacts",
			"doctor.memory.dedupeDreamDiary",
			"doctor.memory.remHarness"
		],
		loadHandlers: loadDoctorHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["environments.list", "environments.status"],
		loadHandlers: loadEnvironmentsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"worktrees.list",
			"worktrees.create",
			"worktrees.remove",
			"worktrees.restore",
			"worktrees.gc"
		],
		loadHandlers: loadWorktreesHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"exec.approvals.get",
			"exec.approvals.set",
			"exec.approvals.node.get",
			"exec.approvals.node.set"
		],
		loadHandlers: loadExecApprovalsHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["web.login.start", "web.login.wait"],
		loadHandlers: loadWebHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["models.list"],
		loadHandlers: loadModelsHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["models.authLogout", "models.authStatus"],
		loadHandlers: loadModelsAuthStatusHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["nativeHook.invoke"],
		loadHandlers: loadNativeHookRelayHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["plugins.uiDescriptors", "plugins.sessionAction"],
		loadHandlers: loadPluginHostHookHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"config.get",
			"config.schema",
			"config.schema.lookup",
			"config.set",
			"config.patch",
			"config.apply",
			"config.openFile"
		],
		loadHandlers: loadConfigHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"wizard.start",
			"wizard.next",
			"wizard.cancel",
			"wizard.status"
		],
		loadHandlers: loadWizardHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"crestodian.chat",
			"crestodian.setup.detect",
			"crestodian.setup.activate"
		],
		loadHandlers: loadCrestodianHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"talk.session.create",
			"talk.session.join",
			"talk.session.appendAudio",
			"talk.session.startTurn",
			"talk.session.endTurn",
			"talk.session.cancelTurn",
			"talk.session.cancelOutput",
			"talk.session.submitToolResult",
			"talk.session.steer",
			"talk.session.close",
			"talk.client.create",
			"talk.client.toolCall",
			"talk.client.steer",
			"talk.catalog",
			"talk.config",
			"talk.speak",
			"talk.mode"
		],
		loadHandlers: loadTalkHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["audit.list"],
		loadHandlers: loadAuditHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"tasks.list",
			"tasks.get",
			"tasks.cancel"
		],
		loadHandlers: loadTasksHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["tools.catalog"],
		loadHandlers: loadToolsCatalogHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["tools.effective"],
		loadHandlers: loadToolsEffectiveHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["tools.invoke"],
		loadHandlers: loadToolsInvokeHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"tts.status",
			"tts.enable",
			"tts.disable",
			"tts.convert",
			"tts.speak",
			"tts.setProvider",
			"tts.personas",
			"tts.setPersona",
			"tts.providers"
		],
		loadHandlers: loadTtsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"skills.upload.begin",
			"skills.upload.chunk",
			"skills.upload.commit",
			"skills.status",
			"skills.bins",
			"skills.search",
			"skills.detail",
			"skills.securityVerdicts",
			"skills.skillCard",
			"skills.install",
			"skills.update",
			"skills.curator.status",
			"skills.curator.pin",
			"skills.curator.unpin",
			"skills.curator.restore",
			"skills.proposals.list",
			"skills.proposals.inspect",
			"skills.proposals.create",
			"skills.proposals.update",
			"skills.proposals.revise",
			"skills.proposals.requestRevision",
			"skills.proposals.apply",
			"skills.proposals.reject",
			"skills.proposals.quarantine"
		],
		loadHandlers: loadSkillsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"sessions.list",
			"sessions.cleanup",
			"sessions.subscribe",
			"sessions.unsubscribe",
			"sessions.messages.subscribe",
			"sessions.messages.unsubscribe",
			"sessions.preview",
			"sessions.describe",
			"sessions.resolve",
			"sessions.compaction.list",
			"sessions.compaction.get",
			"sessions.create",
			"sessions.compaction.branch",
			"sessions.compaction.restore",
			"sessions.send",
			"sessions.steer",
			"sessions.abort",
			"sessions.patch",
			"sessions.pluginPatch",
			"sessions.reset",
			"sessions.delete",
			"sessions.get",
			"sessions.compact"
		],
		loadHandlers: loadSessionsHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"gateway.identity.get",
			"last-heartbeat",
			"set-heartbeats",
			"system-presence",
			"system.info",
			"system-event"
		],
		loadHandlers: loadSystemHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["update.status", "update.run"],
		loadHandlers: loadUpdateHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"node.pair.request",
			"node.pair.list",
			"node.pair.approve",
			"node.pair.reject",
			"node.pair.remove",
			"node.pair.verify",
			"node.rename",
			"node.list",
			"node.describe",
			"node.pluginSurface.refresh",
			"node.pending.pull",
			"node.pending.ack",
			"node.invoke",
			"node.invoke.result",
			"node.event"
		],
		loadHandlers: loadNodeHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["node.pending.drain", "node.pending.enqueue"],
		loadHandlers: loadNodePendingHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"push.test",
			"push.web.vapidPublicKey",
			"push.web.subscribe",
			"push.web.unsubscribe",
			"push.web.test"
		],
		loadHandlers: loadPushHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["gateway.restart.request", "gateway.restart.preflight"],
		loadHandlers: loadRestartHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"message.action",
			"send",
			"poll"
		],
		loadHandlers: loadSendHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"usage.status",
			"usage.cost",
			"sessions.usage",
			"sessions.usage.timeseries",
			"sessions.usage.logs"
		],
		loadHandlers: loadUsageHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"agent",
			"agent.identity.get",
			"agent.wait"
		],
		loadHandlers: loadAgentHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"agents.list",
			"agents.create",
			"agents.update",
			"agents.delete",
			"agents.files.list",
			"agents.files.get",
			"agents.files.set"
		],
		loadHandlers: loadAgentsHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["agents.workspace.list", "agents.workspace.get"],
		loadHandlers: loadAgentsWorkspaceHandlers
	}),
	...createLazyCoreHandlers({
		methods: [
			"artifacts.list",
			"artifacts.get",
			"artifacts.download"
		],
		loadHandlers: loadArtifactsHandlers
	}),
	...createLazyCoreHandlers({
		methods: ["sessions.files.list", "sessions.files.get"],
		loadHandlers: loadSessionsFilesHandlers
	})
};
/** Builds the per-request method registry from core, plugin, and explicit extra handlers. */
function createRequestGatewayMethodRegistry(extraHandlers) {
	const activePluginRegistry = getPluginRegistryState()?.activeRegistry;
	const activePluginHandlers = activePluginRegistry?.gatewayHandlers ?? {};
	const extraHandlerEntries = Object.entries(extraHandlers ?? {});
	const pluginMethodNames = new Set(Object.keys(activePluginHandlers));
	const coreDescriptorHandlers = { ...coreGatewayHandlers };
	for (const [method, extraHandler] of extraHandlerEntries) if (!pluginMethodNames.has(method) && isCoreGatewayMethodClassified(method)) coreDescriptorHandlers[method] = extraHandler;
	const coreDescriptors = createCoreGatewayMethodDescriptors(coreDescriptorHandlers);
	for (const descriptor of coreDescriptors) {
		const extraHandler = extraHandlers?.[descriptor.name];
		if (extraHandler && !pluginMethodNames.has(descriptor.name)) descriptor.handler = extraHandler;
	}
	const coreMethodNames = new Set(coreDescriptors.map((descriptor) => descriptor.name));
	const auxHandlers = Object.fromEntries(extraHandlerEntries.filter(([method]) => !pluginMethodNames.has(method) && !coreMethodNames.has(method)));
	return createGatewayMethodRegistry([
		...coreDescriptors,
		...activePluginRegistry ? createPluginGatewayMethodDescriptors(activePluginRegistry) : [],
		...createGatewayMethodDescriptorsFromHandlers({
			handlers: auxHandlers,
			owner: {
				kind: "aux",
				area: "gateway-extra"
			},
			defaultScope: ADMIN_SCOPE
		})
	]);
}
/** Authorizes and dispatches one gateway JSON-RPC-style request. */
async function handleGatewayRequest(opts) {
	const { req, respond, client, isWebchatConnect, context } = opts;
	const methodRegistry = opts.methodRegistry?.getHandler(req.method) !== void 0 ? opts.methodRegistry : createRequestGatewayMethodRegistry(opts.extraHandlers);
	const authError = authorizeGatewayMethod(req.method, client, req.params, methodRegistry);
	if (authError) {
		respond(false, void 0, authError);
		return;
	}
	/* pinkie-metre-lock:v2 */
	const metreGate = globalThis[Symbol.for("pinkie.metreLock.v1")];
	let metreBlock = metreGate?.checkGatewayRequest?.(req.method, req.params);
	if (!metreGate && !metreBlock) {
		const releaseCheckKey = Symbol.for("pinkie.metreLock.releaseRuntime.v1");
		if (globalThis[releaseCheckKey] === void 0) {
			let isRelease = false;
			try {
				const fsMod = process.getBuiltinModule?.("node:fs");
				const pathMod = process.getBuiltinModule?.("node:path");
				const urlMod = process.getBuiltinModule?.("node:url");
				const osMod = process.getBuiltinModule?.("node:os");
				if (fsMod && pathMod && urlMod) {
					const here = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
					const stateDir = process.env.OPENCLAW_STATE_DIR || (osMod ? pathMod.join(osMod.homedir(), ".openclaw") : "");
					const candidates = [
						pathMod.resolve(here, "../../../build-info.json"),
						pathMod.resolve(here, "../../../../build-info.json"),
						...(stateDir ? [pathMod.join(stateDir, "extensions", "pinkie-mode-architecture", "guard-build.json")] : []),
					];
					for (const candidate of candidates) {
						try {
							const info = JSON.parse(fsMod.readFileSync(candidate, "utf8"));
							if (info && (info.channel === "release" || info.guard === true)) { isRelease = true; break; }
						} catch {}
					}
				}
			} catch {}
			globalThis[releaseCheckKey] = isRelease;
		}
		if (globalThis[releaseCheckKey] === true) {
			const m = String(req.method || "").trim();
			const p = req.params && typeof req.params === "object" ? req.params : {};
			const isMetreKey = (v) => /^agent:metre(?::|$)/i.test(String(v ?? "").trim());
			const hasMetre = (obj, d = 0) => {
				if (!obj || typeof obj !== "object" || d > 4) return false;
				if (Array.isArray(obj)) return obj.some((x) => typeof x === "string" ? isMetreKey(x) : hasMetre(x, d + 1));
				for (const k of ["sessionKey", "key", "target", "session", "parentSessionKey", "targetSessionKey", "childSessionKey", "requesterSessionKey", "parentKey", "sourceKey", "fromKey", "from", "to", "sessionId", "id"]) {
					if (isMetreKey(obj[k])) return true;
				}
				if (String(obj.agentId ?? "").trim().toLowerCase() === "metre" || String(obj.agent ?? "").trim().toLowerCase() === "metre" || String(obj.mode ?? "").trim().toLowerCase() === "metre") return true;
				for (const [k, v] of Object.entries(obj)) {
					if (k === "message" || k === "content" || k === "prompt" || k === "text" || k === "body" || k === "plan" || k === "query") continue;
					if (v && typeof v === "object" && hasMetre(v, d + 1)) return true;
				}
				return false;
			};
			const allowToday = m === "pinkie.metre.today" && !p.sessionKey && !p.folder && !p.scope && !hasMetre(p);
			const allowGuard = m === "pinkie.guard.status" || m === "pinkie.guard.metreStatus" || m === "pinkie.guard.metreUnlock" || m === "pinkie.guard.metreLock";
			if (!allowGuard && !allowToday && (m.startsWith("pinkie.metre.") || (m.startsWith("agents.") && String(p.id ?? "").trim().toLowerCase() === "metre") || (m === "pinkie.quiet.set" && p.quiet === true) || hasMetre(p))) {
				metreBlock = "正式版中 Metre 需要先输入开发者密码解锁。";
			}
		}
	}
	if (metreBlock) {
		respond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, metreBlock));
		return;
	}
	if (context.unavailableGatewayMethods?.has(req.method)) {
		respond(false, void 0, errorShape(ErrorCodes.UNAVAILABLE, `${req.method} unavailable during gateway startup`, {
			retryable: true,
			retryAfterMs: 500,
			details: {
				...gatewayStartupUnavailableDetails(),
				method: req.method
			}
		}));
		return;
	}
	if (methodRegistry.isControlPlaneWrite(req.method)) {
		const budget = consumeControlPlaneWriteBudget({ client });
		if (!budget.allowed) {
			const actor = resolveControlPlaneActor(client);
			context.logGateway.warn(`control-plane write rate-limited method=${req.method} ${formatControlPlaneActor(actor)} retryAfterMs=${budget.retryAfterMs} key=${budget.key}`);
			respond(false, void 0, errorShape(ErrorCodes.UNAVAILABLE, `rate limit exceeded for ${req.method}; retry after ${Math.ceil(budget.retryAfterMs / 1e3)}s`, {
				retryable: true,
				retryAfterMs: budget.retryAfterMs,
				details: {
					method: req.method,
					limit: "3 per 60s"
				}
			}));
			return;
		}
	}
	const handler = methodRegistry.getHandler(req.method);
	if (!handler) {
		respond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`));
		return;
	}
	const invokeHandler = () => handler({
		req,
		params: req.params ?? {},
		client,
		isWebchatConnect,
		respond,
		context
	});
	await withPluginRuntimeGatewayRequestScope({
		context,
		client,
		isWebchatConnect
	}, invokeHandler);
}
//#endregion
export { coreGatewayHandlers, handleGatewayRequest };
