import { createContext, useContext, useCallback, type MutableRefObject } from 'react';

export interface ChatBridgeMethods {
  sendPrompt: (text: string) => void;
  sendAction: (action: { type: string; payload?: Record<string, unknown> }) => void;
}

/* Ref-based context so updates don't trigger re-renders */
export const ChatBridgeContext = createContext<MutableRefObject<ChatBridgeMethods | null>>({
  current: null,
} as MutableRefObject<ChatBridgeMethods | null>);

/** Register bridge methods (called by ChatPanel) */
export function useChatBridgeRegister() {
  const ref = useContext(ChatBridgeContext);
  const register = useCallback(
    (methods: ChatBridgeMethods) => {
      ref.current = methods;
    },
    [ref],
  );
  return register;
}

/** Call bridge methods (called by Dashboard / prompts) */
export function useChatBridge() {
  const ref = useContext(ChatBridgeContext);
  const sendPrompt = useCallback(
    (text: string) => ref.current?.sendPrompt(text),
    [ref],
  );
  const sendAction = useCallback(
    (action: { type: string; payload?: Record<string, unknown> }) => ref.current?.sendAction(action),
    [ref],
  );
  return { sendPrompt, sendAction };
}
