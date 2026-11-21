// CompletionIntegrityGuard and delivery-truth enforcement across agent turns.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isSessionOperationEvidence, SESSION_WAKE_MARK} from './session-lineage.mjs';
import {judgeReply} from './run-contract.mjs';
import {ASK_USER_TOOL} from './ask.mjs';
import {COMPLETION_CLAIM, DELIVERY_CLAIM, DELIVERY_GUARD_TOOL, ENGLISH_EXTERNAL_ACTION, ENGLISH_MUTATION_CLAIM, ENGLISH_TEST_CLAIM, EXECUTION_TOOL, IN_PROGRESS_CLAIM, OBSERVATION_TOOL, QUESTION_ONLY, REPORTED_EXTERNAL_ACTION, RESPONSE_ONLY_PREFIX, SKILL_PATH, VERIFIER_PATH, WORKFLOW_EVIDENCE_TARGETS, WORK_ACTION_CLAIM, WORK_PRODUCT_CLAIM, hasAttachedSourceContent, inlineSourceInstruction, intentText, isMutationRequest, runProcess, workFirstPrompt} from './mode-constants.mjs';
import {BACKGROUND_FINISHED_CLAIM, FILE_OR_RUN_REQUEST, actionClaimText, agentWorkspaceDir, assertRunOutputPath, backgroundStillRunning, claimedVisualInspection, compactJson, compactToolEvidence, compareSnapshot, completionRunKey, contentInspectionReason, contractTimeBoundary, delegatedWork, deliveryTaskPrompt, douyinWorkflowReason, effectVerificationReason, entryMentionsFile, entryText, evidenceItems, evidencePath, evidenceTamperingReason, executedLockedVerifier, existingPathInside, faststartOk, fileSha256, hasReportedMutation, hostFileMutationReceipt, inlineDeliveryOnly, isHonestIncomplete, isLikelyActionRequest, isPathInside, isReadOnlyDiagnosticRequest, missingVerifierReason, parseIsoMs, probeImageFile, probeVideoFile, promiseWithoutActionReason, proseOnly, registerVerifier, replyDeliveredKinds, resultText, skillHasVerifier, skillProjectRoot, snapshotFile, sourceDisclosureReason, toolArgumentsText, toolCallKey, toolEffectKind, toolIsMechanicalCheck, toolResultFailed, toolTargetPaths, trustedCapture, trustedDoubaoSubmit, trustedUiEntry, verificationFailure, verifierContractReason, verifierSkillFile, withoutPastProgress, workFirstContext, workFirstTextTask, workflowExpectedCounts, workflowRunDir, writeJsonAtomic} from './evidence-rules.mjs';
import {assistantTextFromMessages, modeForContext} from './index.mjs';

export class CompletionIntegrityGuard {
  constructor() {
    this.runs = new Map();
    // 会话 -> 用户最后一条真实的话。生图 / 后台命令完成、看门狗续跑这些内部轮不是新要求。
    this.userPrompts = new Map();
  }

  reset(key) {
    if (key) this.runs.delete(String(key));
  }

  has(key) {
    return Boolean(key && this.runs.has(String(key)));
  }

  begin(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    if (!key || this.runs.has(key)) return;
    // 11-04 隔离实测 R-ad：最后交付的那一轮是「生图任务完成」内部事件开的头，拿它当用户的话，
    // 判不出是执行型请求，亲眼看和素材来源两项交付检查整段跳过。内部轮沿用用户上一条真实的话。
    const raw = workFirstPrompt(event.prompt, modeForContext(ctx));
    const sessionKey = String(ctx.sessionKey || event.sessionKey || '');
    const injected = runtimeTurnText(raw) || internalControlText(raw);
    if (sessionKey && !injected && raw.trim()) {
      this.userPrompts.delete(sessionKey);
      this.userPrompts.set(sessionKey, raw);
      while (this.userPrompts.size > 512) this.userPrompts.delete(this.userPrompts.keys().next().value);
    }
    this.runs.set(key, {
      ...contractTimeBoundary(),
      prompt: (injected && this.userPrompts.get(sessionKey)) || raw,
      // 子会话交回汇报、叫醒父会话的那一轮：活是子会话做的，父会话这轮核对、转告。
      sessionReport: sessionKey && String(event.prompt || '').includes(SESSION_WAKE_MARK) ? sessionKey : '',
      tools: [],
      skills: new Map(),
      loadedSkills: new Set(),
      contractSkills: new Set(),
      missingVerifiers: new Set(),
      pendingTools: new Map(),
      mutationEpoch: 0,
      verification: null,
      authorityRecords: new Map(),
    });
  }

  snapshot(key, {includeTools = true} = {}) {
    const state = this.runs.get(String(key || ''));
    if (!state) return null;
    return {
      v: 1,
      startedAt: state.startedAt,
      contractCutoffNs: state.contractCutoffNs,
      prompt: String(state.prompt || '').slice(0, 12_000),
      sessionReport: String(state.sessionReport || ''),
      tools: includeTools ? state.tools.slice(-1024).map(compactToolEvidence) : [],
      skills: [...state.skills.entries()].map(([skillFile, contract]) => [skillFile, compactJson(contract)]),
      loadedSkills: [...state.loadedSkills],
      contractSkills: [...(state.contractSkills || [])],
      missingVerifiers: [...state.missingVerifiers],
      softGates: compactJson(state.softGates || {}),
      mutationEpoch: Number(state.mutationEpoch) || 0,
      verification: compactJson(state.verification),
      authorityRecords: [...(state.authorityRecords || new Map()).entries()].map(([kind, record]) => [kind, compactJson(record)]),
    };
  }

  restore(key, value = {}) {
    const runKey = String(key || '');
    if (!runKey || !value || value.v !== 1) return false;
    const state = {
      startedAt: Number(value.startedAt) || Date.now(),
      contractCutoffNs: /^\d+$/.test(String(value.contractCutoffNs || '')) ? String(value.contractCutoffNs) : '',
      prompt: String(value.prompt || '').slice(0, 12_000),
      sessionReport: typeof value.sessionReport === 'string' ? value.sessionReport : '',
      tools: Array.isArray(value.tools) ? value.tools.slice(-1024).map(entry => ({
        name: String(entry?.name || ''), failed: Boolean(entry?.failed),
        output: String(entry?.output || '').slice(0, 6_000),
        params: entry?.params && typeof entry.params === 'object' ? entry.params : {},
        effects: Array.isArray(entry?.effects) ? entry.effects : [], at: Number(entry?.at) || 0,
      })) : [],
      skills: new Map(Array.isArray(value.skills) ? value.skills.filter(row => Array.isArray(row) && row.length === 2) : []),
      loadedSkills: new Set(Array.isArray(value.loadedSkills) ? value.loadedSkills : []),
      // Older saved runs did not record contracts: only Skills that ship a verifier are.
      contractSkills: new Set(Array.isArray(value.contractSkills) ? value.contractSkills
        : (Array.isArray(value.loadedSkills) ? value.loadedSkills : []).filter(skillHasVerifier)),
      missingVerifiers: new Set(Array.isArray(value.missingVerifiers) ? value.missingVerifiers : []),
      softGates: value.softGates && typeof value.softGates === 'object' ? {...value.softGates} : {},
      pendingTools: new Map(),
      mutationEpoch: Number(value.mutationEpoch) || 0,
      verification: value.verification && typeof value.verification === 'object' ? value.verification : null,
      authorityRecords: new Map(Array.isArray(value.authorityRecords)
        ? value.authorityRecords.filter(row => Array.isArray(row) && row.length === 2) : []),
    };
    this.runs.set(runKey, state);
    return true;
  }

