import { Router } from 'express';
import {
  createAnalysis,
  getAnalysis,
  getAnalysisOverview,
  getAnalysisIssues,
  getAnalysisStatus,
  getAnalysisStub,
  getAstAnalysis,
  getDependencyAnalysis,
  getGitHistory,
  getRepositoryContext,
  getStaticAnalysis,
  postAiFileSummary,
  postAiSummary,
  postExperimentBaseline,
  postExperimentProposed,
} from '../controllers/analysisController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const analysisRouter = Router();

analysisRouter.post('/', asyncHandler(createAnalysis));
analysisRouter.get('/:analysisId', asyncHandler(getAnalysis));
analysisRouter.get('/:analysisId/status', asyncHandler(getAnalysisStatus));
analysisRouter.get('/:analysisId/ast', asyncHandler(getAstAnalysis));
analysisRouter.get('/:analysisId/overview', asyncHandler(getAnalysisOverview));
analysisRouter.get('/:analysisId/issues', asyncHandler(getAnalysisIssues));
analysisRouter.get('/:analysisId/debt', asyncHandler(getAnalysisStub));
analysisRouter.get('/:analysisId/dependencies', asyncHandler(getDependencyAnalysis));
analysisRouter.get('/:analysisId/history', asyncHandler(getGitHistory));
analysisRouter.get('/:analysisId/static', asyncHandler(getStaticAnalysis));
analysisRouter.get('/:analysisId/context', asyncHandler(getRepositoryContext));
analysisRouter.post('/:analysisId/ai-summary/file', asyncHandler(postAiFileSummary));
analysisRouter.post('/:analysisId/ai-summary/experiment/baseline', asyncHandler(postExperimentBaseline));
analysisRouter.post('/:analysisId/ai-summary/experiment/proposed', asyncHandler(postExperimentProposed));
analysisRouter.post('/:analysisId/ai-summary', asyncHandler(postAiSummary));
