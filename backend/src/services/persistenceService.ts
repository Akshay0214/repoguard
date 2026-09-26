import type { AnalysisJob } from '../types/analysis.js';
import { getDatabase } from '../db/database.js';
import {
  listAnalysisJobs,
  restoreAnalysisJob,
  setAnalysisPersistHandler,
  toStoredAnalysisJob,
} from './analysisService.js';
import {
  getStoredAnalysisResults,
  restoreStoredAnalysisResults,
  setAnalysisResultHandler,
  type StoredAnalysisResults,
} from './analysisResultStore.js';
import { restoreCompletedAnalysis } from './analysisOrchestrationService.js';

interface StoredJobDocument extends Omit<AnalysisJob, 'workspacePath'> {
  _id?: unknown;
}

/**
 * Mirrors in-memory jobs and analyzer results to MongoDB when configured.
 * Workspace paths and credentials are not written.
 */
export function enablePersistenceMirrors(): void {
  setAnalysisPersistHandler((job) => {
    void persistJob(job);
  });
  setAnalysisResultHandler((stored) => {
    void persistResults(stored);
  });
}

export async function hydratePersistence(): Promise<void> {
  const database = getDatabase();
  if (!database) return;

  const jobs = await database
    .collection<StoredJobDocument>('analyses')
    .find({}, { projection: { _id: 0 } })
    .toArray();
  for (const stored of jobs) {
    if (!isStoredJob(stored)) continue;
    restoreAnalysisJob({ ...stored, workspacePath: undefined });
  }

  const results = await database
    .collection<StoredAnalysisResults>('analysis_results')
    .find({}, { projection: { _id: 0 } })
    .toArray();
  for (const stored of results) {
    if (!stored || typeof stored.analysisId !== 'string') continue;
    restoreStoredAnalysisResults(stored);
    const overview = stored.overview;
    if (!overview) continue;
    restoreCompletedAnalysis(stored.analysisId, {
      ast: overview.ast,
      dependencies: overview.dependencies,
      static: overview.static,
      history: overview.history,
      staticFindings: stored.issues?.findings ?? stored.staticAnalysis?.findings ?? null,
      evidence: {
        ast: stored.ast,
        dependencies: stored.dependencies,
        staticAnalysis: stored.staticAnalysis,
        history: stored.history,
      },
      debt: stored.debt,
      modules: overview.readiness.modules,
      limitations: overview.readiness.limitations,
    });
  }
}

async function persistJob(job: AnalysisJob): Promise<void> {
  const database = getDatabase();
  if (!database) return;
  const stored = toStoredAnalysisJob(job);
  try {
    await database.collection('analyses').updateOne({ analysisId: job.analysisId }, { $set: stored }, { upsert: true });
  } catch (error) {
    console.error('Failed to persist analysis job', job.analysisId, error instanceof Error ? error.name : 'error');
  }
}

async function persistResults(stored: StoredAnalysisResults): Promise<void> {
  const database = getDatabase();
  if (!database) return;
  try {
    await database.collection('analysis_results').updateOne(
      { analysisId: stored.analysisId },
      { $set: stored },
      { upsert: true },
    );
  } catch (error) {
    console.error('Failed to persist analysis results', stored.analysisId, error instanceof Error ? error.name : 'error');
  }
}

export async function flushKnownJobs(): Promise<void> {
  await Promise.all(listAnalysisJobs().map((job) => persistJob(job)));
  await Promise.all(
    listAnalysisJobs().map(async (job) => {
      const stored = getStoredAnalysisResults(job.analysisId);
      if (stored) await persistResults(stored);
    }),
  );
}

function isStoredJob(value: StoredJobDocument): value is Omit<AnalysisJob, 'workspacePath'> {
  return (
    typeof value.analysisId === 'string' &&
    typeof value.repositoryName === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.ownerId === 'string' &&
    (value.sourceType === 'github' || value.sourceType === 'zip') &&
    (value.status === 'queued' || value.status === 'acquiring' || value.status === 'ready' || value.status === 'failed')
  );
}
