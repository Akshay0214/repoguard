export type StaticSeverity = 'error' | 'warning';

export interface StaticFinding {
  path: string;
  line: number | null;
  column: number | null;
  ruleId: string;
  severity: StaticSeverity;
  message: string;
  tool: 'eslint';
  category: 'problem' | 'suggestion' | 'layout' | null;
}

export interface StaticAnalysisIssue {
  kind: 'execution' | 'parse' | 'limit';
  path: string | null;
  message: string;
}

export interface StaticAnalysisResult {
  summary: {
    filesAnalyzed: number;
    findingCount: number;
    errorCount: number;
    warningCount: number;
    truncated: boolean;
    repositoryConfigUsed: false;
    ruleSet: 'repoguard-fixed';
  };
  findings: StaticFinding[];
  issues: StaticAnalysisIssue[];
}
