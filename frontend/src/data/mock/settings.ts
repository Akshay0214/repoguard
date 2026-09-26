import type { AppSettings } from '@/types';

export const mockSettings: AppSettings = {
  repository: {
    defaultBranch: 'main',
    autoAnalyzeOnPush: true,
    excludedPaths: 'node_modules/, dist/, **/*.generated.ts',
  },
  analysis: {
    depth: 'standard',
    includeTests: true,
    includeDependencies: true,
    severityThreshold: 'low',
  },
  ai: {
    recommendationsEnabled: true,
    autoExplainIssues: true,
    model: 'RepoGuard AI (v2.1)',
  },
  appearance: {
    theme: 'dark',
    density: 'comfortable',
    accentColor: 'amber',
  },
};
