import type { ReactNode } from 'react';

/**
 * Kick's panel frame: a 52px header — leading icon, title, trailing icon
 * buttons — over a `--bg-surface` body.
 *
 * Panels float rather than sitting flush: the parent lays them out with `gap-1`
 * over `--bg-page`, so a black gutter shows between them.
 *
 * Does not stretch on its own — pass `className="h-full"` inside a fixed-height
 * container, or it collapses to its header.
 */
export default function Panel({
  title,
  icon,
  actions,
  children,
  bodyClassName = '',
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm bg-[var(--bg-surface)] ${className}`}
    >
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4">
        {icon && <span className="shrink-0 text-white">{icon}</span>}
        <h2 className="truncate text-base font-semibold text-white">{title}</h2>
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** The small icon buttons Kick puts in panel headers. */
export function PanelButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
    >
      {children}
    </button>
  );
}
