// A minimal inline-SVG chart with several independently-scaled series — each line
// fits its own [0, max] range, so a viewer count and a small action count both read
// clearly on the same axis without one flattening the other.
export type Series = { data: number[]; color: string };

export default function MultiSpark({
  series, height = 44,
}: { series: Series[]; height?: number }) {
  if (!series.some((s) => s.data.length >= 2)) return <div style={{ height }} />;
  const W = 320;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      {series.map(({ data, color }, i) => {
        if (data.length < 2) return null;
        const max = Math.max(...data) * 1.15 || 1;
        const x = (j: number) => (j / (data.length - 1)) * W;
        const y = (v: number) => height - (v / max) * (height - 3) - 1.5;
        const d = data
          .map((v, j) => `${j === 0 ? 'M' : 'L'}${x(j).toFixed(1)},${y(v).toFixed(1)}`)
          .join(' ');
        return (
          <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.5"
            vectorEffect="non-scaling-stroke" />
        );
      })}
    </svg>
  );
}
