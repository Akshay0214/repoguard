import type { AnalysisProgressStep } from '@/types';

export const mockAnalysisSteps: AnalysisProgressStep[] = [
  { id: 'step-clone', label: 'Fetching repository contents', status: 'pending' },
  { id: 'step-parse', label: 'Parsing source files', status: 'pending' },
  { id: 'step-smells', label: 'Detecting code smells & complexity', status: 'pending' },
  { id: 'step-deps', label: 'Mapping dependency graph', status: 'pending' },
  { id: 'step-security', label: 'Scanning for security risks', status: 'pending' },
  { id: 'step-ai', label: 'Generating AI explanations', status: 'pending' },
  { id: 'step-score', label: 'Computing health score', status: 'pending' },
];
