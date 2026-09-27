import { useEffect, useState } from 'react';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { getAnalysisStatus, type RepositoryAnalysisStatus } from '@/services/repositoryService';
import type { ProductStatus } from '@/components/ui/StatusBadge';

const POLL_MS = 2000;

export function useRepositoryStatus(): { readiness: RepositoryAnalysisStatus | null; productStatus: ProductStatus } {
  const { currentAnalysis } = useAnalysis();
  const [readiness, setReadiness] = useState<RepositoryAnalysisStatus | null>(null);

  useEffect(() => {
    if (!currentAnalysis) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await getAnalysisStatus(currentAnalysis.analysisId);
        if (cancelled) return;
        setReadiness(next);
        if (next.status === 'queued' || next.status === 'acquiring' || next.status === 'analyzing') {
          timer = window.setTimeout(() => void poll(), POLL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 409) {
          timer = window.setTimeout(() => void poll(), POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentAnalysis]);

  if (!currentAnalysis) return { readiness: null, productStatus: 'none' };
  if (!readiness) return { readiness: null, productStatus: 'acquiring' };
  if (readiness.status === 'ready') return { readiness, productStatus: 'complete' };
  if (readiness.status === 'partial') return { readiness, productStatus: 'partial' };
  if (readiness.status === 'failed') return { readiness, productStatus: 'failed' };
  if (readiness.status === 'analyzing') return { readiness, productStatus: 'analyzing' };
  return { readiness, productStatus: 'acquiring' };
}
