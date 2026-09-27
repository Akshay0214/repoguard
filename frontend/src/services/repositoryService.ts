// Frontend service layer for RepoGuard.
//
// Every function here returns a Promise and is shaped the way a real
// HTTP client call would look (e.g. `fetch('/api/repository/overview')`).
// analyzeRepository, overview, issues, dependencies, file AI, repository AI,
// technical debt, and Git history call the API.

import type { AnalysisJob, AnalysisProgressStep, AnalysisStatus, AnalyzeRequest } from '@/types';
import { ApiError, getJson, getText, postForm, postJson } from '@/services/apiClient';

export type RepositoryModuleStatus = 'pending' | 'running' | 'ready' | 'failed';

export type RepositoryReadinessStatus = 'queued' | 'acquiring' | 'analyzing' | 'ready' | 'partial' | 'failed';

export interface RepositoryAnalysisStatus {
  analysisId: string;
  status: RepositoryReadinessStatus;
  acquisition: { status: 'pending' | 'running' | 'ready' | 'failed' };
  modules: {
    ast: RepositoryModuleStatus;
    dependencies: RepositoryModuleStatus;
    static: RepositoryModuleStatus;
    history: RepositoryModuleStatus;
  };
  limitations: string[];
}

const ANALYSIS_STATUSES: readonly AnalysisStatus[] = ['idle', 'queued', 'running', 'completed', 'failed'];

function isAnalysisStatus(value: unknown): value is AnalysisStatus {
  return typeof value === 'string' && ANALYSIS_STATUSES.some((status) => status === value);
}

function readCreatedAnalysis(payload: unknown): {
  analysisId: string;
  repositoryUrl: string;
  repositoryName: string;
  branch: string;
  sourceType: 'github' | 'zip';
  status: AnalysisStatus;
  createdAt: string;
} {
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected analysis response.', 0);
  }

  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected analysis response.', 0);
  }

  const data = envelope.data as {
    analysisId?: unknown;
    repositoryUrl?: unknown;
    repositoryName?: unknown;
    branch?: unknown;
    sourceType?: unknown;
    status?: unknown;
    createdAt?: unknown;
  };

  if (typeof data.analysisId !== 'string' || data.analysisId.trim() === '') {
    throw new ApiError('The API returned an unexpected analysis response.', 0);
  }
  if (typeof data.repositoryUrl !== 'string' || typeof data.repositoryName !== 'string' || typeof data.branch !== 'string') {
    throw new ApiError('The API returned an unexpected analysis response.', 0);
  }
  if ((data.sourceType !== 'github' && data.sourceType !== 'zip') || !isAnalysisStatus(data.status)) {
    throw new ApiError('The API returned an unexpected analysis response.', 0);
  }

  return {
    analysisId: data.analysisId,
    repositoryUrl: data.repositoryUrl,
    repositoryName: data.repositoryName,
    branch: data.branch,
    sourceType: data.sourceType,
    status: data.status,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
  };
}

/**
 * Creates an analysis job for a GitHub repository or an uploaded ZIP.
 * A GitHub token is sent only as a request header and is not stored.
 */
export async function analyzeRepository(
  request: AnalyzeRequest,
  _onProgress?: (steps: AnalysisProgressStep[], percent: number) => void,
): Promise<AnalysisJob> {
  if (request.source === 'upload') {
    if (!request.file) throw new ApiError('A ZIP archive is required.', 400);
    const form = new FormData();
    form.append('archive', request.file);
    if (request.branch?.trim()) form.append('branch', request.branch.trim());
    const payload = await postForm('/analyses/upload', form);
    const created = readCreatedAnalysis(payload);
    return {
      id: created.analysisId,
      status: created.status,
      progress: 0,
      steps: [],
      startedAt: created.createdAt,
      repositoryUrl: created.repositoryUrl,
      repositoryName: created.repositoryName,
      branch: created.branch,
      sourceType: created.sourceType,
    };
  }

  const repositoryUrl = request.githubUrl?.trim() ?? '';
  const branch = request.branch?.trim() || 'main';
  if (!repositoryUrl) {
    throw new ApiError('A repository URL is required.', 400);
  }

  const headers: Record<string, string> = {};
  const token = request.githubToken?.trim();
  if (token) headers['X-GitHub-Token'] = token;

  const payload = await postJson(
    '/analyses',
    {
      sourceType: 'github',
      repositoryUrl,
      branch,
    },
    'Unable to start repository analysis. Please check the repository URL and try again.',
    headers,
  );
  const created = readCreatedAnalysis(payload);

  return {
    id: created.analysisId,
    status: created.status,
    progress: 0,
    steps: [],
    startedAt: created.createdAt,
    repositoryUrl: created.repositoryUrl,
    repositoryName: created.repositoryName,
    branch: created.branch,
    sourceType: created.sourceType,
  };
}

