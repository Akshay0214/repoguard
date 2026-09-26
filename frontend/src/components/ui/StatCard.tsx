import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: string;
  hint?: string;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
        {Icon && (
          <span
            className={cn('flex h-7 w-7 items-center justify-center rounded-md')}
            style={{ backgroundColor: accent ? `${accent}1a` : 'var(--color-surface-2)', color: accent ?? 'var(--color-text-faint)' }}
          >
            <Icon size={14} strokeWidth={2.25} />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold text-[var(--color-text)]">{value}</span>
      </div>
      {hint && <span className="text-xs text-[var(--color-text-faint)]">{hint}</span>}
    </Card>
  );
}

export function ProgressBar({ value, max = 100, color = 'var(--color-accent)' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}
