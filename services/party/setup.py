"""Install two tool-less, isolated OpenClaw group participants. Preserve all existing agents."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

IDENTITIES = json.loads(Path(__file__).with_name('identities.json').read_text(encoding='utf-8'))


def state_root(home):
    return Path(os.environ.get('PINKIE_STATE_ROOT', home / 'Library/Application Support/SuperPinkie'))


def party_soul(name, address='铲屎官'):
    return (f'# {name} · 派对群聊\n\n' + IDENTITIES['instruction'].format(name=name) +
            f'\n称呼用户为{address}。\n')


def legacy_party_soul(name, address='铲屎官'):
    """Exact prior installer template; only these owned files may be migrated."""
    return (f'# {name} · 派对群聊\n\n你是群聊中的{name}，称呼用户为{address}。中文、简洁、自然。\n'
            '只依据本次收到的群聊记录回答，不读取其他模式、其他群或私人会话。\n'
            '没有直接执行工具的权限。不要声称已读文件、已修改程序或已经完成未验证的工作。\n'
            f'收到群聊调度协议时按协议输出；真正的派工由派对服务记录并经{address}确认。\n')


def identity_file(name):
    return f'# IDENTITY.md\n\n- **Name:** {name}\n'


def migrate_file(home, agent_id, target, known, replacement):
    if not target.is_file() or target.is_symlink():
        return False
    original = target.read_text(encoding='utf-8')
    if original == replacement or original not in known:
        return False
    backup = state_root(home) / 'backups' / ('party-identity-' + str(time.time_ns()))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(target, backup / (agent_id + '-' + target.name))
    if target.read_text(encoding='utf-8') != original:
        raise RuntimeError('派对身份文件正在被修改；已保留备份，未覆盖，请稍后重试。')
    target.write_text(replacement, encoding='utf-8')
    return True


def install(home=None):
    home = Path(home or Path.home())
    config = home / '.openclaw/openclaw.json'
    if not config.is_file():
        return False
    raw = config.read_bytes()
    data = json.loads(raw)
    agents = data.setdefault('agents', {}).setdefault('list', [])
    changed = False
    migrated = False
    for agent_id, member, old_name in [('pinkie-party', 'pinkie', '碧琪'), ('party-openclaw', 'openclaw', 'OpenClaw')]:
        name = IDENTITIES['names'][member]
        workspace = home / '.openclaw' / ('workspace-' + agent_id)
        existing = next((a for a in agents if a.get('id') == agent_id), None)
        if existing:
            # Only migrate our exact old template in our own isolated workspace.
            # Never alter custom personas or another agent sharing this id.
            if (existing.get('workspace') == str(workspace) and
                    '*' in existing.get('tools', {}).get('deny', []) and
                    not workspace.is_symlink()):
                known_souls = {legacy_party_soul(label, address)
                               for label in (name, old_name) for address in ('老板', '铲屎官')}
                known_souls.add(party_soul(name, '老板'))
                migrated |= migrate_file(home, agent_id, workspace / 'SOUL.md', known_souls, party_soul(name))
                known_identities = {identity_file(label) + '- **Vibe:** 清楚、可靠的群聊搭档\n'
                                    for label in (name, old_name)}
                migrated |= migrate_file(home, agent_id, workspace / 'IDENTITY.md', known_identities, identity_file(name))
                if existing.get('name') == old_name and old_name != name:
                    existing['name'] = name
                    changed = True
            continue
        workspace.mkdir(parents=True, exist_ok=True)
        for filename, content in {
            'SOUL.md': party_soul(name),
            'IDENTITY.md': identity_file(name),
            'AGENTS.md': '# 群聊边界\n\n仅处理本次传入的群聊内容。不主动访问本机文件、其他会话或外部渠道。\n',
            'HEARTBEAT.md': '<!-- No scheduled work. -->\n',
        }.items():
            target = workspace / filename
            if not target.exists():
                target.write_text(content, encoding='utf-8')
        agents.append({'id': agent_id, 'name': name, 'workspace': str(workspace),
                       'tools': {'deny': ['*']}, 'memorySearch': {'enabled': False}})
        changed = True
    if not changed:
        return migrated
    backup = state_root(home) / 'backups' / ('party-' + str(time.time_ns()))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(config, backup / 'openclaw.json')
    # Do not overwrite a simultaneous config edit.
    if config.read_bytes() != raw:
        raise RuntimeError('配置正在被其他程序修改；未写入，请稍后重试。')
    fd, name = tempfile.mkstemp(dir=config.parent, prefix='.party-config-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.chmod(name, 0o600)
        os.replace(name, config)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return True


if __name__ == '__main__':
    print('派对专属 Agent 已安装。' if install() else '派对配置已就绪，或尚未配置 OpenClaw。')
