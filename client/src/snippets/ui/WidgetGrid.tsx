import { useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, Check, LayoutGrid } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import Widget from './Widget';
import { useWidgetLayout } from '../hooks/useWidgetLayout';

const Grid = WidthProvider(RGL);

export type WidgetDef = {
  id: string;
  /** shown in the "+ Widgets" menu; header title falls back to this */
  title: string;
  /** header label rendered inside the widget (omit for a bare header) */
  header?: string;
  icon?: React.ReactNode;
  node: React.ReactNode;
};

/**
 * AWS-console-style dashboard: draggable, resizable, hideable widgets with a
 * "+ Widgets" checklist menu. Layout and hidden set are managed internally
 * (see useWidgetLayout if you need to own that state, e.g. to persist it).
 *
 * NOTE: react-draggable reads process.env.DRAGGABLE_DEBUG — Vite needs
 * `define: { 'process.env.DRAGGABLE_DEBUG': 'undefined' }` or dragging throws.
 */
export default function WidgetGrid({
  title,
  widgets,
  defaultLayout,
  frameStyle,
}: {
  title: string;
  widgets: WidgetDef[];
  defaultLayout: Layout[];
  frameStyle?: React.CSSProperties;
}) {
  const { visibleLayout, hidden, toggleWidget, onLayoutChange } = useWidgetLayout(defaultLayout);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] transition-colors duration-500"
      style={frameStyle}
    >
      <div className="relative flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <LayoutGrid size={12} className="text-[var(--text-secondary)]" />
        <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">{title}</span>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        >
          <Plus size={11} /> Widgets
        </button>
        {menuOpen && (
          <div className="absolute right-3 top-9 z-20 w-52 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-lg">
            {widgets.map((w) => {
              const visible = !hidden.has(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => toggleWidget(w.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-base)]"
                >
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded border"
                    style={{
                      borderColor: visible ? 'var(--kick-green)' : 'var(--border)',
                      background: visible ? 'var(--kick-green)' : 'transparent',
                    }}
                  >
                    {visible && <Check size={10} className="text-black" />}
                  </span>
                  {w.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Grid
          layout={visibleLayout}
          cols={12}
          rowHeight={30}
          margin={[10, 10]}
          draggableHandle=".widget-handle"
          compactType="vertical"
          onLayoutChange={onLayoutChange}
        >
          {widgets
            .filter((w) => !hidden.has(w.id))
            .map((w) => (
              <div key={w.id}>
                <Widget title={w.header} icon={w.icon} onHide={() => toggleWidget(w.id)}>
                  {w.node}
                </Widget>
              </div>
            ))}
        </Grid>
      </div>
    </div>
  );
}
