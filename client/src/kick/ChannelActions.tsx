import { useEffect, useState } from "react"
import { ChevronRight, ExternalLink, Wrench } from "lucide-react"
import Panel, { PanelButton } from "./Panel"
import { controller } from "../useGambit"
import { ARM_LABEL, ARM_XP, type Arm, type Autonomy, type Mode } from "../types"

type Row = {
  label: string
  kind?: "chevron" | "toggle" | "external"
  value?: string
  on?: boolean
  muted?: boolean
  /** Real arm this toggle drives — turning it off sets autonomy to `off`; turning it
   *  back on restores whichever non-off value the arm actually defaults to. */
  arm?: Arm
  /** Drives `rewards_enabled` — whether closed windows pay participation XP into chat. */
  rewards?: boolean
}

const OURS = 3

// Manual fire-rate sliders live here instead of on/off toggles — in `manual` each arm
// fires at the rate you set and the bandit never runs; in `auto` these are ignored.
const RATE_ARMS: Arm[] = ["emote_rally", "chat_poll", "quiz"]
const RATE_LABEL: Record<string, string> = {
  emote_rally: "Emote rally",
  chat_poll: "Chat poll",
  quiz: "Quiz",
}

// What each toggle-driven arm restores to when turned back on — its real backend default.
const ON_VALUE: Partial<Record<Arm, Autonomy>> = {
  chat_digest: "auto",
  prediction: "ask",
}

const SECTIONS: { heading: string; rows: Row[] }[] = [
  {
    heading: "Gambit",
    rows: [
      { label: "Suggestions", kind: "toggle", on: true },
      { label: "Auto approve", kind: "toggle" },
      { label: "Cooldown", kind: "chevron", value: "90s" },
      { label: "Quiet hours", kind: "chevron", value: "Off" },
    ],
  },
  {
    heading: "Tactics",
    rows: [
      { label: "Chat digest", kind: "toggle", on: true, arm: "chat_digest" },
      {
        label: "Prediction",
        kind: "toggle",
        value: "Approval required",
        arm: "prediction",
      },
    ],
  },
  {
    // Ours, and real. This section used to be Kick chrome inventing its own numbers
    // ("XP for votes — 10 XP", "Quest drops"), which was harmless while nothing paid out
    // XP and became a lie the moment something did: a streamer reading it would think
    // those rows were the rates, sitting one panel away from the rates that actually are.
    // The rate rows are read straight off `ARM_XP`, so they cannot drift from the server.
    heading: "Chat rewards",
    rows: [
      { label: "Post rewards to chat", kind: "toggle", rewards: true },
      ...(Object.keys(ARM_XP) as Arm[])
        .sort((a, b) => (ARM_XP[a] ?? 0) - (ARM_XP[b] ?? 0))
        .map((arm): Row => ({
          label: ARM_LABEL[arm],
          kind: "chevron",
          value: `+${ARM_XP[arm]} XP`,
        })),
    ],
  },
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

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 ${
        on
          ? "justify-end bg-[var(--kick-green)]"
          : "justify-start bg-[var(--bg-elevated)]"
      }`}
    >
      <span className="size-3 rounded-full bg-white" />
    </span>
  )
}

/** Kick's channel settings list, for chrome only, plus our Gambit pre-set — "Suggestions",
 *  "Auto approve", the mode switch and per-arm rate sliders, the "Chat digest" toggle and
 *  "Post rewards to chat" actually drive the controller (`GET`/`PUT /controller/autonomy`).
 *  Everything below "Chat rewards" is inert Kick chrome; nothing there is ours to wire up. */
export default function ChannelActions() {
  const [enabled, setEnabled] = useState(true)
  const [autonomy, setAutonomy] = useState<Partial<Record<Arm, Autonomy>>>({})
  const [mode, setMode] = useState<Mode>("auto")
  const [rates, setRates] = useState<Partial<Record<Arm, number>>>({})
  const [rewards, setRewards] = useState(true)

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

  // Same discipline as the rest of these: the server's answer sets the switch, so a
  // rejected request leaves it showing what is actually true.
  const toggleRewards = () => {
    void controller
      .setAutonomy({ rewards_enabled: !rewards })
      .then((p) => setRewards(p.rewards_enabled))
      .catch(() => undefined)
  }

  // Set from the server's response, not optimistically — a rejected or CORS-blocked
  // request should leave the toggle showing what's actually true, not what we hoped.
  const toggleSuggestions = () => {
    const next = !enabled
    void controller
      .setAutonomy({ enabled: next })
      .then((p) => setEnabled(p.enabled))
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

  const isOn = (r: Row): boolean => {
    if (r.label === "Suggestions") return enabled
    if (r.label === "Auto approve") return autoApproveOn
    if (r.rewards) return rewards
    if (r.arm) return autonomy[r.arm] !== "off"
    return !!r.on
  }

  return (
    <Panel
      title="Channel Actions"
      icon={<Wrench size={13} />}
      actions={
        <PanelButton label="Popout Channel Actions">
          <ExternalLink size={13} />
        </PanelButton>
      }
      bodyClassName="overflow-y-auto px-3 py-2"
    >
      {SECTIONS.map((s, i) => (
        <div key={s.heading} className="mb-1">
          <h3
            className={`py-2 text-sm font-semibold ${
              i < OURS ? "text-[var(--kick-green)]" : "text-white"
            }`}
          >
            {s.heading}
          </h3>
          {s.rows.map((r) => {
            const on = isOn(r)
            const wired =
              r.label === "Suggestions" ||
              r.label === "Auto approve" ||
              !!r.arm ||
              !!r.rewards
            return (
              <div
                key={r.label}
                className="flex h-8 items-center justify-between border-b border-[var(--border)] text-sm last:border-b-0"
              >
                <span
                  className={
                    r.muted
                      ? "text-[var(--text-muted)]"
                      : "text-[var(--text-secondary)]"
                  }
                >
                  {r.label}
                </span>
                <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  {r.value && <span className="text-xs">{r.value}</span>}
                  {r.kind === "chevron" && <ChevronRight size={14} />}
                  {r.kind === "external" && <ExternalLink size={12} />}
                  {r.kind === "toggle" && (
                    <button
                      type="button"
                      aria-label={`Toggle ${r.label}`}
                      onClick={
                        wired
                          ? () => {
                              if (r.rewards) return toggleRewards()
                              if (r.arm) return toggleArm(r.arm)
                              if (r.label === "Auto approve") return toggleAutoApprove()
                              return toggleSuggestions()
                            }
                          : undefined
                      }
                      disabled={!wired}
                    >
                      <Toggle on={on} />
                    </button>
                  )}
                </span>
              </div>
            )
          })}
          {s.heading === "Tactics" && (
            <div className="space-y-3 border-b border-[var(--border)] py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Mode</span>
                <div className="flex gap-1 rounded-md border border-[var(--border)] p-0.5">
                  {(["manual", "auto"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModeAndSave(m)}
                      className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${
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
              <div className={`space-y-3 ${mode === "auto" ? "opacity-40" : ""}`}>
                {RATE_ARMS.map((arm) => (
                  <div key={arm}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{RATE_LABEL[arm]}</span>
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
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </Panel>
  )
}
