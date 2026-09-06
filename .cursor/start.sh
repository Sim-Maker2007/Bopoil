#!/usr/bin/env bash
# Per-boot reconciliation for the Cloud Agent VM. Starts PostgreSQL and applies
# any pending database migrations. Must tolerate being run on every boot.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true

PG_VERSION="$(ls /usr/lib/postgresql/ 2>/dev/null | sort -V | tail -n1)"
if [ -n "${PG_VERSION:-}" ]; then
  sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
  for _ in $(seq 1 30); do
    if sudo -u postgres pg_isready -q; then break; fi
    sleep 1
  done
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='coat_care'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE coat_care;" >/dev/null
  fi
fi

npm run db:migrate

echo "PostgreSQL is running and migrations are applied."
