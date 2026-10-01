#!/usr/bin/env bash
# Runs only after a manual target selection; target credentials come from its Environment.
set -euo pipefail
[[ "${TARGET_ENVIRONMENT:-}" =~ ^(aws-prod|aliyun-prod)$ && "${DEPLOY_TARGET:-}" == "$TARGET_ENVIRONMENT" ]] || { echo 'Set DEPLOY_TARGET to the selected Environment name in that Environment.' >&2; exit 1; }
[[ "${SSH_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Set SSH_HOST in the selected Environment.' >&2; exit 1; }
[[ "${SSH_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Set SSH_USER in the selected Environment.' >&2; exit 1; }
SSH_PORT=${SSH_PORT:-22}
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 ))
[[ "${REVISION:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]
[[ -n "${SSH_KEY:-}" && -n "${SSH_KNOWN_HOSTS:-}" ]] || { echo 'Set SSH_KEY and SSH_KNOWN_HOSTS in the selected Environment.' >&2; exit 1; }
python3 deploy/cloud/validate_image.py "$IMAGE"
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
SSH=(ssh -i "$ssh_dir/key" -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15)
target="$SSH_USER@$SSH_HOST"
"${SSH[@]}" "$target" "bash -s -- '$TARGET_ENVIRONMENT'" < deploy/cloud/preflight.sh
release="/opt/shadowtable/releases/${REVISION}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
"${SSH[@]}" "$target" "umask 077; mkdir -p '$release'"
tar -C deploy/cloud --exclude='__pycache__' -czf - . | "${SSH[@]}" "$target" "tar -xzf - -C '$release'"
"${SSH[@]}" "$target" "bash '$release/deploy.sh' '$IMAGE'"
