#!/usr/bin/env bash
# Runs INSIDE the container. Staged so the read-only checks (the core portability
# question) run with zero risk; the TEE sign + broadcast only fire when explicitly asked.
#
#   STAGE=read   (default) — mm runs on Linux + session restores + reads work
#   STAGE=sign            — + TEE sign-message (the /evaluate gate's path; no broadcast)
#   STAGE=tx              — + a real 0-value self-transfer (spends gas, mainnet)
set -uo pipefail
STAGE="${STAGE:-read}"
hr(){ printf '\n=== %s ===\n' "$1"; }
ok(){ printf '  ✅ %s\n' "$1"; }
no(){ printf '  ❌ %s\n' "$1"; }

hr "1. mm runs on Linux"
mm --version || { no "mm --version failed — binary/native-dep problem on Linux"; exit 1; }
ok "mm --version ran"

hr "2. session restored from mounted ~/.metamask"
if mm wallet show --json 2>/tmp/show.err; then
  ok "mm wallet show --json returned (session is portable — no keychain binding)"
else
  no "mm wallet show failed — token expired OR session not self-contained:"
  cat /tmp/show.err
  exit 2
fi

hr "2b. selected wallet identity"
mm wallet show --json 2>/dev/null | jq -r '.data | (.selectedWallet // .address // .) ' 2>/dev/null \
  || mm wallet show 2>/dev/null | head -20

hr "3. read — balance (no gas)"
mm wallet balance 2>&1 | head -20 && ok "balance read worked" || no "balance read failed"

if [ "$STAGE" = "read" ]; then
  hr "DONE (read stage)"; echo "  portability + reads validated; rerun with STAGE=sign for TEE sign"; exit 0
fi

hr "4. TEE sign-message (gate path — NO broadcast, NO gas)"
# exact syntax from scripts/sign-with-mm.ts: mm wallet sign-message --message <m> --chain-id 1 --json
mm wallet sign-message --message "d1-spike $(date -u +%FT%TZ)" --chain-id 1 --json 2>&1 | head -20 \
  && ok "TEE off-chain sign worked in-container (the /evaluate gate's signer path)" || no "TEE sign failed"

if [ "$STAGE" = "sign" ]; then
  hr "DONE (sign stage)"; echo "  TEE sign confirmed remote; rerun with STAGE=tx for a real 0-value self-transfer"; exit 0
fi

hr "5. real 0-value self-transfer (mainnet, spends gas ~21000)"
SELF="$(mm wallet show --json 2>/dev/null | jq -r '.data.address // .data.selectedWallet.address // empty')"
echo "  self = ${SELF:-<unresolved>}"
mm wallet send-transaction --chain-id 1 \
  --payload "{\"to\":\"$SELF\",\"value\":\"0x0\"}" \
  --intent "d1-spike self-transfer" --wait 2>&1 | head -40 \
  && ok "TEE broadcast worked in-container" || no "TEE broadcast failed"
hr "DONE (tx stage)"
