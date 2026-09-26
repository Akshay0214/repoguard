import { randomUUID } from 'node:crypto';
import type { AnalysisJob, PublicAnalysisJob } from '../types/analysis.js';

/**
 * Temporary process memory for the API contract.
 * Later steps replace this with the analysis pipeline and persistence.
 * Planned siblings in this folder: staticAnalysisService.
 */
const jobs = new Map<string, AnalysisJob>();

export function createAnalysisJob(input: {
  repositoryUrl: string;
  repositoryName: string;
  branch: string;
}): AnalysisJob {
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    analysisId: randomUUID(),
    repositoryUrl: input.repositoryUrl,
    repositoryName: input.repositoryName,
    branch: input.branch,
    sourceType: 'github',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.analysisId, job);
  return job;
}

export function getAnalysisJob(analysisId: string): AnalysisJob | undefined {
  return jobs.get(analysisId);
}

export function updateAnalysisJob(
  analysisId: string,
  patch: Partial<Omit<AnalysisJob, 'analysisId' | 'createdAt'>>,
): AnalysisJob | undefined {
  const current = jobs.get(analysisId);
  if (!current) return undefined;
  const next: AnalysisJob = {
    ...current,
    ...patch,
    analysisId: current.analysisId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(analysisId, next);
  return next;
}

export function toPublicAnalysisJob(job: AnalysisJob): PublicAnalysisJob {
  const { workspacePath: _workspacePath, ...publicJob } = job;
  return publicJob;
}
