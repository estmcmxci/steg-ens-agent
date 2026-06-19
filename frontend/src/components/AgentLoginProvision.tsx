import { useState } from 'react';
import { useProvision } from '../hooks/useProvision';
import { ProvisionProgress } from './ProvisionProgress';

/* AgentLoginProvision — the in-card "sign in with email → provision a fresh agent"
 * flow (PLAN.md §0). Lives INSIDE the profile card's logged-out state (replaces the
 * old standalone ProvisionWizard). Email is the thesis affordance; the backend work
 * is POST /provision (provisions a new agent under the current session). On success
 * the parent re-anchors the card to the freshly provisioned agent.
 */

const DEMO_NAME = 'demo.steg.eth';
const DEMO_LABEL = 'demo';

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
  const [email, setEmail] = useState('');
  const idle = prov.status === 'idle';
  const running = prov.status === 'running';
  const validEmail = EMAIL_RE.test(email.trim());

  return (
    <div className="pcard__login">
      <div className="prov-card__head">
        <div className="prov-card__title">
          <span className="prov-card__spark">✦</span>
          Sign in with email
        </div>
        <span className="prov-card__sub">
          Get a MetaMask TEE agent wallet under <code>{DEMO_NAME}</code>, with a verifiable
          ERC-8004 identity. No wallet to connect.
        </span>
      </div>

      {/* Email entry */}
      {idle && (
        <form
          className="pcard__login-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail) prov.start({ name: DEMO_NAME, label: DEMO_LABEL });
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
          <button className="prov-card__cta" type="submit" disabled={!validEmail}>
            <span>Continue with email</span>
            <span className="prov-card__cta-arrow">→</span>
          </button>
          {onCancel && (
            <button type="button" className="prov-card__retry" onClick={onCancel}>
              Cancel
            </button>
          )}
        </form>
      )}

      {/* Live progress */}
      {!idle && <ProvisionProgress steps={prov.steps} />}
      {running && prov.message && (
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
            <button className="prov-card__retry" onClick={() => prov.start({ name: DEMO_NAME, label: DEMO_LABEL })}>
              Try again
            </button>
            {onCancel && (
              <button className="prov-card__retry" onClick={onCancel}>
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
            <span className="prov-card__success-name">{DEMO_NAME} is live</span>
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
          <button className="prov-card__cta" onClick={() => onProvisioned(DEMO_NAME)}>
            <span>Open {DEMO_NAME}</span>
            <span className="prov-card__cta-arrow">→</span>
          </button>
        </div>
      )}
    </div>
  );
}
