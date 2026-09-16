#!/usr/bin/env bash
# Run as the deployment account on the Linux server.
set -euo pipefail
release="${1:?Usage: release.sh RELEASE_ID}"
[[ "$release" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 2
root=/opt/shadowtable
next="$root/releases/$release"
[[ -f "$next/server/index.js" ]]
exec 9>"$root/deploy.lock"
flock -w 120 9
previous="$(readlink -f "$root/current" || true)"

healthy() {
  for attempt in {1..20}; do
    if systemctl is-active --quiet shadowtable &&
      curl --fail --silent --max-time 2 http://127.0.0.1:8787/health | /usr/bin/node -e '
        let s=""; process.stdin.on("data", d => s += d);
        process.stdin.on("end", () => { try { process.exit(JSON.parse(s).ok === true ? 0 : 1); } catch { process.exit(1); } });'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

activate() {
  ln -s "$1" "$root/current.next"
  mv -Tf "$root/current.next" "$root/current"
}

# No npm install needed: the backend only uses Node built-ins.
/usr/bin/node --check "$next/server/index.js"
activate "$next"
if sudo -n /usr/bin/systemctl restart shadowtable && healthy; then
  echo "Deployed $release"
  exit 0
fi

echo 'Deployment failed; rolling back application code.' >&2
if [[ -n "$previous" && -d "$previous" && "$previous" != "$next" ]]; then
  activate "$previous"
  sudo -n /usr/bin/systemctl restart shadowtable
  if healthy; then
    echo 'Previous release restored.' >&2
  else
    echo 'Rollback health check failed; inspect the service on the server.' >&2
  fi
else
  sudo -n /usr/bin/systemctl stop shadowtable
  rm -f "$root/current"
  echo 'No previous release; stopped the failed first deployment.' >&2
fi
exit 1
