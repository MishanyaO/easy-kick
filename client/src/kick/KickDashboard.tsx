import { useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import Nav from './Nav';
import Sidebar from './Sidebar';
import Panel, { PanelButton } from './Panel';
import SessionInfo from './SessionInfo';
import StreamPreview from './StreamPreview';
import StreamInfo from './StreamInfo';
import ChannelActions from './ChannelActions';
import ChatComposer from './ChatComposer';
import IconRail from './IconRail';
import ActivityFeed from './ActivityFeed';
import Insights from './Insights';
import Chat from '../components/Chat';
import { useGambit } from '../useGambit';
import { useGymControls } from './useGymControls';

/**
 * Gambit rehoused in a replica of dashboard.kick.com/stream.
 *
 * Kick's layout is three columns plus a right-hand icon rail. Panels are
 * `--bg-surface` cards floating on a black page with 4px gutters, all measured
 * off the live dashboard.
 *
 * Kick's own Mod Actions panel shipped empty — no moderation data, no reason to keep it —
 * so ours, `Insights`, sits in that slot instead: a mini graph plus whatever needs the
 * streamer's attention now (a pending approval, chat_digest cards). Analytics and Tactics
 * live one click away via its popout (`?insights`). The live poll tally lives in Chat's
 * own pinned-banner slot, not here. Activity Feed, Session Info and Chat carry the rest of
 * the live data; Channel Actions and the rail are inert Kick chrome.
 */
export default function KickDashboard() {
  const s = useGambit();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const gym = useGymControls(s.reset);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-page)]">
      <Nav sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} />

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,50fr)_minmax(0,30fr)_minmax(0,20fr)] grid-rows-[minmax(0,1fr)] gap-1 overflow-hidden bg-[var(--bg-page)] p-1">
          {/* Flex, not grid rows: `auto` rows squeeze below their content when
              the column overflows, and a squeezed panel clips its own header. */}
          <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
            <div className="shrink-0">
              <SessionInfo s={s} live={gym.status === 'running'} speed={gym.speed} />
            </div>

            {/* Aspect, not a fixed height — a short wide box crops the banner. */}
            <div className="aspect-[16/9] max-h-[520px] shrink-0">
              <StreamPreview gymOn={gym.status === 'running'} />
            </div>

            {/* Kick's own bottom row, but the right half is ours now: Insights in the
                slot Mod Actions used to occupy. */}
            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-1 overflow-hidden">
              <ActivityFeed s={s} />
              <Insights s={s} onDecide={s.decide} />
            </div>
          </div>

          <Panel
            title="Chat"
            icon={<MessageSquare size={13} />}
            bodyClassName="flex flex-col"
            actions={
              <>
                <span
                  className="mr-1.5 size-2 rounded-full transition-colors duration-300"
                  title={s.connected ? 'Connected' : 'Disconnected'}
                  style={{ background: s.connected ? 'var(--kick-green)' : 'var(--danger)' }}
                />
                <span className="tnum mr-1 text-xs text-[var(--text-muted)]">{s.chat.length}</span>
                <PanelButton label="Popout Chat">
                  <ExternalLink size={13} />
                </PanelButton>
              </>
            }
          >
            <div className="min-h-0 flex-1">
              <Chat
                messages={s.chat}
                lastBot={s.lastBot}
                participation={s.context?.participation}
                viewers={s.context?.viewer_count}
                poll={s.poll}
                closedPoll={s.closedPoll}
                onDismissPoll={s.dismissPoll}
                frameless
              />
            </div>
            <ChatComposer />
          </Panel>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1">
            <StreamInfo gym={gym} />
            <ChannelActions />
          </div>
        </main>

        <div className="shrink-0 py-1 pr-1">
          <IconRail />
        </div>
      </div>
    </div>
  );
}