  replayTools(key, entries = []) {
    const state = this.runs.get(String(key || ''));
    if (!state) return 0;
    const seen = new Set(state.tools.map(entry => `${entry.at}:${entry.name}:${hashForAudit(toolArgumentsText(entry))}`));
    for (const raw of entries) {
      const entry = compactToolEvidence(raw);
      const id = `${entry.at}:${entry.name}:${hashForAudit(toolArgumentsText(entry))}`;
      if (!entry.name || seen.has(id)) continue;
      state.tools.push(entry); seen.add(id);
    }
    state.tools.sort((a, b) => (a.at || 0) - (b.at || 0));
    if (state.tools.length > 2048) state.tools = state.tools.slice(-2048);
    return state.tools.length;
  }

  /**
   * Some transports call before_agent_run with an empty prompt and only add
   * the user text in before_prompt_build. Keep that request in the evidence
   * window instead of silently classifying the turn as chat.
   */
  updatePrompt(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    const prompt = workFirstPrompt(event.prompt, modeForContext(ctx)).trim();
    const sessionKey = String(ctx.sessionKey || event.sessionKey || '');
    if (key && sessionKey && String(event.prompt || '').includes(SESSION_WAKE_MARK)) {
      const woken = this.runs.get(key);
      if (woken) woken.sessionReport ||= sessionKey; else this.begin({prompt: event.prompt}, ctx);
      return;
    }
    if (!key || !prompt || internalControlText(prompt)) return;
    const state = this.runs.get(key);
    if (!state) {
      this.begin({prompt}, ctx);
      return;
    }
    if (!state.prompt || internalControlText(state.prompt)) state.prompt = prompt;
  }

  /** A steer that adds an explicit change keeps the window but raises the bar. */
  amendPrompt(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    const prompt = workFirstPrompt(event.prompt, modeForContext(ctx)).trim();
    const state = key && this.runs.get(key);
    if (state && prompt && !internalControlText(prompt)) state.prompt = prompt;
  }

  beforeTool(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    if (!key) return;
    const state = this.runs.get(key) || {
      ...contractTimeBoundary(), prompt: '', tools: [], skills: new Map(),
      loadedSkills: new Set(), contractSkills: new Set(), missingVerifiers: new Set(), pendingTools: new Map(),
      mutationEpoch: 0, verification: null, authorityRecords: new Map(),
    };
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const paths = toolTargetPaths(event.toolName, params, agentWorkspaceDir(ctx)).slice(0, 24);
    state.pendingTools.set(toolCallKey(event), paths.map(snapshotFile));
    this.runs.set(key, state);
  }

  afterTool(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    if (!key) return;
    const state = this.runs.get(key) || {
      ...contractTimeBoundary(), prompt: '', tools: [], skills: new Map(), loadedSkills: new Set(),
      contractSkills: new Set(), missingVerifiers: new Set(), pendingTools: new Map(), mutationEpoch: 0,
      verification: null, authorityRecords: new Map(),
    };
    const output = resultText(event.result);
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const callKey = toolCallKey(event);
    const snapshots = state.pendingTools.get(callKey) || [];
    state.pendingTools.delete(callKey);
    const failed = toolResultFailed(event, output);
    let effects = snapshots.map(compareSnapshot);
    // Preserve strictness when a tool merely says "completed": that is not a
    // mutation receipt.  But a real built-in write/edit result with
    // details.changed=true is authoritative host evidence and must not be
    // discarded just because the transport failed to correlate hook ids.
    if (!failed && !effects.some(effect => effect.changed)
        && hostFileMutationReceipt(event.toolName, event.result)) {
      // code_edit 的 path 相对项目目录（不是 agent 工作区），用它回执里引擎写的绝对路径。
      const reported = String(event.toolName || '') === 'code_edit' && typeof event.result?.details?.absolutePath === 'string'
        && path.isAbsolute(event.result.details.absolutePath) ? [event.result.details.absolutePath] : null;
      effects = (reported || toolTargetPaths(event.toolName, params, agentWorkspaceDir(ctx))).slice(0, 16).map(target => ({
        ...snapshotFile(target), changed: true, hostReported: true,
      }));
    }
    const entry = {
      name: String(event.toolName || ''),
      failed,
      output,
      params,
      effects,
      at: Date.now(),
    };
    state.tools.push(entry);
    if (!failed && String(event.toolName || '') !== DELIVERY_GUARD_TOOL && toolEffectKind(entry)) {
      state.mutationEpoch = (Number(state.mutationEpoch) || 0) + 1;
      state.verification = null;
    }
    const requestedPath = params.path || params.file_path || params.filePath || '';
    const readSucceeded = !failed && /^(?:read|read_file|open_file)$/i.test(String(event.toolName || ''));
    if (readSucceeded && SKILL_PATH.test(String(requestedPath))) {
      const skillFile = path.resolve(String(requestedPath));
      const verifier = path.join(path.dirname(skillFile), 'tools', 'verify_completion.py');
      state.loadedSkills.add(skillFile);
      state.contractSkills ||= new Set();
      // 只有读取时就自带 tools/verify_completion.py 的 Skill 才把独立验收当作
      // 交付条件。社区或自写的普通 Skill 没有验收器，按常规工具证据核验；以前
      // 把它们也算作「缺验收器」，结果用任何普通 Skill 都永远不能交付，模型只能
      // 空转、到处找脚本。读取之后才出现的验收器不会让它变成契约 Skill。
      if (state.contractSkills.has(skillFile) || fs.existsSync(verifier)) {
        state.contractSkills.add(skillFile);
        if (!registerVerifier(state, skillFile, verifier)) state.missingVerifiers.add(skillFile);
      }
      state.verification = null;
    } else if (readSucceeded && VERIFIER_PATH.test(String(requestedPath))) {
      const verifier = path.resolve(String(requestedPath));
      const skillFile = verifierSkillFile(verifier);
      // A verifier created by the same model after it read an unverified
      // Skill is not independent. Only a contract present at first Skill load
      // may become the completion authority for this turn.
      if (state.contractSkills?.has(skillFile) && !state.missingVerifiers.has(skillFile)) {
        registerVerifier(state, skillFile, verifier);
        state.verification = null;
      }
    }
    this.runs.set(key, state);
  }

