import type { ReactNode } from 'react';

export function EvidenceBlock({ title = 'Evidence', children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{title}</h3>
      <div className="mt-2 text-sm text-[var(--color-text)]">{children}</div>
    </section>
  );
}

export function InterpretationBlock({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-md border border-[var(--color-ai)]/30 bg-[var(--color-ai-soft)] px-3 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ai)]">AI interpretation</h3>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Model text. It is not a linter result, a metric, or proof of a defect.
      </p>
      <div className="mt-2 text-sm text-[var(--color-text)]">{children}</div>
    </section>
  );
}

export function LimitationList({ items, empty = 'No limitations were reported.' }: { items: string[]; empty?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm text-[var(--color-text-muted)]">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-warning)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
