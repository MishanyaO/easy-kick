// A minimal inline-SVG chart with several series — by default each line fits its own
// [0, max] range, so a viewer count and a small action count both read clearly on the
// same axis without one flattening the other. Series sharing a `scaleGroup` instead
// share one [0, max] range, which is what makes two comparable series comparable: equal
// values draw at equal heights, and the gap between the lines is a real quantity.
export type Series = { data: number[]; color: string; scaleGroup?: string };

export default function MultiSpark({
  series, height = 44,
}: { series: Series[]; height?: number }) {
  if (!series.some((s) => s.data.length >= 2)) return <div style={{ height }} />;
  const W = 320;
  const groupMax = (group: string) => Math.max(
    ...series.filter((s) => s.scaleGroup === group).flatMap((s) => s.data),
  ) * 1.15 || 1;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      {series.map(({ data, color, scaleGroup }, i) => {
        if (data.length < 2) return null;
        const max = scaleGroup ? groupMax(scaleGroup) : Math.max(...data) * 1.15 || 1;
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
