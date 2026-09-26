import { Handle, Position } from '@xyflow/react';
import { FileCode2 } from 'lucide-react';

export interface InternalFileNodeData {
  path: string;
}

export function DependencyNodeCard({ data, selected }: { data: InternalFileNodeData; selected?: boolean }) {
  const fileName = data.path.split('/').pop() || data.path;

  return (
    <div
      className="w-[196px] rounded-lg border bg-[var(--color-surface)] px-3 py-2.5 shadow-none transition-colors"
      style={{
        borderColor: selected ? 'var(--color-accent)' : 'var(--color-border-strong)',
        boxShadow: selected ? '0 0 0 1px var(--color-accent)' : 'none',
      }}
      title={data.path}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--color-border-strong)', border: 'none', width: 6, height: 6 }} />
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
          <FileCode2 size={13} />
        </span>
        <span className="truncate font-mono text-[12px] text-[var(--color-text)]">{fileName}</span>
      </div>
      <p className="mt-2 truncate font-mono text-[10px] text-[var(--color-text-faint)]">{data.path}</p>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--color-border-strong)', border: 'none', width: 6, height: 6 }} />
    </div>
  );
}
