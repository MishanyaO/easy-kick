import {
  AchievementsIcon,
  ChevronDownIcon,
  CommunityIcon,
  DropsIcon,
  ModerationIcon,
  RevenueIcon,
  StreamIcon,
  StreamKeyIcon,
  StudioIcon,
  type IconProps,
} from './icons';

type Item = {
  label: string;
  Icon: (p: IconProps) => JSX.Element;
  /** Collapsible groups render a chevron instead of acting as a link. */
  group?: boolean;
};

// Order and labels match dashboard.kick.com/stream.
const ITEMS: Item[] = [
  { label: 'Stream', Icon: StreamIcon },
  { label: 'Stream URL & Key', Icon: StreamKeyIcon },
  { label: 'Revenue', Icon: RevenueIcon },
  { label: 'Achievements', Icon: AchievementsIcon },
  { label: 'Studio', Icon: StudioIcon, group: true },
  { label: 'Moderation', Icon: ModerationIcon },
  { label: 'Community', Icon: CommunityIcon, group: true },
  { label: 'Drops & rewards', Icon: DropsIcon },
];

/**
 * Kick's dashboard sidebar. Decorative — "Stream" is pinned active.
 *
 * Collapsing animates the width to 0 rather than unmounting, so the content
 * area slides open instead of snapping.
 */
export default function Sidebar({ open }: { open: boolean }) {
  return (
    <div
      id="sidebar-wrapper"
      aria-hidden={!open}
      className={`flex shrink-0 flex-col overflow-hidden bg-[var(--bg-base)] py-2 transition-[width] duration-200 ease-out ${
        open ? 'w-[var(--sidebar-width)]' : 'w-0'
      }`}
    >
      <ul className="flex w-[var(--sidebar-width)] shrink-0 flex-col px-2">
        {ITEMS.map(({ label, Icon, group }) => {
          const active = label === 'Stream';
          return (
            <li key={label}>
              <span
                data-state={active ? 'active' : 'inactive'}
                className={`inline-flex h-12 w-full cursor-pointer select-none items-center gap-x-4 rounded px-4 py-1 text-base font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[var(--bg-selected)] text-white'
                    : 'text-white hover:bg-[var(--bg-elevated)]'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
                {group && <ChevronDownIcon className="ml-auto size-3.5 shrink-0" />}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
