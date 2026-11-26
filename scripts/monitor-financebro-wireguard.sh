#!/bin/sh
set -eu

/usr/bin/timeout 12s /usr/bin/docker exec financebro-prod-bot-1 node -e '
fetch("https://api.telegram.org/", {redirect:"manual",signal:AbortSignal.timeout(8000)})
  .then(response => process.exit(response.status === 302 ? 0 : 1))
  .catch(() => process.exit(1));
'

key=$(cat "$CREDENTIALS_DIRECTORY/telemetry-key")
if ! printf '%s\n' "$key" | grep -Eq '^[A-Za-z0-9_-]{16,80}$'; then
    printf '%s\n' 'Missing or invalid Cronitor telemetry key' >&2
    exit 1
fi
printf 'url = "https://cronitor.link/p/%s/financebro-prod-wireguard"\n' "$key" | /usr/bin/curl --config - --max-time 8 --fail --silent --output /dev/null
