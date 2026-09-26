/**
 * Evidence-based technical debt indicators.
 * These are not a validated technical-debt measurement and are not time estimates.
 */

export type DebtIndicator =
  | 'static-analysis'
  | 'structural-nesting'
  | 'unresolved-dependency'
  | 'dependency-connectivity'
  | 'change-frequency';

export interface DebtEvidence {
  source: 'static' | 'ast' | 'dependencies' | 'history';
  /** Repository-relative path, or null for a repository-level limitation note. */
  path: string | null;
  detail: string;
}

export interface TechnicalDebtItem {
  id: string;
  indicator: DebtIndicator;
  category: string;
  affectedFile: string;
  evidence: DebtEvidence;
  /** Weighted contribution from DEBT_WEIGHTS. Not hours and not a validated debt score. */
  contribution: number;
  explanation: string;
}

export interface TechnicalDebtSummary {
  itemCount: number;
  estimatedContribution: number;
  byIndicator: Record<DebtIndicator, { count: number; contribution: number }>;
  truncated: boolean;
}

export interface TechnicalDebtReport {
  analysisId: string;
  kind: 'technical-debt-indicators';
  disclaimer: string;
  weights: Record<string, number>;
  items: TechnicalDebtItem[];
  summary: TechnicalDebtSummary;
  limitations: string[];
}
