import { useEffect } from 'react';
import { animate, useMotionValue, useTransform, type MotionValue } from 'framer-motion';

/**
 * Smoothly tweens a number whenever `value` changes and returns a
 * MotionValue<string> of the rounded integer — render with <motion.span>{v}</motion.span>.
 */
export function useAnimatedNumber(value: number, duration = 0.6): MotionValue<string> {
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: 'easeOut' });
    return controls.stop;
  }, [value, duration, mv]);
  return rounded;
}
