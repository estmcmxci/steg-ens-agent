import type { ENSNameEntry } from '../lib/api';

interface ContextualPromptsProps {
  isConnected: boolean;
  hasNames: boolean;
  names: ENSNameEntry[];
  justRegistered: boolean;
  onPrompt: (text: string) => void;
}

interface PromptChip {
  icon: string;
  label: string;
  prompt: string;
}

function getPrompts(props: ContextualPromptsProps): PromptChip[] {
  const { isConnected, hasNames, names, justRegistered } = props;

  if (justRegistered) {
    return [
      { icon: '✏️', label: 'Set records', prompt: 'Set text records on my newly registered name' },
      { icon: '🖼', label: 'Set avatar', prompt: 'Set an avatar on my ENS name' },
      { icon: '👤', label: 'View profile', prompt: 'Show my ENS profile' },
      { icon: '➕', label: 'Register another', prompt: 'Help me register another .eth name' },
    ];
  }

  if (!isConnected) {
    return [
      { icon: '🔍', label: 'Check availability', prompt: 'Is myname.eth available?' },
      { icon: '❓', label: 'What is ENS?', prompt: 'What is ENS and how does it work?' },
      { icon: '📝', label: 'How to register', prompt: 'How do I register an ENS name?' },
    ];
  }

  if (!hasNames) {
    return [
      { icon: '🔍', label: 'Check availability', prompt: 'Is myname.eth available?' },
      { icon: '➕', label: 'Register a name', prompt: 'Help me register a new .eth name' },
      { icon: '📋', label: 'View my names', prompt: 'Show all ENS names for my connected wallet' },
    ];
  }

  const chips: PromptChip[] = [
    { icon: '📋', label: 'View my names', prompt: 'Show all ENS names for my connected wallet' },
    { icon: '➕', label: 'Register a name', prompt: 'Help me register a new .eth name' },
    { icon: '✏️', label: 'Manage records', prompt: 'I want to update text records on my ENS name' },
  ];

  // Add renew chip if any name expires within 90 days
  const expiring = names.find((n) => n.expiry && !n.expiry.expired && n.expiry.days_left < 90);
  if (expiring) {
    chips.push({ icon: '🔄', label: `Renew ${expiring.name}`, prompt: `Renew ${expiring.name}` });
  }

  return chips;
}

export function ContextualPrompts(props: ContextualPromptsProps) {
  const chips = getPrompts(props);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--ds-space-2)',
        padding: 'var(--ds-space-3) var(--ds-space-4)',
      }}
    >
      {chips.map((chip, i) => (
        <button
          key={chip.label}
          className={`ds-btn ds-btn--secondary ds-btn--sm ds-animate-in ds-stagger-${Math.min(i + 1, 8)}`}
          onClick={() => props.onPrompt(chip.prompt)}
          style={{ gap: 'var(--ds-space-1)' }}
        >
          <span>{chip.icon}</span>
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  );
}
