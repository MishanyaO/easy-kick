import { useEffect, useRef, useState } from "react"
import { ChevronRight, ExternalLink, Settings, Wrench, X } from "lucide-react"
import Panel, { PanelButton } from "./Panel"
import { controller } from "../useGambit"
import { ARM_LABEL, ARM_XP, type Arm, type Autonomy, type Mode } from "../types"

/**
 * Kick's channel settings list, with ours behind a gear in its header.
 *
 * The two used to be one scroll: our live rails sat in the same column as Kick's chat
 * settings, so the handful of controls that actually do something were mixed in among a
 * dozen that are painted on, and every one of ours cost a scroll to reach.
 *
 * They split by how they are used, not by who owns them. Kick's rows are what this panel is
 * — a settings surface a streamer recognises, and the reason the column is not a hole — and
 * they stay. Ours are opened, changed once, and closed, which is a dialog.
 */

type Row = {
  label: string
  kind?: "chevron" | "toggle" | "external"
  value?: string
  on?: boolean
  muted?: boolean
}

/** Kick's own, and inert: there is no moderation backend behind any of it. Left as chrome
 *  because the replica is the point — a streamer opening this panel on our dashboard should
 *  find what they would find on theirs. Nothing here claims to be ours. */
const SECTIONS: { heading: string; rows: Row[] }[] = [
  {
    heading: "Chat access",
    rows: [
      { label: "Account age", kind: "chevron", value: "Off" },
      { label: "Followers only", kind: "chevron", value: "Off" },
      { label: "Subscribers only", kind: "toggle", on: false },
    ],
  },
  {
    heading: "Chat options",
    rows: [
      { label: "Emotes only", kind: "toggle", on: false },
      { label: "Slow mode", kind: "chevron", value: "Off" },
      { label: "Banned words", kind: "chevron" },
      { label: "AI Chat Moderation", kind: "external" },
    ],
  },
  {
    heading: "Channel options",
    rows: [
      { label: "Show view count", kind: "toggle", on: true },
      { label: "Raid Channel", muted: true },
      { label: "Set goals", kind: "chevron" },
    ],
  },
]

// Manual fire-rate sliders, not on/off toggles — in `manual` each arm fires at the rate you
// set and the bandit never runs; in `auto` these are ignored entirely.
const RATE_ARMS: Arm[] = ["emote_rally", "chat_poll", "quiz"]

// What each toggle-driven arm restores to when turned back on — its real backend default.
const ON_VALUE: Partial<Record<Arm, Autonomy>> = {
  chat_digest: "auto",
  prediction: "ask",
}

/** Arms that pay participation XP, cheapest effort first. */
const PAYING_ARMS = (Object.keys(ARM_XP) as Arm[]).sort(
  (a, b) => (ARM_XP[a] ?? 0) - (ARM_XP[b] ?? 0),
)

/** Kick's pill switch. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        on
          ? "justify-end bg-[var(--kick-green)]"
          : "justify-start bg-[var(--bg-elevated)]"
      }`}
    >
      <span className="size-3 rounded-full bg-white" />
    </span>
  )
}

/** One switchable rail. The whole row is the hit target — a 16px pill is a poor one. */
function ToggleRow({
  label,
  hint,
  on,
  onClick,
}: {
  label: string
  hint?: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[var(--border)] py-2 text-left last:border-b-0 hover:bg-white/[0.03]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[var(--text-secondary)]">{label}</span>
        {hint && (
          <span className="block text-[11px] text-[var(--text-muted)]">{hint}</span>
        )}
      </span>
      <Toggle on={on} />
    </button>
  )
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="py-2 text-sm font-semibold text-[var(--kick-green)]">{heading}</h3>
      {children}
    </section>
  )
}

/**
 * The panel, plus the gear that opens ours.
 *
 * The dialog owns its own data: the policy is only fetched once the gear has been used, so a
 * dashboard nobody opened the settings on makes no request for them.
 */
