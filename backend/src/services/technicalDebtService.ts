import type { AstAnalysisResult } from '../types/ast.js';
import type { DependencyAnalysisResult } from '../types/dependency.js';
import type { GitHistoryResult } from '../types/gitHistory.js';
import type { StaticAnalysisResult } from '../types/staticAnalysis.js';
import type {
  DebtIndicator,
  TechnicalDebtItem,
  TechnicalDebtReport,
  TechnicalDebtSummary,
} from '../types/technicalDebt.js';

/**
 * Deterministic indicator weights. These are maintenance-concern weights,
 * not a validated model of technical debt and not estimated hours.
 */
export const DEBT_WEIGHTS = {
  staticError: 3,
  staticWarning: 1,
  nestingThreshold: 4,
  nestingContribution: 2,
  unresolvedImport: 2,
  connectivityThreshold: 8,
  connectivityContribution: 1,
  changeThreshold: 3,
  changeContribution: 1,
} as const;

export const DEBT_DISCLAIMER =
  'These are technical debt indicators derived from analyzer evidence. Estimated debt contribution is a weighted sum of those indicators. It is not a scientifically validated debt estimate, not proof of technical debt, and not a time estimate.';

const MAX_ITEMS = 300;

export interface DebtModuleEvidence {
  ast: AstAnalysisResult | null;
  dependencies: DependencyAnalysisResult | null;
  staticAnalysis: StaticAnalysisResult | null;
  history: GitHistoryResult | null;
  unavailable: string[];
}

export function estimateTechnicalDebt(analysisId: string, evidence: DebtModuleEvidence): TechnicalDebtReport {
  const items: TechnicalDebtItem[] = [];
  const limitations = [...evidence.unavailable];

  if (evidence.staticAnalysis) {
    items.push(...staticItems(evidence.staticAnalysis));
    if (evidence.staticAnalysis.summary.truncated) {
      limitations.push('Static analysis was truncated, so static-analysis indicators do not cover the whole repository.');
    }
  } else {
    limitations.push('Static analysis evidence is unavailable, so static-analysis indicators were not estimated.');
  }

  if (evidence.ast) {
    items.push(...nestingItems(evidence.ast));
    if (evidence.ast.summary.truncated) {
      limitations.push('AST discovery was truncated, so structural nesting indicators do not cover every source file.');
    }
    if (evidence.ast.summary.skippedOversizeFiles > 0) {
      limitations.push('Oversized files were skipped by AST analysis, so their nesting was not estimated.');
    }
  } else {
    limitations.push('AST evidence is unavailable, so structural nesting indicators were not estimated.');
  }

  if (evidence.dependencies) {
    items.push(...unresolvedItems(evidence.dependencies));
    items.push(...connectivityItems(evidence.dependencies));
    if (evidence.dependencies.summary.truncated) {
      limitations.push('Dependency discovery was truncated, so dependency indicators do not cover every source file.');
    }
  } else {
    limitations.push('Dependency evidence is unavailable, so unresolved-import and connectivity indicators were not estimated.');
  }

  if (!evidence.history) {
    limitations.push('Git history evidence is unavailable, so change-frequency indicators were not estimated.');
  } else if (!evidence.history.summary.isComplete || evidence.history.summary.historyDepth === 'shallow') {
    limitations.push('Git history is shallow or incomplete, so change-frequency indicators were not estimated.');
  } else {
    items.push(...changeItems(evidence.history));
  }

  items.sort((left, right) => {
    if (right.contribution !== left.contribution) return right.contribution - left.contribution;
    const file = left.affectedFile.localeCompare(right.affectedFile);
    if (file !== 0) return file;
    return left.indicator.localeCompare(right.indicator) || left.id.localeCompare(right.id);
  });

  const truncated = items.length > MAX_ITEMS;
  const kept = truncated ? items.slice(0, MAX_ITEMS) : items;
  if (truncated) {
    limitations.push(`Technical debt indicators were limited to ${MAX_ITEMS} items.`);
  }

  return {
    analysisId,
    kind: 'technical-debt-indicators',
    disclaimer: DEBT_DISCLAIMER,
    weights: { ...DEBT_WEIGHTS },
    items: kept,
    summary: summarize(kept, truncated),
    limitations: unique(limitations),
  };
}

function staticItems(result: StaticAnalysisResult): TechnicalDebtItem[] {
  const byFile = new Map<string, { errors: number; warnings: number; rules: Map<string, number> }>();
  for (const finding of result.findings) {
    const current = byFile.get(finding.path) ?? { errors: 0, warnings: 0, rules: new Map() };
    if (finding.severity === 'error') current.errors += 1;
    else current.warnings += 1;
    current.rules.set(finding.ruleId, (current.rules.get(finding.ruleId) ?? 0) + 1);
    byFile.set(finding.path, current);
  }

  const items: TechnicalDebtItem[] = [];
  for (const [file, counts] of byFile) {
    const contribution = counts.errors * DEBT_WEIGHTS.staticError + counts.warnings * DEBT_WEIGHTS.staticWarning;
    if (contribution <= 0) continue;
    const rules = [...counts.rules.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([rule, count]) => `${rule} (${count})`)
      .join(', ');
    items.push({
      id: `static-analysis:${file}`,
      indicator: 'static-analysis',
      category: 'maintenance concern',
      affectedFile: file,
      evidence: {
        source: 'static',
        path: file,
        detail: `${counts.errors} error findings and ${counts.warnings} warning findings. Rules: ${rules}.`,
      },
      contribution,
      explanation:
        'Estimated contribution counts fixed-rule static findings in this file. A finding is an analyzer result, not proof of technical debt.',
    });
  }
  return items;
}

