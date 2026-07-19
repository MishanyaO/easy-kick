import { useState } from 'react';
import type { Layout } from 'react-grid-layout';

/**
 * State for a draggable/resizable widget dashboard (react-grid-layout):
 * current layout (preserved per widget, even while hidden) and the set of
 * hidden widget ids.
 */
export function useWidgetLayout(defaultLayout: Layout[]) {
  const [layout, setLayout] = useState<Layout[]>(defaultLayout);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggleWidget = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleLayout = layout.filter((l) => !hidden.has(l.i));

  /** Pass to RGL's onLayoutChange — merges visible positions back with hidden widgets' saved ones. */
  const onLayoutChange = (l: Layout[]) =>
    setLayout((prev) => [...l, ...prev.filter((p) => hidden.has(p.i))]);

  return { layout, visibleLayout, hidden, toggleWidget, onLayoutChange };
}
