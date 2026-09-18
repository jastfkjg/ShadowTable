#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
image=${1:?Usage: deploy.sh IMAGE_DIGEST}
[[ "$image" =~ ^[a-z0-9][a-z0-9.-]*\.aliyuncs\.com/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$ ]] || { echo 'An immutable ACR image digest is required.' >&2; exit 1; }
bash "$release/preflight.sh"
exec 9>/opt/shadowtable/deploy.lock
flock -w 120 9
[[ ! -e "$release/image.env" ]] || { echo 'Use a fresh release directory.' >&2; exit 1; }
printf 'SHADOWTABLE_IMAGE=%s\n' "$image" > "$release/image.env"
compose() { bash "$release/compose.sh" "$@"; }
compose config --quiet
origin=$(compose config --format json | python3 "$release/validate_config.py")
compose pull
# Verify persistent directory permissions using the actual container user.
compose run --rm --no-deps -T app node -e "const fs=require('node:fs');fs.accessSync('/data',fs.constants.R_OK|fs.constants.W_OK)"
# GNU readlink -f may return a path even when its final component is absent.
# An absent current is a first deployment; a dangling link is invalid state.
previous=""
if [[ -e /opt/shadowtable/current || -L /opt/shadowtable/current ]]; then
    previous=$(readlink -f /opt/shadowtable/current)
fi
if [[ -n "$previous" && ! -f "$previous/compose.yaml" ]]; then
    echo 'Legacy release detected. Complete the documented systemd migration first.' >&2
    exit 1
fi
stopped=false
rollback() {
    status=$?
    trap - EXIT
    if [[ "$status" != 0 && "$stopped" == true ]]; then
        echo 'Deployment failed; restoring previous application (database is not rolled back).' >&2
        compose stop app || true
        if [[ -n "$previous" ]]; then
            if ! bash "$previous/compose.sh" up -d --wait --wait-timeout 120 app; then
                echo 'Rollback failed; inspect containers and backups before retrying.' >&2
            fi
        else
            echo 'No previous container release; failed application remains stopped.' >&2
        fi
    fi
    exit "$status"
}
trap rollback EXIT
compose stop app
stopped=true
mkdir -p /opt/shadowtable/backups
backup="/opt/shadowtable/backups/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$release").tgz"
# The writer is stopped: archive the entire directory, including any WAL files.
if ! compose run --rm --no-deps -T app tar -C /data -czf - . > "$backup.tmp"; then
    rm -f "$backup.tmp"
    exit 1
fi
mv "$backup.tmp" "$backup"
compose up -d --wait --wait-timeout 120 app
healthy=false
for attempt in {1..12}; do
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 10 "$origin/health" |
        python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)'; then
        healthy=true
        break
    fi
    if (( attempt < 12 )); then sleep 5; fi
done
[[ "$healthy" == true ]] || { echo 'Public health check failed.' >&2; exit 1; }
if [[ -n "$previous" ]]; then ln -sfn "$previous" /opt/shadowtable/previous; fi
ln -sfn "$release" /opt/shadowtable/current
stopped=false
printf 'Deployed %s\nBackup: %s\n' "$image" "$backup"