const MODULE_STATUSES: readonly RepositoryModuleStatus[] = ['pending', 'running', 'ready', 'failed'];
const READINESS_STATUSES: readonly RepositoryReadinessStatus[] = ['queued', 'acquiring', 'analyzing', 'ready', 'partial', 'failed'];

function isModuleStatus(value: unknown): value is RepositoryModuleStatus {
  return typeof value === 'string' && MODULE_STATUSES.some((status) => status === value);
}

function isReadinessStatus(value: unknown): value is RepositoryReadinessStatus {
  return typeof value === 'string' && READINESS_STATUSES.some((status) => status === value);
}

export async function getAnalysisStatus(analysisId: string): Promise<RepositoryAnalysisStatus> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/status`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected analysis status.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected analysis status.', 0);
  }
  const data = envelope.data as {
    analysisId?: unknown;
    status?: unknown;
    acquisition?: { status?: unknown };
    modules?: {
      ast?: unknown;
      dependencies?: unknown;
      static?: unknown;
      history?: unknown;
    };
    limitations?: unknown;
  };
  const modules = data.modules;
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : null;
  if (
    data.analysisId !== analysisId ||
    !isReadinessStatus(data.status) ||
    !modules ||
    !isModuleStatus(modules.ast) ||
    !isModuleStatus(modules.dependencies) ||
    !isModuleStatus(modules.static) ||
    !isModuleStatus(modules.history) ||
    !limitations ||
    (data.acquisition?.status !== 'pending' &&
      data.acquisition?.status !== 'running' &&
      data.acquisition?.status !== 'ready' &&
      data.acquisition?.status !== 'failed')
  ) {
    throw new ApiError('The API returned an unexpected analysis status.', 0);
  }
  return {
    analysisId: data.analysisId,
    status: data.status,
    acquisition: { status: data.acquisition.status },
    modules: {
      ast: modules.ast,
      dependencies: modules.dependencies,
      static: modules.static,
      history: modules.history,
    },
    limitations,
  };
}

export interface AnalysisOverview {
  analysisId: string;
  repository: {
    name: string;
    owner: string | null;
    branch: string;
    sourceType: string;
    repositoryUrl: string;
  };
  readiness: {
    status: RepositoryReadinessStatus;
    modules: RepositoryAnalysisStatus['modules'];
    limitations: string[];
  };
  ast: {
    totalFiles: number;
    totalLines: number;
    totalFunctions: number;
    totalClasses: number;
    parseErrors: number;
    filesDiscovered: number;
  } | null;
  dependencies: {
    totalInternalNodes: number;
    totalInternalEdges: number;
    totalExternalPackages: number;
    unresolvedImports: number;
  } | null;
  static: {
    filesAnalyzed: number;
    findingCount: number;
    errorCount: number;
    warningCount: number;
  } | null;
  history: {
    availableCommits: number;
    uniqueAuthors: number;
    historyDepth: string;
    isComplete: boolean;
  } | null;
  health: {
    disclaimer: string;
    formula: string;
    heuristicScore: number | null;
    omittedInputs: string[];
    indicators: Array<{ id: string; label: string; value: number | string | null; available: boolean }>;
  } | null;
  debt: {
    disclaimer: string;
    summary: { itemCount: number; estimatedContribution: number };
    limitations: string[];
  } | null;
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readSection<T extends object>(value: unknown, fields: Array<keyof T>): T | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const section = {} as T;
  for (const field of fields) {
    const count = readCount(record[field as string]);
    if (count === null) return null;
    section[field] = count as T[keyof T];
  }
  return section;
}

function readHealth(value: unknown): AnalysisOverview['health'] {
  if (typeof value !== 'object' || value === null) return null;
  const health = value as {
    disclaimer?: unknown;
    formula?: unknown;
    heuristicScore?: unknown;
    omittedInputs?: unknown;
    indicators?: unknown;
  };
  if (typeof health.disclaimer !== 'string' || typeof health.formula !== 'string' || !Array.isArray(health.indicators)) {
    return null;
  }
  const score = health.heuristicScore === null ? null : readCount(health.heuristicScore);
  if (health.heuristicScore !== null && score === null) return null;
  const indicators = health.indicators.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const indicator = item as { id?: unknown; label?: unknown; value?: unknown; available?: unknown };
    if (typeof indicator.id !== 'string' || typeof indicator.label !== 'string' || typeof indicator.available !== 'boolean') {
      return [];
    }
    const indicatorValue =
      indicator.value === null || typeof indicator.value === 'string' || typeof indicator.value === 'number'
        ? indicator.value
        : null;
    return [{ id: indicator.id, label: indicator.label, value: indicatorValue, available: indicator.available }];
  });
  const omittedInputs = Array.isArray(health.omittedInputs)
    ? health.omittedInputs.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    disclaimer: health.disclaimer,
    formula: health.formula,
    heuristicScore: score,
    omittedInputs,
    indicators,
  };
}

function readDebtSummary(value: unknown): AnalysisOverview['debt'] {
  if (value === null || typeof value !== 'object') return null;
  const debt = value as {
    disclaimer?: unknown;
    summary?: { itemCount?: unknown; estimatedContribution?: unknown };
    limitations?: unknown;
  };
  if (
    typeof debt.disclaimer !== 'string' ||
    typeof debt.summary?.itemCount !== 'number' ||
    typeof debt.summary.estimatedContribution !== 'number'
  ) {
    return null;
  }
  return {
    disclaimer: debt.disclaimer,
    summary: {
      itemCount: debt.summary.itemCount,
      estimatedContribution: debt.summary.estimatedContribution,
    },
    limitations: Array.isArray(debt.limitations)
      ? debt.limitations.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export async function getAnalysisOverview(analysisId: string): Promise<AnalysisOverview> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/overview`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected repository overview.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected repository overview.', 0);
  }
  const data = envelope.data as {
    analysisId?: unknown;
    repository?: {
      name?: unknown;
      owner?: unknown;
      branch?: unknown;
      sourceType?: unknown;
      repositoryUrl?: unknown;
    };
    readiness?: {
      status?: unknown;
      modules?: RepositoryAnalysisStatus['modules'];
      limitations?: unknown;
    };
    ast?: unknown;
    dependencies?: unknown;
    static?: unknown;
    history?: unknown;
  };
  const modules = data.readiness?.modules;
  const limitations = Array.isArray(data.readiness?.limitations)
    ? data.readiness.limitations.filter((item): item is string => typeof item === 'string')
    : null;
  const ast = readSection<NonNullable<AnalysisOverview['ast']>>(data.ast, [
    'totalFiles',
    'totalLines',
    'totalFunctions',
    'totalClasses',
    'parseErrors',
    'filesDiscovered',
  ]);
  const dependencies = readSection<NonNullable<AnalysisOverview['dependencies']>>(data.dependencies, [
    'totalInternalNodes',
    'totalInternalEdges',
    'totalExternalPackages',
    'unresolvedImports',
  ]);
  const staticSummary = readSection<NonNullable<AnalysisOverview['static']>>(data.static, [
    'filesAnalyzed',
    'findingCount',
    'errorCount',
    'warningCount',
  ]);
  const history = data.history === null
    ? null
    : typeof data.history === 'object' && data.history !== null
      ? data.history as { availableCommits?: unknown; uniqueAuthors?: unknown; historyDepth?: unknown; isComplete?: unknown }
      : undefined;
  const historyCounts = history
    ? {
        availableCommits: readCount(history.availableCommits),
        uniqueAuthors: readCount(history.uniqueAuthors),
      }
    : null;
  if (
    data.analysisId !== analysisId ||
    typeof data.repository?.name !== 'string' ||
    (data.repository.owner !== null && typeof data.repository.owner !== 'string') ||
    typeof data.repository.branch !== 'string' ||
    typeof data.repository.sourceType !== 'string' ||
    typeof data.repository.repositoryUrl !== 'string' ||
    !isReadinessStatus(data.readiness?.status) ||
    !modules ||
    !isModuleStatus(modules.ast) ||
    !isModuleStatus(modules.dependencies) ||
    !isModuleStatus(modules.static) ||
    !isModuleStatus(modules.history) ||
    !limitations ||
    (data.ast !== null && !ast) ||
    (data.dependencies !== null && !dependencies) ||
    (data.static !== null && !staticSummary) ||
    history === undefined ||
    (history !== null && (historyCounts?.availableCommits === null || historyCounts?.uniqueAuthors === null || typeof history.historyDepth !== 'string' || typeof history.isComplete !== 'boolean'))
  ) {
    throw new ApiError('The API returned an unexpected repository overview.', 0);
  }
  const historyDepth = history === null ? null : history.historyDepth;
  const historyComplete = history === null ? null : history.isComplete;
  const historyOverview =
    history === null ||
    !historyCounts ||
    historyCounts.availableCommits === null ||
    historyCounts.uniqueAuthors === null ||
    typeof historyDepth !== 'string' ||
    typeof historyComplete !== 'boolean'
      ? null
      : {
          availableCommits: historyCounts.availableCommits,
          uniqueAuthors: historyCounts.uniqueAuthors,
          historyDepth,
          isComplete: historyComplete,
        };
  return {
    analysisId,
    repository: {
      name: data.repository.name,
      owner: data.repository.owner,
      branch: data.repository.branch,
      sourceType: data.repository.sourceType,
      repositoryUrl: data.repository.repositoryUrl,
    },
    readiness: {
      status: data.readiness.status,
      modules,
      limitations,
    },
    ast,
    dependencies,
    static: staticSummary,
    history: historyOverview,
    health: readHealth((data as { health?: unknown }).health),
    debt: readDebtSummary((data as { debt?: unknown }).debt),
  };
}

