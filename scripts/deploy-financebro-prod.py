"""Apply a verified FinanceBro release to the isolated production Compose project."""

import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path('/srv/financebro-prod')
CONFIG = ROOT / 'compose.yaml'
STATE = ROOT / 'deployed-image-set.json'
REGISTRY = 'ghcr.io/yurigolev/finance-bro-mono-repo'
IMAGES = ('migrate', 'core', 'bot', 'input', 'whisper', 'mini-app')
SERVICES = ('core', 'whisper', 'input', 'mini-app', 'bot')
SECRETS = ('BOT_TOKEN', 'POSTGRES_PASSWORD', 'CORE_SERVICE_TOKEN', 'INPUT_SERVICE_TOKEN')
HASH = re.compile(r'[a-f0-9]{40}')


def image_settings(manifest):
    if manifest['platform'] != 'linux/amd64':
        raise ValueError('Expected linux/amd64 images')
    settings = {}
    for service in IMAGES:
        ref = manifest['images'][service]
        if not re.fullmatch(rf'{re.escape(REGISTRY)}/{service}@sha256:[a-f0-9]{{64}}', ref):
            raise ValueError(f'Invalid image reference for {service}')
        settings[service.upper().replace('-', '_') + '_IMAGE'] = ref
    return settings


def compose(settings, *args, capture_output=False):
    command = [
        'docker', 'compose', '--project-name', 'financebro-prod', '--project-directory',
        str(ROOT), '--env-file', '/dev/null', '-f', str(CONFIG), *args,
    ]
    return subprocess.run(
        command, env=os.environ | settings, capture_output=capture_output, text=True,
        check=True, timeout=360,
    )


def check_relay(settings):
    compose(
        settings, 'exec', '-T', 'telegram-relay', 'node', '-e',
        "require('node:https').get({hostname:'api.telegram.org',timeout:8000,"
        "lookup:(_host,opts,callback) => callback(null,opts.all ? "
        "[{address:'127.0.0.1',family:4}] : '127.0.0.1',4)},response => "
        "process.exit(response.statusCode === 302 ? 0 : 1))"
        ".on('timeout', () => process.exit(1)).on('error', () => process.exit(1))",
    )
    print('Telegram HTTPS checked through the WireGuard relay', flush=True)


def check_services(settings):
    compose(
        settings, 'exec', '-T', 'mini-app', 'wget', '-qO', '/dev/null', 'http://127.0.0.1/',
    )
    compose(
        settings, 'exec', '-T', 'bot', 'node', '-e',
        "fetch('https://api.telegram.org/bot' + process.env.BOT_TOKEN + '/getMe', "
        "{signal: AbortSignal.timeout(8000)}).then(r => r.json()).then(body => "
        "process.exit(body.ok && body.result.username.toLowerCase() === 'financebroprodbot' ? 0 : 1))"
        ".catch(() => process.exit(1))",
    )
    print('Mini App and production Telegram getMe checked', flush=True)


def main():
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError('Release request exceeds 16 KiB')
    request = json.loads(raw)
    manifest = request['manifest']
    release = request['commit']
    if not all(HASH.fullmatch(value) for value in (release, manifest['commit'], manifest['tree'])):
        raise ValueError('Invalid Git release information')
    secret_values = request['secrets']
    settings = {}
    for name in SECRETS:
        value = secret_values.get(name)
        if not isinstance(value, str) or not value or any(char in value for char in '\r\n\0'):
            raise ValueError(f'Missing or invalid production secret: {name}')
        settings[name] = value
    settings['DB_IMAGE'] = 'postgres@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71'
    password = quote(settings['POSTGRES_PASSWORD'], safe='')
    settings['DATABASE_URL'] = f'postgresql://financebro:{password}@db:5432/financebro'
    candidate = settings | image_settings(manifest)

    with (ROOT / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if hashlib.sha256(CONFIG.read_bytes()).hexdigest() != request['deploy_compose_sha256']:
            raise ValueError('Review and install the tagged production Compose file first')
        if hashlib.sha256((ROOT / 'telegram-relay.mjs').read_bytes()).hexdigest() != request['telegram_relay_sha256']:
            raise ValueError('Install the tagged Telegram relay before deployment')
        previous = json.loads(STATE.read_text())['manifest'] if STATE.exists() else None
        services = [
            service for service in SERVICES
            if previous is None or previous['images'][service] != manifest['images'][service]
        ]
        if 'bot' not in services:
            old_bot = subprocess.run(
                ['docker', 'inspect', '--type=container', '--format', '{{json .HostConfig.ExtraHosts}}',
                 'financebro-prod-bot-1'], capture_output=True, text=True, check=False, timeout=15,
            )
            if old_bot.returncode != 0 or json.loads(old_bot.stdout):
                services.append('bot')
        migrate = previous is None or previous['images']['migrate'] != manifest['images']['migrate']
        print(f'Updating: {", ".join(services) or "none"}; migrations: {"yes" if migrate else "no"}', flush=True)
        compose(candidate, 'config', '--quiet')
        if services or migrate:
            compose(candidate, 'pull', 'db', *(['migrate'] if migrate else []), *services)
            compose(candidate, 'up', '-d', '--wait', '--wait-timeout', '90', 'db')
        compose(candidate, 'up', '-d', '--no-deps', '--pull', 'never', 'telegram-relay')
        check_relay(candidate)
        if migrate:
            compose(candidate, 'run', '--rm', '--no-deps', '--pull', 'never', 'migrate')
        try:
            if services:
                compose(candidate, 'up', '-d', '--no-deps', '--pull', 'never', '--wait',
                        '--wait-timeout', '120', *services)
            check_services(candidate)
        except subprocess.SubprocessError:
            if previous is not None and services:
                compose(settings | image_settings(previous), 'up', '-d', '--no-deps', '--pull',
                        'never', '--wait', '--wait-timeout', '120', *services)
            raise
        pending = STATE.with_suffix('.pending')
        pending.write_text(json.dumps({'commit': release, 'manifest': manifest}) + '\n')
        pending.replace(STATE)
    print(f'Deployed FinanceBro production {release}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        sys.exit('Production deployment failed')
