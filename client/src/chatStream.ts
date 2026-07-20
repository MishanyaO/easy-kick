import type { ChatEvent } from './types';
import { API_BASE } from './api';

/**
 * Subscribes to real Kick chat from the easy-kick backend over SSE.
 * EventSource reconnects on its own, so a backend restart heals without a page reload.
 */
export function startChatStream(onChat: (e: ChatEvent) => void): () => void {
  const source = new EventSource(`${API_BASE}/stream`);

  source.onmessage = (ev) => {
    try {
      onChat(JSON.parse(ev.data) as ChatEvent);
    } catch {
      // A malformed frame should not tear down the stream.
    }
  };

  return () => source.close();
}
