"""Apply a published image set to the preinstalled FinanceBro dev stack."""

import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path('/srv/financebro-dev')
REGISTRY = 'ghcr.io/yurigolev/finance-bro-mono-repo'
IMAGES = {
    'migrate': 'MIGRATE_IMAGE', 'core': 'CORE_IMAGE', 'mini-app': 'MINI_APP_IMAGE',
    'whisper': 'WHISPER_IMAGE', 'input': 'INPUT_IMAGE', 'bot': 'BOT_IMAGE',
}
RUNNING = {
    'core': 'financebro-dev-financial-core', 'mini-app': 'financebro-dev-mini-app',
    'whisper': 'financebro-dev-whisper', 'input': 'financebro-dev-input',
    'bot': 'financebro-dev-bot',
}
BOT_COMPOSE = ROOT / 'bot.compose.yaml'
GIT_HASH = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')
SECRET_NAMES = ('BOT_TOKEN', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'CORE_SERVICE_TOKEN', 'INPUT_SERVICE_TOKEN')
MAX_REQUEST_BYTES = 16 * 1024


def image_refs(manifest):
    refs = {}
    for service in IMAGES:
        prefix = f'{REGISTRY}/{service}@'
        ref = manifest['images'][service]
        if not isinstance(ref, str) or not ref.startswith(prefix) or not DIGEST.fullmatch(ref[len(prefix):]):
            raise ValueError(f'Invalid image reference for {service}')
        refs[service] = ref
    return refs


def compose(image_env, settings, *args):
    command = [
        'docker', 'compose', '--project-name', 'financebro-dev', '--project-directory', str(ROOT),
        '--env-file', str(image_env), '-f', str(ROOT / 'compose.yaml'),
        '-f', str(BOT_COMPOSE),
    ]
    subprocess.run([*command, *args], check=True, timeout=300, env=os.environ | settings)


def inspect(container, template):
    result = subprocess.run(['docker', 'inspect', '--type=container', '--format', template, container],
                            capture_output=True, text=True, timeout=15)
    return result.stdout.strip() if result.returncode == 0 else None


def wait_for_mini_app():
    def status(path):
        try:
            with urlopen(f'http://127.0.0.1:8082{path}', timeout=3) as response:
                return response.status
        except HTTPError as error:
            return error.code
        except (URLError, TimeoutError):
            return None

    for _ in range(15):
        if status('/') == 200 and status('/api/analytics/overview?period=current-month') == 401:
            return
        time.sleep(2)
    raise ValueError('FinanceBro dev did not pass the Mini App and API health checks')


def check_telegram(image_env, settings):
    compose(
        image_env, settings, 'exec', '-T', 'bot', 'node', '-e',
        "fetch('https://api.telegram.org/bot' + process.env.BOT_TOKEN + '/getMe', "
        "{signal:AbortSignal.timeout(8000)}).then(r=>r.json()).then(body=>"
        "process.exit(body.ok && body.result.username.toLowerCase()==='financebrotestbot'?0:1))"
        ".catch(()=>process.exit(1))",
    )
    print('Dev Telegram getMe passed', flush=True)


def main():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError('Deployment request exceeds 16 KiB')
    request = json.loads(raw)
    manifest = request['manifest']
    secrets = request['secrets']
    if not isinstance(secrets, dict):
        raise ValueError('Deployment secrets must be a JSON object')
    settings = {'COMPOSE_PROJECT_NAME': 'financebro-dev'}
    for name in SECRET_NAMES:
        value = secrets.get(name)
        if not isinstance(value, str) or not value or any(char in value for char in '\r\n\0'):
            raise ValueError(f'Missing or invalid deployment secret: {name}')
        settings[name] = value
    if not all(GIT_HASH.fullmatch(manifest[key]) for key in ('commit', 'tree', 'compose')):
        raise ValueError('Invalid Git hashes in image manifest')
    if manifest['platform'] != 'linux/amd64':
        raise ValueError('Expected linux/amd64 images')

    bootstrap = json.loads((ROOT / 'image-set.json').read_text())
    if manifest['compose'] != bootstrap['compose']:
        raise ValueError('The source Compose configuration changed; review the installed dev stack first')
    refs = image_refs(manifest)
    current = ROOT / 'images.env'

    with (ROOT / '.deploy.lock').open('a') as lock, tempfile.TemporaryDirectory(dir=ROOT) as temporary:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for key, path in (
            ('bot_compose_sha256', BOT_COMPOSE),
            ('telegram_relay_sha256', ROOT / 'telegram-relay.mjs'),
        ):
            if hashlib.sha256(path.read_bytes()).hexdigest() != request[key]:
                raise ValueError(f'Install the required dev file: {path.name}')
        previous = dict(line.split('=', 1) for line in current.read_text().splitlines())
        stage = Path(temporary) / 'images.env'
        overlay_sha = request['bot_compose_sha256']
        stage.write_text(''.join(f'{IMAGES[key]}={value}\n' for key, value in refs.items()) +
                         f'FINANCEBRO_DEPLOYED_SHA={manifest["commit"]}\n'
                         f'FINANCEBRO_BOT_COMPOSE_SHA256={overlay_sha}\n')
        compose(stage, settings, 'config', '--quiet')
        if inspect('financebro-dev-postgres', '{{.State.Health.Status}}') != 'healthy':
            raise ValueError('The existing dev PostgreSQL is not healthy')
        running = {name: inspect(container, '{{.Config.Image}} {{.State.Running}}')
                   for name, container in RUNNING.items()}
        changed_overlay = previous.get('FINANCEBRO_BOT_COMPOSE_SHA256') != overlay_sha
        targets = [
            name for name, state in running.items()
            if state != f'{refs[name]} true' or (changed_overlay and name in ('whisper', 'input', 'bot'))
        ]
        migrate = previous['MIGRATE_IMAGE'] != refs['migrate']
        print(f'Updating: {", ".join(targets) or "none"}; migrations: {"yes" if migrate else "no"}', flush=True)
        pull = (['migrate'] if migrate else []) + targets
        if pull:
            compose(stage, settings, 'pull', *pull)
        if migrate:
            compose(stage, settings, 'run', '--rm', '--no-deps', '--pull', 'never', 'migrate')
        up = ('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90')
        existing_targets = [name for name in targets if (running[name] or '').endswith(' true')]
        new_targets = [name for name in targets if name not in existing_targets]
        compose(stage, settings, *up, 'telegram-relay')
        try:
            dependencies = [name for name in targets if name != 'bot']
            if dependencies:
                compose(stage, settings, *up, *dependencies)
            if 'bot' in targets:
                compose(stage, settings, *up, 'bot')
            wait_for_mini_app()
            check_telegram(stage, settings)
            os.replace(stage, current)
        except (ValueError, OSError, subprocess.SubprocessError):
            if new_targets:
                compose(stage, settings, 'stop', *new_targets)
            if existing_targets:
                rollback = Path(temporary) / 'previous-images.env'
                rollback.write_text(''.join(f'{key}={value}\n' for key, value in
                                            ({IMAGES[name]: ref for name, ref in refs.items()} | previous).items()))
                compose(rollback, settings, *up, *existing_targets)
            raise
    print(f'Deployed FinanceBro dev {manifest["commit"]}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
