import { cn } from '@/lib/cn';
const LABEL = {
    complete: 'Analysis complete',
    partial: 'Partially complete',
    failed: 'Analysis failed',
    analyzing: 'Analyzing',
    acquiring: 'Acquiring repository',
    unavailable: 'Unavailable',
    none: 'No repository',
};
const STYLE = {
    complete: 'border-[var(--color-good)]/40 bg-[var(--color-good-soft)] text-[var(--color-good)]',
    partial: 'border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
    failed: 'border-[var(--color-critical)]/40 bg-[var(--color-critical-soft)] text-[var(--color-critical)]',
    analyzing: 'border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent-text)]',
    acquiring: 'border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent-text)]',
    unavailable: 'border-[var(--color-border-strong)] text-[var(--color-text-muted)]',
    none: 'border-[var(--color-border-strong)] text-[var(--color-text-faint)]',
};
export function StatusBadge({ status, label }) {
    return (<span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', STYLE[status])}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current"/>
      {label ?? LABEL[status]}
    </span>);
}
