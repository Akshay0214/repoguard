import type { ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SEVERITY_META } from '@/lib/meta';
import type { Severity } from '@/types';

export function Badge({
  children,
  className,
  color,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        !color && 'border-[var(--color-border-strong)] text-[var(--color-text-muted)]',
        className,
      )}
      style={
        color
          ? { color, borderColor: `${color}40`, backgroundColor: `${color}14` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

const SEVERITY_ICON: Record<Severity, typeof AlertTriangle> = {
  critical: AlertOctagon,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const meta = SEVERITY_META[severity];
  const Icon = SEVERITY_ICON[severity];
  return (
    <Badge color={meta.color} className={className}>
      <Icon size={12} strokeWidth={2.25} />
      {meta.label}
    </Badge>
  );
}