function nestingItems(result: AstAnalysisResult): TechnicalDebtItem[] {
  const items: TechnicalDebtItem[] = [];
  for (const file of result.files) {
    const deep = file.functions.filter((fn) => fn.nestingDepth >= DEBT_WEIGHTS.nestingThreshold);
    if (deep.length === 0 && file.maxNestingDepth < DEBT_WEIGHTS.nestingThreshold) continue;
    const count = Math.max(deep.length, file.maxNestingDepth >= DEBT_WEIGHTS.nestingThreshold ? 1 : 0);
    items.push({
      id: `structural-nesting:${file.path}`,
      indicator: 'structural-nesting',
      category: 'maintenance concern',
      affectedFile: file.path,
      evidence: {
        source: 'ast',
        path: file.path,
        detail: `Maximum nesting depth ${file.maxNestingDepth}. ${deep.length} functions at or above depth ${DEBT_WEIGHTS.nestingThreshold}.`,
      },
      contribution: DEBT_WEIGHTS.nestingContribution * count,
      explanation:
        'Estimated contribution reflects structural nesting reported by the AST analyzer. Nesting depth is not a validated complexity or debt metric.',
    });
  }
  return items;
}

function unresolvedItems(result: DependencyAnalysisResult): TechnicalDebtItem[] {
  return result.unresolved.map((item, index) => ({
    id: `unresolved-dependency:${item.source}:${item.importSpecifier}:${index}`,
    indicator: 'unresolved-dependency' as const,
    category: 'maintenance concern',
    affectedFile: item.source,
    evidence: {
      source: 'dependencies' as const,
      path: item.source,
      detail: `Unresolved import "${item.importSpecifier}" (${item.kind}). ${item.message}`,
    },
    contribution: DEBT_WEIGHTS.unresolvedImport,
    explanation:
      'Estimated contribution marks an import the dependency analyzer could not resolve. An unresolved import is not by itself a defect.',
  }));
}

function connectivityItems(result: DependencyAnalysisResult): TechnicalDebtItem[] {
  return result.files
    .filter((file) => file.outgoingInternal >= DEBT_WEIGHTS.connectivityThreshold)
    .map((file) => ({
      id: `dependency-connectivity:${file.path}`,
      indicator: 'dependency-connectivity' as const,
      category: 'maintenance concern',
      affectedFile: file.path,
      evidence: {
        source: 'dependencies' as const,
        path: file.path,
        detail: `${file.outgoingInternal} outgoing internal dependencies (threshold ${DEBT_WEIGHTS.connectivityThreshold}).`,
      },
      contribution: DEBT_WEIGHTS.connectivityContribution,
      explanation:
        'Estimated contribution flags high internal fan-out. Connectivity is not a circular-dependency or architecture score.',
    }));
}

function changeItems(result: GitHistoryResult): TechnicalDebtItem[] {
  return result.files
    .filter((file) => file.presentInWorkTree && file.commitCount >= DEBT_WEIGHTS.changeThreshold)
    .map((file) => ({
      id: `change-frequency:${file.path}`,
      indicator: 'change-frequency' as const,
      category: 'maintenance concern',
      affectedFile: file.path,
      evidence: {
        source: 'history' as const,
        path: file.path,
        detail: `${file.commitCount} commits in the available history, ${file.additions} additions and ${file.deletions} deletions.`,
      },
      contribution: DEBT_WEIGHTS.changeContribution,
      explanation:
        'Estimated contribution uses available Git change counts. It is not a hotspot score and is omitted when history is shallow.',
    }));
}

function summarize(items: TechnicalDebtItem[], truncated: boolean): TechnicalDebtSummary {
  const byIndicator = emptyIndicators();
  let estimatedContribution = 0;
  for (const item of items) {
    const bucket = byIndicator[item.indicator];
    bucket.count += 1;
    bucket.contribution += item.contribution;
    estimatedContribution += item.contribution;
  }
  return {
    itemCount: items.length,
    estimatedContribution,
    byIndicator,
    truncated,
  };
}

function emptyIndicators(): TechnicalDebtSummary['byIndicator'] {
  const indicators: DebtIndicator[] = [
    'static-analysis',
    'structural-nesting',
    'unresolved-dependency',
    'dependency-connectivity',
    'change-frequency',
  ];
  return Object.fromEntries(indicators.map((indicator) => [indicator, { count: 0, contribution: 0 }])) as TechnicalDebtSummary['byIndicator'];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}
