export type RegistrationStep = 'idle' | 'commit' | 'waiting' | 'register' | 'complete';

interface RegistrationProgressProps {
  step: RegistrationStep;
}

const STEPS: { key: RegistrationStep; label: string }[] = [
  { key: 'commit', label: 'Commit' },
  { key: 'waiting', label: 'Wait' },
  { key: 'register', label: 'Register' },
  { key: 'complete', label: 'Done' },
];

const ORDER: Record<RegistrationStep, number> = {
  idle: -1, commit: 0, waiting: 1, register: 2, complete: 3,
};

export function RegistrationProgress({ step }: RegistrationProgressProps) {
  if (step === 'idle') return null;
  const currentIdx = ORDER[step];

  return (
    <div className="reg-progress">
      {STEPS.map((s, i) => {
        const idx = ORDER[s.key];
        const completed = idx < currentIdx;
        const current = idx === currentIdx;
        const future = idx > currentIdx;

        const circleColor = completed ? 'var(--success)' : current ? 'var(--accent)' : 'var(--border)';
        const textColor = completed ? 'var(--success)' : current ? 'var(--text)' : 'var(--text-muted)';

        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div className="reg-step">
              <div
                className="reg-step__circle"
                style={{
                  color: completed || current ? '#fff' : 'var(--text-muted)',
                  background: completed || current ? circleColor : 'transparent',
                  border: future ? `2px solid ${circleColor}` : 'none',
                }}
              >
                {completed ? '✓' : i + 1}
              </div>
              <span className="reg-step__label" style={{ color: textColor }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="reg-line" style={{ background: completed ? 'var(--success)' : 'var(--border)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
