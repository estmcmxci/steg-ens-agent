import type { ReactNode } from 'react';

interface SplitLayoutProps {
  story: ReactNode;
  chat: ReactNode;
}

export function SplitLayout({ story, chat }: SplitLayoutProps) {
  return (
    <div className="layout">
      <div className="layout__story">
        {story}
      </div>
      <div className="layout__divider" />
      <div className="layout__chat">
        {chat}
      </div>
    </div>
  );
}
