import type { AnalysisJob } from '../types/analysis.js';
import type { AiInterpretation } from '../types/ai.js';
import { getStoredAnalysisResults } from './analysisResultStore.js';
import { readRepositoryOverview, readRepositoryStaticIssues, readTechnicalDebt } from './analysisOrchestrationService.js';

export interface AnalysisReport {
  generatedAt: string;
  repository: {
    name: string;
    branch: string;
    sourceType: AnalysisJob['sourceType'];
    repositoryUrl: string;
  };
  analysisId: string;
  status: string;
  overview: ReturnType<typeof readRepositoryOverview> | null;
  staticFindings: ReturnType<typeof readRepositoryStaticIssues> extends infer T
    ? T extends { state: 'ready'; issues: infer Issues }
      ? Issues
      : null
    : null;
  gitHistorySummary: {
    availableCommits: number;
    uniqueAuthors: number;
    totalFileChanges: number;
    totalAdditions: number;
    totalDeletions: number;
    historyDepth: string;
    isComplete: boolean;
  } | null;
  technicalDebt: ReturnType<typeof readTechnicalDebt> extends infer T
    ? T extends { state: 'ready'; report: infer Report }
      ? Report
      : null
    : null;
  limitations: string[];
  aiInterpretation: AiInterpretation | null;
}

export function buildAnalysisReport(job: AnalysisJob): AnalysisReport {
  const stored = getStoredAnalysisResults(job.analysisId);
  const overview = job.status === 'queued' || job.status === 'acquiring' ? null : readRepositoryOverview(job);
  const issues = readRepositoryStaticIssues(job);
  const debt = readTechnicalDebt(job);
  const history = stored?.history?.summary ?? null;
  const limitations = [
    ...(overview?.readiness.limitations ?? []),
    ...(debt.state === 'ready' ? debt.report.limitations : []),
    ...(stored?.reduced ? ['Stored analyzer details were reduced because the result was large.'] : []),
  ];

  return {
    generatedAt: new Date().toISOString(),
    repository: {
      name: job.repositoryName,
      branch: job.branch,
      sourceType: job.sourceType,
      repositoryUrl: job.repositoryUrl,
    },
    analysisId: job.analysisId,
    status: overview?.readiness.status ?? job.status,
    overview,
    staticFindings: issues.state === 'ready' ? issues.issues : null,
    gitHistorySummary: history
      ? {
          availableCommits: history.availableCommits,
          uniqueAuthors: history.uniqueAuthors,
          totalFileChanges: history.totalFileChanges,
          totalAdditions: history.totalAdditions,
          totalDeletions: history.totalDeletions,
          historyDepth: history.historyDepth,
          isComplete: history.isComplete,
        }
      : overview?.history
        ? {
            availableCommits: overview.history.availableCommits,
            uniqueAuthors: overview.history.uniqueAuthors,
            totalFileChanges: overview.history.totalFileChanges,
            totalAdditions: overview.history.totalAdditions,
            totalDeletions: overview.history.totalDeletions,
            historyDepth: overview.history.historyDepth,
            isComplete: overview.history.isComplete,
          }
        : null,
    technicalDebt: debt.state === 'ready' ? debt.report : null,
    limitations: [...new Set(limitations)],
    aiInterpretation: stored?.repositoryAi ?? null,
  };
}

