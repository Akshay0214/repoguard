const results = new Map();
let resultHandler = null;
const MAX_JSON_CHARS = 12_000_000;
export function setAnalysisResultHandler(handler) {
    resultHandler = handler;
}
export function getStoredAnalysisResults(analysisId) {
    return results.get(analysisId);
}
export function restoreStoredAnalysisResults(stored) {
    results.set(stored.analysisId, stored);
}
export function saveStoredAnalysisResults(job, patch) {
    const current = results.get(job.analysisId);
    const next = {
        analysisId: job.analysisId,
        savedAt: new Date().toISOString(),
        overview: patch.overview ?? current?.overview ?? null,
        issues: patch.issues ?? current?.issues ?? null,
        ast: patch.ast ?? current?.ast ?? null,
        dependencies: patch.dependencies ?? current?.dependencies ?? null,
        history: patch.history ?? current?.history ?? null,
        staticAnalysis: patch.staticAnalysis ?? current?.staticAnalysis ?? null,
        debt: patch.debt ?? current?.debt ?? null,
        repositoryAi: patch.repositoryAi ?? current?.repositoryAi ?? null,
        reduced: false,
    };
    const bounded = boundResultSize(next);
    results.set(job.analysisId, bounded);
    resultHandler?.(bounded);
    return bounded;
}
export function rememberRepositoryAi(analysisId, interpretation) {
    const current = results.get(analysisId);
    if (!current) {
        saveStoredAnalysisResults({ analysisId }, { repositoryAi: interpretation });
        return;
    }
    saveStoredAnalysisResults({ analysisId }, { repositoryAi: interpretation });
}
function boundResultSize(stored) {
    if (jsonSize(stored) <= MAX_JSON_CHARS)
        return stored;
    const reduced = {
        ...stored,
        reduced: true,
        ast: stored.ast
            ? { ...stored.ast, files: [], errors: stored.ast.errors.slice(0, 50) }
            : null,
        dependencies: stored.dependencies
            ? {
                ...stored.dependencies,
                nodes: [],
                edges: [],
                files: stored.dependencies.files.slice(0, 200),
                unresolved: stored.dependencies.unresolved.slice(0, 200),
            }
            : null,
        history: stored.history
            ? {
                ...stored.history,
                commits: stored.history.commits.slice(0, 50),
                files: stored.history.files.slice(0, 200),
            }
            : null,
        staticAnalysis: stored.staticAnalysis
            ? {
                ...stored.staticAnalysis,
                findings: stored.staticAnalysis.findings.slice(0, 500),
            }
            : null,
    };
    return reduced;
}
function jsonSize(value) {
    try {
        return JSON.stringify(value).length;
    }
    catch {
        return MAX_JSON_CHARS + 1;
    }
}
