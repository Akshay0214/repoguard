import type { DependencyEdgeKind } from './dependency.js';
import type { HistoryDepth } from './gitHistory.js';
import type { StaticFinding, StaticSeverity } from './staticAnalysis.js';

export type ContextMode =
  | 'repository-summary'
  | 'file'
  | 'experiment-file-baseline'
  | 'experiment-file-proposed';

export interface ContextRepository {
  name: string;
  branch: string;
  sourceType: 'github' | 'zip';
}

export interface ContextLimitation {
  source: 'ast' | 'dependencies' | 'history' | 'static' | 'context';
  message: string;
}

export interface ContextAstSummary {
  totalFiles: number;
  totalLines: number;
  totalFunctions: number;
  totalClasses: number;
  totalImports: number;
  totalExports: number;
  parseErrors: number;
  maxNestingDepth: number;
}

export interface ContextDependencySummary {
  totalInternalNodes: number;
  totalInternalEdges: number;
  totalExternalPackages: number;
  unresolvedImports: number;
  filesWithDependencies: number;
  filesWithNoDependencies: number;
  maxOutgoingInternalDependencies: number;
}

export interface ContextStaticRuleCount {
  ruleId: string;
  severity: StaticSeverity;
  category: StaticFinding['category'];
  count: number;
}

export interface ContextStaticSummary {
  filesAnalyzed: number;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  truncated: boolean;
  repositoryConfigUsed: false;
  ruleSet: 'repoguard-fixed';
  issueCounts: {
    execution: number;
    parse: number;
    limit: number;
  };
  globalLimitMessages: string[];
  rules: ContextStaticRuleCount[];
}

export interface ContextFileStaticFinding {
  path: string;
  line: number | null;
  column: number | null;
  ruleId: string;
  severity: StaticSeverity;
  message: string;
  tool: 'eslint';
  category: StaticFinding['category'];
}

export interface ContextFileStaticIssue {
  kind: 'execution' | 'parse' | 'limit';
  message: string;
}

export interface ContextFileStatic {
  repositoryConfigUsed: false;
  ruleSet: 'repoguard-fixed';
  repositoryTruncated: boolean;
  findingsTruncated: boolean;
  findings: ContextFileStaticFinding[];
  issues: ContextFileStaticIssue[];
}

export interface ContextHistorySummary {
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
}

export interface RepositorySummaryContext {
  mode: 'repository-summary';
  repository: ContextRepository;
  ast: ContextAstSummary;
  dependencies: ContextDependencySummary;
  history: ContextHistorySummary;
  static: ContextStaticSummary;
  limitations: ContextLimitation[];
}

export interface ContextFileAst {
  lineCount: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  exportCount: number;
  maxNestingDepth: number;
  functions: Array<{ name: string | null; line: number; nestingDepth: number }>;
  functionsTruncated: boolean;
}

export interface ContextInternalEdge {
  path: string;
  kind: DependencyEdgeKind;
  importSpecifier: string;
}

export interface ContextExternalUse {
  name: string;
  kind: DependencyEdgeKind;
  importSpecifier: string;
}

export interface ContextUnresolvedImport {
  importSpecifier: string;
  kind: DependencyEdgeKind;
  message: string;
}

export interface ContextFileDependencies {
  outgoing: ContextInternalEdge[];
  incoming: ContextInternalEdge[];
  external: ContextExternalUse[];
  unresolved: ContextUnresolvedImport[];
  truncated: boolean;
}

export interface ContextFileHistory {
  commitCount: number;
  additions: number;
  deletions: number;
  changeCount: number;
  firstSeenAt: string;
  lastChangedAt: string;
  renamedFrom: string | null;
  presentInWorkTree: boolean;
  historyDepth: HistoryDepth;
  isComplete: boolean;
}

export interface FileContext {
  mode: 'file';
  repository: ContextRepository;
  file: {
    path: string;
    truncated: boolean;
    ast: ContextFileAst | null;
    dependencies: ContextFileDependencies;
    history: ContextFileHistory | null;
    static: ContextFileStatic;
  };
  limitations: ContextLimitation[];
}

export type RepositoryContext = RepositorySummaryContext | FileContext | ExperimentFileBaselineContext | ExperimentFileProposedContext;

/**
 * File-local evidence shared by the experimental conditions.
 * It omits repository identity, dependency relationships, and Git history.
 * `repositoryTruncated` is repository coverage, so it is not part of this object.
 */
export interface ExperimentFileStatic {
  repositoryConfigUsed: false;
  ruleSet: 'repoguard-fixed';
  findingsTruncated: boolean;
  findings: ContextFileStaticFinding[];
  issues: ContextFileStaticIssue[];
}

export interface ExperimentFileLocalEvidence {
  path: string;
  truncated: boolean;
  ast: ContextFileAst | null;
  static: ExperimentFileStatic;
}

export interface ExperimentFileBaselineContext {
  mode: 'experiment-file-baseline';
  condition: 'baseline';
  file: ExperimentFileLocalEvidence;
  limitations: ContextLimitation[];
}

export interface ExperimentFileProposedContext {
  mode: 'experiment-file-proposed';
  condition: 'proposed';
  file: ExperimentFileLocalEvidence;
  repository: ContextRepository;
  dependencies: ContextFileDependencies;
  history: ContextFileHistory | null;
  limitations: ContextLimitation[];
}
