import { LoaderCircle, Inbox, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
export function LoadingState({ label = 'Loading data…' }) {
    return (<div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--color-text-faint)]">
      <LoaderCircle size={22} className="animate-spin text-[var(--color-accent)]"/>
      <p className="text-sm">{label}</p>
    </div>);
}
export function Skeleton({ className = 'h-4 w-full' }) {
    return <div className={`animate-pulse rounded-md bg-[var(--color-surface-2)] ${className}`}/>;
}
export function EmptyState({ icon, title, description, action, }) {
    return (<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--color-border-strong)] py-16 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-faint)]">
        {icon ?? <Inbox size={20}/>}
      </div>
      <h3 className="font-display text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {description && <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>}
      {action}
    </div>);
}
export function ErrorState({ title = 'Something went wrong', description = 'This data could not be loaded. Try again.', onRetry, }) {
    return (<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[var(--color-critical)]/25 bg-[var(--color-critical-soft)] py-16 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-critical)]">
        <TriangleAlert size={20}/>
      </div>
      <h3 className="font-display text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      {onRetry && (<Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>)}
    </div>);
}
