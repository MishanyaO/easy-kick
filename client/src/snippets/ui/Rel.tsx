import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

/** "1.7× normal" with a direction arrow — makes any metric interpretable at a glance. */
export default function Rel({ value }: { value: number }) {
  const up = value >= 1;
  return (
    <span
      className="tnum flex items-center gap-0.5 text-[10px] font-semibold"
      style={{ color: up ? 'var(--kick-green)' : 'var(--warn)' }}
    >
      {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {value.toFixed(1)}× normal
    </span>
  );
}