export interface StaticFinding {
  path: string;
  line: number | null;
  column: number | null;
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  tool: 'eslint';
  category: 'problem' | 'suggestion' | 'layout' | null;
}

export interface IssueSummary {
  findingCount: number;
  errorCount: number;
  warningCount: number;
  truncated: boolean;
}

export interface IssueListResponse {
  analysisId: string;
  findings: StaticFinding[];
  summary: IssueSummary;
  limitations: string[];
}

function readNullableCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function readFinding(value: unknown): StaticFinding | null {
  if (typeof value !== 'object' || value === null) return null;
  const finding = value as Partial<StaticFinding>;
  const line = finding.line === null ? null : readNullableCount(finding.line);
  const column = finding.column === null ? null : readNullableCount(finding.column);
  if (
    typeof finding.path !== 'string' ||
    finding.path.trim() === '' ||
    (finding.line !== null && line === null) ||
    (finding.column !== null && column === null) ||
    typeof finding.ruleId !== 'string' ||
    (finding.severity !== 'error' && finding.severity !== 'warning') ||
    typeof finding.message !== 'string' ||
    finding.tool !== 'eslint' ||
    (finding.category !== null && finding.category !== 'problem' && finding.category !== 'suggestion' && finding.category !== 'layout')
  ) {
    return null;
  }
  return {
    path: finding.path,
    line,
    column,
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    tool: 'eslint',
    category: finding.category ?? null,
  };
}

