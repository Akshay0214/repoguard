import path from 'node:path';
import type { AnalysisJob } from '../types/analysis.js';
import type {
  OverviewAst,
  OverviewDependencies,
  OverviewHistory,
  OverviewStatic,
  RepositoryOverview,
} from '../types/analysisOverview.js';
import type { AnalysisModuleStatus, AnalysisReadiness, RepositoryAnalysisStatus } from '../types/analysisStatus.js';
import type { AstAnalysisResult } from '../types/ast.js';
import type { DependencyAnalysisResult } from '../types/dependency.js';
import type { GitHistoryResult } from '../types/gitHistory.js';
import type { StaticAnalysisResult, StaticFinding } from '../types/staticAnalysis.js';
import { getAnalysisJob } from './analysisService.js';
import { analyzeAcquiredRepository } from './astAnalysisService.js';
import { analyzeAcquiredDependencies } from './dependencyAnalysisService.js';
import { analyzeAcquiredGitHistory, GitHistoryError } from './gitHistoryAnalysisService.js';
import { analysisWorkspacePath } from './repositoryAcquisitionService.js';
import { analyzeAcquiredStatic, StaticAnalysisUnavailableError } from './staticAnalysisService.js';

/**
 * Tracks whether the four repository analyzers have finished.
 * It calls the existing cached analyzer functions and does not reimplement them.
 * LLM interpretation is intentionally not a module here.
 */

type ModuleName = keyof AnalysisReadiness['modules'];

interface ModuleRecord {
  status: AnalysisModuleStatus;
  limitations: string[];
}

interface AnalysisRun {
  modules: Record<ModuleName, ModuleRecord>;
  ast: OverviewAst | null;
  dependencies: OverviewDependencies | null;
  static: OverviewStatic | null;
  history: OverviewHistory | null;
  staticFindings: StaticFinding[] | null;
}

