import type { ReactNode } from 'react';

interface CenteredLayoutProps {
  profileCard: ReactNode;
  chat: ReactNode;
  logo: ReactNode;
}

export function CenteredLayout({ profileCard, chat, logo }: CenteredLayoutProps) {
  return (
    <div className="centered">
      <div className="centered__nebula" />

      {/* Logo floats top-left, independent of the modal */}
      <div className="centered__logo-wrap">
        {logo}
      </div>

      {/* Single unified modal: profile card + chat */}
      <div className="centered__modal">
        {/* Mobile-only inline logo — the floating one is hidden on mobile */}
        <div className="centered__mobile-logo">
          {logo}
        </div>
        <div className="centered__modal-card">
          {profileCard}
        </div>
        <div className="centered__modal-chat">
          {chat}
        </div>
      </div>
    </div>
  );
}
