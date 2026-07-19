import { Smile, Meh, Frown } from 'lucide-react';

export function sentimentLabel(s: number): { text: string; color: string; Icon: typeof Meh } {
  if (s >= 0.65) return { text: 'positive', color: 'var(--kick-green)', Icon: Smile };
  if (s >= 0.45) return { text: 'mixed', color: 'var(--text-secondary)', Icon: Meh };
  return { text: 'negative', color: 'var(--danger)', Icon: Frown };
}
