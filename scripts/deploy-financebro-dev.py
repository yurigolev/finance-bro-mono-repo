"""Apply a published image set to the preinstalled FinanceBro dev stack."""

import fcntl
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
IMAGES = {'migrate': 'MIGRATE_IMAGE', 'core': 'CORE_IMAGE', 'mini-app': 'MINI_APP_IMAGE'}
RUNNING = {'core': 'financebro-dev-financial-core', 'mini-app': 'financebro-dev-mini-app'}
GIT_HASH = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')


def image_refs(manifest):
    refs = {}
    for service in IMAGES:
        prefix = f'{REGISTRY}/{service}@'
        ref = manifest['images'][service]
        if not isinstance(ref, str) or not ref.startswith(prefix) or not DIGEST.fullmatch(ref[len(prefix):]):
            raise ValueError(f'Invalid image reference for {service}')
        refs[service] = ref
    return refs


def compose(image_env, *args):
    command = [
        'docker', 'compose', '--project-name', 'financebro-dev', '--project-directory', str(ROOT),
        '--env-file', str(ROOT / 'deploy.env'), '--env-file', str(image_env), '-f', str(ROOT / 'compose.yaml'),
    ]
    subprocess.run([*command, *args], check=True, timeout=300)


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


def main():
    raw = sys.stdin.buffer.read(16 * 1024 + 1)
    if len(raw) > 16 * 1024:
        raise ValueError('Manifest exceeds 16 KiB')
    manifest = json.loads(raw)
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
        previous = dict(line.split('=', 1) for line in current.read_text().splitlines())
        stage = Path(temporary) / 'images.env'
        stage.write_text(''.join(f'{IMAGES[key]}={value}\n' for key, value in refs.items()) +
                         f'FINANCEBRO_DEPLOYED_SHA={manifest["commit"]}\n')
        if inspect('financebro-dev-postgres', '{{.State.Health.Status}}') != 'healthy':
            raise ValueError('The existing dev PostgreSQL is not healthy')
        targets = [name for name, container in RUNNING.items()
                   if inspect(container, '{{.Config.Image}} {{.State.Running}}') != f'{refs[name]} true']
        migrate = previous['MIGRATE_IMAGE'] != refs['migrate']
        print(f'Updating: {", ".join(targets) or "none"}; migrations: {"yes" if migrate else "no"}', flush=True)
        pull = (['migrate'] if migrate else []) + targets
        if pull:
            compose(stage, 'pull', *pull)
        if migrate:
            compose(stage, 'run', '--rm', '--no-deps', '--pull', 'never', 'migrate')
        attempted = False
        try:
            if targets:
                attempted = True
                compose(stage, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait',
                        '--wait-timeout', '90', *targets)
            wait_for_mini_app()
            os.replace(stage, current)
        except (ValueError, OSError, subprocess.SubprocessError):
            if attempted:
                compose(current, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait',
                        '--wait-timeout', '90', *targets)
            raise
    print(f'Deployed FinanceBro dev {manifest["commit"]}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
