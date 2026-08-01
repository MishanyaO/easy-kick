import { KickMarkIcon, MenuIcon } from './icons';
import KickLogo from './KickLogo';
import Avatar from './Avatar';

/** Kick's dashboard top bar. The hamburger toggles the sidebar; the rest is decorative. */
export default function Nav({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <nav
      className="sticky top-0 z-[402] flex h-[var(--navbar-height)] shrink-0 items-center justify-between bg-[var(--bg-base)] pl-3 pr-10"
      style={{ boxShadow: '0px 2px 4px 0px rgba(0, 0, 0, 0.2)' }}
    >
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar-wrapper"
          className="flex size-10 shrink-0 items-center justify-center rounded text-white transition-colors hover:bg-[var(--bg-elevated)] active:scale-95"
        >
          <MenuIcon className="size-4" />
        </button>
        <a href="/stream" title="Home" className="flex shrink-0 items-center">
          <KickLogo />
        </a>
      </div>

      <div className="flex items-center gap-5">
        <button className="flex h-9 items-center gap-1.5 rounded bg-[var(--kick-green)] px-2 text-sm font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--kick-green-dim)] active:scale-[0.98]">
          <KickMarkIcon className="size-4" />
          Go live
        </button>
        <button className="shrink-0 rounded-full ring-2 ring-[var(--kick-green)]">
          <Avatar name="User Name" className="size-8" />
        </button>
      </div>
    </nav>
  );
}
