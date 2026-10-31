// Patch only a verified runtime attempt boundary; never overwrite an unknown build.
// The SessionManager intentionally defers a new transcript until an assistant
// entry exists. A rejected first answer causes a new attempt before that flush,
// and the retry suppresses its synthetic user input. Persist the pending real
// user entry while the existing session write lock is held.
const marker='/* pinkie-flush-first-user-before-retry:v1 */';
const preserveMarker='/* pinkie-preserve-user-leaf-on-retry:v1 */';
const prepareMarker='/* pinkie-preserve-pending-user-on-retry:v1 */';
const old='if (activeContextEngine && !beforeAgentFinalizeRevisionReason) flushSessionManagerFile(activeSessionManager);';
const replacement=`${old}
                    else if (beforeAgentFinalizeRevisionReason
                      && /^agent:(?:main|project|thinking|learning):/.test(String(params.sessionKey || ''))
                      && activeSessionManager.flushed === false
                      && activeSessionManager.getEntries?.().some(entry => entry?.type === 'message' && entry.message?.role === 'user')) {
                      ${marker}
                      flushSessionManagerFile(activeSessionManager);
                    }`;
const oldMerge=`if (orphanPromptMerge.removeLeaf) {
						if (leafEntry.parentId) sessionManager.branch(leafEntry.parentId);
						else sessionManager.resetLeaf();
						const sessionContext = sessionManager.buildSessionContext();
						activeSession.agent.state.messages = sessionContext.messages;
					}`;
const replacementMerge=`if (orphanPromptMerge.removeLeaf) {
						${preserveMarker}
						const preserveUserLeaf = params.suppressNextUserMessagePersistence === true
							&& /^agent:(?:main|project|thinking|learning):/.test(String(params.sessionKey || ''));
						const current = preserveUserLeaf ? sessionManager.buildSessionContext().messages : null;
						if (preserveUserLeaf && current?.at(-1)?.role === 'user') {
							// The retry prompt already merges this user turn. Omit the old
							// in-memory copy from this model call, but keep its durable leaf.
							activeSession.agent.state.messages = current.slice(0, -1);
						} else {
							if (leafEntry.parentId) sessionManager.branch(leafEntry.parentId);
							else sessionManager.resetLeaf();
							const sessionContext = sessionManager.buildSessionContext();
							activeSession.agent.state.messages = sessionContext.messages;
						}
					}`;
const oldPrepare=`if (sm.wasRecoveredFromCorruptHeader?.() || preservesForkedBranch) {`;
const newPrepare=`${prepareMarker}
		const preservesPendingUser = params.preservePendingUser === true
			&& sm.fileEntries.some(e => e.type === 'message' && e.message?.role === 'user');
		if (sm.wasRecoveredFromCorruptHeader?.() || preservesForkedBranch || preservesPendingUser) {`;
const oldPrepareCall=`await prepareSessionManagerForRun({
					sessionManager,
					sessionFile: params.sessionFile,
					hadSessionFile,
					sessionId: params.sessionId,
					cwd: effectiveCwd
				});`;
const newPrepareCall=`await prepareSessionManagerForRun({
					sessionManager,
					sessionFile: params.sessionFile,
					hadSessionFile,
					sessionId: params.sessionId,
					cwd: effectiveCwd,
					preservePendingUser: params.suppressNextUserMessagePersistence === true
						&& /^agent:(?:main|project|thinking|learning):/.test(String(params.sessionKey || ''))
				});`;
export function transformWithStatus(source) {
 if (source.includes(marker) && source.includes(preserveMarker) && source.includes(prepareMarker)) return {changed:false,reason:'already-patched',text:source};
 if (source.includes(marker) || source.includes(preserveMarker) || source.includes(prepareMarker)) return {changed:false,reason:'partial-patch',text:source};
 if([old,oldMerge,oldPrepare,oldPrepareCall].some(part=>source.split(part).length!==2)) return {changed:false,reason:'unsupported-runtime',text:source};
 return {changed:true,reason:'patched',text:source.replace(old,replacement).replace(oldMerge,replacementMerge).replace(oldPrepare,newPrepare).replace(oldPrepareCall,newPrepareCall)};
}