export interface RepositoryStaticIssues {
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

const MODULES: ModuleName[] = ['ast', 'dependencies', 'static', 'history'];
const runs = new Map<string, AnalysisRun>();

export function beginRepositoryAnalysis(analysisId: string): void {
  if (runs.has(analysisId)) return;
  const job = getAnalysisJob(analysisId);
  if (!job || job.status !== 'ready' || !job.workspacePath) return;

  let workspace: string;
  try {
    workspace = analysisWorkspacePath(analysisId);
  } catch {
    return;
  }
  if (path.resolve(job.workspacePath) !== workspace) return;

  const run: AnalysisRun = {
    modules: {
      ast: { status: 'running', limitations: [] },
      dependencies: { status: 'running', limitations: [] },
      static: { status: 'running', limitations: [] },
      history: { status: 'running', limitations: [] },
    },
    ast: null,
    dependencies: null,
    static: null,
    history: null,
    staticFindings: null,
  };
  runs.set(analysisId, run);
  void settle(run, analysisId, workspace);
}

export function readRepositoryOverview(job: AnalysisJob): RepositoryOverview {
  const readiness = readRepositoryAnalysisStatus(job);
  const run = runs.get(job.analysisId);
  const identity = splitRepositoryName(job.repositoryName);
  const status = readiness.status === 'queued' || readiness.status === 'acquiring' ? 'analyzing' : readiness.status;
  return {
    analysisId: job.analysisId,
    repository: {
      name: identity.name,
      owner: identity.owner,
      branch: job.branch,
      sourceType: job.sourceType,
      repositoryUrl: job.repositoryUrl,
    },
    readiness: {
      status,
      modules: readiness.modules,
      limitations: readiness.limitations,
    },
    ast: run?.ast ?? null,
    dependencies: run?.dependencies ?? null,
    static: run?.static ?? null,
    history: run?.history ?? null,
  };
}

export function readRepositoryStaticIssues(
  job: AnalysisJob,
):
  | { state: 'pending' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; issues: RepositoryStaticIssues } {
  readRepositoryAnalysisStatus(job);
  const run = runs.get(job.analysisId);
  const moduleStatus = run?.modules.static.status ?? 'pending';
  if (moduleStatus === 'failed') {
    return { state: 'failed', message: run?.modules.static.limitations[0] ?? 'Static analysis failed.' };
  }
  if (moduleStatus !== 'ready' || !run?.static || run.staticFindings === null) {
    return { state: 'pending' };
  }
  return {
    state: 'ready',
    issues: {
      analysisId: job.analysisId,
      findings: run.staticFindings,
      summary: {
        findingCount: run.static.findingCount,
        errorCount: run.static.errorCount,
        warningCount: run.static.warningCount,
        truncated: run.static.truncated,
      },
      limitations: run.modules.static.limitations,
    },
  };
}

export function readRepositoryAnalysisStatus(job: AnalysisJob): AnalysisReadiness {
  if (job.status === 'ready') beginRepositoryAnalysis(job.analysisId);
  const run = runs.get(job.analysisId);
  const modules = run ? moduleSnapshot(run) : pendingModules();
  return {
    analysisId: job.analysisId,
    status: overallStatus(job, modules),
    acquisition: { status: acquisitionStatus(job) },
    modules,
    limitations: limitationsFor(job, run),
  };
}

async function settle(run: AnalysisRun, analysisId: string, workspace: string): Promise<void> {
  await Promise.all([
    finish(run, 'ast', workspace, analyzeAcquiredRepository(analysisId, workspace), astLimitations, (result) => {
      run.ast = {
        totalFiles: result.summary.totalFiles,
        totalLines: result.summary.totalLines,
        totalFunctions: result.summary.totalFunctions,
        totalClasses: result.summary.totalClasses,
        totalImports: result.summary.totalImports,
        totalExports: result.summary.totalExports,
        parseErrors: result.summary.parseErrors,
        maxNestingDepth: result.summary.maxNestingDepth,
        filesDiscovered: result.summary.filesDiscovered,
        skippedOversizeFiles: result.summary.skippedOversizeFiles,
        truncated: result.summary.truncated,
      };
    }),
    finish(run, 'dependencies', workspace, analyzeAcquiredDependencies(analysisId, workspace), dependencyLimitations, (result) => {
      run.dependencies = {
        totalInternalNodes: result.summary.totalInternalNodes,
        totalInternalEdges: result.summary.totalInternalEdges,
        totalExternalPackages: result.summary.totalExternalPackages,
        unresolvedImports: result.summary.unresolvedImports,
        filesWithDependencies: result.summary.filesWithDependencies,
        filesWithNoDependencies: result.summary.filesWithNoDependencies,
        maxOutgoingInternalDependencies: result.summary.maxOutgoingInternalDependencies,
        filesDiscovered: result.summary.filesDiscovered,
        parseErrors: result.summary.parseErrors,
        truncated: result.summary.truncated,
      };
    }),
    finish(run, 'static', workspace, analyzeAcquiredStatic(analysisId, workspace), staticLimitations, (result) => {
      run.staticFindings = result.findings;
      run.static = staticOverview(result);
    }),
    finish(run, 'history', workspace, analyzeAcquiredGitHistory(analysisId, workspace), historyLimitations, (result) => {
      run.history = {
        availableCommits: result.summary.availableCommits,
        uniqueAuthors: result.summary.uniqueAuthors,
        totalFileChanges: result.summary.totalFileChanges,
        totalAdditions: result.summary.totalAdditions,
        totalDeletions: result.summary.totalDeletions,
        historyDepth: result.summary.historyDepth,
        isComplete: result.summary.isComplete,
        commitsWithoutFileDiff: result.summary.commitsWithoutFileDiff,
      };
    }),
  ]);
}

async function finish<T>(
  run: AnalysisRun,
  name: ModuleName,
  workspace: string,
  pending: Promise<T>,
  limitationsFrom: (result: T) => string[],
  store: (result: T) => void,
): Promise<void> {
  try {
    const result = await pending;
    run.modules[name] = { status: 'ready', limitations: limitationsFrom(result) };
    store(result);
  } catch (error) {
    run.modules[name] = { status: 'failed', limitations: [failureLimitation(name, error, workspace)] };
  }
}

function astLimitations(result: AstAnalysisResult): string[] {
  const limitations: string[] = [];
  if (result.summary.parseErrors > 0) {
    limitations.push(`${result.summary.parseErrors} source files could not be parsed.`);
  }
  if (result.summary.skippedOversizeFiles > 0) {
    limitations.push(`${result.summary.skippedOversizeFiles} files were skipped because they exceed the file size limit.`);
  }
  if (result.summary.truncated) limitations.push('AST file discovery stopped at the file limit.');
  return limitations;
}

function dependencyLimitations(result: DependencyAnalysisResult): string[] {
  const limitations: string[] = [];
  if (result.summary.parseErrors > 0) {
    limitations.push(`${result.summary.parseErrors} source files could not be parsed for dependencies.`);
  }
  if (result.summary.unresolvedImports > 0) {
    limitations.push(`${result.summary.unresolvedImports} dependency references could not be resolved.`);
  }
  if (result.summary.truncated) limitations.push('Dependency file discovery stopped at the file limit.');
  return limitations;
}

function staticLimitations(result: StaticAnalysisResult): string[] {
  const limitations: string[] = [];
  if (result.summary.truncated) limitations.push('Static analysis stopped before the repository was fully checked.');
  for (const issue of result.issues) {
    if (issue.kind === 'limit' && issue.path === null) limitations.push(issue.message);
  }
  const parseCount = result.issues.filter((issue) => issue.kind === 'parse').length;
  if (parseCount > 0) {
    limitations.push(`${parseCount} files could not be parsed by static analysis. Those are issues, not rule findings.`);
  }
  const executionCount = result.issues.filter((issue) => issue.kind === 'execution').length;
  if (executionCount > 0) limitations.push(`Static analysis failed to execute on ${executionCount} files.`);
  const sizeCount = result.issues.filter((issue) => issue.kind === 'limit' && issue.path !== null).length;
  if (sizeCount > 0) {
    limitations.push(`${sizeCount} files exceeded the source size limit and were not statically analyzed.`);
  }
  return limitations;
}

function historyLimitations(result: GitHistoryResult): string[] {
  const limitations: string[] = [];
  if (result.summary.historyDepth === 'shallow' || !result.summary.isComplete) {
    limitations.push('Git history is shallow and incomplete.');
  }
  if (result.summary.commitsWithoutFileDiff > 0) {
    const count = result.summary.commitsWithoutFileDiff;
    const commits = count === 1 ? 'commit has' : 'commits have';
    const parents = count === 1 ? 'its parent is' : 'their parents are';
    limitations.push(`${count} ${commits} no file diff because ${parents} outside this clone.`);
  }
  for (const error of result.errors) {
    if (!limitations.includes(error.message)) limitations.push(error.message);
  }
  return limitations;
}

function failureLimitation(name: ModuleName, error: unknown, workspace: string): string {
  if (error instanceof StaticAnalysisUnavailableError) return 'ESLint is not available.';
  if (error instanceof GitHistoryError) return stripWorkspace(error.message, workspace);
  if (error instanceof Error && error.message === 'WORKSPACE_MISSING') return 'Acquired workspace is no longer available.';
  if (name === 'ast') return 'AST analysis failed.';
  if (name === 'dependencies') return 'Dependency analysis failed.';
  if (name === 'static') return 'Static analysis failed.';
  return 'Git history analysis failed.';
}

function stripWorkspace(message: string, workspace: string): string {
  const stripped = message.split(workspace).join('').split(workspace.replaceAll('\\', '/')).join('');
  const first = stripped.split('\n')[0]?.trim() || 'Analysis failed.';
  return first.slice(0, 240);
}

function acquisitionStatus(job: AnalysisJob): AnalysisReadiness['acquisition']['status'] {
  if (job.status === 'queued') return 'pending';
  if (job.status === 'acquiring') return 'running';
  if (job.status === 'failed') return 'failed';
  return 'ready';
}

function overallStatus(job: AnalysisJob, modules: AnalysisReadiness['modules']): RepositoryAnalysisStatus {
  if (job.status === 'queued') return 'queued';
  if (job.status === 'acquiring') return 'acquiring';
  if (job.status === 'failed') return 'failed';
  if (!job.workspacePath) return 'failed';
  const values = MODULES.map((name) => modules[name]);
  if (values.some((status) => status === 'pending' || status === 'running')) return 'analyzing';
  const failed = values.filter((status) => status === 'failed').length;
  if (failed === values.length) return 'failed';
  if (failed > 0) return 'partial';
  return 'ready';
}

function limitationsFor(job: AnalysisJob, run: AnalysisRun | undefined): string[] {
  if (job.status === 'failed') return job.errorMessage ? [job.errorMessage] : ['Repository acquisition failed.'];
  if (job.status === 'ready' && !job.workspacePath) return ['Acquired workspace is no longer available.'];
  if (!run) return [];
  return MODULES.flatMap((name) => run.modules[name].limitations);
}

function moduleSnapshot(run: AnalysisRun): AnalysisReadiness['modules'] {
  return {
    ast: run.modules.ast.status,
    dependencies: run.modules.dependencies.status,
    static: run.modules.static.status,
    history: run.modules.history.status,
  };
}

function pendingModules(): AnalysisReadiness['modules'] {
  return { ast: 'pending', dependencies: 'pending', static: 'pending', history: 'pending' };
}

function splitRepositoryName(repositoryName: string): { owner: string | null; name: string } {
  const parts = repositoryName.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) return { owner: parts[0], name: parts[1] };
  return { owner: null, name: repositoryName };
}

function staticOverview(result: StaticAnalysisResult): OverviewStatic {
  const counts = new Map<string, OverviewStatic['rules'][number]>();
  for (const finding of result.findings) {
    const key = `${finding.ruleId}\0${finding.severity}\0${finding.category ?? ''}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else {
      counts.set(key, {
        ruleId: finding.ruleId,
        severity: finding.severity,
        category: finding.category,
        count: 1,
      });
    }
  }
  return {
    filesAnalyzed: result.summary.filesAnalyzed,
    findingCount: result.summary.findingCount,
    errorCount: result.summary.errorCount,
    warningCount: result.summary.warningCount,
    truncated: result.summary.truncated,
    repositoryConfigUsed: false,
    ruleSet: 'repoguard-fixed',
    issueCounts: {
      execution: result.issues.filter((issue) => issue.kind === 'execution').length,
      parse: result.issues.filter((issue) => issue.kind === 'parse').length,
      limit: result.issues.filter((issue) => issue.kind === 'limit').length,
    },
    rules: [...counts.values()]
      .sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.severity.localeCompare(right.severity))
      .slice(0, 20),
  };
}