export async function getAnalysisIssues(analysisId: string): Promise<IssueListResponse> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/issues`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected issue list.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected issue list.', 0);
  }
  const data = envelope.data as {
    analysisId?: unknown;
    findings?: unknown;
    summary?: Partial<IssueSummary>;
    limitations?: unknown;
  };
  const findings = Array.isArray(data.findings) ? data.findings.map(readFinding) : null;
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string')
    : null;
  const summary = data.summary;
  if (
    data.analysisId !== analysisId ||
    !findings ||
    findings.some((finding) => finding === null) ||
    !summary ||
    typeof summary.findingCount !== 'number' ||
    typeof summary.errorCount !== 'number' ||
    typeof summary.warningCount !== 'number' ||
    typeof summary.truncated !== 'boolean' ||
    summary.findingCount !== findings.length ||
    !limitations
  ) {
    throw new ApiError('The API returned an unexpected issue list.', 0);
  }
  return {
    analysisId,
    findings: findings as StaticFinding[],
    summary: {
      findingCount: summary.findingCount,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      truncated: summary.truncated,
    },
    limitations,
  };
}

export interface FileAiEvidenceReference {
  source: 'ast' | 'static' | 'dependencies' | 'history' | 'repository';
  field: string;
  index: number | null;
}

export interface FileAiObservation {
  category: string;
  observation: string;
  interpretation: string;
  evidence: FileAiEvidenceReference[];
  confidence: 'low' | 'medium' | 'high';
}

export interface FileAiInterpretation {
  summary: string;
  observations: FileAiObservation[];
  limitations: string[];
}

function readAiEvidence(value: unknown): FileAiEvidenceReference | null {
  if (typeof value !== 'object' || value === null) return null;
  const evidence = value as Partial<FileAiEvidenceReference>;
  if (
    (evidence.source !== 'ast' &&
      evidence.source !== 'static' &&
      evidence.source !== 'dependencies' &&
      evidence.source !== 'history' &&
      evidence.source !== 'repository') ||
    typeof evidence.field !== 'string' ||
    evidence.field.trim() === '' ||
    !(evidence.index === null || (typeof evidence.index === 'number' && Number.isInteger(evidence.index) && evidence.index >= 0))
  ) {
    return null;
  }
  return { source: evidence.source, field: evidence.field, index: evidence.index };
}

function readAiObservation(value: unknown): FileAiObservation | null {
  if (typeof value !== 'object' || value === null) return null;
  const observation = value as Partial<FileAiObservation>;
  const evidence = Array.isArray(observation.evidence) ? observation.evidence.map(readAiEvidence) : null;
  if (
    typeof observation.category !== 'string' ||
    observation.category.trim() === '' ||
    typeof observation.observation !== 'string' ||
    observation.observation.trim() === '' ||
    typeof observation.interpretation !== 'string' ||
    observation.interpretation.trim() === '' ||
    !evidence ||
    evidence.length === 0 ||
    evidence.some((item) => item === null) ||
    (observation.confidence !== 'low' && observation.confidence !== 'medium' && observation.confidence !== 'high')
  ) {
    return null;
  }
  return {
    category: observation.category,
    observation: observation.observation,
    interpretation: observation.interpretation,
    evidence: evidence as FileAiEvidenceReference[],
    confidence: observation.confidence,
  };
}

export type DependencyEdgeKind = 'import' | 're-export' | 'require' | 'dynamic-import';

export interface DependencyFileNode {
  id: string;
  type: 'file';
}

export interface DependencyRelation {
  source: string;
  target: string;
  type: 'internal' | 'external';
  kind: DependencyEdgeKind;
  importSpecifier: string;
}

export interface ExternalPackageDependency {
  name: string;
  count: number;
}

export interface UnresolvedImport {
  source: string;
  importSpecifier: string;
  kind: DependencyEdgeKind;
  message: string;
}

export interface FileDependencyFacts {
  path: string;
  outgoingInternal: number;
  incomingInternal: number;
  external: number;
  unresolved: number;
}

export interface DependencySummary {
  totalInternalNodes: number;
  totalInternalEdges: number;
  totalExternalPackages: number;
  unresolvedImports: number;
  filesWithDependencies: number;
  filesWithNoDependencies: number;
  maxOutgoingInternalDependencies: number;
  filesDiscovered: number;
  parseErrors: number;
  truncated: boolean;
}

export interface DependencyAnalysisError {
  path: string;
  message: string;
}

export interface DependencyAnalysisResult {
  summary: DependencySummary;
  nodes: DependencyFileNode[];
  edges: DependencyRelation[];
  externalDependencies: ExternalPackageDependency[];
  unresolved: UnresolvedImport[];
  files: FileDependencyFacts[];
  errors: DependencyAnalysisError[];
}

const DEPENDENCY_EDGE_KINDS: readonly DependencyEdgeKind[] = ['import', 're-export', 'require', 'dynamic-import'];

function isDependencyEdgeKind(value: unknown): value is DependencyEdgeKind {
  return typeof value === 'string' && DEPENDENCY_EDGE_KINDS.some((kind) => kind === value);
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function readDependencyNode(value: unknown): DependencyFileNode | null {
  if (typeof value !== 'object' || value === null) return null;
  const node = value as Partial<DependencyFileNode>;
  if (typeof node.id !== 'string' || node.id.trim() === '' || node.type !== 'file') return null;
  return { id: node.id, type: 'file' };
}

function readDependencyEdge(value: unknown): DependencyRelation | null {
  if (typeof value !== 'object' || value === null) return null;
  const edge = value as Partial<DependencyRelation>;
  if (
    typeof edge.source !== 'string' ||
    edge.source.trim() === '' ||
    typeof edge.target !== 'string' ||
    edge.target.trim() === '' ||
    (edge.type !== 'internal' && edge.type !== 'external') ||
    !isDependencyEdgeKind(edge.kind) ||
    typeof edge.importSpecifier !== 'string'
  ) {
    return null;
  }
  return {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    kind: edge.kind,
    importSpecifier: edge.importSpecifier,
  };
}

function readExternalPackage(value: unknown): ExternalPackageDependency | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<ExternalPackageDependency>;
  const count = readNonNegativeInteger(item.count);
  if (typeof item.name !== 'string' || item.name.trim() === '' || count === null) return null;
  return { name: item.name, count };
}

function readUnresolvedImport(value: unknown): UnresolvedImport | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<UnresolvedImport>;
  if (
    typeof item.source !== 'string' ||
    item.source.trim() === '' ||
    typeof item.importSpecifier !== 'string' ||
    !isDependencyEdgeKind(item.kind) ||
    typeof item.message !== 'string' ||
    item.message.trim() === ''
  ) {
    return null;
  }
  return {
    source: item.source,
    importSpecifier: item.importSpecifier,
    kind: item.kind,
    message: item.message,
  };
}

function readFileFacts(value: unknown): FileDependencyFacts | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<FileDependencyFacts>;
  const outgoingInternal = readNonNegativeInteger(item.outgoingInternal);
  const incomingInternal = readNonNegativeInteger(item.incomingInternal);
  const external = readNonNegativeInteger(item.external);
  const unresolved = readNonNegativeInteger(item.unresolved);
  if (
    typeof item.path !== 'string' ||
    item.path.trim() === '' ||
    outgoingInternal === null ||
    incomingInternal === null ||
    external === null ||
    unresolved === null
  ) {
    return null;
  }
  return {
    path: item.path,
    outgoingInternal,
    incomingInternal,
    external,
    unresolved,
  };
}

function readDependencyError(value: unknown): DependencyAnalysisError | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<DependencyAnalysisError>;
  if (typeof item.path !== 'string' || item.path.trim() === '' || typeof item.message !== 'string' || item.message.trim() === '') {
    return null;
  }
  return { path: item.path, message: item.message };
}

export async function getAnalysisDependencies(analysisId: string): Promise<DependencyAnalysisResult> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/dependencies`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected dependency result.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected dependency result.', 0);
  }
  const data = envelope.data as Partial<DependencyAnalysisResult> & { workspacePath?: unknown; source?: unknown };
  if ('workspacePath' in data || 'source' in data) {
    throw new ApiError('The API returned an unexpected dependency result.', 0);
  }
  const summary = data.summary;
  const nodes = Array.isArray(data.nodes) ? data.nodes.map(readDependencyNode) : null;
  const edges = Array.isArray(data.edges) ? data.edges.map(readDependencyEdge) : null;
  const externalDependencies = Array.isArray(data.externalDependencies)
    ? data.externalDependencies.map(readExternalPackage)
    : null;
  const unresolved = Array.isArray(data.unresolved) ? data.unresolved.map(readUnresolvedImport) : null;
  const files = Array.isArray(data.files) ? data.files.map(readFileFacts) : null;
  const errors = Array.isArray(data.errors) ? data.errors.map(readDependencyError) : null;
  const internalEdges = edges?.filter((edge) => edge?.type === 'internal').length;
  if (
    !summary ||
    readNonNegativeInteger(summary.totalInternalNodes) === null ||
    readNonNegativeInteger(summary.totalInternalEdges) === null ||
    readNonNegativeInteger(summary.totalExternalPackages) === null ||
    readNonNegativeInteger(summary.unresolvedImports) === null ||
    readNonNegativeInteger(summary.filesWithDependencies) === null ||
    readNonNegativeInteger(summary.filesWithNoDependencies) === null ||
    readNonNegativeInteger(summary.maxOutgoingInternalDependencies) === null ||
    readNonNegativeInteger(summary.filesDiscovered) === null ||
    readNonNegativeInteger(summary.parseErrors) === null ||
    typeof summary.truncated !== 'boolean' ||
    !nodes ||
    nodes.some((node) => node === null) ||
    !edges ||
    edges.some((edge) => edge === null) ||
    !externalDependencies ||
    externalDependencies.some((item) => item === null) ||
    !unresolved ||
    unresolved.some((item) => item === null) ||
    !files ||
    files.some((item) => item === null) ||
    !errors ||
    errors.some((item) => item === null) ||
    summary.totalInternalNodes !== nodes.length ||
    summary.totalInternalEdges !== internalEdges ||
    summary.totalExternalPackages !== externalDependencies.length ||
    summary.unresolvedImports !== unresolved.length ||
    summary.filesDiscovered !== nodes.length ||
    files.length !== nodes.length
  ) {
    throw new ApiError('The API returned an unexpected dependency result.', 0);
  }
  return {
    summary: {
      totalInternalNodes: summary.totalInternalNodes,
      totalInternalEdges: summary.totalInternalEdges,
      totalExternalPackages: summary.totalExternalPackages,
      unresolvedImports: summary.unresolvedImports,
      filesWithDependencies: summary.filesWithDependencies,
      filesWithNoDependencies: summary.filesWithNoDependencies,
      maxOutgoingInternalDependencies: summary.maxOutgoingInternalDependencies,
      filesDiscovered: summary.filesDiscovered,
      parseErrors: summary.parseErrors,
      truncated: summary.truncated,
    },
    nodes: nodes as DependencyFileNode[],
    edges: edges as DependencyRelation[],
    externalDependencies: externalDependencies as ExternalPackageDependency[],
    unresolved: unresolved as UnresolvedImport[],
    files: files as FileDependencyFacts[],
    errors: errors as DependencyAnalysisError[],
  };
}

