export type DependencyEdgeKind = 'import' | 're-export' | 'require' | 'dynamic-import';

export type DependencyClassification = 'internal' | 'external';

export interface DependencyNode {
  id: string;
  type: 'file';
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: DependencyClassification;
  kind: DependencyEdgeKind;
  importSpecifier: string;
}

export interface ExternalDependency {
  name: string;
  count: number;
}

export interface UnresolvedDependency {
  source: string;
  importSpecifier: string;
  kind: DependencyEdgeKind;
  message: string;
}

export interface FileDependencyFacts {
  path: string;
  outgoingInternal: number;
  incomingInternal: number;
  external: number;
  unresolved: number;
}

export interface DependencyAnalysisSummary {
  totalInternalNodes: number;
  totalInternalEdges: number;
  totalExternalPackages: number;
  unresolvedImports: number;
  filesWithDependencies: number;
  filesWithNoDependencies: number;
  /** Largest number of distinct internal files imported by one file. */
  maxOutgoingInternalDependencies: number;
  filesDiscovered: number;
  parseErrors: number;
  truncated: boolean;
}

export interface DependencyAnalysisError {
  path: string;
  message: string;
}

export interface DependencyAnalysisResult {
  summary: DependencyAnalysisSummary;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  externalDependencies: ExternalDependency[];
  unresolved: UnresolvedDependency[];
  files: FileDependencyFacts[];
  errors: DependencyAnalysisError[];
}
