import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { createAnalysis, createZipAnalysis, getAnalysis, getAnalysisOverview, getAnalysisIssues, getAnalysisReport, getAnalysisReportHtml, getAnalysisStatus, getAstAnalysis, getDependencyAnalysis, getGitHistory, getRepositoryContext, getStaticAnalysis, getTechnicalDebt, postAiFileSummary, postAiSummary, postExperimentBaseline, postExperimentProposed, } from '../controllers/analysisController.js';
import { requireUser } from '../middleware/requireUser.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: env.maxZipBytes,
    },
});
export const analysisRouter = Router();
analysisRouter.use(requireUser);
analysisRouter.post('/upload', upload.single('archive'), asyncHandler(createZipAnalysis));
analysisRouter.post('/', asyncHandler(createAnalysis));
analysisRouter.get('/:analysisId', asyncHandler(getAnalysis));
analysisRouter.get('/:analysisId/status', asyncHandler(getAnalysisStatus));
analysisRouter.get('/:analysisId/ast', asyncHandler(getAstAnalysis));
analysisRouter.get('/:analysisId/overview', asyncHandler(getAnalysisOverview));
analysisRouter.get('/:analysisId/issues', asyncHandler(getAnalysisIssues));
analysisRouter.get('/:analysisId/debt', asyncHandler(getTechnicalDebt));
analysisRouter.get('/:analysisId/dependencies', asyncHandler(getDependencyAnalysis));
analysisRouter.get('/:analysisId/history', asyncHandler(getGitHistory));
analysisRouter.get('/:analysisId/static', asyncHandler(getStaticAnalysis));
analysisRouter.get('/:analysisId/context', asyncHandler(getRepositoryContext));
analysisRouter.get('/:analysisId/report.html', asyncHandler(getAnalysisReportHtml));
analysisRouter.get('/:analysisId/report', asyncHandler(getAnalysisReport));
analysisRouter.post('/:analysisId/ai-summary/file', asyncHandler(postAiFileSummary));
analysisRouter.post('/:analysisId/ai-summary/experiment/baseline', asyncHandler(postExperimentBaseline));
analysisRouter.post('/:analysisId/ai-summary/experiment/proposed', asyncHandler(postExperimentProposed));
analysisRouter.post('/:analysisId/ai-summary', asyncHandler(postAiSummary));
