import { useEffect, useState } from 'react';
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
import ModActions from './ModActions';
import InsightsDrawer from './InsightsDrawer';
import Chat from '../components/Chat';
import { useGambit, gym } from '../useGambit';

/**
 * Gambit rehoused in a replica of dashboard.kick.com/stream.
 *
 * Kick's layout is three columns plus a right-hand icon rail. Panels are
 * `--bg-surface` cards floating on a black page with 4px gutters, all measured
 * off the live dashboard.
 *
 * Kick's own panels are reproduced as they ship, Mod Actions included. Our surface
 * is the one thing that is *not* a Kick panel: `InsightsDrawer` floats over the
 * whole dashboard, parked by the streamer over the preview, because the streamer is
 * looking at the preview and not at us. Analytics and Tactics live one click away in
 * the drawer's popout tab (`?insights`). Activity Feed, Session Info and Chat carry
 * the rest of the live data; Mod Actions, Channel Actions and the rail are inert
 * Kick chrome.
 */
export default function KickDashboard() {
  const s = useGambit();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [gymOn, setGymOn] = useState(false);

  useEffect(() => {
    void gym
      .status()
      .then((g) => setGymOn(g.status === 'running'))
      .catch(() => undefined);
  }, []);

  const toggleGym = async () => {
    await (gymOn ? gym.stop() : gym.start(20, 7));
    setGymOn(!gymOn);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-page)]">
      <Nav sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} />

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,50fr)_minmax(0,30fr)_minmax(0,20fr)] gap-1 overflow-hidden bg-[var(--bg-page)] p-1">
          {/* Flex, not grid rows: `auto` rows squeeze below their content when
              the column overflows, and a squeezed panel clips its own header. */}
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            <div className="shrink-0">
              <SessionInfo context={s.context} live={s.connected} />
            </div>

            {/* Aspect, not a fixed height — a short wide box crops the banner. */}
            <div className="aspect-[16/9] max-h-[520px] shrink-0">
              <StreamPreview />
            </div>

            {/* Kick's own bottom row, restored: Activity Feed beside Mod Actions.
                Insights no longer squats in the Mod Actions slot — it floats. */}
            <div className="grid min-h-[420px] flex-1 grid-cols-2 gap-1">
              <ActivityFeed s={s} />
              <ModActions />
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
                frameless
              />
            </div>
            <ChatComposer />
          </Panel>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1">
            <StreamInfo gymOn={gymOn} onToggleGym={() => void toggleGym()} />
            <ChannelActions />
          </div>
        </main>

        <div className="shrink-0 py-1 pr-1">
          <IconRail />
        </div>
      </div>

      {/* Ours, and the only thing on this screen that is: floating, user-parked,
          above the whole dashboard rather than inside one of Kick's slots. */}
      <InsightsDrawer s={s} />
    </div>
  );
}
