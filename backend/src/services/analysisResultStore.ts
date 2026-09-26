import type { AnalysisJob } from '../types/analysis.js';
import type { RepositoryOverview } from '../types/analysisOverview.js';
import type { AstAnalysisResult } from '../types/ast.js';
import type { DependencyAnalysisResult } from '../types/dependency.js';
import type { GitHistoryResult } from '../types/gitHistory.js';
import type { StaticAnalysisResult, StaticFinding } from '../types/staticAnalysis.js';
import type { AiInterpretation } from '../types/ai.js';
import type { TechnicalDebtReport } from '../types/technicalDebt.js';

export interface StoredStaticIssues {
  analysisId: string;
  findings: StaticFinding[];
  summary: {
    findingCount: number;
    errorCount: number;
    warningCount: number;
    truncated: boolean;
  };
  limitations: string[];
}

/**
 * In-process copy of analyzer output.
 * persistenceService mirrors this when MongoDB is configured.
 * Payloads contain analyzer evidence only: no tokens, keys, or workspace paths.
 */
export interface StoredAnalysisResults {
  analysisId: string;
  savedAt: string;
  overview: RepositoryOverview | null;
  issues: StoredStaticIssues | null;
  ast: AstAnalysisResult | null;
  dependencies: DependencyAnalysisResult | null;
  history: GitHistoryResult | null;
  staticAnalysis: StaticAnalysisResult | null;
  debt: TechnicalDebtReport | null;
  repositoryAi: AiInterpretation | null;
  reduced: boolean;
}

const results = new Map<string, StoredAnalysisResults>();
type ResultHandler = (stored: StoredAnalysisResults) => void;
let resultHandler: ResultHandler | null = null;

const MAX_JSON_CHARS = 12_000_000;

export function setAnalysisResultHandler(handler: ResultHandler | null): void {
  resultHandler = handler;
}

export function getStoredAnalysisResults(analysisId: string): StoredAnalysisResults | undefined {
  return results.get(analysisId);
}

export function restoreStoredAnalysisResults(stored: StoredAnalysisResults): void {
  results.set(stored.analysisId, stored);
}

export function saveStoredAnalysisResults(
  job: Pick<AnalysisJob, 'analysisId'>,
  patch: Partial<Omit<StoredAnalysisResults, 'analysisId' | 'savedAt'>>,
): StoredAnalysisResults {
  const current = results.get(job.analysisId);
  const next: StoredAnalysisResults = {
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

export function rememberRepositoryAi(analysisId: string, interpretation: AiInterpretation): void {
  const current = results.get(analysisId);
  if (!current) {
    saveStoredAnalysisResults({ analysisId }, { repositoryAi: interpretation });
    return;
  }
  saveStoredAnalysisResults({ analysisId }, { repositoryAi: interpretation });
}

function boundResultSize(stored: StoredAnalysisResults): StoredAnalysisResults {
  if (jsonSize(stored) <= MAX_JSON_CHARS) return stored;
  const reduced: StoredAnalysisResults = {
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

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return MAX_JSON_CHARS + 1;
  }
}
