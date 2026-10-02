import path from 'node:path';
import { analyzeAcquiredRepository } from '../services/astAnalysisService.js';
import { analyzeAcquiredDependencies } from '../services/dependencyAnalysisService.js';
import { analyzeAcquiredGitHistory, GitHistoryError } from '../services/gitHistoryAnalysisService.js';
import { buildAcquiredContext, ContextRequestError, normalizeRepositoryPath } from '../services/contextBuilderService.js';
import { interpretAcquiredContext, LlmError, readAiConfig, requireAiConfig } from '../services/llmService.js';
import { analyzeAcquiredStatic, StaticAnalysisUnavailableError } from '../services/staticAnalysisService.js';
import { createAnalysisJob, getAnalysisJob, toPublicAnalysisJob } from '../services/analysisService.js';
import { getStoredAnalysisResults, rememberRepositoryAi } from '../services/analysisResultStore.js';
import { beginRepositoryAnalysis, readRepositoryAnalysisStatus, readRepositoryOverview, readRepositoryStaticIssues, readTechnicalDebt } from '../services/analysisOrchestrationService.js';
import { acquireRepository, analysisWorkspacePath, holdGithubToken } from '../services/repositoryAcquisitionService.js';
import { buildAnalysisReport, renderAnalysisReportHtml } from '../services/reportService.js';
import { acquireUploadedArchive, archiveLabel, assertZipUpload, ZipExtractError } from '../services/zipAcquisitionService.js';
import { HttpError } from '../utils/httpError.js';
import { validateCreateAnalysisRequest } from '../utils/validateCreateAnalysis.js';
function requireJob(req) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const job = getAnalysisJob(analysisId);
    if (!job || !req.user || job.ownerId !== req.user.id) {
        throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
    }
    return job;
}
function readSuppliedGithubToken(req) {
    const header = req.header('x-github-token');
    const body = req.body;
    const bodyToken = typeof body === 'object' && body !== null && typeof body.githubToken === 'string'
        ? body.githubToken
        : undefined;
    if (typeof body === 'object' && body !== null && 'githubToken' in body) {
        delete body.githubToken;
    }
    const token = (header ?? bodyToken ?? '').trim();
    return token || undefined;
}
export async function createAnalysis(req, res) {
    const suppliedToken = readSuppliedGithubToken(req);
    const input = validateCreateAnalysisRequest(req.body);
    if (!req.user)
        throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const job = createAnalysisJob({ ...input, ownerId: req.user.id });
    if (suppliedToken)
        holdGithubToken(job.analysisId, suppliedToken);
    const responseJob = toPublicAnalysisJob(job);
    void acquireRepository(job.analysisId)
        .then(() => {
        beginRepositoryAnalysis(job.analysisId);
    })
        .catch((error) => {
        console.error('Repository acquisition stopped unexpectedly', error instanceof Error ? error.name : 'error');
    });
    res.status(201).json({
        success: true,
        data: responseJob,
    });
}
export async function createZipAnalysis(req, res) {
    if (!req.user)
        throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const file = req.file;
    try {
        assertZipUpload(file ? { size: file.size, originalname: file.originalname } : undefined);
    }
    catch (error) {
        if (error instanceof ZipExtractError) {
            const status = error.code === 'LIMIT' ? 413 : 400;
            throw new HttpError(status, 'VALIDATION_ERROR', error.message);
        }
        throw error;
    }
    if (!file?.buffer)
        throw new HttpError(400, 'VALIDATION_ERROR', 'A ZIP archive is required.');
    const label = archiveLabel(file.originalname);
    const requestedBranch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
    const branch = requestedBranch || 'uploaded';
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'branch must contain only letters, numbers, and . _ / -');
    }
    const job = createAnalysisJob({
        repositoryUrl: `zip-upload:${label}`,
        repositoryName: label.replace(/\.zip$/i, '') || 'upload',
        branch,
        sourceType: 'zip',
        ownerId: req.user.id,
    });
    void acquireUploadedArchive(job.analysisId, file.buffer)
        .then(() => {
        beginRepositoryAnalysis(job.analysisId);
    })
        .catch((error) => {
        console.error('ZIP acquisition stopped unexpectedly', error instanceof Error ? error.name : 'error');
    });
    res.status(201).json({
        success: true,
        data: toPublicAnalysisJob(job),
    });
}
export async function getAnalysis(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    res.status(200).json({
        success: true,
        data: toPublicAnalysisJob(requireJob(req)),
    });
}
function requireReadyWorkspace(req) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const job = requireJob(req);
    if (job.status !== 'ready' || !job.workspacePath) {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', job.status === 'failed'
            ? (job.errorMessage ?? 'Repository acquisition failed.')
            : 'Repository acquisition is not complete.');
    }
    let expectedWorkspace;
    try {
        expectedWorkspace = analysisWorkspacePath(analysisId);
    }
    catch {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is not valid');
    }
    if (path.resolve(job.workspacePath) !== expectedWorkspace) {
        throw new HttpError(500, 'INTERNAL_ERROR', 'Stored workspace does not match this analysis.');
    }
    return expectedWorkspace;
}
export async function getAnalysisStatus(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const job = requireJob(req);
    if (job.status === 'queued' || job.status === 'acquiring') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
    }
    res.status(200).json({
        success: true,
        data: readRepositoryAnalysisStatus(job),
    });
}
export async function getAnalysisOverview(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const job = requireJob(req);
    if (job.status === 'queued' || job.status === 'acquiring') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
    }
    res.status(200).json({
        success: true,
        data: readRepositoryOverview(job),
    });
}
export async function getAnalysisIssues(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string' || analysisId.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const job = requireJob(req);
    if (job.status === 'queued' || job.status === 'acquiring') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
    }
    if (job.status === 'failed') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', job.errorMessage ?? 'Repository acquisition failed.');
    }
    const result = readRepositoryStaticIssues(job);
    if (result.state === 'pending') {
        const stored = getStoredAnalysisResults(job.analysisId)?.issues;
        if (stored) {
            res.status(200).json({ success: true, data: stored });
            return;
        }
    }
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
export async function getAstAnalysis(req, res) {
    const job = requireJob(req);
    const stored = getStoredAnalysisResults(job.analysisId)?.ast ?? null;
    if (job.status !== 'ready' || !job.workspacePath) {
        if (stored) {
            res.status(200).json({ success: true, data: stored });
            return;
        }
    }
    const workspace = requireReadyWorkspace(req);
    try {
        const result = await withStoredFallback(job.analysisId, () => analyzeAcquiredRepository(job.analysisId, workspace), stored);
        res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
            throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
        }
        throw error;
    }
}
export async function getDependencyAnalysis(req, res) {
    const job = requireJob(req);
    const stored = getStoredAnalysisResults(job.analysisId)?.dependencies ?? null;
    if (job.status !== 'ready' || !job.workspacePath) {
        if (stored) {
            res.status(200).json({ success: true, data: stored });
            return;
        }
    }
    const workspace = requireReadyWorkspace(req);
    try {
        const result = await withStoredFallback(job.analysisId, () => analyzeAcquiredDependencies(job.analysisId, workspace), stored);
        res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
            throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
        }
        throw error;
    }
}
export async function getGitHistory(req, res) {
    const job = requireJob(req);
    const stored = getStoredAnalysisResults(job.analysisId)?.history ?? null;
    if (job.status !== 'ready' || !job.workspacePath) {
        if (stored) {
            res.status(200).json({ success: true, data: stored });
            return;
        }
    }
    const workspace = requireReadyWorkspace(req);
    try {
        const result = await withStoredFallback(job.analysisId, () => analyzeAcquiredGitHistory(job.analysisId, workspace), stored);
        res.status(200).json({ success: true, data: result });
    }
    catch (error) {
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
export async function getStaticAnalysis(req, res) {
    const job = requireJob(req);
    const stored = getStoredAnalysisResults(job.analysisId)?.staticAnalysis ?? null;
    if (job.status !== 'ready' || !job.workspacePath) {
        if (stored) {
            res.status(200).json({ success: true, data: stored });
            return;
        }
    }
    const workspace = requireReadyWorkspace(req);
    try {
        const result = await withStoredFallback(job.analysisId, () => analyzeAcquiredStatic(job.analysisId, workspace), stored);
        res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        if (error instanceof StaticAnalysisUnavailableError) {
            throw new HttpError(503, 'STATIC_ANALYSIS_UNAVAILABLE', error.message);
        }
        if (error instanceof Error && error.message === 'WORKSPACE_MISSING') {
            throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
        }
        throw error;
    }
}
export async function getRepositoryContext(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const mode = req.query.mode;
    if (mode !== 'repository-summary' &&
        mode !== 'file' &&
        mode !== 'experiment-file-baseline' &&
        mode !== 'experiment-file-proposed') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'mode must be repository-summary, file, experiment-file-baseline, or experiment-file-proposed.');
    }
    if (mode !== 'repository-summary' && typeof req.query.path !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'path is required for file context.');
    }
    const workspace = requireReadyWorkspace(req);
    const job = getAnalysisJob(analysisId);
    if (!job) {
        throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
    }
    try {
        const result = await buildAcquiredContext({
            analysisId: job.analysisId,
            repositoryName: job.repositoryName,
            branch: job.branch,
            sourceType: job.sourceType,
        }, workspace, contextRequestFromQuery(mode, req.query.path));
        res.status(200).json({ success: true, data: result });
    }
    catch (error) {
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
function mapLlmError(error) {
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
export async function postAiSummary(req, res) {
    const job = requireJob(req);
    const storedAi = getStoredAnalysisResults(job.analysisId)?.repositoryAi ?? null;
    if (job.status !== 'ready' || !job.workspacePath) {
        if (storedAi) {
            res.status(200).json({ success: true, data: storedAi });
            return;
        }
    }
    const workspace = requireReadyWorkspace(req);
    try {
        requireAiConfig(readAiConfig());
        const context = await buildAcquiredContext({
            analysisId: job.analysisId,
            repositoryName: job.repositoryName,
            branch: job.branch,
            sourceType: job.sourceType,
        }, workspace, { mode: 'repository-summary' });
        const interpretation = await interpretAcquiredContext(`${job.analysisId}:repository-summary`, context);
        rememberRepositoryAi(job.analysisId, interpretation);
        res.status(200).json({ success: true, data: interpretation });
    }
    catch (error) {
        throw mapAnalysisFailure(error);
    }
}
function contextRequestFromQuery(mode, path) {
    if (mode === 'repository-summary')
        return { mode };
    return { mode, path: path };
}
export async function postExperimentBaseline(req, res) {
    await postExperimentInterpretation(req, res, 'baseline');
}
export async function postExperimentProposed(req, res) {
    await postExperimentInterpretation(req, res, 'proposed');
}
async function postExperimentInterpretation(req, res, condition) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const requestedPath = req.body?.path;
    if (typeof requestedPath !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'path is required.');
    }
    const workspace = requireReadyWorkspace(req);
    const job = getAnalysisJob(analysisId);
    if (!job)
        throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
    const contextMode = condition === 'baseline' ? 'experiment-file-baseline' : 'experiment-file-proposed';
    try {
        const normalizedPath = normalizeRepositoryPath(requestedPath);
        const configured = requireAiConfig(readAiConfig());
        const context = await buildAcquiredContext({
            analysisId: job.analysisId,
            repositoryName: job.repositoryName,
            branch: job.branch,
            sourceType: job.sourceType,
        }, workspace, { mode: contextMode, path: requestedPath });
        const interpretation = await interpretAcquiredContext(`${job.analysisId}:${contextMode}:${normalizedPath}`, context);
        const data = {
            condition,
            contextMode,
            path: normalizedPath,
            model: configured.model,
            interpretation,
        };
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        throw mapAnalysisFailure(error);
    }
}
export async function postAiFileSummary(req, res) {
    const analysisId = req.params.analysisId;
    if (typeof analysisId !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'analysisId is required');
    }
    const requestedPath = req.body?.path;
    if (typeof requestedPath !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'path is required.');
    }
    const workspace = requireReadyWorkspace(req);
    const job = getAnalysisJob(analysisId);
    if (!job)
        throw new HttpError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found');
    try {
        normalizeRepositoryPath(requestedPath);
        requireAiConfig(readAiConfig());
        const context = await buildAcquiredContext({
            analysisId: job.analysisId,
            repositoryName: job.repositoryName,
            branch: job.branch,
            sourceType: job.sourceType,
        }, workspace, { mode: 'file', path: requestedPath });
        const interpretation = await interpretAcquiredContext(`${job.analysisId}:file:${normalizeRepositoryPath(requestedPath)}`, context);
        res.status(200).json({ success: true, data: interpretation });
    }
    catch (error) {
        throw mapAnalysisFailure(error);
    }
}
function mapAnalysisFailure(error) {
    if (error instanceof LlmError)
        return mapLlmError(error);
    if (error instanceof ContextRequestError) {
        if (error.code === 'FILE_NOT_FOUND')
            return new HttpError(404, 'FILE_NOT_FOUND', error.message);
        return new HttpError(400, 'VALIDATION_ERROR', error.message);
    }
    if (error instanceof GitHistoryError) {
        if (error.code === 'WORKSPACE_MISSING') {
            return new HttpError(409, 'ACQUISITION_NOT_READY', 'Acquired workspace is no longer available.');
        }
        if (error.code === 'NO_GIT_REPOSITORY')
            return new HttpError(422, 'GIT_HISTORY_UNAVAILABLE', error.message);
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
export async function getTechnicalDebt(req, res) {
    const job = requireJob(req);
    if (job.status === 'queued' || job.status === 'acquiring') {
        throw new HttpError(409, 'ACQUISITION_NOT_READY', 'Repository acquisition is not complete.');
    }
    const result = readTechnicalDebt(job);
    if (result.state === 'failed') {
        throw new HttpError(422, 'ACQUISITION_FAILED', result.message);
    }
    if (result.state === 'unavailable') {
        throw new HttpError(422, 'DEBT_UNAVAILABLE', result.message);
    }
    if (result.state === 'pending') {
        throw new HttpError(409, 'DEBT_NOT_READY', 'Technical debt indicators are not ready yet.');
    }
    res.status(200).json({ success: true, data: result.report });
}
export async function getAnalysisReport(req, res) {
    const job = requireJob(req);
    res.status(200).json({ success: true, data: buildAnalysisReport(job) });
}
export async function getAnalysisReportHtml(req, res) {
    const job = requireJob(req);
    res.status(200).type('html').send(renderAnalysisReportHtml(buildAnalysisReport(job)));
}
async function withStoredFallback(analysisId, load, stored) {
    try {
        return await load();
    }
    catch (error) {
        if (stored && isWorkspaceUnavailable(error))
            return stored;
        throw error;
    }
}
function isWorkspaceUnavailable(error) {
    if (error instanceof GitHistoryError && error.code === 'WORKSPACE_MISSING')
        return true;
    return error instanceof Error && error.message === 'WORKSPACE_MISSING';
}
