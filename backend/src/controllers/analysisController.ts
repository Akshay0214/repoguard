import type { Request, Response } from 'express';
import path from 'node:path';
import { analyzeAcquiredRepository } from '../services/astAnalysisService.js';
import { analyzeAcquiredDependencies } from '../services/dependencyAnalysisService.js';
import { analyzeAcquiredGitHistory, GitHistoryError } from '../services/gitHistoryAnalysisService.js';
import { buildAcquiredContext, ContextRequestError, normalizeRepositoryPath } from '../services/contextBuilderService.js';
import type { ExperimentAiResponse } from '../types/ai.js';
import { interpretAcquiredContext, LlmError, readAiConfig, requireAiConfig } from '../services/llmService.js';
import { analyzeAcquiredStatic, StaticAnalysisUnavailableError } from '../services/staticAnalysisService.js';
import { createAnalysisJob, getAnalysisJob, toPublicAnalysisJob } from '../services/analysisService.js';
import { beginRepositoryAnalysis, readRepositoryAnalysisStatus, readRepositoryOverview, readRepositoryStaticIssues } from '../services/analysisOrchestrationService.js';
import { acquireRepository, analysisWorkspacePath } from '../services/repositoryAcquisitionService.js';
import { HttpError } from '../utils/httpError.js';
import { validateCreateAnalysisRequest } from '../utils/validateCreateAnalysis.js';

const NOT_IMPLEMENTED = 'Analysis results are not implemented yet.';

function requireJob(analysisId: string) {
  const job = getAnalysisJob(analysisId);
  if (!job) {
    throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
  }
  return job;
}

export async function createAnalysis(req: Request, res: Response): Promise<void> {
  const input = validateCreateAnalysisRequest(req.body);
  const job = createAnalysisJob(input);
  const responseJob = toPublicAnalysisJob(job);
  void acquireRepository(job.analysisId)
    .then(() => {
      beginRepositoryAnalysis(job.analysisId);
    })
    .catch((error: unknown) => {
      console.error('Repository acquisition stopped unexpectedly', error);
    });
  res.status(201).json({
    success: true,
    data: responseJob,
  });
}

export async function getAnalysis(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string' || analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  res.status(200).json({
    success: true,
    data: toPublicAnalysisJob(requireJob(analysisId)),
  });
}

function requireReadyWorkspace(analysisId: string): string {
  if (analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }

  const job = requireJob(analysisId);
  if (job.status !== 'ready' || !job.workspacePath) {
    throw new HttpError(
      409,
      'ACQUISITION_NOT_READY',
      job.status === 'failed'
        ? (job.errorMessage ?? 'Repository acquisition failed.')
        : 'Repository acquisition is not complete.',
    );
  }

  let expectedWorkspace: string;
  try {
    expectedWorkspace = analysisWorkspacePath(analysisId);
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is not valid');
  }
  if (path.resolve(job.workspacePath) !== expectedWorkspace) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Stored workspace does not match this analysis.');
  }
  return expectedWorkspace;
}

export async function getAnalysisStatus(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string' || analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const job = requireJob(analysisId);
  if (job.status === 'queued' || job.status === 'acquiring') {
    throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
  }
  res.status(200).json({
    success: true,
    data: readRepositoryAnalysisStatus(job),
  });
}

export async function getAnalysisOverview(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string' || analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const job = requireJob(analysisId);
  if (job.status === 'queued' || job.status === 'acquiring') {
    throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
  }
  res.status(200).json({
    success: true,
    data: readRepositoryOverview(job),
  });
}

export async function getAnalysisIssues(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string' || analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const job = requireJob(analysisId);
  if (job.status === 'queued' || job.status === 'acquiring') {
    throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
  }
  if (job.status === 'failed' || !job.workspacePath) {
    throw new HttpError(409, 'ACQUISITION_NOT_READY', job.errorMessage ?? 'Repository acquisition failed.');
  }
  const result = readRepositoryStaticIssues(job);
  if (result.state === 'failed') {
    throw new HttpError(503, 'STATIC_ANALYSIS_FAILED', result.message);
  }
  if (result.state === 'pending') {
    throw new HttpError(409, 'STATIC_ANALYSIS_NOT_READY', 'Static analysis is not complete.');
  }
  res.status(200).json({
    success: true,
    data: result.issues,
  });
}

