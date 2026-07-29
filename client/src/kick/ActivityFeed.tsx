import { ExternalLink, Zap } from 'lucide-react';
import Panel, { PanelButton } from './Panel';
import { labelFor, points, isControl, VERDICT_COLOR, STATE_LABEL } from '../types';
import type { GambitState } from '../useGambit';

/** One row of Kick's activity list: a coloured state chip, a line, a trailing figure. */
function Row({
  chip,
  chipColor,
  title,
  detail,
  votes,
  trailing,
  trailingColor,
}: {
  chip: string;
  chipColor: string;
  title: string;
  detail?: string;
  /** A closed chat_poll/quiz's final split — the decision, not just that it happened. */
  votes?: Record<string, number>;
  trailing?: string;
  trailingColor?: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0">
      <span
        className="mt-px shrink-0 rounded px-1 py-px text-[9px] font-bold tracking-wider"
        style={{ background: chipColor, color: 'var(--on-primary)' }}
      >
        {chip}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-white">{title}</p>
        {detail && <p className="truncate text-[11px] text-[var(--text-muted)]">{detail}</p>}
        {votes && Object.values(votes).some((n) => n > 0) && (
          <span className="tnum mt-0.5 inline-block rounded-sm bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
            {Object.entries(votes).map(([k, n]) => `${k}:${n}`).join(' · ')}
          </span>
        )}
      </div>
      {trailing && (
        <span className="tnum shrink-0 text-[11px] font-semibold" style={{ color: trailingColor }}>
          {trailing}
        </span>
      )}
    </div>
  );
}

/**
 * Kick's "Activity Feed" panel, carrying the controller's decisions: what is
 * awaiting the streamer, what is being measured, and how closed windows landed.
 */
export default function ActivityFeed({ s }: { s: GambitState }) {
  const measuring = Object.values(s.inflight);
  const empty = !s.pending && measuring.length === 0 && s.results.length === 0;

  return (
    <Panel
      title="Activity Feed"
      icon={<Zap size={13} />}
      className="h-full"
      bodyClassName="overflow-y-auto"
      actions={
        <PanelButton label="Popout Activity Feed">
          <ExternalLink size={13} />
        </PanelButton>
      }
    >
      {empty ? (
        <div className="flex h-full items-center justify-center px-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">No activity yet.</p>
        </div>
      ) : (
        <>
          {s.pending && (
            <Row
              chip="ASK"
              chipColor="var(--warn)"
              title={s.pending.title}
              detail={s.pending.reason}
            />
          )}

          {measuring.map((a) => (
            <Row
              key={a.id}
              chip="LIVE"
              chipColor="var(--kick-green)"
              title={a.title}
              detail="measuring…"
            />
          ))}

          {s.results.map((r) => {
            const verdict = labelFor(r);
            return (
              <Row
                key={r.action_id}
                chip={STATE_LABEL[r.state]}
                chipColor="var(--bg-selected)"
                title={r.action?.title ?? r.arm}
                detail={isControl(r) ? 'control window' : verdict}
                votes={r.votes}
                trailing={points(r.engagement_delta)}
                trailingColor={isControl(r) ? 'var(--text-muted)' : VERDICT_COLOR[verdict]}
              />
            );
          })}
        </>
      )}
    </Panel>
  );
}