  async verifyAfterTool(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    const state = this.runs.get(key);
    const entry = state?.tools.at(-1);
    if (!executedLockedVerifier(state, entry)) return;
    // Shell output is only a trigger, never authority. Run every locked
    // contract independently so printed PASS text or one passing Skill cannot
    // certify a failed second contract.
    return this.verifyExternal(key);
  }

  workflowContext(key, requestedRunDir) {
    const state = this.runs.get(String(key || ''));
    if (!state) throw new Error('当前会话没有可核验的执行记录');
    const skillFile = [...state.loadedSkills].find(value => /[\\/]douyin-ai-video-workflow[\\/]SKILL\.md$/i.test(value));
    if (!skillFile) throw new Error('本轮没有先读取视频工作流 SKILL.md');
    const projectRoot = skillProjectRoot(skillFile);
    const runsRoot = path.join(projectRoot, 'runs');
    const runDir = path.resolve(String(requestedRunDir || ''));
    if (!requestedRunDir || !isPathInside(runDir, runsRoot)
        || !existingPathInside(runDir, runsRoot)) throw new Error('运行目录必须是当前 Skill 项目 runs/ 下的新目录');
    const initialized = state.tools.find(entry => !entry.failed
      && /pipeline_state\.py[\s\S]*\binit\b/i.test(toolArgumentsText(entry))
      && workflowRunDir(entry) === runDir);
    if (!initialized) throw new Error('本轮没有用 pipeline_state.py init 初始化这个 RUN_ID');
    const stateFile = path.join(runDir, 'pipeline_state.json');
    if (!fs.existsSync(stateFile) || !existingPathInside(stateFile, runDir)
        || fs.lstatSync(stateFile).isSymbolicLink()) throw new Error('运行状态文件不存在或离开了本轮运行目录');
    let pipeline;
    try { pipeline = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { throw new Error('运行状态文件不可读'); }
    const createdAt = parseIsoMs(pipeline.created_at);
    if (!createdAt || createdAt < state.startedAt - 2_000) throw new Error('RUN_ID 不是本轮新初始化，不能复用旧运行');
    return {state, skillFile, projectRoot, runsRoot, runDir, pipeline};
  }

  assertFreshRunFile(file, runDir, startedAt, label, {image = false, video = false} = {}) {
    const target = path.resolve(String(file || ''));
    let link;
    try { link = fs.lstatSync(target); } catch { link = null; }
    if (!target || !isPathInside(target, runDir) || !existingPathInside(target, runDir)
        || !link || link.isSymbolicLink() || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`${label} 不在本轮运行目录或不存在`);
    }
    const stat = fs.statSync(target);
    const birth = Number(stat.birthtimeMs || stat.ctimeMs || 0);
    if (birth < startedAt - 2_000 || stat.mtimeMs < startedAt - 2_000) throw new Error(`${label} 早于本轮开始，不能复用旧证据`);
    const probe = image ? probeImageFile(target) : video ? probeVideoFile(target) : {};
    return {path: target, sha256: fileSha256(target), size: stat.size, ...probe};
  }

