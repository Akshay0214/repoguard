import type { RepositoryOverview, RepositorySummary } from '@/types';
import { countIssuesBySeverity, mockIssues } from '@/data/mock/issues';

export const mockRepository: RepositorySummary = {
  id: 'repo-orbit-commerce',
  name: 'orbit-commerce',
  fullName: 'acme-labs/orbit-commerce',
  provider: 'github',
  defaultBranch: 'main',
  visibility: 'private',
  primaryLanguage: 'TypeScript',
  languages: [
    { name: 'TypeScript', percent: 62 },
    { name: 'JavaScript', percent: 18 },
    { name: 'CSS', percent: 11 },
    { name: 'Python', percent: 6 },
    { name: 'Other', percent: 3 },
  ],
  fileCount: 1284,
  linesOfCode: 96420,
  contributors: 14,
  lastAnalyzedAt: '2026-08-29T09:12:00Z',
};

export const mockRepositoryOverview: RepositoryOverview = {
  repository: mockRepository,
  health: {
    overall: 74,
    codeQuality: 78,
    maintainability: 69,
    security: 82,
    architecture: 71,
    technicalDebt: 64,
  },
  severityCounts: countIssuesBySeverity(mockIssues),
  healthTrend: [
    { date: '2026-06-01', score: 61 },
    { date: '2026-06-15', score: 64 },
    { date: '2026-07-01', score: 63 },
    { date: '2026-07-15', score: 68 },
    { date: '2026-08-01', score: 70 },
    { date: '2026-08-15', score: 72 },
    { date: '2026-08-29', score: 74 },
  ],
  topRiskAreas: [
    {
      id: 'risk-1',
      path: 'src/services/payments/checkoutService.ts',
      description: 'High cyclomatic complexity and low test coverage around refund handling.',
      riskScore: 91,
      issueCount: 9,
      category: 'complexity',
    },
    {
      id: 'risk-2',
      path: 'src/lib/auth/tokenManager.ts',
      description: 'Hardcoded fallback secret and inconsistent token expiry checks.',
      riskScore: 87,
      issueCount: 5,
      category: 'security',
    },
    {
      id: 'risk-3',
      path: 'src/modules/inventory',
      description: 'Circular dependency between inventory and pricing modules.',
      riskScore: 79,
      issueCount: 6,
      category: 'architecture',
    },
    {
      id: 'risk-4',
      path: 'src/components/legacy/OrderTable.tsx',
      description: 'Duplicated rendering logic copied across three legacy table views.',
      riskScore: 73,
      issueCount: 4,
      category: 'duplication',
    },
    {
      id: 'risk-5',
      path: 'src/utils/formatters.ts',
      description: 'Sprawling utility file with unrelated responsibilities and no unit tests.',
      riskScore: 65,
      issueCount: 7,
      category: 'code-smell',
    },
  ],
  aiInsight: {
    id: 'insight-1',
    headline: 'Refund flow is your biggest concentration of risk',
    body:
      'checkoutService.ts accounts for nearly a third of open critical and high-severity issues. Its refund path branches into 14 conditional paths with no dedicated tests, which is the most common precursor to production incidents in payment code. Splitting refund logic into its own module and adding contract tests would remove most of this risk in a single pass.',
    confidence: 'high',
    relatedIssueIds: ['issue-1', 'issue-4', 'issue-9'],
  },
};
