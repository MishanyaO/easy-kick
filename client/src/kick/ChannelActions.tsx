import { ChevronRight, ExternalLink, Wrench } from "lucide-react"
import Panel, { PanelButton } from "./Panel"

type Row = {
  label: string
  kind?: "chevron" | "toggle" | "external"
  value?: string
  on?: boolean
  muted?: boolean
}

const OURS = 3

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
      { label: "Emote rally", kind: "toggle", on: true },
      { label: "Chat poll", kind: "toggle", on: true },
      { label: "Quiz", kind: "toggle", on: true },
      { label: "Chat digest", kind: "toggle", on: true },
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

/** Static — Kick's channel settings list plus our Gambit pre-set, for chrome only.
 *  Nothing toggles, on either half. */
export default function ChannelActions() {
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
          {s.rows.map((r) => (
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
                {r.kind === "toggle" && <Toggle on={!!r.on} />}
              </span>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}
