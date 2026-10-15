#!/usr/bin/env bash
# Builds the web app against the local test stack (for automated browser tests).
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=${DEVSTACK_STATE:-$HOME/.zb-devstack/state.json}
export EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1
export EXPO_BASE_URL=/zvezdnye-bally
export EXPO_PUBLIC_SUPABASE_URL=$(node -e "console.log(require('$STATE').url)")
export EXPO_PUBLIC_SUPABASE_KEY=$(node -e "console.log(require('$STATE').anonKey)")
npm run build:web
