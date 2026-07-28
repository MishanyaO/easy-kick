import { useEffect, useState } from "react"
import { ChevronRight, ExternalLink, Wrench } from "lucide-react"
import Panel, { PanelButton } from "./Panel"
import { controller } from "../useGambit"
import type { Arm, Autonomy } from "../types"

type Row = {
  label: string
  kind?: "chevron" | "toggle" | "external"
  value?: string
  on?: boolean
  muted?: boolean
  /** Real arm this toggle drives — turning it off sets autonomy to `off`; turning it
   *  back on restores whichever non-off value the arm actually defaults to. */
  arm?: Arm
}

const OURS = 3

// What each arm's toggle restores to when turned back on — its real backend default.
const ON_VALUE: Partial<Record<Arm, Autonomy>> = {
  emote_rally: "ask",
  chat_poll: "ask",
  quiz: "ask",
  chat_digest: "auto",
}

const SECTIONS: { heading: string; rows: Row[] }[] = [
  {
    heading: "Gambit",
    rows: [
      { label: "Suggestions", kind: "toggle", on: true },
      { label: "Autonomy", kind: "chevron", value: "Ask first" },
      { label: "Cooldown", kind: "chevron", value: "90s" },
      { label: "Quiet hours", kind: "chevron", value: "Off" },
    ],
  },
  {
    heading: "Tactics",
    rows: [
      { label: "Emote rally", kind: "toggle", on: true, arm: "emote_rally" },
      { label: "Chat poll", kind: "toggle", on: true, arm: "chat_poll" },
      { label: "Quiz", kind: "toggle", on: true, arm: "quiz" },
      { label: "Chat digest", kind: "toggle", on: true, arm: "chat_digest" },
      { label: "Prediction", muted: true },
    ],
  },
  {
    heading: "Chat rewards",
    rows: [
      { label: "XP for votes", kind: "chevron", value: "10 XP" },
      { label: "XP for first message", kind: "chevron", value: "25 XP" },
      { label: "Quest drops", kind: "toggle", on: true },
      { label: "Level badges", kind: "chevron" },
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

/** Kick's channel settings list, for chrome only, plus our Gambit pre-set — "Suggestions"
 *  and the Tactics toggles actually drive the controller (`GET`/`PUT /controller/autonomy`).
 *  Everything below "Tactics" is inert Kick chrome; nothing there is ours to wire up. */
export default function ChannelActions() {
  const [enabled, setEnabled] = useState(true)
  const [autonomy, setAutonomy] = useState<Partial<Record<Arm, Autonomy>>>({})

  useEffect(() => {
    void controller
      .policy()
      .then((p) => {
        setEnabled(p.enabled)
        setAutonomy(p.autonomy)
      })
      .catch(() => undefined)
  }, [])

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

  const isOn = (r: Row): boolean => {
    if (r.label === "Suggestions") return enabled
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
            const wired = r.label === "Suggestions" || !!r.arm
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
                      onClick={wired ? () => (r.arm ? toggleArm(r.arm) : toggleSuggestions()) : undefined}
                      disabled={!wired}
                    >
                      <Toggle on={on} />
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </Panel>
  )
}
