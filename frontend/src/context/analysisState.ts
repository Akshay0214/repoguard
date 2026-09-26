import { createContext, useContext } from 'react';
import type { AnalysisJob, CurrentAnalysis } from '@/types';

export interface AnalysisContextValue {
  currentAnalysis: CurrentAnalysis | null;
  setCurrentAnalysis: (analysis: CurrentAnalysis) => void;
  clearCurrentAnalysis: () => void;
}

export const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function toCurrentAnalysis(job: AnalysisJob): CurrentAnalysis {
  return {
    analysisId: job.id,
    repositoryUrl: job.repositoryUrl,
    repositoryName: job.repositoryName,
    branch: job.branch,
    sourceType: job.sourceType,
    status: job.status,
  };
}

export function useAnalysis(): AnalysisContextValue {
  const value = useContext(AnalysisContext);
  if (!value) {
    throw new Error('useAnalysis must be used within AnalysisProvider');
  }
  return value;
}
