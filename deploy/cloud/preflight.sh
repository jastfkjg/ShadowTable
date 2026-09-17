#!/usr/bin/env bash
set -euo pipefail
for tool in docker python3 curl flock tar readlink; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
docker info >/dev/null
version=$(docker compose version --short)
python3 - "$version" <<'PY'
import re, sys
m = re.match(r'v?(\d+)\.(\d+)\.(\d+)', sys.argv[1])
if not m or tuple(map(int, m.groups())) < (2, 24, 0):
    sys.exit('Docker Compose 2.24+ required')
PY
docker network inspect shadowtable_proxy >/dev/null
[[ -r /opt/shadowtable/app.env && -w /opt/shadowtable && -d /opt/shadowtable/data ]]
# Refuse to run alongside the legacy host service.
if command -v systemctl >/dev/null && systemctl is-active --quiet shadowtable; then
    echo 'Stop and disable the legacy shadowtable systemd service first.' >&2
    exit 1
fi
