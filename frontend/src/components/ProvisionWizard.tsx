import { useProvision } from '../hooks/useProvision';
import { ProvisionProgress } from './ProvisionProgress';

/* ProvisionWizard — the milestone-7 onboarding entry point (PLAN.md §3.3.1 Phase 3).
 *
 * Self-contained card (no wallet-connect — the email-only thesis): one primary
 * button kicks off POST /provision, the choreography streams in as live progress,
 * and on completion it surfaces the new agent's ENS name, server wallet, ERC-8004
 * id, and a link to its verifiable /card. The operator's one Ledger sig (the
 * subname mint) happens out-of-band before the demo; this flow is 0-Ledger.
 */

const DEMO_NAME = 'demo.steg.eth';
const DEMO_LABEL = 'demo';

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ProvisionWizard() {
  const prov = useProvision();
  const running = prov.status === 'running';
  const idle = prov.status === 'idle';

  return (
    <div className="pcard prov-card">
      <div className="prov-card__head">
        <div className="prov-card__title">
          <span className="prov-card__spark">✦</span>
          Onboard a new agent
        </div>
        <span className="prov-card__sub">
          Sign in with email → a MetaMask TEE wallet under <code>{DEMO_NAME}</code>, with a
          verifiable ERC-8004 identity. No wallet to connect.
        </span>
      </div>

      {/* Idle: the single call-to-action */}
      {idle && (
        <button className="prov-card__cta" onClick={() => prov.start({ name: DEMO_NAME, label: DEMO_LABEL })}>
          <span>Provision {DEMO_NAME}</span>
          <span className="prov-card__cta-arrow">→</span>
        </button>
      )}

      {/* Running / complete / error: the stepper */}
      {!idle && <ProvisionProgress steps={prov.steps} />}

      {/* Live status line while running */}
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
          <button className="prov-card__retry" onClick={() => prov.start({ name: DEMO_NAME, label: DEMO_LABEL })}>
            Try again
          </button>
        </div>
      )}

      {/* Success */}
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
          <div className="prov-card__success-actions">
            {prov.card && (
              <a className="prov-card__cta prov-card__cta--link" href={prov.card} target="_blank" rel="noopener noreferrer">
                View verifiable card →
              </a>
            )}
            <button className="prov-card__retry" onClick={prov.reset}>
              Provision another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