export type HistoryDepth = 'shallow' | 'limited' | 'complete';

export interface GitHistorySummary {
  availableCommits: number;
  uniqueAuthors: number;
  totalFileChanges: number;
  totalAdditions: number;
  totalDeletions: number;
  oldestAvailableCommitAt: string | null;
  newestAvailableCommitAt: string | null;
  historyDepth: HistoryDepth;
  isComplete: boolean;
  commitsWithoutFileDiff: number;
  cloneCommitCount: number;
  truncated: boolean;
  commitLimit: number | null;
}

export interface GitCommitRecord {
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
}

export interface GitAuthorRecord {
  name: string;
  commits: number;
}

export interface GitFileHistory {
  path: string;
  commitCount: number;
  additions: number;
  deletions: number;
  changeCount: number;
  firstSeenAt: string;
  lastChangedAt: string;
  presentInWorkTree: boolean;
  renamedFrom: string | null;
}

export interface GitMostChangedFile {
  path: string;
  commitCount: number;
}

export interface GitHistoryErrorRecord {
  message: string;
}

export interface GitHistoryResult {
  summary: GitHistorySummary;
  commits: GitCommitRecord[];
  authors: GitAuthorRecord[];
  files: GitFileHistory[];
  mostChangedFiles: GitMostChangedFile[];
  errors: GitHistoryErrorRecord[];
}

function readTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readGitCommit(value: unknown): GitCommitRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const commit = value as Partial<GitCommitRecord>;
  const timestamp = readTimestamp(commit.timestamp);
  if (
    typeof commit.hash !== 'string' ||
    commit.hash.trim() === '' ||
    typeof commit.author !== 'string' ||
    commit.author.trim() === '' ||
    timestamp === null ||
    typeof commit.subject !== 'string'
  ) {
    return null;
  }
  return { hash: commit.hash, author: commit.author, timestamp, subject: commit.subject };
}

function readGitAuthor(value: unknown): GitAuthorRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const author = value as Partial<GitAuthorRecord>;
  const commits = readNonNegativeInteger(author.commits);
  if (typeof author.name !== 'string' || author.name.trim() === '' || commits === null) return null;
  return { name: author.name, commits };
}

function readGitFile(value: unknown): GitFileHistory | null {
  if (typeof value !== 'object' || value === null) return null;
  const file = value as Partial<GitFileHistory>;
  const commitCount = readNonNegativeInteger(file.commitCount);
  const additions = readNonNegativeInteger(file.additions);
  const deletions = readNonNegativeInteger(file.deletions);
  const changeCount = readNonNegativeInteger(file.changeCount);
  const firstSeenAt = readTimestamp(file.firstSeenAt);
  const lastChangedAt = readTimestamp(file.lastChangedAt);
  if (
    typeof file.path !== 'string' ||
    file.path.trim() === '' ||
    commitCount === null ||
    additions === null ||
    deletions === null ||
    changeCount === null ||
    changeCount !== additions + deletions ||
    firstSeenAt === null ||
    lastChangedAt === null ||
    typeof file.presentInWorkTree !== 'boolean' ||
    (file.renamedFrom !== null && typeof file.renamedFrom !== 'string')
  ) {
    return null;
  }
  return {
    path: file.path,
    commitCount,
    additions,
    deletions,
    changeCount,
    firstSeenAt,
    lastChangedAt,
    presentInWorkTree: file.presentInWorkTree,
    renamedFrom: file.renamedFrom ?? null,
  };
}

