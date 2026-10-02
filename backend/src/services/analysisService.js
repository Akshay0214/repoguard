import { randomUUID } from 'node:crypto';
/**
 * Process memory for analysis jobs.
 * When MongoDB is configured, persistenceService mirrors public fields
 * and restores them on startup. Workspace paths stay in this process only.
 */
const jobs = new Map();
let persistHandler = null;
export function setAnalysisPersistHandler(handler) {
    persistHandler = handler;
}
export function createAnalysisJob(input) {
    const now = new Date().toISOString();
    const job = {
        analysisId: randomUUID(),
        repositoryUrl: input.repositoryUrl,
        repositoryName: input.repositoryName,
        branch: input.branch,
        sourceType: input.sourceType ?? 'github',
        status: 'queued',
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
    };
    jobs.set(job.analysisId, job);
    persistHandler?.(job);
    return job;
}
export function getAnalysisJob(analysisId) {
    return jobs.get(analysisId);
}
export function listAnalysisJobs() {
    return [...jobs.values()];
}
export function restoreAnalysisJob(job) {
    const current = jobs.get(job.analysisId);
    jobs.set(job.analysisId, {
        ...job,
        workspacePath: current?.workspacePath,
    });
}
export function updateAnalysisJob(analysisId, patch) {
    const current = jobs.get(analysisId);
    if (!current)
        return undefined;
    const next = {
        ...current,
        ...patch,
        analysisId: current.analysisId,
        ownerId: current.ownerId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
    };
    jobs.set(analysisId, next);
    persistHandler?.(next);
    return next;
}
export function toPublicAnalysisJob(job) {
    const { workspacePath: _workspacePath, ownerId: _ownerId, ...publicJob } = job;
    return publicJob;
}
/** Fields safe to store. Workspace paths and credentials are excluded. */
export function toStoredAnalysisJob(job) {
    const { workspacePath: _workspacePath, ...stored } = job;
    return stored;
}
