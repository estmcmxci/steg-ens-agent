#!/usr/bin/env bash
# Build + send auth.* record calldata to an ENS name's resolver in one step.
# The (long) calldata is generated internally and never printed.
#
# Usage:
#   scripts/send.sh <name> [credentialId] --ledger                     # publish, hardware-signed
#   scripts/send.sh <name> [credentialId] --revoke --ledger            # flip to revoked, hardware-signed
#   PRIVATE_KEY=0x... scripts/send.sh <name> [credentialId]            # publish records (hot key)
#   PRIVATE_KEY=0x... scripts/send.sh <name> [credentialId] --revoke   # flip to revoked (hot key)
#   PRIVATE_KEY=0x... scripts/send.sh <fleetName> --envelope           # publish Tier-1 envelope
#   scripts/send.sh <name> [credentialId] --dry-run                    # build only, don't send
#
# Signing modes (precedence: --ledger > PRIVATE_KEY > interactive prompt):
#   --ledger       sign on a Ledger; the private key NEVER touches this CLI.
#                  This is the operator path — agent.steg.eth's records are
#                  operator authority (steg.eth = hardware wallet), so prefer it.
#                  Optional: OPERATOR_ADDRESS (-> --from) selects which device
#                  account; LEDGER_HD_PATH (-> --hd-path) selects the derivation.
#   PRIVATE_KEY    hot key in env (do NOT use for the operator key). Tip: prefix
#                  the command with a SPACE so it stays out of shell history.
#   (neither)      falls back to `cast send --interactive` (prompts for key).
#
# Notes:
#   - ETH_RPC_URL is read from .env automatically.
set -euo pipefail

ACTION=publish
DRY=0
LEDGER=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --revoke)   ACTION=revoke ;;
    --envelope) ACTION=envelope ;;
    --dry-run)  DRY=1 ;;
    --ledger)   LEDGER=1 ;;
    *)          ARGS+=("$a") ;;
  esac
done

NAME="${ARGS[0]:-}"
CRED="${ARGS[1]:-primary}"
if [ -z "$NAME" ]; then
  echo "usage: [PRIVATE_KEY=0x..] scripts/send.sh <name> [credentialId] [--revoke] [--dry-run]" >&2
  exit 2
fi

# Load .env quietly for ETH_RPC_URL (values not printed).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${ETH_RPC_URL:?ETH_RPC_URL not set (add it to .env)}"

# Generate calldata silently.
if [ "$ACTION" = revoke ]; then
  OUT=$(bun scripts/revoke.ts "$NAME" "$CRED" 2>/dev/null)
elif [ "$ACTION" = envelope ]; then
  OUT=$(bun scripts/publish-envelope.ts "$NAME" 2>/dev/null)
else
  OUT=$(bun scripts/publish-records.ts "$NAME" "$CRED" 2>/dev/null)
fi
TO=$(printf '%s\n' "$OUT" | sed -n 's/^to: //p')
DATA=$(printf '%s\n' "$OUT" | sed -n 's/^data: //p')
if [ -z "${TO:-}" ] || [ -z "${DATA:-}" ]; then
  echo "error: failed to build calldata" >&2
  exit 1
fi

SIGN_MODE=$([ "$LEDGER" = 1 ] && echo ledger || { [ -n "${PRIVATE_KEY:-}" ] && echo private-key || echo interactive; })

echo "action:   $ACTION" >&2
echo "name:     $NAME ($CRED)" >&2
echo "to:       $TO" >&2
echo "calldata: ${#DATA} chars (hidden)" >&2
echo "signer:   $SIGN_MODE" >&2

if [ "$DRY" = 1 ]; then
  echo "dry-run: not sending" >&2
  exit 0
fi

if [ "$LEDGER" = 1 ]; then
  # Hardware-signed. Key never enters the CLI. Build args conditionally so an
  # unset OPERATOR_ADDRESS/LEDGER_HD_PATH doesn't pass empty flags to cast.
  CAST_ARGS=("$TO" "$DATA" --rpc-url "$ETH_RPC_URL" --ledger)
  [ -n "${OPERATOR_ADDRESS:-}" ] && CAST_ARGS+=(--from "$OPERATOR_ADDRESS")
  [ -n "${LEDGER_HD_PATH:-}" ]   && CAST_ARGS+=(--hd-path "$LEDGER_HD_PATH")
  echo "(confirm the transaction on your Ledger)" >&2
  exec cast send "${CAST_ARGS[@]}"
elif [ -n "${PRIVATE_KEY:-}" ]; then
  exec cast send "$TO" "$DATA" --rpc-url "$ETH_RPC_URL" --private-key "$PRIVATE_KEY"
else
  echo "(no --ledger and no PRIVATE_KEY env -> using cast --interactive)" >&2
  exec cast send "$TO" "$DATA" --rpc-url "$ETH_RPC_URL" --interactive
fi
