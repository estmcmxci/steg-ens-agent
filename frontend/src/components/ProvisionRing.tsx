import { PROVISION_STEPS, type StepState } from '../hooks/useProvision';

interface ProvisionRingProps {
  steps: Record<string, StepState>;
  current?: string;
  message?: string;
  status: 'idle' | 'running' | 'complete' | 'error';
}

/* Radial progress ring for the onboarding choreography (PLAN-D Part 3) — replaces the
 * horizontal dot-stepper while a run is in flight. The arc fills proportionally to
 * completed steps; the center shows "Step N of 9" + the current step label; the live
 * per-step `message` rolls below. On complete it shows ✓ (green ring); on error, ! (red
 * ring). Uses the existing prov-card / token palette to stay on-brand. */

const SIZE = 136;
const STROKE = 9;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function ProvisionRing({ steps, current, message, status }: ProvisionRingProps) {
  const total = PROVISION_STEPS.length;
  const doneCount = PROVISION_STEPS.filter((s) => steps[s.id] === 'done').length;
  const complete = status === 'complete';
  const errored = status === 'error';

  // The step in focus: the active one, else the errored one (so the ring labels the
  // failure point), else the last done.
  const focusId =
    current ??
    PROVISION_STEPS.find((s) => steps[s.id] === 'error')?.id ??
    PROVISION_STEPS.find((s) => steps[s.id] === 'active')?.id;
  const focusLabel = PROVISION_STEPS.find((s) => s.id === focusId)?.label ?? '';

  // Arc = fraction of completed steps (full on complete). The center counter shows the
  // step currently being worked (done + 1) while running.
  const frac = complete ? 1 : doneCount / total;
  const offset = CIRC * (1 - frac);
  const stepNum = complete ? total : Math.min(doneCount + 1, total);

  const arcColor = errored ? 'var(--danger)' : complete ? 'var(--success)' : 'var(--accent)';

  return (
    <div className="prov-ring">
      <div className="prov-ring__dial" style={{ width: SIZE, height: SIZE }}>
        <svg className="prov-ring__svg" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            className="prov-ring__track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            strokeWidth={STROKE}
            fill="none"
          />
          <circle
            className="prov-ring__arc"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            strokeWidth={STROKE}
            fill="none"
            stroke={arcColor}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="prov-ring__center">
          {complete ? (
            <span className="prov-ring__glyph prov-ring__glyph--ok">✓</span>
          ) : errored ? (
            <span className="prov-ring__glyph prov-ring__glyph--err">!</span>
          ) : (
            <>
              <span className="prov-ring__count">
                {stepNum}
                <span className="prov-ring__count-total">/{total}</span>
              </span>
              {focusLabel && <span className="prov-ring__focus">{focusLabel}</span>}
            </>
          )}
        </div>
      </div>

      {/* Rolling live text — the per-step message from the job state. */}
      {!complete && (
        <div className={`prov-ring__msg${errored ? ' prov-ring__msg--error' : ''}`}>
          {!errored && <span className="prov-card__pulse" />}
          <span className="prov-ring__msg-text">
            {errored ? 'Provisioning stopped' : message ?? 'Working…'}
          </span>
        </div>
      )}
    </div>
  );
}
