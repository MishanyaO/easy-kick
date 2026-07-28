// A minimal inline-SVG sparkline — no axes, legend or tooltip, ambient proof of life only.
export default function Spark({
  data, height = 22, color = 'var(--kick-green)',
}: { data: number[]; height?: number; color?: string }) {
  if (data.length < 2) return <div style={{ height }} />;
  const W = 320;
  const max = Math.max(...data) * 1.15 || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => height - (v / max) * (height - 3) - 1.5;
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