  /**
   * Trusted evidence writer. The model supplies descriptive fields, while the
   * host recomputes file hashes/media facts and requires matching tool events.
   * It never writes pipeline_state.json; only pipeline_state.py may advance it.
   */
  async recordEvidence(key, request = {}) {
    const kind = String(request.kind || '');
    const relative = WORKFLOW_EVIDENCE_TARGETS[kind];
    if (!relative) throw new Error('不支持的受控证据类型');
    const {state, runDir} = this.workflowContext(key, request.run_dir);
    const data = request.data && typeof request.data === 'object' && !Array.isArray(request.data)
      ? structuredClone(request.data) : {};
    const active = state.tools.filter(entry => !entry.failed && entry.at >= state.startedAt);
    const target = path.join(runDir, relative);
    assertRunOutputPath(target, runDir);

    if (kind === 'submission_ledger') {
      const items = evidenceItems(data, 'items', 'submissions', 'jobs');
      const submits = active.filter(trustedDoubaoSubmit);
      if (!items.length || submits.length < items.length) throw new Error('真实豆包提交次数不足，不能生成提交台账');
      const expected = workflowExpectedCounts(active.find(entry => /pipeline_state\.py[\s\S]*\binit\b/i.test(toolArgumentsText(entry))) || {});
      if (expected.videos && items.length !== expected.videos) throw new Error(`提交台账必须覆盖全部 ${expected.videos} 个视频单元`);
      const screenshotHashes = new Set();
      for (const [index, item] of items.entries()) {
        if (!String(item.unit_id || '').trim() || !String(item.platform_job_id || '').trim()) {
          throw new Error(`提交条目 ${index + 1} 缺少视频单元 ID 或平台任务 ID`);
        }
        if (String(item.aspect_ratio || '') !== '9:16' || Number(item.duration_sec || 0) <= 0) {
          throw new Error(`提交条目 ${index + 1} 没有核对 9:16 与有效时长`);
        }
        if (!/^[a-f0-9]{64}$/i.test(String(item.prompt_sha256 || ''))) throw new Error(`提交条目 ${index + 1} 缺少 Prompt SHA-256`);
        const submit = submits[index];
        if (!entryText(submit).includes(String(item.platform_job_id))) throw new Error(`提交条目 ${index + 1} 的平台任务 ID 不在真实 UI 回执中`);
        const screenshot = evidencePath(item, 'screenshot_path');
        const checked = this.assertFreshRunFile(screenshot, runDir, state.startedAt, `提交截图 ${index + 1}`, {image: true});
        if (!trustedCapture(active, checked.path, submit.at)) throw new Error(`提交截图 ${index + 1} 没有绑定提交后的可信 UI 截图事件`);
        if (screenshotHashes.has(checked.sha256)) throw new Error('不同视频单元不能复用同一张提交截图');
        screenshotHashes.add(checked.sha256);
        item.status = 'SUBMITTED'; item.submitted = true;
        item.submitted_at = new Date(submit.at).toISOString();
        item.screenshot_path = checked.path; item.screenshot_sha256 = checked.sha256;
        item.screenshot_width = checked.width; item.screenshot_height = checked.height;
      }
      data.items = items;
    } else if (kind === 'video_ledger') {
      const items = evidenceItems(data, 'items', 'videos', 'shots');
      if (!items.length) throw new Error('视频台账没有条目');
      const expected = workflowExpectedCounts(active.find(entry => /pipeline_state\.py[\s\S]*\binit\b/i.test(toolArgumentsText(entry))) || {});
      if (expected.videos && items.length !== expected.videos) throw new Error(`视频台账必须覆盖全部 ${expected.videos} 个视频单元`);
      const hashes = new Set();
      for (const [index, item] of items.entries()) {
        if (!String(item.unit_id || '').trim()) throw new Error(`视频条目 ${index + 1} 缺少视频单元 ID`);
        const videoPath = evidencePath(item, 'path', 'file_path', 'local_path', 'video_path');
        const checked = this.assertFreshRunFile(videoPath, runDir, state.startedAt, `视频 ${index + 1}`, {video: true});
        const downloaded = active.find(entry => entry.at >= state.startedAt
          && /(?:download|browser|computer|cua)/i.test(String(entry.name || ''))
          && /(?:download|下载|saved|保存)/i.test(entryText(entry)) && entryMentionsFile(entry, checked.path));
        if (!downloaded) throw new Error(`视频 ${index + 1} 没有可信下载回执`);
        const decoded = await runProcess('ffmpeg', ['-v', 'error', '-i', checked.path, '-f', 'null', '-'], {
          encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
        }).then(() => true).catch(() => false);
        if (!decoded || Number(checked.video.width || 0) >= Number(checked.video.height || 0)) throw new Error(`视频 ${index + 1} 不是可完整解码的竖屏视频`);
        if (hashes.has(checked.sha256)) throw new Error('不同视频单元不能复用同一个视频文件');
        hashes.add(checked.sha256);
        item.path = checked.path; item.sha256 = checked.sha256; item.decode_ok = true;
        item.downloaded_at = new Date(downloaded.at).toISOString();
        item.duration_sec = Number(checked.data.format?.duration || 0);
        item.width = Number(checked.video.width || 0); item.height = Number(checked.video.height || 0);
        item.codec = checked.video.codec_name;
      }
      data.items = items;
    } else if (kind === 'qc_report') {
      const master = this.assertFreshRunFile(path.join(runDir, 'final', 'FINAL_MASTER_VIDEO.mp4'), runDir, state.startedAt, '最终母带', {video: true});
      const frameViews = new Set(active.filter(entry => /(?:view_image|multimodal|vision)/i.test(String(entry.name || ''))
        && /\.(?:png|jpe?g|webp)\b/i.test(entryText(entry)))
        .map(entry => evidencePath(entry.params || {}, 'path', 'file_path', 'image_path')).filter(Boolean));
      if (frameViews.size < 3) throw new Error('QC 至少需要真实查看 3 个不同时间点的母带抽帧');
      const decoded = await runProcess('ffmpeg', ['-v', 'error', '-i', master.path, '-f', 'null', '-'], {
        encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
      }).then(() => true).catch(() => false);
      if (!decoded) throw new Error('最终母带完整解码失败');
      const video = master.video || {}, audio = master.audio || {};
      if (video.codec_name !== 'h264' || Number(video.width) !== 1080 || Number(video.height) !== 1920 || video.pix_fmt !== 'yuv420p') {
        throw new Error('最终母带必须为 H.264、1080x1920、yuv420p');
      }
      if (audio.codec_name !== 'aac' || String(audio.sample_rate || '') !== '48000') throw new Error('最终母带音频必须为 AAC 48kHz');
      if (!faststartOk(master.path)) throw new Error('最终母带缺少 faststart');
      const semantic = data.machine_checks && typeof data.machine_checks === 'object' ? data.machine_checks : {};
      const semanticNames = ['black_frame_reviewed', 'continuity_reviewed', 'watermark_reviewed', 'subtitle_safe_area_reviewed', 'content_title_match'];
      if (semanticNames.some(name => semantic[name] !== true)) throw new Error('QC 的视觉/内容复核项没有逐项确认');
      data.status = 'PASS';
      data.reviewed_at = new Date().toISOString();
      data.video_path = master.path; data.video_sha256 = master.sha256;
      data.machine_checks = {
        ...semantic, full_decode_ok: true, resolution_ok: true, audio_ok: Boolean(master.audio),
        pixel_format_ok: master.video.pix_fmt === 'yuv420p', faststart_ok: true,
      };
      if (Object.values(data.machine_checks).some(value => value !== true)) throw new Error('QC 客观检查没有全部通过');
    } else if (kind === 'publish_receipt') {
      const xhs = active.filter(entry => trustedUiEntry(entry) && /xiaohongshu\.com|xhslink\.com|小红书/i.test(entryText(entry)));
      const upload = xhs.find(entry => /"(?:action|kind)"\s*:\s*"upload_file"/i.test(toolArgumentsText(entry)));
      const publish = xhs.findLast(entry => entry.at >= Number(upload?.at || 0)
        && /"(?:action|kind)"\s*:\s*"(?:click|press)"/i.test(toolArgumentsText(entry))
        && /(?:公开发布|发布成功|publish)/i.test(entryText(entry)));
      if (!upload || !publish) throw new Error('没有小红书真实上传以及随后点击公开发布的可信 UI 动作');
      const screenshot = this.assertFreshRunFile(evidencePath(data, 'screenshot_path'), runDir, state.startedAt, '发布成功截图', {image: true});
      if (screenshot.path !== path.join(runDir, 'publish', 'published.png')) throw new Error('发布成功截图必须保存为 publish/published.png');
      const observed = trustedCapture(xhs, screenshot.path, publish.at);
      if (!observed) throw new Error('发布后没有可信 UI 成功页截图');
      data.status = 'PUBLISHED'; data.visibility = 'PUBLIC'; data.screenshot_path = screenshot.path;
      data.screenshot_sha256 = screenshot.sha256;
      if (!data.platform_post_id || !data.title) throw new Error('发布页面没有提供作品 ID 或实际标题');
      if (!entryText(observed).includes(String(data.platform_post_id)) || !entryText(observed).includes(String(data.title).trim())) {
        throw new Error('发布成功页没有同时观察到作品 ID 和实际标题');
      }
      data.published_at = new Date(observed.at).toISOString();
    } else if (kind === 'publication_verification') {
      const publicUrl = String(data.public_url || '');
      let parsed;
      try { parsed = new URL(publicUrl); } catch { throw new Error('公开作品 URL 无效'); }
      if (parsed.protocol !== 'https:' || !['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com'].includes(parsed.hostname)) {
        throw new Error('公开作品 URL 不是 HTTPS 小红书链接');
      }
      if (/xiaohongshu\.com$/i.test(parsed.hostname) && !/^\/(?:explore|discovery\/item)\//.test(parsed.pathname)) {
        throw new Error('公开 URL 不是作品详情页');
      }
      const receipt = state.authorityRecords?.get('publish_receipt');
      const reopened = active.find(entry => entry.at >= Number(receipt?.at || 0)
        && trustedUiEntry(entry)
        && /(?:open|navigate|snapshot)/i.test(`${toolArgumentsText(entry)}\n${entry.output}`)
        && `${toolArgumentsText(entry)}\n${entry.output}`.includes(publicUrl));
      if (!receipt || !reopened) throw new Error('发布后没有重新打开并观察同一公开作品 URL');
      const published = this.assertFreshRunFile(evidencePath(data, 'screenshot_path'), runDir, state.startedAt, '发布成功截图', {image: true});
      const publicPage = this.assertFreshRunFile(evidencePath(data, 'public_page_screenshot_path'), runDir, state.startedAt, '公开页截图', {image: true});
      if (published.path !== path.join(runDir, 'publish', 'published.png') || publicPage.path !== path.join(runDir, 'publish', 'public_page.png')) {
        throw new Error('发布页和公开页截图必须使用契约规定的固定路径');
      }
      if (!trustedCapture(active, publicPage.path, reopened.at)) throw new Error('公开页截图没有绑定二次打开后的可信 UI 截图事件');
      if (published.sha256 === publicPage.sha256) throw new Error('发布页截图与二次公开页截图不能相同');
      const receiptData = JSON.parse(fs.readFileSync(receipt.path, 'utf8'));
      const title = String(data.title || receiptData.title || '').trim(), account = String(data.account_id || '').trim();
      const observedText = entryText(reopened);
      if (!title || !account || !observedText.includes(title) || !observedText.includes(account)) {
        throw new Error('公开页文本没有同时核对标题和账号');
      }
      if (!publicUrl.includes(String(receiptData.platform_post_id || ''))) throw new Error('公开 URL 没有绑定发布回执的作品 ID');
      const pageEvidencePath = path.join(runDir, 'publish', 'public_page_evidence.txt');
      assertRunOutputPath(pageEvidencePath, runDir);
      fs.writeFileSync(pageEvidencePath, `${observedText}\n`, {encoding: 'utf8', mode: 0o600});
      const pageEvidence = this.assertFreshRunFile(pageEvidencePath, runDir, state.startedAt, '公开页文本证据');
      const master = this.assertFreshRunFile(path.join(runDir, 'final', 'FINAL_MASTER_VIDEO.mp4'), runDir, state.startedAt, '最终母带', {video: true});
      data.status = 'PUBLISHED'; data.platform = 'xiaohongshu'; data.url_reopened = true;
      data.public_visibility_confirmed = true; data.screenshot_path = published.path;
      data.screenshot_sha256 = published.sha256; data.public_page_screenshot_path = publicPage.path;
      data.public_page_screenshot_sha256 = publicPage.sha256; data.page_evidence_path = pageEvidence.path;
      data.page_evidence_sha256 = pageEvidence.sha256;
      data.title = title; data.account_id = account; data.observed_title = title; data.observed_account_id = account;
      data.platform_post_id = String(receiptData.platform_post_id || ''); data.published_at = receiptData.published_at;
      data.video_sha256 = master.sha256; data.verification_source = 'trusted_ui_reopen';
    } else if (kind === 'cleanup_report') {
      const publication = state.authorityRecords?.get('publication_verification');
      const closed = active.filter(entry => entry.at >= Number(publication?.at || 0)
        && trustedUiEntry(entry) && /"(?:action|kind)"\s*:\s*"close"/i.test(toolArgumentsText(entry)));
      if (!publication || !closed.length) throw new Error('公开页验证后没有真实关闭本次任务标签页');
      const desktop = this.assertFreshRunFile(evidencePath(data, 'desktop_screenshot_path'), runDir, state.startedAt, '清理后截图', {image: true});
      if (desktop.path !== path.join(runDir, 'reports', 'cleanup_desktop.png')) throw new Error('清理后截图必须保存为 reports/cleanup_desktop.png');
      const observation = active.find(entry => entry.at >= closed.at(-1).at && trustedUiEntry(entry)
        && /(?:tabs|snapshot|status|inspect|标签页)/i.test(entryText(entry)));
      if (!observation || !trustedCapture(active, desktop.path, observation.at)) throw new Error('关闭后没有再次观察标签页集合和保存清理截图');
      const closedTargets = closed.map(entry => String(entry.params?.targetId || entry.params?.target_id || '')).filter(Boolean);
      if (!closedTargets.length || closedTargets.some(id => entryText(observation).includes(id))) throw new Error('关闭后仍能在标签页集合中看到本次任务目标');
      data.status = 'COMPLETED'; data.task_tabs_remaining = 0;
      data.unrelated_tabs_preserved = true; data.saved_login_preserved = true;
      data.closed_targets = closedTargets;
      data.completed_at = new Date().toISOString(); data.desktop_screenshot_path = desktop.path;
      data.desktop_screenshot_sha256 = desktop.sha256;
    }

    writeJsonAtomic(target, data);
    state.mutationEpoch = (Number(state.mutationEpoch) || 0) + 1;
    state.verification = null;
    state.authorityRecords = state.authorityRecords || new Map();
    state.authorityRecords.set(kind, {
      kind, path: target, sha256: fileSha256(target), at: Date.now(), epoch: state.mutationEpoch,
    });
    return {ok: true, kind, path: target, sha256: fileSha256(target)};
  }

