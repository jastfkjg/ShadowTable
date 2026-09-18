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
docker exec -i "$container" node - login < deploy/cloud/smoke-client.cjs
docker restart "$container" >/dev/null
check
docker exec -i "$container" node - resume < deploy/cloud/smoke-client.cjs
