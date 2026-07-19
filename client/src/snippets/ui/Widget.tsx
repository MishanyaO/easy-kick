import { GripVertical, EyeOff } from 'lucide-react';

/**
 * Shell for one dashboard widget: drag-grip header (class `widget-handle` —
 * the react-grid-layout draggableHandle), optional title, hover-revealed
 * hide button.
 */
export default function Widget({
  title,
  icon,
  children,
  onHide,
}: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onHide?: () => void;
}) {
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
      <div className="widget-handle flex cursor-grab items-center gap-1.5 px-2.5 py-1.5 active:cursor-grabbing">
        <GripVertical size={11} className="text-[var(--text-muted)]" />
        {title && (
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
            {icon}
            {title}
          </span>
        )}
        {onHide && (
          <button
            onClick={onHide}
            onMouseDown={(e) => e.stopPropagation()}
            title="Hide widget"
            className="ml-auto rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
          >
            <EyeOff size={11} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">{children}</div>
    </div>
  );
}
