#!/usr/bin/env bash
# Local/CI disposable container test, including persistent SQLite after restart.
set -euo pipefail
suffix="${RANDOM}-$$"
image="shadowtable-smoke:$suffix"
container="shadowtable-smoke-$suffix"
volume="shadowtable-smoke-$suffix"
cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
    docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build -t "$image" .
docker volume create "$volume" >/dev/null
docker run -d --name "$container" --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges:true -v "$volume:/data" \
    -e WEB_ORIGIN=https://table.example.com "$image" >/dev/null
check() {
    for attempt in {1..20}; do
        if docker exec "$container" node -e "fetch('http://127.0.0.1:8787/health').then(async r=>{if(!r.ok || !(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"; then return 0; fi
        sleep 1
    done
    docker logs "$container"
    return 1
}
check
docker exec "$container" node -e "fetch('http://127.0.0.1:8787/',{headers:{Host:'table.example.com'}}).then(async r=>{if(!r.ok || !(await r.text()).includes('<html'))process.exit(1)}).catch(()=>process.exit(1))"
docker exec -i "$container" node <<'JS'
const fs = require('node:fs');
(async () => {
  const r = await fetch('http://127.0.0.1:8787/api/guest-login', {
    method: 'POST',
    headers: {Host: 'table.example.com', Origin: 'https://table.example.com', 'Content-Type': 'application/json'},
    body: '{}',
  });
  const data = await r.json();
  if (!r.ok || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error('Guest login failed');
  fs.writeFileSync('/data/smoke-token', data.token, {mode: 0o600});
})().catch(e => {console.error(e); process.exit(1)});
JS
docker restart "$container" >/dev/null
check
docker exec -i "$container" node <<'JS'
const fs = require('node:fs');
(async () => {
  const token = fs.readFileSync('/data/smoke-token', 'utf8');
  const r = await fetch('http://127.0.0.1:8787/api/me/rooms', {headers: {Authorization: 'Bearer ' + token}});
  if (!r.ok || !Array.isArray((await r.json()).rooms)) throw new Error('Session did not survive restart');
})().catch(e => {console.error(e); process.exit(1)});
JS
