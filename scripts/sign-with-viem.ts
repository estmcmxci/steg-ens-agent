/**
 * Local signer — the Path B fallback.
 *
 * mm 2.0.0 cannot off-chain-sign in BYOK mode (sign-message / sign-typed-data
 * route to a server-only keyring adapter — confirmed bug, latest version). So
 * the agent's action signature is produced here instead, with viem, using the
 * SAME key: the BYOK mnemonic the user backed up. The signer address is
 * unchanged (0x2B4C…8979), the scheme is unchanged (EIP-191 personal_sign), and
 * the verifier needs no changes — it only cares that the signature recovers to
 * the ENS-published `signer`.
 *
 * The mnemonic is read from MM_MNEMONIC (set it in your own terminal so it stays
 * off any transcript) — or a raw key from AGENT_PRIVATE_KEY. We never log it.
 * A guard asserts the derived address equals AGENT_ADDRESS, so a wrong mnemonic
 * or derivation path fails loudly instead of producing a dead signature.
 */

import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { serializeRequest } from "../src/hash"
import type { ActionRequest, Hex } from "../src/types"

function loadAccount() {
  const mnemonic = process.env.MM_MNEMONIC?.trim()
  const pk = process.env.AGENT_PRIVATE_KEY?.trim()
  if (pk) return privateKeyToAccount(pk as Hex)
  if (mnemonic) return mnemonicToAccount(mnemonic) // default path m/44'/60'/0'/0/0 = byok:evm:0
  throw new Error(
    "no local signer: set MM_MNEMONIC (your backed-up BYOK seed) or AGENT_PRIVATE_KEY in the environment",
  )
}

/** Sign an action request locally with the agent's key (EIP-191). */
export async function signWithViem(request: ActionRequest): Promise<Hex> {
  const account = loadAccount()
  const expected = process.env.AGENT_ADDRESS
  if (expected && account.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `derived signer ${account.address} != AGENT_ADDRESS ${expected} — wrong mnemonic or derivation path`,
    )
  }
  return account.signMessage({ message: serializeRequest(request) })
}

if (import.meta.main) {
  const { buildDemoRequest } = await import("./demo-request")
  const request = buildDemoRequest()
  const sig = await signWithViem(request)
  console.error("signer :", loadAccount().address)
  console.error("request:", serializeRequest(request))
  console.log(sig)
}
