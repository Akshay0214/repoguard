import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AnalysisContext } from '@/context/analysisState';
import type { CurrentAnalysis } from '@/types';

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [currentAnalysis, setCurrentAnalysis] = useState<CurrentAnalysis | null>(null);

  const clearCurrentAnalysis = useCallback(() => {
    setCurrentAnalysis(null);
  }, []);

  const value = useMemo(
    () => ({ currentAnalysis, setCurrentAnalysis, clearCurrentAnalysis }),
    [currentAnalysis, clearCurrentAnalysis],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
