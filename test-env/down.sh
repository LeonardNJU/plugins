#!/usr/bin/env bash
# Stop the plugin test environment.
#
#   ./down.sh           stop and remove the containers, keep the data
#   ./down.sh --reset   also delete the volumes and .secrets (next up.sh seeds from scratch)
set -euo pipefail
cd "$(dirname "$0")"

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$RESET" = 1 ]; then
  docker compose --profile ai down --volumes --remove-orphans
  rm -rf .secrets
else
  docker compose --profile ai down --remove-orphans
fi
