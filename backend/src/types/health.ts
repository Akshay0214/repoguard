export interface HealthIndicator {
  id: string;
  label: string;
  value: number | string | null;
  available: boolean;
}

export interface RepositoryHealth {
  kind: 'heuristic-indicator';
  disclaimer: string;
  formula: string;
  indicators: HealthIndicator[];
  heuristicScore: number | null;
  omittedInputs: string[];
}
