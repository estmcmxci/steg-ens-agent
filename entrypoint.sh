#!/usr/bin/env sh
# Brain container entrypoint (PLAN-C §5).
#
# 1. Materialize the headless mm state under ~/.metamask:
#      - session.json  (MM_SESSION_B64)  — the auth session
#      - wallets.json  (MM_WALLETS_B64)  — the wallet definitions mm resolves by ref
#    TEE/session signing only — there is deliberately NO MM_PASSWORD: the server can
#    sign as the agent's TEE wallet but holds no seed. Both files are required; without
#    wallets.json mm returns WALLET_NOT_FOUND. (swap-quotes is cache; not injected.)
#
#    PERSISTENCE (PLAN-C §6a): /root/.metamask MUST be a Railway persistent volume.
#    The env vars only BOOTSTRAP a fresh/empty volume — we write each file ONLY IF it's
#    absent. Once the brain runs, it owns this state on the volume: refreshed mm tokens
#    and wallets created by `mm wallet create` persist across redeploys (otherwise every
#    provisioned agent's wallet is lost and every redeploy needs a fresh `mm login`).
#    Set MM_FORCE_BOOTSTRAP=1 to overwrite the volume from env (e.g. after a re-login).
# 2. Start uvicorn. The brain runs as `app.main` from brain/ (--app-dir), but its
#    subprocesses (bun scripts/*.ts, mm) run with cwd=/app (REPO_ROOT = parents[2]).
set -e

mkdir -p /root/.metamask
FORCE="${MM_FORCE_BOOTSTRAP:-0}"

bootstrap_mm_file() {  # $1=path  $2=base64-value  $3=label
  if [ -f "$1" ] && [ "$FORCE" != "1" ]; then
    echo "entrypoint: $3 present on volume — keeping brain-owned state ($(wc -c < "$1" | tr -d ' ')B)."
  elif [ -n "$2" ]; then
    printf '%s' "$2" | base64 -d > "$1"
    echo "entrypoint: bootstrapped $3 from env ($(wc -c < "$1" | tr -d ' ')B)${FORCE:+, force=$FORCE}."
  else
    echo "entrypoint: WARNING — $3 absent and no bootstrap env; mm will fail."
  fi
}

bootstrap_mm_file /root/.metamask/session.json "$MM_SESSION_B64" session.json
bootstrap_mm_file /root/.metamask/wallets.json "$MM_WALLETS_B64" wallets.json

# Railway injects $PORT; default 8000 for `docker run` locally.
PORT="${PORT:-8000}"
echo "entrypoint: starting uvicorn on 0.0.0.0:${PORT}"
exec uvicorn app.main:app --app-dir brain --host 0.0.0.0 --port "$PORT"
