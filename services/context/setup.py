"""Install model-aware limits without touching personas, keys, URLs or history."""
import json
import os
from pathlib import Path
import runpy
import shutil
import tempfile
import time

budget = runpy.run_path(str(Path(__file__).with_name('context_budget.py')))


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
    state = home/'Library/Application Support/SuperPinkie'
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
    compaction.pop('reserveTokensFloor', None)
    # Keep user-set windows and keepRecentTokens exactly as-is. These additions
    # improve what survives a compaction instead of making compaction happen
    # earlier or discarding a larger recent tail.
    compaction.setdefault('mode', 'safeguard')
    compaction.setdefault('recentTurnsPreserve', 8)
    compaction.setdefault('maxHistoryShare', 0.9)
    compaction.setdefault('identifierPolicy', 'custom')
    compaction.setdefault(
        'identifierInstructions',
        'Preserve exact file paths, project roots, session IDs, agent IDs, commands, URLs, model names, error text, user constraints, decisions, tool outcomes, verification results, and unfinished work.'
    )
    quality = compaction.setdefault('qualityGuard', {})
    quality.setdefault('enabled', True)
    quality.setdefault('maxRetries', 2)
    compaction.setdefault('midTurnPrecheck', {}).setdefault('enabled', True)
    compaction.setdefault('postIndexSync', 'await')
    memory_flush = compaction.setdefault('memoryFlush', {})
    memory_flush.setdefault('enabled', True)
    memory_flush.setdefault(
        'systemPrompt',
        'The session is nearing compaction. Save a loss-resistant work checkpoint without changing persona, workspace, agent identity, or user-authored context. Finish with the exact token NO_REPLY.'
    )
    memory_flush.setdefault(
        'prompt',
        'Update memory/context/active.md with a structured handoff: current user goal; exact constraints and preferences; selected mode/model/project root; decisions and reasons; files changed; commands and tool results; verified results; errors; unfinished work and the next concrete action. Keep exact identifiers and paths. Do not delete unrelated existing notes. Reply with exactly NO_REPLY after writing, or NO_REPLY if nothing durable changed.'
    )
    changed = config != json.loads(raw)
    state.mkdir(parents=True,exist_ok=True,mode=0o700)
    if not policy_file.exists():
        policy_file.write_text(json.dumps(rules,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
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
    return changed


if __name__=='__main__':
    install()
