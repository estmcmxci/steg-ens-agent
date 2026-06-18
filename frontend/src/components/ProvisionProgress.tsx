import { PROVISION_STEPS, type StepState } from '../hooks/useProvision';

interface ProvisionProgressProps {
  steps: Record<string, StepState>;
}

/* Compact horizontal stepper for the onboarding choreography. Reuses the
 * registration-flow visual tokens (circles + connecting lines) but supports a
 * per-step state (pending / active / done / error) driven by the SSE stream. */
export function ProvisionProgress({ steps }: ProvisionProgressProps) {
  return (
    <div className="prov-progress">
      {PROVISION_STEPS.map((s, i) => {
        const st = steps[s.id] ?? 'pending';
        const done = st === 'done';
        const active = st === 'active';
        const error = st === 'error';

        const circleBg = error
          ? 'var(--danger)'
          : done
            ? 'var(--success)'
            : active
              ? 'var(--accent)'
              : 'transparent';
        const circleBorder = !done && !active && !error ? '2px solid var(--border)' : 'none';
        const textColor = error
          ? 'var(--danger)'
          : done
            ? 'var(--success)'
            : active
              ? 'var(--text)'
              : 'var(--text-muted)';

        return (
          <div
            key={s.id}
            className="prov-step-wrap"
            style={{ flex: i < PROVISION_STEPS.length - 1 ? 1 : undefined }}
          >
            <div className="prov-step" title={s.label}>
              <div
                className={`prov-step__circle${active ? ' prov-step__circle--active' : ''}`}
                style={{
                  color: done || active || error ? '#fff' : 'var(--text-muted)',
                  background: circleBg,
                  border: circleBorder,
                }}
              >
                {error ? '!' : done ? '✓' : i + 1}
              </div>
              <span className="prov-step__label" style={{ color: textColor }}>
                {s.label}
              </span>
            </div>
            {i < PROVISION_STEPS.length - 1 && (
              <div
                className="prov-line"
                style={{ background: done ? 'var(--success)' : 'var(--border)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
