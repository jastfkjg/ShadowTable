#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# This dedicated network contains the application and its Caddy gateway only.
# Resolve its actual ranges; never trust every private/public proxy address.
SHADOWTABLE_PROXY_CIDRS=$(docker network inspect shadowtable_proxy | python3 -c '
import ipaddress,json,sys
networks=json.load(sys.stdin)
subnets=[ipaddress.ip_network(item["Subnet"],strict=False) for item in networks[0]["IPAM"]["Config"] if item.get("Subnet")]
if not subnets or any(not subnet.is_private or subnet.prefixlen == 0 for subnet in subnets):
    sys.exit("shadowtable_proxy must have explicit private subnets")
print(",".join(map(str,subnets)))')
export SHADOWTABLE_PROXY_CIDRS
exec docker compose --project-name shadowtable --env-file "$release/image.env" -f "$release/compose.yaml" "$@"
