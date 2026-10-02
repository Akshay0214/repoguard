import { cn } from '@/lib/cn';
export function Card({ children, className, padded = true, interactive = false, ...props }) {
    return (<div className={cn('rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]', padded && 'p-4', interactive && 'transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] cursor-pointer', className)} {...props}>
      {children}
    </div>);
}
export function CardHeader({ children, className }) {
    return <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>{children}</div>;
}
export function CardTitle({ children, className }) {
    return <h3 className={cn('font-display text-sm font-semibold text-[var(--color-text)]', className)}>{children}</h3>;
}
export function CardDescription({ children, className }) {
    return <p className={cn('mt-1 text-sm text-[var(--color-text-muted)]', className)}>{children}</p>;
}
