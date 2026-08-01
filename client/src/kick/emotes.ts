// The first ten of Kick's global `emoji*` set. The art was pulled once from
// files.kick.com/emotes/<id>/fullsize and vendored into public/emotes, so the composer row
// and the message bodies render the same frames offline — the endpoint that carries the
// name↔id mapping (kick.com/emotes/<channel>) is Cloudflare-blocked, so the mapping below
// is the only copy we have of it.
export const VENDORED_EMOTES = [
  { id: 1730752, name: 'emojiAngel' },
  { id: 1730753, name: 'emojiAngry' },
  { id: 1579033, name: 'emojiAstonished' },
  { id: 1730754, name: 'emojiAwake' },
  { id: 1579036, name: 'emojiBlowKiss' },
  { id: 1730755, name: 'emojiBubbly' },
  { id: 1730756, name: 'emojiCheerful' },
  { id: 1730758, name: 'emojiClown' },
  { id: 1730759, name: 'emojiCool' },
  { id: 1730760, name: 'emojiCrave' },
] as const;

const LOCAL = new Map<number, string>(
  VENDORED_EMOTES.map((e) => [e.id, `/emotes/${e.name}.gif`]),
);

/** Local art for the ten we ship; Kick's CDN for every other emote a real chat carries. */
export function emoteSrc(id: number | string): string {
  return LOCAL.get(Number(id)) ?? `https://files.kick.com/emotes/${id}/fullsize`;
}