export default function ChannelActions() {
  const [open, setOpen] = useState(false)

  return (
    <Panel
      title="Channel Actions"
      icon={<Wrench size={13} />}
      actions={
        <>
          {/* Ours. Sits in the header of the panel it used to be buried in, so it is
              findable from the surface a streamer already associates with settings. */}
          <PanelButton
            label="Gambit settings"
            onClick={() => setOpen(true)}
            active={open}
          >
            <Settings size={13} />
          </PanelButton>
          <PanelButton label="Popout Channel Actions">
            <ExternalLink size={13} />
          </PanelButton>
        </>
      }
      bodyClassName="overflow-y-auto px-3 py-2"
    >
      {SECTIONS.map((s) => (
        <div key={s.heading} className="mb-1">
          <h3 className="py-2 text-sm font-semibold text-white">{s.heading}</h3>
          {s.rows.map((r) => (
            <div
              key={r.label}
              className="flex h-8 items-center justify-between border-b border-[var(--border)] text-sm last:border-b-0"
            >
              <span
                className={
                  r.muted ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"
                }
              >
                {r.label}
              </span>
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                {r.value && <span className="text-xs">{r.value}</span>}
                {r.kind === "chevron" && <ChevronRight size={14} />}
                {r.kind === "external" && <ExternalLink size={12} />}
                {r.kind === "toggle" && <Toggle on={!!r.on} />}
              </span>
            </div>
          ))}
        </div>
      ))}

      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </Panel>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(true)
  const [autonomy, setAutonomy] = useState<Partial<Record<Arm, Autonomy>>>({})
  const [mode, setMode] = useState<Mode>("auto")
  const [rates, setRates] = useState<Partial<Record<Arm, number>>>({})
  const [rewards, setRewards] = useState(true)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void controller
      .policy()
      .then((p) => {
        setEnabled(p.enabled)
        setAutonomy(p.autonomy)
        setRewards(p.rewards_enabled ?? true)
        if (p.mode) setMode(p.mode)
        if (p.fire_rate) setRates((r) => ({ ...r, ...p.fire_rate }))
      })
      .catch(() => undefined)
  }, [])

  // Escape closes, and focus starts inside the dialog rather than wherever the gear left it.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Set from the server's response, not optimistically — a rejected or CORS-blocked
  // request should leave the switch showing what's actually true, not what we hoped.
  const toggleSuggestions = () => {
    void controller
      .setAutonomy({ enabled: !enabled })
      .then((p) => setEnabled(p.enabled))
      .catch(() => undefined)
  }

  const toggleRewards = () => {
    void controller
      .setAutonomy({ rewards_enabled: !rewards })
      .then((p) => setRewards(p.rewards_enabled))
      .catch(() => undefined)
  }

  const toggleArm = (arm: Arm) => {
    const next: Autonomy = autonomy[arm] === "off" ? ON_VALUE[arm] ?? "ask" : "off"
    void controller
      .setAutonomy({ autonomy: { [arm]: next } })
      .then((p) => setAutonomy(p.autonomy))
      .catch(() => undefined)
  }

  // "Auto approve" is a master toggle over the arms that default to `ask` — on fires them
  // without a card, off restores the ask-first behavior. Arms individually set to `off`
  // are left alone; this never turns an off arm on.
  const autoApproveOn = RATE_ARMS.every((arm) => autonomy[arm] !== "ask")
  const toggleAutoApprove = () => {
    const next: Autonomy = autoApproveOn ? "ask" : "auto"
    const patch = Object.fromEntries(
      RATE_ARMS.filter((arm) => autonomy[arm] !== "off").map((arm) => [arm, next]),
    )
    void controller
      .setAutonomy({ autonomy: patch })
      .then((p) => setAutonomy(p.autonomy))
      .catch(() => undefined)
  }

  const setModeAndSave = (next: Mode) => {
    setMode(next)
    void controller.setAutonomy({ mode: next }).catch(() => undefined)
  }

  const setRate = (arm: Arm, value: number) => {
    setRates((r) => ({ ...r, [arm]: value }))
    void controller.setAutonomy({ fire_rate: { [arm]: value } }).catch(() => undefined)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gambit settings"
        // Stop the backdrop's close from firing for clicks inside the sheet.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg-surface)]"
      >
        {/* Same 52px header the panels wear, so the sheet reads as one of them. */}
        <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4">
          <span className="shrink-0 text-white">
            <Settings size={16} />
          </span>
          <h2 className="truncate text-base font-semibold text-white">Gambit settings</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto flex size-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <Section heading="Gambit">
            <ToggleRow
              label="Suggestions"
              hint="the whole loop — off, nothing is decided or sent"
              on={enabled}
              onClick={toggleSuggestions}
            />
            <ToggleRow
              label="Auto approve"
              hint="fire without waiting for a card"
              on={autoApproveOn}
              onClick={toggleAutoApprove}
            />
          </Section>

          <Section heading="Tactics">
            <ToggleRow
              label="Chat digest"
              hint="never posted to chat — a card for you"
              on={autonomy.chat_digest !== "off"}
              onClick={() => toggleArm("chat_digest")}
            />
            <ToggleRow
              label="Prediction"
              hint="stakes viewers' points, so it always asks first"
              on={autonomy.prediction !== "off"}
              onClick={() => toggleArm("prediction")}
            />

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Mode</span>
              <div className="flex gap-1 rounded-md border border-[var(--border)] p-0.5">
                {(["manual", "auto"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModeAndSave(m)}
                    className={`rounded px-2 py-0.5 text-xs font-semibold capitalize transition-colors ${
                      mode === m
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Dimmed rather than hidden in `auto`: a slider that vanishes looks like a bug,
                and the point is that the bandit is deciding this instead of you. */}
            <div className={`mt-3 space-y-3 ${mode === "auto" ? "opacity-40" : ""}`}>
              <p className="text-[11px] text-[var(--text-muted)]">
                {mode === "auto"
                  ? "Thompson sampling sets the rate — these are ignored."
                  : "Fires per minute, per tactic. The bandit never runs in manual."}
              </p>
              {RATE_ARMS.map((arm) => (
                <div key={arm}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">{ARM_LABEL[arm]}</span>
                    <span className="tnum text-xs text-[var(--text-muted)]">
                      {(rates[arm] ?? 0).toFixed(1)} / min
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={rates[arm] ?? 0}
                    disabled={mode === "auto"}
                    onChange={(e) => setRate(arm, Number(e.target.value))}
                    className="w-full accent-[var(--kick-green)]"
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section heading="Chat rewards">
            <ToggleRow
              label="Post rewards to chat"
              hint="one line per closed window, naming who took part"
              on={rewards}
              onClick={toggleRewards}
            />
            {/* Read straight off `ARM_XP`, so the rates here cannot drift from the ones the
                server actually pays. */}
            <dl className="mt-2 space-y-1">
              {PAYING_ARMS.map((arm) => (
                <div key={arm} className="flex items-baseline justify-between text-sm">
                  <dt className="text-[var(--text-muted)]">{ARM_LABEL[arm]}</dt>
                  <dd className="tnum text-xs text-[var(--text-secondary)]">
                    +{ARM_XP[arm]} XP
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  )
}
