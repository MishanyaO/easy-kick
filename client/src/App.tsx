import { useEffect, useRef, useState } from 'react';
import ChatPanel from './components/ChatPanel';
import CenterPanel, { type HypePoint } from './components/CenterPanel';
import ActionFeed from './components/ActionFeed';
import SimulatorPanel from './components/SimulatorPanel';
import { SIMULATOR_UI } from './api';
import { startMockStream } from './mockStream';
import { startChatStream } from './chatStream';
import type { ChatEvent, InsightEvent, ActionEvent, ActionResult } from './types';

const MAX_MSGS = 80;
const HISTORY_MS = 5 * 60 * 1000;

export default function App() {
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [insight, setInsight] = useState<InsightEvent | null>(null);
  const [history, setHistory] = useState<HypePoint[]>([]);
  const [actions, setActions] = useState<Record<string, ActionEvent>>({});
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [started, setStarted] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    // Real chat from the backend — live Kick webhooks or the replay simulator.
    const stopChat = startChatStream((e) => {
      setStarted(true);
      setMessages((m) => [...m.slice(-MAX_MSGS + 1), e]);
    });

    // Insights, actions and results are still mocked — the backend does no analysis yet.
    const stopMock = startMockStream((e) => {
      if (e.type === 'chat') return; // superseded by the live stream above
      setStarted(true);
      if (e.type === 'insight') {
        setInsight(e);
        setHistory((h) => {
          const t = Math.round((Date.now() - startRef.current) / 1000);
          const next = [...h, { t, hype: e.hype, spike: e.spike }];
          return next.length > HISTORY_MS / 2000 ? next.slice(-HISTORY_MS / 2000) : next;
        });
      } else if (e.type === 'action') {
        setActions((a) => {
          const prev = a[e.id];
          if (prev && (prev.status === 'dismissed' || prev.status === 'closed')) return a;
          return { ...a, [e.id]: e };
        });
      } else if (e.type === 'result') {
        setResults((r) => ({ ...r, [e.action_id]: e }));
        setActions((a) =>
          a[e.action_id] ? { ...a, [e.action_id]: { ...a[e.action_id], status: 'closed' } } : a,
        );
      }
    });
    return () => {
      stopChat();
      stopMock();
    };
  }, []);

  const closeWithResult = (action: ActionEvent) => {
    const votes: Record<string, number> = {};
    let total = 0;
    for (const o of action.options) {
      votes[o] = 10 + Math.floor(Math.random() * 40);
      total += votes[o];
    }
    void total;
    const result: ActionResult = {
      type: 'result',
      action_id: action.id,
      state: action.state,
      arm: action.kind,
      votes,
      engagement_delta: Math.round((0.1 + Math.random() * 0.35) * 100) / 100,
      reward: Math.round(Math.random() * 100) / 100,
      lift_naive: Math.round((0.1 + Math.random() * 0.5) * 100) / 100,
      outcome: 'fired',
    };
    setResults((r) => ({ ...r, [action.id]: result }));
    setActions((a) => ({ ...a, [action.id]: { ...action, status: 'closed' } }));
  };

  const handleSend = (id: string) => {
    const action = actions[id];
    if (!action || action.status !== 'suggested') return;
    setActions((a) => ({ ...a, [id]: { ...action, status: 'live' } }));
    // mock: poll closes itself after ~14s with a result
    setTimeout(() => closeWithResult({ ...action, status: 'live' }), 14000);
  };

  const handleDismiss = (id: string) => {
    setActions((a) => (a[id] ? { ...a, [id]: { ...a[id], status: 'dismissed' } } : a));
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] p-3">
      {SIMULATOR_UI && (
        <div className="mb-3 shrink-0">
          <SimulatorPanel />
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_2fr_1fr] gap-3">
      <div className="min-h-0">
        <ActionFeed
          actions={Object.values(actions)}
          results={results}
          onSend={handleSend}
          onDismiss={handleDismiss}
        />
      </div>
      <div className="min-h-0">
        <CenterPanel insight={insight} history={history} started={started} />
      </div>
      <div className="min-h-0">
        <ChatPanel messages={messages} spike={insight?.spike ?? false} />
      </div>
      </div>
    </div>
  );
}