export async function getAstAnalysis(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const workspace = requireReadyWorkspace(analysisId);

  try {
    const result = await analyzeAcquiredRepository(analysisId, workspace);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
      throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
    }
    throw error;
  }
}

export async function getDependencyAnalysis(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const workspace = requireReadyWorkspace(analysisId);

  try {
    const result = await analyzeAcquiredDependencies(analysisId, workspace);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
      throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
    }
    throw error;
  }
}

export async function getGitHistory(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const workspace = requireReadyWorkspace(analysisId);

  try {
    const result = await analyzeAcquiredGitHistory(analysisId, workspace);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof GitHistoryError) {
      if (error.code === 'WORKSPACE_MISSING') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
      }
      if (error.code === 'NO_GIT_REPOSITORY') {
        throw new HttpError(422, 'GIT_HISTORY_UNAVAILABLE', error.message);
      }
      if (error.code === 'GIT_TIMEOUT') {
        throw new HttpError(504, 'GIT_HISTORY_TIMEOUT', error.message);
      }
      if (error.code === 'GIT_UNAVAILABLE') {
        throw new HttpError(500, 'GIT_UNAVAILABLE', error.message);
      }
      throw new HttpError(500, 'GIT_HISTORY_FAILED', 'Git history command failed.');
    }
    throw error;
  }
}

export async function getStaticAnalysis(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const workspace = requireReadyWorkspace(analysisId);

  try {
    const result = await analyzeAcquiredStatic(analysisId, workspace);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof StaticAnalysisUnavailableError) {
      throw new HttpError(503, 'STATIC_ANALYSIS_UNAVAILABLE', error.message);
    }
    if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
      throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
    }
    throw error;
  }
}

export async function getRepositoryContext(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const mode = req.query.mode;
  if (
    mode !== 'repository-summary' &&
    mode !== 'file' &&
    mode !== 'experiment-file-baseline' &&
    mode !== 'experiment-file-proposed'
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'mode must be repository-summary, file, experiment-file-baseline, or experiment-file-proposed.',
    );
  }
  if (mode !== 'repository-summary' && typeof req.query.path !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'path is required for file context.');
  }

  const workspace = requireReadyWorkspace(analysisId);
  const job = getAnalysisJob(analysisId);
  if (!job) {
    throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
  }

  try {
    const result = await buildAcquiredContext(
      {
        analysisId: job.analysisId,
        repositoryName: job.repositoryName,
        branch: job.branch,
        sourceType: job.sourceType,
      },
      workspace,
      contextRequestFromQuery(mode, req.query.path),
    );
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ContextRequestError) {
      if (error.code === 'FILE_NOT_FOUND') {
        throw new HttpError(404, 'FILE_NOT_FOUND', error.message);
      }
      throw new HttpError(400, 'VALIDATION_ERROR', error.message);
    }
    if (error instanceof GitHistoryError) {
      if (error.code === 'WORKSPACE_MISSING') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
      }
      if (error.code === 'NO_GIT_REPOSITORY') {
        throw new HttpError(422, 'GIT_HISTORY_UNAVAILABLE', error.message);
      }
      throw new HttpError(500, 'GIT_HISTORY_FAILED', 'Git history command failed.');
    }
    if (error instanceof StaticAnalysisUnavailableError) {
      throw new HttpError(503, 'STATIC_ANALYSIS_UNAVAILABLE', error.message);
    }
    if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
      throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
    }
    throw error;
  }
}

function mapLlmError(error: LlmError): HttpError {
  if (error.code === 'NOT_CONFIGURED') {
    return new HttpError(503, 'AI_NOT_CONFIGURED', error.message);
  }
  if (error.code === 'TIMEOUT') {
    return new HttpError(504, 'AI_TIMEOUT', error.message);
  }
  if (error.code === 'RATE_LIMIT') {
    return new HttpError(503, 'AI_RATE_LIMIT', error.message);
  }
  if (error.code === 'INVALID_RESPONSE') {
    return new HttpError(502, 'AI_RESPONSE_INVALID', error.message);
  }
  return new HttpError(503, 'AI_SERVICE_UNAVAILABLE', error.message);
}

export async function postAiSummary(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const workspace = requireReadyWorkspace(analysisId);
  const job = getAnalysisJob(analysisId);
  if (!job) throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');

  try {
    requireAiConfig(readAiConfig());
    const context = await buildAcquiredContext(
      {
        analysisId: job.analysisId,
        repositoryName: job.repositoryName,
        branch: job.branch,
        sourceType: job.sourceType,
      },
      workspace,
      { mode: 'repository-summary' },
    );
    const interpretation = await interpretAcquiredContext(`${job.analysisId}:repository-summary`, context);
    res.status(200).json({ success: true, data: interpretation });
  } catch (error) {
    throw mapAnalysisFailure(error);
  }
}

