import { motion } from 'framer-motion';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

/** Large metric number that tweens on change. Pair with the `tnum` class for tabular digits. */
export default function AnimatedNumber({ value }: { value: number }) {
  const rounded = useAnimatedNumber(value);
  return <motion.span className="tnum">{rounded}</motion.span>;
}
