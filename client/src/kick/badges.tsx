// Kick's chat badges, and the derived identity behind them.
//
// Shared because two surfaces have to agree: the chat pane draws these next to a username,
// and the Rewards board draws the same viewer's badge next to the same name. If each
// derived its own, @nova2k would be Level 8 in chat and Level 25 on the board, which is
// worse than showing no badge at all.

/** Real Kick level emblems, hotlinked from its CDN like `emoteSrc` — only the levels we
 *  have UUIDs for. */
export const LEVEL_BADGES: Record<number, string> = {
  1: 'https://ext.cdn.kick.com/chat/badges/1_17be7ee9-9ede-4f58-b6da-a2e1e4b1e56a.png',
  7: 'https://ext.cdn.kick.com/chat/badges/7_bce852c7-f8c0-43e9-bba1-5ae987199625.png',
  8: 'https://ext.cdn.kick.com/chat/badges/8_47c056a6-e00e-41dd-a540-df0e10f98329.png',
  13: 'https://ext.cdn.kick.com/chat/badges/13_984e9f19-a4b7-44e2-8a39-3b240abeddc9.png',
  14: 'https://ext.cdn.kick.com/chat/badges/14_eb93114d-ac72-4b51-b804-d77545652208.png',
  15: 'https://ext.cdn.kick.com/chat/badges/15_61050dae-2221-4500-aca7-0d3793fe98e0.png',
  25: 'https://ext.cdn.kick.com/chat/badges/25_f055d38e-8e80-4a99-8419-467bad3eb1ab.png',
  31: 'https://ext.cdn.kick.com/chat/badges/31_019f35ce-472a-74da-b3bc-69e3f2363639.png',
  45: 'https://ext.cdn.kick.com/chat/badges/45_82077115-61cb-4b5d-b036-31f13b96cfeb.png',
};

/** low→high, so a pick out of this reads as a ladder */
export const LEVELS = [1, 7, 8, 13, 14, 15, 25, 31, 45];

export type Role = 'mod' | 'vip' | null;

/** A per-user hash (FNV-1a), separate from the name-colour hash, so derived badges don't
 *  track name colour. */
export function userHash(name: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Level, role, and sub for a chatter — stable across their messages, and across surfaces.
 * Derived, not from the wire: the gym sends no badges. Server `is_sub`/`is_mod` still win
 * where the wire carries them, but `level` is always derived, which is what lets the chat
 * pane and the Rewards board show the same viewer the same emblem.
 */
export function identity(name: string): { level: number | null; role: Role; sub: boolean } {
  const h = userHash(name);
  const r = h % 100;
  const role: Role = r < 3 ? 'mod' : r < 11 ? 'vip' : null; // ~3% mods, ~8% VIPs
  const sub = ((h >>> 3) % 100) < 16;
  const show = ((h >>> 8) % 100) < 38; // only some carry a visible level
  const draw = ((h >>> 15) % 1000) / 1000;
  const level = show ? LEVELS[Math.floor(draw * draw * LEVELS.length)] : null; // squared: skews low
  return { level, role, sub };
}

/** One emblem, sized in `em` so it rides whatever text it sits in — a 14px chat row and an
 *  11px board row both get a badge in proportion. */
export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="inline-flex size-[1.35em] shrink-0 items-center" title={`Level ${level}`}>
      <img
        className="size-full"
        alt={`Level ${level}`}
        src={LEVEL_BADGES[level]}
        draggable={false}
      />
    </span>
  );
}
