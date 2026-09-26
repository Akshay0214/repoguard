import { Menu, GitBranch, ScanSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAnalysis } from '@/context/analysisState';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { currentAnalysis } = useAnalysis();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-raised)]/80 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] md:hidden"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
          <GitBranch size={13} className="text-[var(--color-text-faint)]" />
          {currentAnalysis ? (
            <>
              <span className="font-mono text-xs text-[var(--color-text)]">{currentAnalysis.repositoryName}</span>
              <span className="rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-faint)]">
                {currentAnalysis.branch}
              </span>
            </>
          ) : (
            <span className="font-mono text-xs text-[var(--color-text-faint)]">No repository selected</span>
          )}
        </div>
      </div>

      <Link to="/analyze">
        <Button size="sm" className="gap-1.5">
          <ScanSearch size={14} />
          <span className="hidden sm:inline">Analyze Repository</span>
          <span className="sm:hidden">Analyze</span>
        </Button>
      </Link>
    </header>
  );
}
