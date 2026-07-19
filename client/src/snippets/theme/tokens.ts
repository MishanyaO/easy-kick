/**
 * Design tokens for JS contexts (canvas, chart libs that can't resolve
 * CSS variables in every prop, inline style objects).
 *
 * Prefer `var.*` (CSS variable references, theme-aware). Use `hex.*`
 * only where a raw colour is mandatory. Never invent new values here —
 * mirror tokens.css exactly.
 */
export const vars = {
  green: 'var(--kick-green)',
  greenDim: 'var(--kick-green-dim)',
  bgBase: 'var(--bg-base)',
  bgSurface: 'var(--bg-surface)',
  bgElevated: 'var(--bg-elevated)',
  border: 'var(--border)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  danger: 'var(--danger)',
  warn: 'var(--warn)',
} as const;

export const hex = {
  green: '#53FC18',
  greenDim: '#3fbf13',
  bgBase: '#0b0e0f',
  bgSurface: '#131718',
  bgElevated: '#1c2123',
  border: '#262c2e',
  textPrimary: '#ffffff',
  textSecondary: '#a3a8a6',
  textMuted: '#6b7270',
  danger: '#ff4d4d',
  warn: '#ffb020',
} as const;

/** Common class recipes so snippets compose consistently. */
export const cx = {
  /** Widget/card frame */
  card: 'rounded-lg border border-[var(--border)] bg-[var(--bg-base)]',
  /** Panel frame (outer columns) */
  panel: 'rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]',
  /** Uppercase micro label above a metric or section */
  microLabel: 'text-[10px] font-semibold tracking-widest text-[var(--text-muted)]',
  /** Primary CTA (kick green — always dark text on top) */
  buttonPrimary:
    'rounded-md px-3 py-1.5 text-xs font-bold text-black bg-[var(--kick-green)] hover:bg-[var(--kick-green-dim)] transition-colors',
  /** Quiet secondary action */
  buttonGhost:
    'rounded-md px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors',
  /** Neutral chip (topics, options) */
  chip: 'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]',
} as const;
