"""Install model-aware limits without touching personas, keys, URLs or history."""
import json
import os
from pathlib import Path
import runpy
import shutil
import tempfile
import time

budget = runpy.run_path(str(Path(__file__).with_name('context_budget.py')))

# Summarising a near-full GPT session with the same GPT route can deadlock the
# session for the whole compaction timeout. Prefer a configured long-context
# Gemini route for maintenance work while leaving the user's chat model alone.
COMPACTION_MODEL_PREFERENCES = (
    'mm/gemini-3.8-flash-tiered',
    'mm/gemini-3.7-flash-tiered',
    'mm/gemini-3.6-flash-tiered',
)


def replace_preserving_file_flags(temp_name, target):
    """Atomic replace without dropping macOS user-immutable protection."""
    target_stat = target.stat()
    flags = getattr(target_stat, 'st_flags', 0)
    immutable = getattr(__import__('stat'), 'UF_IMMUTABLE', 0)
    if immutable and flags & immutable:
        os.chflags(target, flags & ~immutable)
    try:
        os.replace(temp_name, target)
        os.chmod(target, target_stat.st_mode & 0o777)
    finally:
        if flags and target.exists() and hasattr(os, 'chflags'):
            os.chflags(target, flags)


def install(home=None):
    home = Path(home or Path.home())
    source = home/'.openclaw/openclaw.json'
    if not source.is_file():
        return False
    raw = source.read_bytes()
    config = json.loads(raw)
    state = Path(os.environ.get('PINKIE_STATE_ROOT',
                                (Path(os.environ.get('LOCALAPPDATA', home/'AppData/Local'))/'SuperPinkie'
                                 if os.name == 'nt' else home/'Library/Application Support/SuperPinkie')))
    policy_file = state/'context-policy.json'
    rules = budget['policy'](home)
    provenance = budget['read_json'](state/'context-limits.json')
    limits = {}
    for provider, entry in config.get('models', {}).get('providers', {}).items():
        for model in entry.get('models', []):
            ref = provider+'/'+model['id']
            previous = provenance.get(ref, {})
            # Keep provenance while our conservative value is unchanged. Explicit
            # edits in OpenClaw or modelLimits take precedence on the next install.
            override = budget['positive'](rules['modelLimits'].get(ref))
            configured = budget['positive'](model.get('contextTokens')) or budget['positive'](model.get('contextWindow'))
            fallback = not configured or (previous.get('source') == 'conservative-fallback' and configured == previous.get('window'))
            if override:
                model['contextWindow'] = override
                if budget['positive'](model.get('contextTokens')):
                    model['contextTokens'] = override
            elif fallback:
                model['contextWindow'] = rules['unknownContextWindow']
            # Never bake an agent-wide cap back into the model's declared window.
            # Runtime still applies that cap without destroying provider metadata.
            declared = budget['positive'](model.get('contextTokens')) or model['contextWindow']
            limits[ref] = {'window':declared,'source':'override' if override else 'conservative-fallback' if fallback else 'provider-config'}
    # The runtime patch supplies reserves as a percentage, not these old fixed
    # defaults. Keep unrelated compaction options (memory flush, instructions...).
    compaction = config.setdefault('agents', {}).setdefault('defaults', {}).setdefault('compaction', {})
    compaction.pop('reserveTokens', None)
    compaction.setdefault('reserveTokensFloor', 100000)
    compaction.setdefault('timeoutSeconds', 900)
    # Keep user-set windows and keepRecentTokens exactly as-is. These supported
    # additions improve what survives compaction without moving its threshold.
    # Current CLE Kk runtimes reject the retired free-form instruction fields;
    # remove only those known retired keys so a re-install cannot brick config.
    compaction.setdefault('mode', 'safeguard')
    compaction.setdefault('recentTurnsPreserve', 12)
    compaction.pop('maxHistoryShare', None)
    compaction.pop('identifierInstructions', None)
    if compaction.get('identifierPolicy') not in ('strict', 'off'):
        compaction['identifierPolicy'] = 'strict'
    quality = compaction.setdefault('qualityGuard', {})
    quality.setdefault('enabled', True)
    quality.setdefault('maxRetries', 4)
    compaction.setdefault('midTurnPrecheck', {}).setdefault('enabled', True)
    compaction.setdefault('postIndexSync', 'await')
    memory_flush = compaction.setdefault('memoryFlush', {})
    memory_flush.setdefault('enabled', True)
    memory_flush.pop('systemPrompt', None)
    memory_flush.pop('prompt', None)
    configured_refs = {
        provider+'/'+str(model.get('id', ''))
        for provider, entry in config.get('models', {}).get('providers', {}).items()
        for model in entry.get('models', []) if model.get('id')
    }
    maintenance_model = next((ref for ref in COMPACTION_MODEL_PREFERENCES if ref in configured_refs), None)
    if maintenance_model:
        # setdefault preserves an explicit operator choice. The separate model
        # affects only summaries/memory flushes, never normal user replies.
        compaction.setdefault('model', maintenance_model)
        memory_flush.setdefault('model', maintenance_model)
    changed = config != json.loads(raw)
    policy_changed = False
    state.mkdir(parents=True,exist_ok=True,mode=0o700)
    if policy_file.exists():
        policy_raw = policy_file.read_bytes()
        policy_data = budget['read_json'](policy_file)
        required_ratios = {'triggerRatio': .65, 'targetRatio': .45, 'keepRecentRatio': .45}
        if any(policy_data.get(key) != value for key, value in required_ratios.items()):
            backup=state/'backups'/('context-policy-'+str(time.time_ns()))
            backup.mkdir(parents=True,mode=0o700)
            shutil.copy2(policy_file,backup/'context-policy.json')
            policy_data.update(required_ratios)
            fd,tmp=tempfile.mkstemp(dir=policy_file.parent,prefix='.context-policy-')
            try:
                with os.fdopen(fd,'w',encoding='utf-8') as handle:
                    json.dump(policy_data,handle,ensure_ascii=False,indent=2);handle.write('\n')
                os.chmod(tmp,0o600)
                if policy_file.read_bytes()!=policy_raw:
                    raise RuntimeError('上下文策略正在变化，未覆盖，请重试')
                replace_preserving_file_flags(tmp,policy_file)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
            policy_changed = True
    else:
        policy_file.write_text(json.dumps(rules,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        policy_changed = True
    if changed:
        backup=state/'backups'/('context-config-'+str(time.time_ns()))
        backup.mkdir(parents=True,mode=0o700)
        shutil.copy2(source,backup/'openclaw.json')
        if source.read_bytes()!=raw:
            raise RuntimeError('配置正在变化，未覆盖，请重试')
        fd,tmp=tempfile.mkstemp(dir=source.parent,prefix='.context-config-')
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as handle:
                json.dump(config,handle,ensure_ascii=False,indent=2);handle.write('\n')
            os.chmod(tmp,0o600);replace_preserving_file_flags(tmp,source)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
    (state/'context-limits.json').write_text(json.dumps(limits,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('模型上下文策略已准备；未知接口上限使用保守值，详情见 context-limits.json。')
    return changed or policy_changed


if __name__=='__main__':
    install()
