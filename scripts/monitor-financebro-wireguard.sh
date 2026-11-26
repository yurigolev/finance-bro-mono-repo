#!/bin/sh
set -eu

/usr/bin/timeout 12s /usr/bin/docker exec financebro-prod-bot-1 node -e '
fetch("https://api.telegram.org/", {redirect:"manual",signal:AbortSignal.timeout(8000)})
  .then(response => process.exit(response.status === 302 ? 0 : 1))
  .catch(() => process.exit(1));
'

url=$(cat "$CREDENTIALS_DIRECTORY/ping-url")
if ! printf '%s\n' "$url" | grep -Eq '^https://hc-ping\.com/[a-f0-9-]{36}$'; then
    printf '%s\n' 'Missing or invalid WireGuard Healthchecks URL' >&2
    exit 1
fi
printf 'url = "%s"\n' "$url" | /usr/bin/curl --config - --request POST --max-time 8 --fail --silent --output /dev/null
