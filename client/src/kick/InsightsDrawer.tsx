// The Insights drawer — live mode (prototype variant F) rehoused as a floating,
// user-positioned panel over the Kick dashboard, wearing Kick's own panel header.
//
// Two things it is not: it is not a dock (nothing reserves a column for "nothing
// needed"), and it is not modal (chat stays readable underneath). The streamer
// parks it once — over the stream preview by default — and the position persists.
//
// Analytics and Tactics do not live here. One glance holds one thing, so the header's
// popout is the door to the full surface: `?insights` in a new tab.
import { ExternalLink, LineChart, Minus, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import LivePanel from "../components/LivePanel"
// The hook's return, not bare `GambitState` — the drawer owns the Send/Dismiss decision.
import type { useGambit } from "../useGambit"

const WIDTH = 360
/** Above Kick's own chrome (its sticky nav is z-402) — a drawer parked near the top
 *  of the screen would otherwise lose its grab handle behind the navbar. */
const Z = "z-[500]"
const KEY = "gambit.insights.drawer"
/** How long a suggestion waits before it skips itself. Demo pacing, not the design's
 *  reasoning — [008](.wayfinder/tickets/008-surfaces-attention-budget.md) argued the
 *  window should be the cooldown, since a lull is a minutes-long condition and a streamer
 *  mid-match glances about twice a minute. One constant, one line to put it back. */
const EXPIRY_MS = 5_000

type Pos = { x: number; y: number }

/**
 * The viewport, or null when it cannot be measured — an embedded/offscreen host can
 * report 0, and clamping against 0 silently pins the drawer to the corner and then
 * persists that as the streamer's chosen position.
 */
function viewport(): { w: number; h: number } | null {
  const w = window.innerWidth || document.documentElement.clientWidth
  const h = window.innerHeight || document.documentElement.clientHeight
  return w > 0 && h > 0 ? { w, h } : null
}

/** Keep the header grabbable no matter how the window was resized since. */
function clamp(p: Pos, height: number): Pos {
  const v = viewport()
  if (!v) return p
  const maxX = Math.max(8, v.w - WIDTH - 8)
  const maxY = Math.max(8, v.h - height - 8)
  return {
    x: Math.min(Math.max(8, p.x), maxX),
    y: Math.min(Math.max(8, p.y), maxY),
  }
}

/** Default parking spot: top-right of the stream preview, which is where the eye is. */
function initialPos(): Pos {
  const stored = localStorage.getItem(KEY)
  if (stored) {
    try {
      const p = JSON.parse(stored) as Pos
      if (typeof p.x === "number" && typeof p.y === "number")
        return clamp(p, 200)
    } catch {
      /* ignore a corrupt entry and fall through to the default */
    }
  }
  const v = viewport()
  return clamp({ x: v ? v.w * 0.42 : 560, y: 220 }, 200)
}

export default function InsightsDrawer({
  s,
}: {
  s: ReturnType<typeof useGambit>
}) {
  const [pos, setPos] = useState<Pos>(initialPos)
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** Fraction of the suggestion's life left, 1 → 0. Null when nothing is pending. */
  const [left, setLeft] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Grab offset within the header, so the card does not jump to the cursor on mousedown.
  const grab = useRef<Pos>({ x: 0, y: 0 })

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Let the header's buttons be buttons.
    if ((e.target as HTMLElement).closest("button")) return
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    grab.current = { x: e.clientX - box.left, y: e.clientY - box.top }
    setDragging(true)
    e.preventDefault()
  }, [])

  useEffect(() => {
    if (!dragging) return
    const height = ref.current?.offsetHeight ?? 200
    const move = (e: PointerEvent) =>
      setPos(
        clamp(
          { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y },
          height,
        ),
      )
    const up = () => setDragging(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [dragging])

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(pos))
  }, [pos])

  // A window resize can strand the drawer off-screen; pull it back rather than lose it.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => clamp(p, ref.current?.offsetHeight ?? 200))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // EXPIRY — a suggestion is a perishable thing. It gets EXPIRY_MS to be acted on, drains
  // a bar along the drawer's bottom edge while it waits, and skips itself at zero. Skipping
  // is `dismiss`, which is the honest verb: map note 14 says a dismissal updates the
  // streamer-preference counter and never the arm's chat-response posterior, so an
  // unattended suggestion cannot teach the bandit that its tactic failed.
  // `useGambit` rebuilds `decide` on every render, and a busy chat re-renders many times a
  // second — depending on it directly restarted the countdown on every incoming message,
  // so the bar never drained. Held in a ref so the effect keys on the suggestion alone.
  const decideRef = useRef(s.decide)
  decideRef.current = s.decide
  const pendingId = s.pending?.id ?? null
  useEffect(() => {
    if (!pendingId) {
      setLeft(null)
      return
    }
    const started = performance.now()
    setLeft(1)
    let done = false
    const tick = () => {
      const remaining = 1 - (performance.now() - started) / EXPIRY_MS
      if (remaining > 0) {
        setLeft(remaining)
        return
      }
      // The interval is cleared on the next line, but a re-entrant tick before React
      // re-renders would fire a second decide() for the same id.
      if (done) return
      done = true
      setLeft(0)
      clearInterval(id)
      void decideRef.current(pendingId, "dismiss")
    }
    const id = setInterval(tick, 50)
    return () => clearInterval(id)
  }, [pendingId])

  const openFull = () =>
    window.open(`${window.location.pathname}?insights`, "_blank", "noopener")

  return (
    <div
      ref={ref}
      style={{
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        // Two rings and a deep shadow, all in Kick's own palette: the green hairline
        // says "ours", the black one separates us from whichever panel we happen to
        // be parked over. Without them the drawer is `--bg-surface` on `--bg-surface`.
        boxShadow:
          "0 0 0 1px rgba(253, 253, 253, 0.45), 0 0 0 5px rgba(0,0,0,0.55), 0 24px 60px -12px rgba(0,0,0,0.95)",
      }}
      className={`fixed ${Z} flex flex-col overflow-hidden rounded-sm bg-[var(--bg-elevated)]`}
    >
      <header
        onPointerDown={onPointerDown}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        className="flex h-[52px] shrink-0 select-none items-center gap-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4"
      >
        <span className="shrink-0">
          <LineChart size={14} />
        </span>
        <h2 className="truncate text-base font-semibold text-white">
          Insights
        </h2>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            aria-label={collapsed ? "Expand Insights" : "Collapse Insights"}
            title={collapsed ? "Expand Insights" : "Collapse Insights"}
            onClick={() => setCollapsed((c) => !c)}
            className="flex size-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
          >
            {collapsed ? <Plus size={13} /> : <Minus size={13} />}
          </button>
          <button
            aria-label="Open Insights in a full tab"
            title="Open Insights in a full tab"
            onClick={openFull}
            className="flex size-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <LivePanel s={s} onDecide={s.decide} docked />
          <button
            onClick={openFull}
            className="self-start text-[10px] text-[var(--text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--text-secondary)]"
          >
            {s.results.length
              ? `${s.results.length} closed window${s.results.length === 1 ? "" : "s"} — open analytics`
              : "open analytics & tactics"}
          </button>
        </div>
      )}

      {/* The countdown, as the drawer's bottom border — it reads as the card draining
          rather than as a widget, and it stays visible when the drawer is collapsed,
          which is exactly when the streamer needs to know a decision is expiring. */}
      {left !== null && (
        <div
          role="timer"
          aria-label="Suggestion expires"
          className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40"
        >
          <div
            className="h-full bg-[var(--kick-green)]"
            style={{ width: `${Math.max(0, left) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
