import {
  Info,
  Pencil,
  MonitorPlay,
  Zap,
  FileText,
  MessageSquare,
  Radio,
  Video,
  Wrench,
} from 'lucide-react';

// The two icons at the top are plain (the second reads as selected); the rest
// are outlined in green, marking panels that are currently open.
const PLAIN_TOP = [
  { Icon: Info, label: 'Stream info', selected: false },
  { Icon: Pencil, label: 'Edit stream info', selected: true },
];
const OUTLINED = [
  { Icon: MonitorPlay, label: 'Stream preview' },
  { Icon: Zap, label: 'Activity feed' },
  { Icon: FileText, label: 'Mod actions' },
  { Icon: MessageSquare, label: 'Chat' },
  { Icon: Radio, label: 'Session info' },
  { Icon: Video, label: 'Clips' },
  { Icon: Wrench, label: 'Channel actions' },
];

/** The panel-toggle rail down Kick's right edge. Decorative. */
export default function IconRail() {
  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center gap-4 overflow-y-auto rounded-sm bg-[var(--bg-surface)] py-3">
      {PLAIN_TOP.map(({ Icon, label, selected }) => (
        <button
          key={label}
          aria-label={label}
          title={label}
          className={`flex size-10 shrink-0 items-center justify-center rounded-sm text-white transition-colors hover:bg-[var(--bg-elevated)] ${
            selected ? 'bg-[var(--bg-elevated)]' : ''
          }`}
        >
          <Icon size={18} />
        </button>
      ))}

      {OUTLINED.map(({ Icon, label }) => (
        <button
          key={label}
          aria-label={label}
          title={label}
          className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-[var(--kick-green)] text-white transition-colors hover:bg-[var(--kick-green)] hover:text-[var(--on-primary)]"
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