  async verifyExternal(key) {
    const state = this.runs.get(String(key || ''));
    if (!state) return {ok: false, reason: '当前会话没有可核验的执行记录'};
    // Permission/health/status probes have no artifact contract to satisfy.
    // A model may still have read an unrelated SKILL.md while diagnosing the
    // environment; do not turn that incidental read into a demand to execute
    // the Skill's business workflow. Accept only a real, successful host-side
    // mechanical observation, never model-authored prose.
    if (isReadOnlyDiagnosticRequest(state.prompt)) {
      const observed = state.tools.some(toolIsMechanicalCheck);
      if (!observed) return {ok: false, reason: '只读诊断尚未取得真实的主机检查结果'};
      state.verification = {
        ok: true, epoch: state.mutationEpoch, at: Date.now(), scope: 'read-only-diagnostic',
      };
      return {ok: true, verified: true, scope: 'read-only-diagnostic', at: state.verification.at};
    }
    const missing = missingVerifierReason(state);
    if (missing || state.skills.size === 0) {
      state.verification = null;
      return {ok: false, reason: missing || '本轮没有已锁定的独立 Skill 验收契约'};
    }
    const checkedEpoch = state.mutationEpoch;
    const contracts = [...state.skills];
    for (const [skillFile, contract] of contracts) {
      const contractFailure = verifierContractReason(skillFile, contract);
      if (contractFailure) {
        state.verification = null;
        return {ok: false, reason: contractFailure};
      }
      const projectRoot = skillProjectRoot(skillFile);
      let checked;
      try {
        checked = await runProcess('python3', [
          contract.verifier, '--project-root', projectRoot, '--since-ms', String(state.startedAt), '--json',
        ], {
          encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
          // Same reason as the synchronous verify path: `encoding: 'utf8'`
          // only controls how Node decodes the captured bytes, not the code
          // page python uses to print.  A non-UTF-8 Windows locale makes the
          // child print cp1252 and throw UnicodeEncodeError on Chinese, so pin
          // the child's streams to UTF-8.
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
            PINKIE_INTEGRITY_STARTED_AT_MS: String(state.startedAt),
          },
        });
      } catch (error) {
        const reason = verificationFailure(error?.stdout || error?.stderr || error?.message);
        state.verification = {ok: false, epoch: state.mutationEpoch, at: Date.now(), reason};
        return {ok: false, reason};
      }
      const output = String(checked.stdout || checked.stderr || '');
      let parsed;
      try { parsed = JSON.parse(output); } catch { parsed = null; }
      if (!parsed || parsed.verified !== true || String(parsed.status || '').toUpperCase() !== 'PASS') {
        const reason = parsed ? verificationFailure(output) : '校验器没有返回可验证的 PASS JSON';
        state.verification = {ok: false, epoch: state.mutationEpoch, at: Date.now(), reason};
        return {ok: false, reason};
      }
      const changedContract = verifierContractReason(skillFile, contract);
      if (changedContract) {
        state.verification = null;
        return {ok: false, reason: changedContract};
      }
    }
    if (state.mutationEpoch !== checkedEpoch || state.skills.size !== contracts.length || missingVerifierReason(state)) {
      state.verification = null;
      return {ok: false, reason: '验收期间产物或 Skill 契约发生变化，需要重新验证最新结果'};
    }
    state.verification = {ok: true, epoch: state.mutationEpoch, at: Date.now()};
    return {ok: true, verified: true, at: state.verification.at};
  }

  // 一轮只提醒一次（remindOnce）：先命中的别的提醒（比如最后一个工具失败）会把「视频没说素材来源」挤掉。
  // 11-04 routes-i R-ad-2：侧栏浏览器没连上 → 提醒「最后一次工具调用失败」→ 来源那条再也没机会发。所以并进同一条。
  finalize(event = {}, ctx = {}, options = {}) {
    const decision = this.finalizeChecks(event, ctx, options);
    if (decision?.action !== 'revise') return decision;
    if (workFirstContext(ctx)) return decision;
    const key = completionRunKey(event, ctx);
    const state = this.runs.get(key);
    if (!state) return decision;
    const reply = String(event.lastAssistantMessage || assistantTextFromMessages(event.messages) || '');
    // 只在这条回复是交付时并：「这就去做」那种预告还没到交付，不提来源。
    const delivering = COMPLETION_CLAIM.test(reply) || DELIVERY_CLAIM.test(reply) || replyDeliveredKinds(reply).length > 0;
    if (!delivering && (!isLikelyActionRequest(deliveryTaskPrompt(state.prompt, ctx, key)) || promiseWithoutActionReason(reply))) return decision;
    const note = sourceDisclosureReason(state, reply);
    const reason = String(decision.reason || '').replace(/^全局交付真实性门禁：/, '');
    if (!note || reason.includes(note)) return decision;
    const merged = this.revise(key, `${reason}；另外，${note}`);
    return {...decision, reason: merged.reason, retry: {...(decision.retry || {}), instruction: merged.retry.instruction}};
  }

  finalizeChecks(event = {}, ctx = {}, options = {}) {
    const key = completionRunKey(event, ctx);
    const state = this.runs.get(key);
    const reply = String(event.lastAssistantMessage || assistantTextFromMessages(event.messages) || '');
    if (!state) return;
    const prompt = deliveryTaskPrompt(state.prompt, ctx, key);
    // Asking the user is a legitimate pause, not a delivery claim.
    const lastTool = state.tools.at(-1);
    if (lastTool && lastTool.name === ASK_USER_TOOL && !lastTool.failed) return;
    // A started background job (image_generate, video) yields the turn until
    // its completion event; the interim reply is not a delivery claim.
    if (lastTool && !lastTool.failed && /Background task started for \w+ generation\b/.test(String(lastTool.output || ''))) return;
    // 学习题卡的出题和结算本身就是交付：卡片就在聊天里，不需要文件或命令证据。
    // 否则“给我出 3 道程序阅读题”、卡片作答消息都会被当成执行任务再跑一轮。
    // 只看用户自己的话：模式注入的【学习工作台】等说明里有“运行练习”，不代表这轮要运行什么。
    if (state.tools.some(entry => entry.name === 'learning_activity' && !entry.failed)
        && !FILE_OR_RUN_REQUEST.test(intentText(prompt).split(/\n\s*【/)[0])) return;
    // In the four work modes this gate checks what the reply claims, not what
    // the user's wording appears to ask. A pause or plan is not a false claim
    // that an action was completed. The unrestricted mode keeps its old path.
    const claimText = actionClaimText(reply);
    const workClaim = workFirstContext(ctx) && (WORK_ACTION_CLAIM.test(claimText)
      || WORK_PRODUCT_CLAIM.test(claimText) || ENGLISH_MUTATION_CLAIM.test(claimText)
      || ENGLISH_TEST_CLAIM.test(claimText) || replyDeliveredKinds(reply).length > 0);
    const reportedMutation = workFirstContext(ctx) && hasReportedMutation(reply);
    if (workFirstContext(ctx) && !workClaim && !COMPLETION_CLAIM.test(claimText)
        && !DELIVERY_CLAIM.test(claimText)) return;
    // A one-character fragment after substantial work is not a useful final.
    // Keep short conversational acknowledgements and media-only deliveries valid.
    if (workFirstContext(ctx) && state.tools.filter(entry => !entry.failed).length >= 3
        && reply.trim() && [...reply.replace(/\s/g, '')].length < 10
        && !COMPLETION_CLAIM.test(reply) && !DELIVERY_CLAIM.test(reply) && !isHonestIncomplete(reply)
        && !RESPONSE_ONLY_PREFIX.test(intentText(prompt))
        && !/^(?:NO_REPLY|HEARTBEAT_OK)$/i.test(reply.trim())
        && !/MEDIA:|```|https?:\/\//i.test(reply)) {
      const nudged = this.softRevise(key, state, 'short-final', reply, '已经做过多步工作，但最终回复过短或被截断；请补上真实结果和打开方式，不要重做已完成的操作');
      if (nudged) return nudged;
    }
    // Naming and prose are delivered in the answer itself. They do not need
    // fictitious file changes, even when an optional illustration was made.
    if (workFirstContext(ctx) && workFirstTextTask(prompt)
        && !REPORTED_EXTERNAL_ACTION.test(actionClaimText(reply)) && !ENGLISH_EXTERNAL_ACTION.test(actionClaimText(reply))) return;
    const actionRun = isLikelyActionRequest(prompt);
    // Reading or summarizing an attached document needs no tool/effect proof.
    // Its quoted wording ("正在生成", "未完成"...) is source content, not the
    // assistant's status report, and must not trigger a retry loop.
    if (!actionRun && !reportedMutation && hasAttachedSourceContent(prompt)) return;
    // The same holds for text pasted inline to translate, polish or summarise,
    // as long as the instruction itself does not ask for a file or other effect.
    const inline = inlineSourceInstruction(prompt);
    if (!reportedMutation && inline !== null && !isLikelyActionRequest(inline)
        && !/(?:保存|存成|存到|写入|导出|生成.{0,4}文件|发送|发到|发给|上传|发布)/.test(inline)) return;
    if (backgroundStillRunning(state) && !BACKGROUND_FINISHED_CLAIM.test(proseOnly(reply)) && !DELIVERY_CLAIM.test(reply)) return;
    if (actionRun) {
      const promise = promiseWithoutActionReason(reply);
      const nudged = promise && this.softRevise(key, state, 'promise', reply, promise);
      if (nudged) return nudged;
    }
    const honestIncomplete = isHonestIncomplete(reply);
    const completionClaimed = workClaim || COMPLETION_CLAIM.test(reply) || DELIVERY_CLAIM.test(reply);
    const overallCompletion = DELIVERY_CLAIM.test(reply)
      || /(?:(?:全部|所有|整体|任务|最终|完整|完全).{0,16}(?:完成|交付|成功)|(?:完成|交付|成功).{0,16}(?:全部|所有|整体|任务|完整|完全))/i.test(reply);
    // 执行型请求不能靠避开“完成”两个字绕过门禁；只有明确报告未完成/阻塞
    // 才允许不运行最终验收。
    if (honestIncomplete && !overallCompletion) return;
    if (!completionClaimed && !actionRun) return;
    if ((honestIncomplete && overallCompletion) || (overallCompletion && IN_PROGRESS_CLAIM.test(withoutPastProgress(proseOnly(reply))))) {
      const verdict = judgeReply({reply, tools: state.tools});
      const reason = verdict.code === 'contradiction'
        ? verdict.missing[0]
        : '回复同时声称“已完成”和“仍在生成/等待”，状态自相矛盾';
      return this.revise(key, reason);
    }
    const tampering = evidenceTamperingReason(state);
    if (tampering) return this.revise(key, tampering);
    if (state.tools.at(-1)?.failed) {
      const verdict = judgeReply({reply, tools: state.tools});
      const reason = verdict.code === 'last-tool-failed'
        ? verdict.missing[0]
        : `最后一次工具调用失败，不能把失败状态写成完成：${state.tools.at(-1).name}`;
      return this.revise(key, reason);
    }
    // A bare "continue" is ambiguous, but a terminal completion claim is not:
    // it must never be accepted with zero execution evidence merely because
    // this turn's short follow-up omitted the original action wording.
    if (!reportedMutation && inlineDeliveryOnly(prompt, reply, state)) return;
    const requiresExecution = actionRun || (completionClaimed && (workClaim || !QUESTION_ONLY.test(prompt)));
    if (requiresExecution) {
      // A read/inspect request is still real work, but it does not need a
      // mutating tool. Count a successful observation only for non-mutation
      // requests; a request to edit/create/delete can never pass with reads.
      const mutationRun = isMutationRequest(prompt) || reportedMutation;
      const executed = state.tools.some(entry => !entry.failed && (
        EXECUTION_TOOL.test(entry.name) || isSessionOperationEvidence(entry, prompt) || (!mutationRun && OBSERVATION_TOOL.test(entry.name))
      ));
      if (!executed && !delegatedWork(state)) return this.revise(key, '这是执行型请求，但本轮没有任何真实执行工具记录');
      if (/skill|技能/i.test(prompt) && state.loadedSkills.size === 0) {
        return this.revise(key, '用户要求调用 Skill，但本轮没有读取 SKILL.md');
      }
    }
    // 「成片已经剪好」「封面做好了」不含「完成」二字，也是交付：执行型请求一样要过这两项。
    if (completionClaimed || actionRun) {
      // In work modes, missing polish is not a false completion claim. Only
      // challenge an inspection when the reply says it actually happened.
      const unseen = workFirstContext(ctx)
        ? (claimedVisualInspection(reply) ? contentInspectionReason(state) : '')
        : [contentInspectionReason(state), sourceDisclosureReason(state, reply)].filter(Boolean).join('；另外，');
      const nudged = unseen && this.softRevise(key, state, 'inspection', reply, unseen);
      if (nudged) return nudged;
    }
    if (isReadOnlyDiagnosticRequest(prompt)) {
      if (!state.tools.some(toolIsMechanicalCheck)) {
        return this.revise(key, '只读诊断尚未取得真实的主机检查结果');
      }
      return;
    }
    const missing = missingVerifierReason(state);
    if (missing) return this.revise(key, missing);
    const workflowFailure = douyinWorkflowReason(state);
    if (workflowFailure) return this.revise(key, workflowFailure);
    // The transcript boundary is synchronous, so it never starts a slow
    // verifier. A plugin-owned tool performs that work visibly/asynchronously
    // and leaves a host attestation bound to the current mutation epoch.
    if (options.verifyExternal === false) {
      for (const [skillFile, contract] of state.skills) {
        const contractFailure = verifierContractReason(skillFile, contract);
        if (contractFailure) return this.revise(key, contractFailure);
      }
      if (state.skills.size > 0 && (!state.verification?.ok || state.verification.epoch !== state.mutationEpoch)) {
        const detail = state.verification?.reason ? `：${state.verification.reason}` : '';
        return this.revise(key, `尚未用成果核验工具验证本轮最新产物${detail}`);
      }
      const missingEffect = effectVerificationReason(state, ctx, reply);
      if (missingEffect) return this.revise(key, missingEffect);
      return;
    }
    for (const [skillFile, contract] of state.skills) {
      const contractFailure = verifierContractReason(skillFile, contract);
      if (contractFailure) return this.revise(key, contractFailure);
      const projectRoot = skillProjectRoot(skillFile);
      const checked = spawnSync('python3', [
        contract.verifier,
        '--project-root', projectRoot,
        '--since-ms', String(state.startedAt),
        '--json',
      ], {
        encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
        // `encoding: 'utf8'` only tells Node how to decode the bytes it
        // captured; it does not decide the code page the child python uses to
        // print.  On a Windows box whose locale is not UTF-8 (a stock GitHub
        // runner, a fresh install), python's stdout defaults to cp1252 and a
        // verifier that prints Chinese throws UnicodeEncodeError before Node
        // ever sees the bytes.  Force UTF-8 on the child's streams so the
        // verifier's output is locale-independent, exactly like it is on
        // macOS/Linux where UTF-8 is the default.
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PINKIE_INTEGRITY_STARTED_AT_MS: String(state.startedAt),
        },
      });
      if (checked.error) {
        return this.revise(key, `${path.basename(path.dirname(skillFile))} 真实性校验器无法运行：${checked.error.message}`);
      }
      if (checked.status !== 0) {
        return this.revise(key, `${path.basename(path.dirname(skillFile))} 真实性验收未通过：${verificationFailure(checked.stdout || checked.stderr)}`);
      }
      const output = String(checked.stdout || checked.stderr || '');
      let parsed;
      try { parsed = JSON.parse(output); } catch { parsed = null; }
      if (!parsed || parsed.verified !== true || String(parsed.status || '').toUpperCase() !== 'PASS') {
        return this.revise(key, `${path.basename(path.dirname(skillFile))} 真实性验收未通过：${parsed ? verificationFailure(output) : '校验器没有返回可验证的 PASS JSON'}`);
      }
      const changedContract = verifierContractReason(skillFile, contract);
      if (changedContract) return this.revise(key, changedContract);
    }
    const missingEffect = effectVerificationReason(state, ctx, reply);
    if (missingEffect) return this.revise(key, missingEffect);
  }

  // 只提醒一次的门禁：同一条回复多次核验结果一致；改过之后的新回复不再拦，
  // 避免像旧的验收器规则那样把模型困在打回循环里。
  softRevise(key, state, gate, reply, reason) {
    state.softGates ||= {};
    const replyHash = hashForAudit(reply);
    const seen = state.softGates[gate];
    if (seen && seen !== replyHash) return null;
    state.softGates[gate] = replyHash;
    return this.revise(key, reason);
  }

  revise(key, reason) {
    return {
      action: 'revise',
      reason: `全局交付真实性门禁：${reason}`,
      retry: {
        instruction: `上一版不能交付：${reason}。不要再写完成报告，也不要篡改状态文件或验收脚本。回到用户原始目标继续真实执行并验证；读取了带 verify_completion.py 的 Skill 时，完成所有改动后必须调用 delivery_guard 的 verify 动作。若外部条件阻塞，就明确报告本轮整体未完成、真实阻塞点和已保留成果。`,
        idempotencyKey: `pinkie-integrity-${key}`,
        maxAttempts: 24,
      },
    };
  }

  end(event = {}, ctx = {}) {
    const key = completionRunKey(event, ctx);
    if (key) this.runs.delete(key);
  }
}

function hashForAudit(value = '') {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function internalControlText(value = '') {
  const text = String(value || '');
  return /(?:\u2063|pinkie-(?:tier|integrity|watchdog|marathon)|自动续接保护|档位控制器|档位续跑|全局交付真实性门禁)/i.test(text);
}

// OpenClaw 自己塞进会话的「用户」轮：后台生图/生视频完成通知、内部上下文事件、交付前改写请求。
// 它们不是用户的新要求，不能拿来重新判活儿种类（11-02 隔离实测：生图失败通知把视频活判成简单问答，
// 「Before accepting … apply this revision request」把查 iPhone 版本判成 App 活；r4：长任务压缩上下文前的
// 「Pre-compaction memory flush」把海报、视频判成简单问答）。心跳轮同理。
// 运行时自己的整理轮：压缩前把要点写进记忆（钩子 ctx.trigger === 'memory'）。不属于正在做的那件活。
const HOUSEKEEPING_TURN = /Pre-compaction memory flush\b/;
function housekeepingTurn(event = {}, ctx = {}, prompt = '') {
  return String(ctx.trigger || event.trigger || '') === 'memory'
    || HOUSEKEEPING_TURN.test(`${event.prompt || ''}\n${prompt || ''}`);
}

function runtimeTurnText(value = '') {
  const text = String(value || '').trimStart();
  return /^(?:A background task completed\.|Continue the OpenClaw runtime event\b|Before accepting the previous final answer, apply this revision request|\[Internal task completion event\]|Pre-compaction memory flush\b|Read HEARTBEAT\.md if it exists)/.test(text)
    || text.includes('<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>');
}

function visibleAssistantText(message = {}) {
  if (!message || message.role !== 'assistant') return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

function assistantMessageHasToolCall(message = {}) {
  if (!Array.isArray(message.content)) return false;
  return message.content.some(part => part?.type === 'toolCall' || part?.type === 'tool_use')
    || (Array.isArray(message.toolCalls) && message.toolCalls.length > 0)
    || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    || Boolean(message.toolCall || message.tool_call);
}

function isTerminalAssistantMessage(message = {}) {
  if (!message || message.role !== 'assistant' || assistantMessageHasToolCall(message)) return false;
  if (message.final === true || message.isFinal === true || message.terminal === true) return true;
  const stopReason = String(message.stopReason || message.stop_reason || '').trim().toLowerCase();
  // OpenClaw's transcript writer uses `stop` for a normal terminal answer.
  // Error/abort messages are terminal too, but are intentionally not treated
  // as successful completion claims by the integrity gate.
  return ['stop', 'end', 'complete', 'completed', 'error', 'aborted', 'length'].includes(stopReason);
}

function payloadText(payload = {}) {
  if (typeof payload === 'string') return payload.trim();
  return String(payload?.text || payload?.body || '').trim();
}

function meaningfulChildResult(value = '') {
  const text = String(value || '').trim();
  if (!text || /^(?:NO_REPLY|DONE|OK|完成|已完成|成功)[。.!！\s]*$/i.test(text)) return false;
  return Array.from(text).length >= 40;
}

function auditRecordDigest(record) {
  const copy = {...record};
  delete copy.hash;
  return hashForAudit(JSON.stringify(copy));
}

/**
 * CLE Kk 的控制面审计链。
 *
 * OpenClaw 只负责模型传输和工具生命周期；这个小型控制面在进程内维护
 * 当前轮次的不可伪造（相对于模型输出）的决定，并把脱敏后的事件写入一条
 * hash-chain 日志。日志不是完成依据，作用是让“谁在什么时候做了什么”可复盘，
 * 同时能发现状态文件被回写、删行或篡改。
 */

export {
  hashForAudit,
  internalControlText,
  HOUSEKEEPING_TURN,
  housekeepingTurn,
  runtimeTurnText,
  visibleAssistantText,
  assistantMessageHasToolCall,
  isTerminalAssistantMessage,
  payloadText,
  meaningfulChildResult,
  auditRecordDigest,
};
