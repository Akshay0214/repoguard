import type { AnalysisSourceType } from './analysis.js';
import type { AnalysisModuleStatus, RepositoryAnalysisStatus } from './analysisStatus.js';
import type { HistoryDepth } from './gitHistory.js';
import type { RepositoryHealth } from './health.js';
import type { StaticFinding, StaticSeverity } from './staticAnalysis.js';
import type { TechnicalDebtReport } from './technicalDebt.js';

export interface OverviewRepository {
  name: string;
  owner: string | null;
  branch: string;
  sourceType: AnalysisSourceType;
  repositoryUrl: string;
}

export interface OverviewReadiness {
  status: Exclude<RepositoryAnalysisStatus, 'queued' | 'acquiring'>;
  modules: {
    ast: AnalysisModuleStatus;
    dependencies: AnalysisModuleStatus;
    static: AnalysisModuleStatus;
    history: AnalysisModuleStatus;
  };
  limitations: string[];
}

export interface OverviewAst {
  totalFiles: number;
  totalLines: number;
  totalFunctions: number;
  totalClasses: number;
  totalImports: number;
  totalExports: number;
  parseErrors: number;
  maxNestingDepth: number;
  filesDiscovered: number;
  skippedOversizeFiles: number;
  truncated: boolean;
}

export interface OverviewDependencies {
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

export interface OverviewStaticRule {
  ruleId: string;
  severity: StaticSeverity;
  category: StaticFinding['category'];
  count: number;
}

export interface OverviewStatic {
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
  rules: OverviewStaticRule[];
}

export interface OverviewHistory {
  availableCommits: number;
  uniqueAuthors: number;
  totalFileChanges: number;
  totalAdditions: number;
  totalDeletions: number;
  historyDepth: HistoryDepth;
  isComplete: boolean;
  commitsWithoutFileDiff: number;
}

export interface RepositoryOverview {
  analysisId: string;
  repository: OverviewRepository;
  readiness: OverviewReadiness;
  ast: OverviewAst | null;
  dependencies: OverviewDependencies | null;
  static: OverviewStatic | null;
  history: OverviewHistory | null;
  health: RepositoryHealth;
  debt: TechnicalDebtReport | null;
}
