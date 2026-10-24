#!/usr/bin/env bash
# Builds the Avina shop on a shared server inside a resource cage, so the other sites on the machine keep running.
#   sudo /opt/avina-shop-src/shop/deploy/avina/build-on-server.sh            build only
#   sudo /opt/avina-shop-src/shop/deploy/avina/build-on-server.sh --prune    … then drop devDependencies
#
# What it does (and nothing else):
#   1. refuses to start when MemAvailable (/proc/meminfo, not «free») or free disk is under the safe minimum;
#   2. copies the repository's shop/ (from the git clone in SRC) into APP, keeping APP's .env and image cache;
#   3. npm ci + npm run build as the avina user, in a systemd scope capped at 1800 MB / one CPU,
#      with the lowest CPU and I/O priority and a 1500 MB Node heap;
#   4. cleans the npm cache (and with --prune removes devDependencies).
# It does NOT run database migrations (a separate step with a one-off connection: README «نصب روی سرور اشتراکی»)
# and never restarts or reloads any service — not even avina-shop: run `sudo systemctl restart avina-shop` yourself.
# The avina user has no home directory: HOME and npm's cache are APP/.cache (kept between builds, cache cleaned).
# Needs root (systemd-run --scope and runuser); the build itself runs as the avina user.
set -euo pipefail

SRC=${SRC:-/opt/avina-shop-src}      # git clone of the repository
APP=${APP:-/opt/avina-shop}          # the running app (WorkingDirectory of avina-shop.service)
RUN_AS=${RUN_AS:-avina}
MIN_FREE_MB=${MIN_FREE_MB:-2000}     # MemAvailable before the build
MIN_DISK_MB=${MIN_DISK_MB:-3072}     # free space on APP's file system
PRUNE=0
[[ "${1:-}" == "--prune" ]] && PRUNE=1

fail() { echo "build-on-server: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run with sudo (systemd-run --scope and runuser need root)"
[[ -d "$SRC/shop" ]] || fail "$SRC/shop not found (git clone the repository to $SRC first)"
[[ -f "$APP/.env" ]] || fail "$APP/.env not found (copy deploy/avina/avina-shop.env.example and fill it in)"
id "$RUN_AS" >/dev/null 2>&1 || fail "user $RUN_AS does not exist"

# ── 1. safe minimums: MemAvailable (what the kernel can give without swapping; this server has no swap) ──
free_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
disk_mb=$(df -Pm "$APP" | awk 'NR == 2 { print $4 }')
echo "build-on-server: MemAvailable ${free_mb} MB (min ${MIN_FREE_MB}), free disk ${disk_mb} MB (min ${MIN_DISK_MB})"
(( free_mb >= MIN_FREE_MB )) || fail "not enough available memory (${free_mb} MB < ${MIN_FREE_MB} MB): try again later"
(( disk_mb >= MIN_DISK_MB )) || fail "not enough free disk (${disk_mb} MB < ${MIN_DISK_MB} MB)"

# ── 2. code: SRC/shop → APP (keeps .env, installed modules, the image cache and .cache) ──
rsync -a --delete \
  --exclude '/.env' --exclude '/node_modules/' --exclude '/.next/' --exclude '/.cache/' \
  "$SRC/shop/" "$APP/"
mkdir -p "$APP/.cache/npm"
chown -R "$RUN_AS:$RUN_AS" "$APP"
chmod 600 "$APP/.env"
BUILD_ENV=(HOME="$APP/.cache" npm_config_cache="$APP/.cache/npm")

# ── 3. build in the cage ──
# shellcheck disable=SC2016 # $1 is expanded by the inner bash, not here
systemd-run --scope --quiet --unit="avina-shop-build-$(date +%s)" \
  -p MemoryMax=1800M -p CPUQuota=100% \
  nice -n 19 ionice -c3 \
  runuser -u "$RUN_AS" -- env NODE_OPTIONS=--max-old-space-size=1500 "${BUILD_ENV[@]}" \
  bash -c 'set -euo pipefail
    cd "$1"
    npm ci --no-audit --no-fund
    npm run build' _ "$APP"

# ── 4. clean up ──
runuser -u "$RUN_AS" -- env "${BUILD_ENV[@]}" npm cache clean --force --loglevel=error
if (( PRUNE )); then
  (cd "$APP" && runuser -u "$RUN_AS" -- env "${BUILD_ENV[@]}" npm prune --omit=dev --no-audit --no-fund)
fi

echo "build-on-server: done. Run pending migrations if this release has any (README), then: sudo systemctl restart avina-shop"
