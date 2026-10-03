import { useEffect, useState } from 'react';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { getAnalysisStatus } from '@/services/repositoryService';
const POLL_MS = 2000;
export function useRepositoryStatus() {
    const { currentAnalysis } = useAnalysis();
    const [snapshot, setSnapshot] = useState({ analysisId: null, readiness: null, unavailable: false });
    const analysisId = currentAnalysis?.analysisId ?? null;
    const readiness = snapshot.analysisId === analysisId ? snapshot.readiness : null;
    const unavailable = snapshot.analysisId === analysisId && snapshot.unavailable;
    useEffect(() => {
        if (!currentAnalysis)
            return undefined;
        let cancelled = false;
        let timer = 0;
        const poll = async () => {
            try {
                const next = await getAnalysisStatus(currentAnalysis.analysisId);
                if (cancelled)
                    return;
                setSnapshot({ analysisId: currentAnalysis.analysisId, readiness: next, unavailable: false });
                if (next.status === 'queued' || next.status === 'acquiring' || next.status === 'analyzing') {
                    timer = window.setTimeout(() => void poll(), POLL_MS);
                }
            }
            catch (caught) {
                if (cancelled)
                    return;
                if (caught instanceof ApiError && caught.status === 409) {
                    timer = window.setTimeout(() => void poll(), POLL_MS);
                    return;
                }
                setSnapshot({ analysisId: currentAnalysis.analysisId, readiness: null, unavailable: true });
            }
        };
        void poll();
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [currentAnalysis]);
    if (!currentAnalysis)
        return { readiness: null, productStatus: 'none' };
    if (unavailable)
        return { readiness, productStatus: 'unavailable' };
    if (!readiness)
        return { readiness: null, productStatus: 'acquiring' };
    if (readiness.status === 'ready')
        return { readiness, productStatus: 'complete' };
    if (readiness.status === 'partial')
        return { readiness, productStatus: 'partial' };
    if (readiness.status === 'failed')
        return { readiness, productStatus: 'failed' };
    if (readiness.status === 'analyzing')
        return { readiness, productStatus: 'analyzing' };
    return { readiness, productStatus: 'acquiring' };
}
