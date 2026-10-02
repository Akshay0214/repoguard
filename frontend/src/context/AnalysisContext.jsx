import { useCallback, useMemo, useState } from 'react';
import { AnalysisContext } from '@/context/analysisState';
export function AnalysisProvider({ children }) {
    const [currentAnalysis, setCurrentAnalysis] = useState(null);
    const clearCurrentAnalysis = useCallback(() => {
        setCurrentAnalysis(null);
    }, []);
    const value = useMemo(() => ({ currentAnalysis, setCurrentAnalysis, clearCurrentAnalysis }), [currentAnalysis, clearCurrentAnalysis]);
    return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
