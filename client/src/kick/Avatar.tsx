/**
 * A generated profile picture — no external asset, so it survives offline and
 * strict CSP. The hue is derived from the name, so a given channel always gets
 * the same colours.
 */
export default function Avatar({
  name,
  className = 'size-8',
}: {
  name: string;
  className?: string;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;

  // "User Name" -> UN; a single word like "streamer" -> ST
  const words = name.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = (
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
      : (words[0] ?? '?').slice(0, 2)
  ).toUpperCase();

  return (
    <span
      role="img"
      aria-label={name}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hash} 65% 42%), hsl(${(hash + 48) % 360} 70% 26%))`,
        fontSize: '1em',
      }}
    >
      {initials}
    </span>
  );
}
