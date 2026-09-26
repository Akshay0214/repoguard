// Core domain types for RepoGuard.
// These model the shape of data the backend/AI pipeline will eventually
// return. The mock data layer and service layer are built against these
// same types, so swapping mock functions for real API calls later
// requires no changes on the consuming (component) side.

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type IssueCategory =
  | 'code-smell'
  | 'complexity'
  | 'duplication'
  | 'security'
  | 'architecture';

export type AnalysisStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

export interface RepositorySummary {
  id: string;
  name: string;
  fullName: string;
  provider: 'github' | 'upload';
  defaultBranch: string;
  visibility: 'public' | 'private';
  primaryLanguage: string;
  languages: { name: string; percent: number }[];
  fileCount: number;
  linesOfCode: number;
  contributors: number;
  lastAnalyzedAt: string | null;
}

export interface HealthScoreBreakdown {
  overall: number;
  codeQuality: number;
  maintainability: number;
  security: number;
  architecture: number;
  technicalDebt: number;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface HealthTrendPoint {
  date: string;
  score: number;
}

export interface RiskArea {
  id: string;
  path: string;
  description: string;
  riskScore: number;
  issueCount: number;
  category: IssueCategory;
}

export interface AiInsight {
  id: string;
  headline: string;
  body: string;
  confidence: 'high' | 'medium' | 'low';
  relatedIssueIds: string[];
}

export interface RepositoryOverview {
  repository: RepositorySummary;
  health: HealthScoreBreakdown;
  severityCounts: SeverityCounts;
  healthTrend: HealthTrendPoint[];
  topRiskAreas: RiskArea[];
  aiInsight: AiInsight;
}

export interface CodeMetric {
  label: string;
  value: string | number;
  unit?: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  category: IssueCategory;
  severity: Severity;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  status: 'open' | 'acknowledged' | 'resolved';
  detectedAt: string;
  metrics: CodeMetric[];
  aiExplanation: string;
  aiRecommendation: string;
  affectedComponents: string[];
  codeSnippet?: string;
}

export interface DebtCategoryBreakdown {
  category: IssueCategory;
  hours: number;
  percent: number;
}

export interface DebtHotspot {
  id: string;
  path: string;
  debtHours: number;
  issueCount: number;
  trend: 'up' | 'down' | 'flat';
}

export interface DebtPriorityItem {
  id: string;
  title: string;
  filePath: string;
  severity: Severity;
  estimatedHours: number;
  impact: string;
}

export interface TechnicalDebtSummary {
  totalHours: number;
  totalDays: number;
  debtRatio: number;
  trend: { date: string; hours: number }[];
  categories: DebtCategoryBreakdown[];
  hotspots: DebtHotspot[];
  priorityList: DebtPriorityItem[];
}

export type DependencyRisk = 'none' | 'low' | 'medium' | 'high';

export interface DependencyNode {
  id: string;
  label: string;
  type: 'module' | 'file' | 'package';
  risk: DependencyRisk;
  issueCount: number;
  linesOfCode: number;
  description: string;
}

export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  kind: 'imports' | 'depends-on';
}

export interface DependencyGraphData {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface AnalysisHistoryEntry {
  id: string;
  triggeredAt: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  healthScore: number;
  issueCount: number;
  severityCounts: SeverityCounts;
  status: AnalysisStatus;
  durationSeconds: number;
}

export interface AnalyzeRequest {
  source: 'github' | 'upload';
  githubUrl?: string;
  fileName?: string;
  branch?: string;
}

export interface AnalysisProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

export type AnalysisSourceType = 'github' | 'zip';

/** The repository/job currently selected in the UI. Not persisted. */
export interface CurrentAnalysis {
  analysisId: string;
  repositoryUrl: string | null;
  repositoryName: string;
  branch: string;
  sourceType: AnalysisSourceType;
  status: AnalysisStatus;
}

export interface AnalysisJob {
  id: string;
  status: AnalysisStatus;
  progress: number;
  steps: AnalysisProgressStep[];
  startedAt: string;
  repositoryUrl: string | null;
  repositoryName: string;
  branch: string;
  sourceType: AnalysisSourceType;
}

export interface AppSettings {
  repository: {
    defaultBranch: string;
    autoAnalyzeOnPush: boolean;
    excludedPaths: string;
  };
  analysis: {
    depth: 'quick' | 'standard' | 'deep';
    includeTests: boolean;
    includeDependencies: boolean;
    severityThreshold: Severity;
  };
  ai: {
    recommendationsEnabled: boolean;
    autoExplainIssues: boolean;
    model: string;
  };
  appearance: {
    theme: 'dark' | 'darker' | 'midnight';
    density: 'comfortable' | 'compact';
    accentColor: 'amber' | 'blue' | 'teal';
  };
}
