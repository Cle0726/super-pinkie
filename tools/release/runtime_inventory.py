"""Read-only checks of the core feature inventory in a packaged App profile."""

import json
import subprocess


CORE_AGENTS = {'main', 'project', 'thinking', 'learning', 'unrestricted', 'metre',
               'roles', 'pinkie-party', 'party-openclaw'}
CORE_PLUGINS = {'pinkie-mode-architecture', 'pinkie-project-scope', 'pinkie-first-person-renderer'}
CORE_MODEL_SYNC = 'pinkie-model-sync'


def cli_json(command, env, expected, timeout=65):
    result = subprocess.run(list(map(str, command)), env=env, capture_output=True,
                            encoding='utf-8', errors='replace', timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        # Only print the failed operation and exit code; the CLI may include
        # profile data or auth hints in its full diagnostic output.
        raise RuntimeError(f"{' '.join(map(str, command[2:5]))}: CLI exit {result.returncode}")
    lines = result.stdout.splitlines()
    for index, line in enumerate(lines):
        if not line.lstrip().startswith(('[', '{')):
            continue
        try:
            data = json.loads('\n'.join(lines[index:]))
        except ValueError:
            continue
        if isinstance(data, expected):
            return data
    raise RuntimeError(f"{' '.join(map(str, command[2:5]))}: no valid JSON payload")


def activation_report(agent_ids, plugins):
    installed = {entry.get('id'): entry for entry in plugins if isinstance(entry, dict)}
    missing_agents = sorted(CORE_AGENTS - set(agent_ids))
    unready_plugins = sorted(pid for pid in CORE_PLUGINS if not (
        installed.get(pid, {}).get('enabled') is True and installed.get(pid, {}).get('status') == 'loaded'))
    mode = installed.get('pinkie-mode-architecture', {})
    return {'ok': not missing_agents and not unready_plugins,
            'missing_agents': missing_agents, 'unready_plugins': unready_plugins,
            'model_sync_registered': CORE_MODEL_SYNC in (mode.get('services') or [])}


def inspect_activation(command, env, agent_ids=None):
    if agent_ids is None:
        agents = cli_json([*command, 'agents', 'list', '--json'], env, list)
        agent_ids = [entry.get('id') for entry in agents if isinstance(entry, dict)]
    inventory = cli_json([*command, 'plugins', 'list', '--enabled', '--json'], env, dict)
    report = activation_report(agent_ids, inventory.get('plugins') or [])
    # The enabled CLI listing may use discovery metadata instead of full
    # runtime registration. Ask the runtime inspector before falling back to
    # a negative decision about the catalog service.
    if report['ok'] and not report['model_sync_registered']:
        details = cli_json([*command, 'plugins', 'inspect', 'pinkie-mode-architecture', '--runtime', '--json'], env, dict)
        record = details.get('plugin') or details.get('record') or details
        report['model_sync_registered'] = CORE_MODEL_SYNC in (record.get('services') or [])
    report['ok'] = report['ok'] and report['model_sync_registered']
    return report