export function renderAnalysisReportHtml(report: AnalysisReport): string {
  const debtItems = report.technicalDebt?.items.slice(0, 50) ?? [];
  const findings = report.staticFindings?.findings.slice(0, 50) ?? [];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>RepoGuard analysis report</title>
  <style>
    body { font-family: Georgia, serif; margin: 2rem; color: #1c1917; }
    h1, h2 { font-family: "Segoe UI", sans-serif; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d6d3d1; padding: 0.4rem 0.5rem; text-align: left; vertical-align: top; }
    .note { color: #57534e; }
  </style>
</head>
<body>
  <h1>RepoGuard analysis report</h1>
  <p class="note">This report contains stored analyzer results. Heuristic scores and debt contributions are indicators, not validated quality measurements.</p>
  <h2>Repository</h2>
  <p>${escapeHtml(report.repository.name)} (${escapeHtml(report.repository.sourceType)})</p>
  <p>Branch: ${escapeHtml(report.repository.branch)}</p>
  <p>URL: ${escapeHtml(report.repository.repositoryUrl)}</p>
  <p>Analysis: ${escapeHtml(report.analysisId)}</p>
  <p>Generated: ${escapeHtml(report.generatedAt)}</p>
  <p>Status: ${escapeHtml(report.status)}</p>
  <h2>Overview</h2>
  ${report.overview ? overviewTable(report) : '<p>Overview is not ready.</p>'}
  <h2>Static findings</h2>
  ${findings.length === 0 ? '<p>No stored static findings.</p>' : findingsTable(findings)}
  <h2>Git history summary</h2>
  ${report.gitHistorySummary ? `<p>${report.gitHistorySummary.availableCommits} commits, ${report.gitHistorySummary.uniqueAuthors} authors, history ${escapeHtml(report.gitHistorySummary.historyDepth)}, complete: ${report.gitHistorySummary.isComplete}</p>` : '<p>Git history summary is unavailable.</p>'}
  <h2>Technical debt indicators</h2>
  ${report.technicalDebt ? `<p>${escapeHtml(report.technicalDebt.disclaimer)}</p><p>Estimated contribution: ${report.technicalDebt.summary.estimatedContribution}</p>${debtTable(debtItems)}` : '<p>Technical debt indicators are not ready.</p>'}
  <h2>Limitations</h2>
  <ul>${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>None recorded.</li>'}</ul>
  <h2>AI interpretation</h2>
  ${report.aiInterpretation ? `<p>${escapeHtml(report.aiInterpretation.summary)}</p>` : '<p>No repository AI interpretation has been stored.</p>'}
</body>
</html>`;
}

function overviewTable(report: AnalysisReport): string {
  const overview = report.overview;
  if (!overview) return '';
  const rows = [
    ['Files', overview.ast?.totalFiles],
    ['Lines', overview.ast?.totalLines],
    ['Functions', overview.ast?.totalFunctions],
    ['Classes', overview.ast?.totalClasses],
    ['Static findings', overview.static?.findingCount],
    ['Unresolved imports', overview.dependencies?.unresolvedImports],
    ['Heuristic score', overview.health.heuristicScore],
  ];
  return `<table><tbody>${rows
    .map(([label, value]) => `<tr><th>${escapeHtml(String(label))}</th><td>${value ?? 'Unavailable'}</td></tr>`)
    .join('')}</tbody></table><p class="note">${escapeHtml(overview.health.disclaimer)}</p>`;
}

function findingsTable(findings: Array<{ path: string; line: number | null; ruleId: string; severity: string; message: string }>): string {
  return `<table><thead><tr><th>File</th><th>Line</th><th>Rule</th><th>Severity</th><th>Message</th></tr></thead><tbody>${findings
    .map(
      (finding) =>
        `<tr><td>${escapeHtml(finding.path)}</td><td>${finding.line ?? ''}</td><td>${escapeHtml(finding.ruleId)}</td><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.message)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function debtTable(items: Array<{ indicator: string; affectedFile: string; contribution: number; evidence: { detail: string } }>): string {
  if (items.length === 0) return '<p>No debt indicators were produced from the available evidence.</p>';
  return `<table><thead><tr><th>Indicator</th><th>File</th><th>Contribution</th><th>Evidence</th></tr></thead><tbody>${items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.indicator)}</td><td>${escapeHtml(item.affectedFile)}</td><td>${item.contribution}</td><td>${escapeHtml(item.evidence.detail)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
