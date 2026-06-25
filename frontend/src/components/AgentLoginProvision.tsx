import { useEffect, useState } from 'react';
import { useProvision } from '../hooks/useProvision';
import { useMintWatch } from '../hooks/useMintWatch';
import { requestMint } from '../lib/provisionApi';
import { ProvisionProgress } from './ProvisionProgress';

/* AgentLoginProvision — the in-card "sign in with email → provision a fresh agent"
 * flow (PLAN.md §0 / §7 G1). Lives INSIDE the profile card's logged-out state. Email
 * is the thesis affordance; the user picks a subname label; the backend work is POST
 * /provision. On success the parent re-anchors the card to the freshly provisioned agent.
 *
 * G1: the target is now USER-CHOSEN (was hardcoded demo.steg.eth). Because only the
 * operator's Ledger can mint a subname under wrapped steg.eth, picking a label enters
 * an "awaiting operator mint" state that polls ownerOf until the name exists, THEN
 * streams /provision (which runs hot-key-signed, no further Ledger).
 */

const PARENT = 'steg.eth';
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/; // ENS-ish label, lowercase
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function AgentLoginProvision({
  onProvisioned,
  onCancel,
}: {
  onProvisioned: (name: string) => void;
  onCancel?: () => void;
}) {
  const prov = useProvision();
  const mint = useMintWatch();
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');

  const cleanLabel = label.trim().toLowerCase();
  const name = cleanLabel ? `${cleanLabel}.${PARENT}` : '';
  // After a refresh mid-run the local form state is empty, so fall back to the
  // name/label the hook recovered from the resumed job record (PLAN-D Part 2).
  const effName = name || prov.name || '';
  const effLabel = cleanLabel || prov.label || '';
  const validEmail = EMAIL_RE.test(email.trim());
  const validLabel = LABEL_RE.test(cleanLabel);

  const provIdle = prov.status === 'idle';
  const showForm = provIdle && mint.status === 'idle';
  const awaiting = provIdle && (mint.status === 'waiting' || mint.status === 'minted');

  // Once the operator's mint is detected on-chain, stream /provision for the new name.
  useEffect(() => {
    if (mint.status === 'minted' && prov.status === 'idle' && name) {
      prov.start({ name, label: cleanLabel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint.status, prov.status, name, cleanLabel]);

  const cancelAll = () => {
    mint.reset();
    prov.reset();
    onCancel?.();
  };

  return (
    <div className="pcard__login">
      <div className="prov-card__head">
        <div className="prov-card__title">
          <span className="prov-card__spark">✦</span>
          Sign in with email
        </div>
        <span className="prov-card__sub">
          Get a MetaMask TEE agent wallet under{' '}
          <code>{name || `<name>.${PARENT}`}</code>, with a verifiable ERC-8004 identity.
          No wallet to connect.
        </span>
      </div>

      {/* Email + label entry */}
      {showForm && (
        <form
          className="pcard__login-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail && validLabel) {
              // Register the pending mint so the operator isn't blind (Option C),
              // then start the on-chain poll that actually detects the mint.
              void requestMint(cleanLabel, email.trim());
              mint.watch(name);
            }
          }}
        >
          <input
            className="pcard__login-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <div className="pcard__login-label-row">
            <input
              className="pcard__login-input pcard__login-input--label"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="agent-name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <span className="pcard__login-suffix">.{PARENT}</span>
          </div>
          {label && !validLabel && (
            <span className="prov-card__hint">
              Use lowercase letters, numbers, and hyphens (2–32 chars).
            </span>
          )}
          <button className="prov-card__cta" type="submit" disabled={!validEmail || !validLabel}>
            <span>Continue with email</span>
            <span className="prov-card__cta-arrow">→</span>
          </button>
          {onCancel && (
            <button type="button" className="prov-card__retry" onClick={cancelAll}>
              Cancel
            </button>
          )}
        </form>
      )}

      {/* Awaiting the operator's one-time Ledger mint of the chosen subname */}
      {awaiting && (
        <div className="prov-card__await">
          <div className="prov-card__await-head">
            <span className="prov-card__pulse" />
            {mint.status === 'minted'
              ? `${name} minted — starting provisioning…`
              : `Waiting for the operator to mint ${name}…`}
          </div>
          {mint.status === 'waiting' && (
            <>
              <p className="prov-card__await-note">
                Minting a name under <code>{PARENT}</code> needs the operator to approve
                once on their Ledger. They run:
              </p>
              <code className="prov-card__await-cmd">
                bun scripts/mint-subname.ts --name {name} --send
              </code>
              <p className="prov-card__await-note prov-card__await-note--dim">
                This panel auto-continues the moment the mint lands on-chain.
              </p>
            </>
          )}
          <button type="button" className="prov-card__retry" onClick={cancelAll}>
            Cancel
          </button>
        </div>
      )}

      {/* Live provision progress */}
      {!provIdle && <ProvisionProgress steps={prov.steps} />}
      {prov.status === 'running' && prov.message && (
        <div className="prov-card__status">
          <span className="prov-card__pulse" />
          {prov.message}
        </div>
      )}

      {/* Error */}
      {prov.status === 'error' && (
        <div className="prov-card__error">
          <div className="prov-card__error-msg">
            <strong>Provisioning stopped.</strong> {prov.error}
          </div>
          <div className="prov-card__success-actions">
            <button className="prov-card__retry" onClick={() => prov.start({ name: effName, label: effLabel })}>
              Try again
            </button>
            {onCancel && (
              <button className="prov-card__retry" onClick={cancelAll}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Success → hand the new agent up to re-anchor the card */}
      {prov.status === 'complete' && (
        <div className="prov-card__success">
          <div className="prov-card__success-head">
            <span className="prov-card__check">✓</span>
            <span className="prov-card__success-name">{effName} is live</span>
          </div>
          <div className="prov-card__facts">
            {prov.serverWallet && (
              <div className="prov-card__fact">
                <span className="prov-card__fact-key">TEE wallet</span>
                <span className="prov-card__fact-val">{truncAddr(prov.serverWallet)}</span>
              </div>
            )}
            {prov.agentId && (
              <div className="prov-card__fact">
                <span className="prov-card__fact-key">ERC-8004 id</span>
                <span className="prov-card__fact-val">{prov.agentId}</span>
              </div>
            )}
          </div>
          <button className="prov-card__cta" onClick={() => onProvisioned(effName)}>
            <span>Open {effName}</span>
            <span className="prov-card__cta-arrow">→</span>
          </button>
        </div>
      )}
    </div>
  );
}
