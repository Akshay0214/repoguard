import { Menu, ScanSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAnalysis } from '@/context/analysisState';
import { useRepositoryStatus } from '@/components/layout/useRepositoryStatus';
export function Topbar({ onMenuClick }) {
    const { currentAnalysis } = useAnalysis();
    const { productStatus, readiness } = useRepositoryStatus();
    const source = currentAnalysis?.sourceType === 'zip' ? 'ZIP upload' : currentAnalysis ? 'GitHub' : null;
    const limitationCount = readiness?.limitations.length ?? 0;
    return (<header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-raised)] px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onMenuClick} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] md:hidden" aria-label="Open navigation">
          <Menu size={18}/>
        </button>
        {currentAnalysis ? (<div className="min-w-0">
            <p className="truncate font-mono text-sm text-[var(--color-text)]">{currentAnalysis.repositoryName}</p>
            <p className="truncate text-xs text-[var(--color-text-faint)]">
              {source}
              {currentAnalysis.branch ? ` · ${currentAnalysis.branch}` : ''}
              {limitationCount > 0 ? ` · ${limitationCount} limitation${limitationCount === 1 ? '' : 's'}` : ''}
            </p>
          </div>) : (<p className="text-sm text-[var(--color-text-faint)]">No repository selected</p>)}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={productStatus}/>
        <Link to="/analyze">
          <Button size="sm" className="gap-1.5">
            <ScanSearch size={14}/>
            <span className="hidden sm:inline">Analyze repository</span>
          </Button>
        </Link>
      </div>
    </header>);
}