function readMostChangedFile(value: unknown): GitMostChangedFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const file = value as Partial<GitMostChangedFile>;
  const commitCount = readNonNegativeInteger(file.commitCount);
  if (typeof file.path !== 'string' || file.path.trim() === '' || commitCount === null) return null;
  return { path: file.path, commitCount };
}

function readGitHistoryError(value: unknown): GitHistoryErrorRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<GitHistoryErrorRecord>;
  if (typeof item.message !== 'string' || item.message.trim() === '') return null;
  return { message: item.message };
}

export async function getAnalysisGitHistory(analysisId: string): Promise<GitHistoryResult> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/history`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected Git history result.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected Git history result.', 0);
  }
  const data = envelope.data as Partial<GitHistoryResult> & { workspacePath?: unknown; source?: unknown };
  if ('workspacePath' in data || 'source' in data) {
    throw new ApiError('The API returned an unexpected Git history result.', 0);
  }
  const summary = data.summary;
  const commits = Array.isArray(data.commits) ? data.commits.map(readGitCommit) : null;
  const authors = Array.isArray(data.authors) ? data.authors.map(readGitAuthor) : null;
  const files = Array.isArray(data.files) ? data.files.map(readGitFile) : null;
  const mostChangedFiles = Array.isArray(data.mostChangedFiles) ? data.mostChangedFiles.map(readMostChangedFile) : null;
  const errors = Array.isArray(data.errors) ? data.errors.map(readGitHistoryError) : null;
  const oldest = summary ? (summary.oldestAvailableCommitAt === null ? null : readTimestamp(summary.oldestAvailableCommitAt)) : null;
  const newest = summary ? (summary.newestAvailableCommitAt === null ? null : readTimestamp(summary.newestAvailableCommitAt)) : null;
  if (
    !summary ||
    readNonNegativeInteger(summary.availableCommits) === null ||
    readNonNegativeInteger(summary.uniqueAuthors) === null ||
    readNonNegativeInteger(summary.totalFileChanges) === null ||
    readNonNegativeInteger(summary.totalAdditions) === null ||
    readNonNegativeInteger(summary.totalDeletions) === null ||
    (summary.oldestAvailableCommitAt !== null && oldest === null) ||
    (summary.newestAvailableCommitAt !== null && newest === null) ||
    (summary.historyDepth !== 'shallow' && summary.historyDepth !== 'limited' && summary.historyDepth !== 'complete') ||
    typeof summary.isComplete !== 'boolean' ||
    readNonNegativeInteger(summary.commitsWithoutFileDiff) === null ||
    readNonNegativeInteger(summary.cloneCommitCount ?? summary.availableCommits) === null ||
    (summary.truncated !== undefined && typeof summary.truncated !== 'boolean') ||
    (summary.commitLimit !== undefined && summary.commitLimit !== null && readNonNegativeInteger(summary.commitLimit) === null) ||
    !commits ||
    commits.some((commit) => commit === null) ||
    !authors ||
    authors.some((author) => author === null) ||
    !files ||
    files.some((file) => file === null) ||
    !mostChangedFiles ||
    mostChangedFiles.some((file) => file === null) ||
    !errors ||
    errors.some((item) => item === null) ||
    summary.availableCommits !== commits.length ||
    summary.uniqueAuthors !== authors.length
  ) {
    throw new ApiError('The API returned an unexpected Git history result.', 0);
  }
  return {
    summary: {
      availableCommits: summary.availableCommits,
      uniqueAuthors: summary.uniqueAuthors,
      totalFileChanges: summary.totalFileChanges,
      totalAdditions: summary.totalAdditions,
      totalDeletions: summary.totalDeletions,
      oldestAvailableCommitAt: summary.oldestAvailableCommitAt === null ? null : oldest,
      newestAvailableCommitAt: summary.newestAvailableCommitAt === null ? null : newest,
      historyDepth: summary.historyDepth,
      isComplete: summary.isComplete,
      commitsWithoutFileDiff: summary.commitsWithoutFileDiff,
      cloneCommitCount: summary.cloneCommitCount ?? summary.availableCommits,
      truncated: summary.truncated === true,
      commitLimit: typeof summary.commitLimit === 'number' ? summary.commitLimit : null,
    },
    commits: commits as GitCommitRecord[],
    authors: authors as GitAuthorRecord[],
    files: files as GitFileHistory[],
    mostChangedFiles: mostChangedFiles as GitMostChangedFile[],
    errors: errors as GitHistoryErrorRecord[],
  };
}

export async function getFileAiInterpretation(analysisId: string, path: string): Promise<FileAiInterpretation> {
  const payload = await postJson(
    `/analyses/${encodeURIComponent(analysisId)}/ai-summary/file`,
    { path },
    'AI interpretation is temporarily unavailable.',
  );
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  const data = envelope.data as Partial<FileAiInterpretation>;
  const observations = Array.isArray(data.observations) ? data.observations.map(readAiObservation) : null;
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : null;
  if (
    typeof data.summary !== 'string' ||
    data.summary.trim() === '' ||
    !observations ||
    observations.some((observation) => observation === null) ||
    !limitations
  ) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  return {
    summary: data.summary,
    observations: observations as FileAiObservation[],
    limitations,
  };
}

export async function getRepositoryAiInterpretation(analysisId: string): Promise<FileAiInterpretation> {
  const payload = await postJson(
    `/analyses/${encodeURIComponent(analysisId)}/ai-summary`,
    {},
    'AI interpretation is temporarily unavailable.',
  );
  return readInterpretationPayload(payload);
}

export interface DebtIndicatorItem {
  id: string;
  indicator: string;
  category: string;
  affectedFile: string;
  evidence: { source: string; path: string | null; detail: string };
  contribution: number;
  explanation: string;
}

export interface TechnicalDebtReport {
  analysisId: string;
  kind: string;
  disclaimer: string;
  items: DebtIndicatorItem[];
  summary: {
    itemCount: number;
    estimatedContribution: number;
    truncated: boolean;
  };
  limitations: string[];
}

export async function getTechnicalDebtReport(analysisId: string): Promise<TechnicalDebtReport> {
  const payload = await getJson(`/analyses/${encodeURIComponent(analysisId)}/debt`);
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected technical debt result.', 0);
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('The API returned an unexpected technical debt result.', 0);
  }
  const data = envelope.data as Partial<TechnicalDebtReport>;
  const items = Array.isArray(data.items) ? data.items.filter(isDebtItem) : null;
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string')
    : null;
  if (
    data.analysisId !== analysisId ||
    typeof data.disclaimer !== 'string' ||
    !data.summary ||
    typeof data.summary.itemCount !== 'number' ||
    typeof data.summary.estimatedContribution !== 'number' ||
    typeof data.summary.truncated !== 'boolean' ||
    !items ||
    !limitations
  ) {
    throw new ApiError('The API returned an unexpected technical debt result.', 0);
  }
  return {
    analysisId,
    kind: typeof data.kind === 'string' ? data.kind : 'technical-debt-indicators',
    disclaimer: data.disclaimer,
    items,
    summary: data.summary,
    limitations,
  };
}

export async function downloadAnalysisReport(analysisId: string): Promise<unknown> {
  return getJson(`/analyses/${encodeURIComponent(analysisId)}/report`);
}

export async function downloadAnalysisReportHtml(analysisId: string): Promise<string> {
  return getText(`/analyses/${encodeURIComponent(analysisId)}/report.html`);
}

function readInterpretationPayload(payload: unknown): FileAiInterpretation {
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true || typeof envelope.data !== 'object' || envelope.data === null) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  const data = envelope.data as Partial<FileAiInterpretation>;
  const observations = Array.isArray(data.observations) ? data.observations.map(readAiObservation) : null;
  const limitations = Array.isArray(data.limitations)
    ? data.limitations.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : null;
  if (
    typeof data.summary !== 'string' ||
    data.summary.trim() === '' ||
    !observations ||
    observations.some((observation) => observation === null) ||
    !limitations
  ) {
    throw new ApiError('AI interpretation returned an invalid response.', 0, 'AI_RESPONSE_INVALID');
  }
  return {
    summary: data.summary,
    observations: observations as FileAiObservation[],
    limitations,
  };
}

function isDebtItem(value: unknown): value is DebtIndicatorItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<DebtIndicatorItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.indicator === 'string' &&
    typeof item.affectedFile === 'string' &&
    typeof item.contribution === 'number' &&
    typeof item.explanation === 'string' &&
    typeof item.evidence === 'object' &&
    item.evidence !== null &&
    typeof item.evidence.detail === 'string'
  );
}
