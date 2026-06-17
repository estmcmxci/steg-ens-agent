import { useState, type ReactNode } from 'react';

interface MobileTabLayoutProps {
  chat: ReactNode;
  dashboard: ReactNode;
}

export function MobileTabLayout({ chat, dashboard }: MobileTabLayoutProps) {
  const [tab, setTab] = useState<'chat' | 'dashboard'>('chat');

  return (
    <div className="mobile-tabs">
      <div className="mobile-tabs__bar">
        <button
          className={`mobile-tab ${tab === 'chat' ? 'mobile-tab--active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className={`mobile-tab ${tab === 'dashboard' ? 'mobile-tab--active' : ''}`}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
      </div>

      <div style={{ display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {chat}
      </div>
      <div style={{ display: tab === 'dashboard' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {dashboard}
      </div>
    </div>
  );
}
