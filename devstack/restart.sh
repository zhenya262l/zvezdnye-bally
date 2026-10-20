#!/usr/bin/env bash
# Restarts the local test stack in the background (as a non-root user if run as root).
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "node devstack/start.mjs" 2>/dev/null || true
pkill -f "devstack/bin/auth" 2>/dev/null || true
pkill -f "devstack/bin/postgrest" 2>/dev/null || true
sleep 1
RUN_AS=${DEVSTACK_USER:-claude}
LOG=/tmp/zb-devstack.out
rm -f "$LOG"
if [ "$(id -u)" = "0" ]; then
  sudo -u "$RUN_AS" -H setsid bash -c "cd '$PWD' && nohup node devstack/start.mjs > $LOG 2>&1 < /dev/null &" > /dev/null 2>&1
  STATE=$(eval echo "~$RUN_AS")/.zb-devstack/state.json
else
  setsid nohup node devstack/start.mjs > $LOG 2>&1 < /dev/null &
  STATE=$HOME/.zb-devstack/state.json
fi
for i in $(seq 1 120); do
  if grep -q "devstack ready" $LOG 2>/dev/null; then cat $LOG; echo "state: $STATE"; exit 0; fi
  sleep 0.5
done
cat $LOG
exit 1
