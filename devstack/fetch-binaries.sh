#!/usr/bin/env bash
# Downloads Supabase Auth (GoTrue) and PostgREST for the local test stack.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
AUTH_VERSION=v2.195.0
POSTGREST_VERSION=v12.2.3
if [ ! -x bin/auth ]; then
  curl -sSL -o bin/auth.tgz "https://github.com/supabase/auth/releases/download/${AUTH_VERSION}/auth-${AUTH_VERSION}-x86.tar.gz"
  tar xzf bin/auth.tgz -C bin && rm bin/auth.tgz
fi
if [ ! -x bin/postgrest ]; then
  curl -sSL -o bin/postgrest.txz "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz"
  tar xJf bin/postgrest.txz -C bin && rm bin/postgrest.txz
fi
echo "ok: $(ls bin)"
