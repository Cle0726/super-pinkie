// Forward the current user turn's images through the existing steering path.
// This transforms only verified runtime builds; callers stage it on a copy.
const runnerMarker = '/* pinkie-steer-current-images:v1 */';
const runnerOld = `\t\tconst steerOutcome = await queueEmbeddedAgentMessageWithOutcomeAsync(steerSessionId, followupRun.prompt, {
\t\t\tsteeringMode: "all",`;
const runnerNew = `\t\t${runnerMarker}
\t\tconst pinkieSteerImages = /^agent:(?:main|project|thinking|learning):/.test(String(sessionKey ?? followupRun.run.sessionKey ?? ""))
\t\t\t? (await resolveCurrentTurnImages({
\t\t\t\tctx: sessionCtx,
\t\t\t\tcfg: resolveQueuedReplyRuntimeConfig(followupRun.run.config),
\t\t\t\timages: followupRun.images ?? opts?.images,
\t\t\t\timageOrder: followupRun.imageOrder ?? opts?.imageOrder
\t\t\t})).images
\t\t\t: void 0;
\t\tconst steerOutcome = await queueEmbeddedAgentMessageWithOutcomeAsync(steerSessionId, followupRun.prompt, {
\t\t\tsteeringMode: "all",
\t\t\t...pinkieSteerImages?.length ? { images: pinkieSteerImages } : {},`;

const selectionMarker = '/* pinkie-forward-steer-images:v1 */';
const selectionPieces = [
  [
    'async function steerAndWaitForTranscriptCommit(activeSession, text, timeoutMs, userTurnTranscriptRecorder) {',
    `${selectionMarker}\nasync function steerAndWaitForTranscriptCommit(activeSession, text, timeoutMs, userTurnTranscriptRecorder, images) {`,
  ],
  [
    '(userTurnTranscriptRecorder ? activeSession.steer(text, void 0, userTurnTranscriptRecorder) : activeSession.steer(text)).catch((err) => {',
    '(userTurnTranscriptRecorder ? activeSession.steer(text, images, userTurnTranscriptRecorder) : images ? activeSession.steer(text, images) : activeSession.steer(text)).catch((err) => {',
  ],
  [
    'if (options?.userTurnTranscriptRecorder) await activeSession.steer(text, void 0, options.userTurnTranscriptRecorder);\n\t\telse await activeSession.steer(text);',
    'if (options?.userTurnTranscriptRecorder) await activeSession.steer(text, options?.images, options.userTurnTranscriptRecorder);\n\t\telse if (options?.images) await activeSession.steer(text, options.images);\n\t\telse await activeSession.steer(text);',
  ],
  [
    'await steerAndWaitForTranscriptCommit(activeSession, text, options.deliveryTimeoutMs ?? DEFAULT_QUEUE_TRANSCRIPT_COMMIT_TIMEOUT_MS, options.userTurnTranscriptRecorder);',
    'await steerAndWaitForTranscriptCommit(activeSession, text, options.deliveryTimeoutMs ?? DEFAULT_QUEUE_TRANSCRIPT_COMMIT_TIMEOUT_MS, options.userTurnTranscriptRecorder, options.images);',
  ],
];

function transform(source, marker, pieces) {
  if (source.includes(marker)) return { changed: false, reason: 'already-patched', text: source };
  if (pieces.some(([before]) => source.split(before).length !== 2)) {
    return { changed: false, reason: 'unsupported-runtime', text: source };
  }
  return { changed: true, reason: 'patched', text: pieces.reduce((text, [before, after]) => text.replace(before, after), source) };
}

export function transformRunner(source) {
  return transform(source, runnerMarker, [[runnerOld, runnerNew]]);
}

export function transformSelection(source) {
  return transform(source, selectionMarker, selectionPieces);
}
