import { createContext, useContext } from 'react';
export const AnalysisContext = createContext(null);
export function toCurrentAnalysis(job) {
    return {
        analysisId: job.id,
        repositoryUrl: job.repositoryUrl,
        repositoryName: job.repositoryName,
        branch: job.branch,
        sourceType: job.sourceType,
        status: job.status,
    };
}
export function useAnalysis() {
    const value = useContext(AnalysisContext);
    if (!value) {
        throw new Error('useAnalysis must be used within AnalysisProvider');
    }
    return value;
}