function contextRequestFromQuery(
  mode: 'repository-summary' | 'file' | 'experiment-file-baseline' | 'experiment-file-proposed',
  path: unknown,
) {
  if (mode === 'repository-summary') return { mode } as const;
  return { mode, path: path as string } as const;
}

export async function postExperimentBaseline(req: Request, res: Response): Promise<void> {
  await postExperimentInterpretation(req, res, 'baseline');
}

export async function postExperimentProposed(req: Request, res: Response): Promise<void> {
  await postExperimentInterpretation(req, res, 'proposed');
}

async function postExperimentInterpretation(
  req: Request,
  res: Response,
  condition: 'baseline' | 'proposed',
): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const requestedPath = req.body?.path;
  if (typeof requestedPath !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'path is required.');
  }
  const workspace = requireReadyWorkspace(analysisId);
  const job = getAnalysisJob(analysisId);
  if (!job) throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');

  const contextMode = condition === 'baseline' ? 'experiment-file-baseline' : 'experiment-file-proposed';
  try {
    const normalizedPath = normalizeRepositoryPath(requestedPath);
    const configured = requireAiConfig(readAiConfig());
    const context = await buildAcquiredContext(
      {
        analysisId: job.analysisId,
        repositoryName: job.repositoryName,
        branch: job.branch,
        sourceType: job.sourceType,
      },
      workspace,
      { mode: contextMode, path: requestedPath },
    );
    const interpretation = await interpretAcquiredContext(
      `${job.analysisId}:${contextMode}:${normalizedPath}`,
      context,
    );
    const data: ExperimentAiResponse = {
      condition,
      contextMode,
      path: normalizedPath,
      model: configured.model,
      interpretation,
    };
    res.status(200).json({ success: true, data });
  } catch (error) {
    throw mapAnalysisFailure(error);
  }
}

export async function postAiFileSummary(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  const requestedPath = req.body?.path;
  if (typeof requestedPath !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'path is required.');
  }
  const workspace = requireReadyWorkspace(analysisId);
  const job = getAnalysisJob(analysisId);
  if (!job) throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');

  try {
    normalizeRepositoryPath(requestedPath);
    requireAiConfig(readAiConfig());
    const context = await buildAcquiredContext(
      {
        analysisId: job.analysisId,
        repositoryName: job.repositoryName,
        branch: job.branch,
        sourceType: job.sourceType,
      },
      workspace,
      { mode: 'file', path: requestedPath },
    );
    const interpretation = await interpretAcquiredContext(
      `${job.analysisId}:file:${normalizeRepositoryPath(requestedPath)}`,
      context,
    );
    res.status(200).json({ success: true, data: interpretation });
  } catch (error) {
    throw mapAnalysisFailure(error);
  }
}

function mapAnalysisFailure(error: unknown): Error {
  if (error instanceof LlmError) return mapLlmError(error);
  if (error instanceof ContextRequestError) {
    if (error.code === 'FILE_NOT_FOUND') return new HttpError(404, 'FILE_NOT_FOUND', error.message);
    return new HttpError(400, 'VALIDATION_ERROR', error.message);
  }
  if (error instanceof GitHistoryError) {
    if (error.code === 'WORKSPACE_MISSING') {
      return new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
    }
    if (error.code === 'NO_GIT_REPOSITORY') return new HttpError(422, 'GIT_HISTORY_UNAVAILABLE', error.message);
    return new HttpError(500, 'GIT_HISTORY_FAILED', 'Git history command failed.');
  }
  if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
    return new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
  }
  if (error instanceof StaticAnalysisUnavailableError) {
    return new HttpError(503, 'STATIC_ANALYSIS_UNAVAILABLE', error.message);
  }
  return error instanceof Error ? error : new Error('Internal server error');
}

export async function getAnalysisStub(req: Request, res: Response): Promise<void> {
  const analysisId = req.params.analysisId;
  if (typeof analysisId !== 'string' || analysisId.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
  }
  requireJob(analysisId);
  res.status(200).json({
    success: true,
    data: null,
    message: NOT_IMPLEMENTED,
  });
}
