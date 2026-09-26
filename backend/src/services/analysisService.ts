import { randomUUID } from 'node:crypto';
import type { AnalysisJob, AnalysisSourceType, PublicAnalysisJob } from '../types/analysis.js';

/**
 * Process memory for analysis jobs.
 * When MongoDB is configured, persistenceService mirrors public fields
 * and restores them on startup. Workspace paths stay in this process only.
 */

const jobs = new Map<string, AnalysisJob>();

type PersistHandler = (job: AnalysisJob) => void;
let persistHandler: PersistHandler | null = null;

export function setAnalysisPersistHandler(handler: PersistHandler | null): void {
  persistHandler = handler;
}

export function createAnalysisJob(input: {
  repositoryUrl: string;
  repositoryName: string;
  branch: string;
  sourceType?: AnalysisSourceType;
  ownerId: string;
}): AnalysisJob {
  const now = new Date().toISOString();
  const job: AnalysisJob = {
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

export function getAnalysisJob(analysisId: string): AnalysisJob | undefined {
  return jobs.get(analysisId);
}

export function listAnalysisJobs(): AnalysisJob[] {
  return [...jobs.values()];
}

export function restoreAnalysisJob(job: AnalysisJob): void {
  const current = jobs.get(job.analysisId);
  jobs.set(job.analysisId, {
    ...job,
    workspacePath: current?.workspacePath,
  });
}

export function updateAnalysisJob(
  analysisId: string,
  patch: Partial<Omit<AnalysisJob, 'analysisId' | 'createdAt' | 'ownerId'>>,
): AnalysisJob | undefined {
  const current = jobs.get(analysisId);
  if (!current) return undefined;
  const next: AnalysisJob = {
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

export function toPublicAnalysisJob(job: AnalysisJob): PublicAnalysisJob {
  const { workspacePath: _workspacePath, ownerId: _ownerId, ...publicJob } = job;
  return publicJob;
}

/** Fields safe to store. Workspace paths and credentials are excluded. */
export function toStoredAnalysisJob(job: AnalysisJob): Omit<AnalysisJob, 'workspacePath'> {
  const { workspacePath: _workspacePath, ...stored } = job;
  return stored;
}
