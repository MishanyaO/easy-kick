import { useEffect, useRef, type RefObject } from 'react';

/**
 * Auto-scrolls a container to the bottom when `dep` changes — but only if the
 * user is already near the bottom. Scrolling up pauses it; returning to the
 * bottom re-engages. Returns [ref, onScroll].
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  dep: unknown,
  thresholdPx = 40,
): [RefObject<T>, () => void] {
  const ref = useRef<T>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
  };

  return [ref, onScroll];
}
