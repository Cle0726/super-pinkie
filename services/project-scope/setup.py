"""Install the project-scope plugin, preserving config and personality files."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import time


def replace_preserving_file_flags(temp_name, target):
    """Atomic replace that preserves macOS user-immutable config protection."""
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
    config = home / '.openclaw/openclaw.json'
    if not config.is_file():
        return False
    raw = config.read_bytes()
    data = json.loads(raw)
    plugins = data.setdefault('plugins', {})
    plugin_id = 'pinkie-project-scope'
    if plugins.get('enabled') is False or plugin_id in plugins.get('deny', []):
        raise RuntimeError('项目工作锚点插件被配置禁用，请先启用。')
    target = home / '.openclaw/extensions' / plugin_id
    source = Path(__file__).resolve().parent
    names = ('index.mjs', 'package.json', 'openclaw.plugin.json')
    assets_changed = any(not (target / n).is_file() or (target / n).read_bytes() != (source / n).read_bytes() for n in names)
    old_plugins = json.dumps(plugins, sort_keys=True)
    entry = plugins.setdefault('entries', {}).setdefault(plugin_id, {})
    entry['enabled'] = True
    entry.setdefault('hooks', {})['allowPromptInjection'] = True
    paths = plugins.setdefault('load', {}).setdefault('paths', [])
    if str(target) not in paths:
        paths.append(str(target))
    if isinstance(plugins.get('allow'), list) and plugin_id not in plugins['allow']:
        plugins['allow'].append(plugin_id)
    config_changed = old_plugins != json.dumps(plugins, sort_keys=True)
    if not assets_changed and not config_changed:
        return False
    backup = home / 'Library/Application Support/SuperPinkie/backups' / ('project-scope-' + str(time.time_ns()))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(config, backup / 'openclaw.json')
    if target.exists():
        shutil.copytree(target, backup / plugin_id)
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in names:
        shutil.copy2(source / name, target / name)
    if config_changed:
        if config.read_bytes() != raw:
            raise RuntimeError('配置发生并发修改，没有覆盖；请重新安装。')
        fd, tmp = tempfile.mkstemp(dir=config.parent, prefix='.pinkie-scope-')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
            os.chmod(tmp, 0o600)
            replace_preserving_file_flags(tmp, config)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    print('项目工作锚点已安装：项目作为默认目录，不限制访问电脑上的其他位置；原人格文件未修改。')
    return True


if __name__ == '__main__':
    install()
