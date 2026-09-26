import type { CreateGithubAnalysisRequest } from '../types/analysis.js';
import { HttpError } from './httpError.js';
import { parseGithubRepositoryName } from './githubRepository.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateCreateAnalysisRequest(body: unknown): CreateGithubAnalysisRequest & {
  repositoryName: string;
} {
  if (!isRecord(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  if (body.sourceType !== 'github') {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'sourceType must be "github". ZIP upload is not supported yet.',
    );
  }

  if (typeof body.repositoryUrl !== 'string' || body.repositoryUrl.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'repositoryUrl is required');
  }

  if (body.branch !== undefined && (typeof body.branch !== 'string' || body.branch.trim() === '')) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'branch must be a non-empty string');
  }

  const repositoryUrl = body.repositoryUrl.trim();
  const repositoryName = parseGithubRepositoryName(repositoryUrl);
  if (!repositoryName) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'repositoryUrl must include a GitHub owner and repository',
    );
  }

  return {
    sourceType: 'github',
    repositoryUrl,
    branch: typeof body.branch === 'string' ? body.branch.trim() : 'main',
    repositoryName,
  };
}
