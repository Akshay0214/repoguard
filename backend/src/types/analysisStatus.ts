export type AcquisitionRunStatus = 'pending' | 'running' | 'ready' | 'failed';

export type AnalysisModuleStatus = 'pending' | 'running' | 'ready' | 'failed';

export type RepositoryAnalysisStatus = 'queued' | 'acquiring' | 'analyzing' | 'ready' | 'partial' | 'failed';

export interface AnalysisReadiness {
  analysisId: string;
  status: RepositoryAnalysisStatus;
  acquisition: {
    status: AcquisitionRunStatus;
  };
  modules: {
    ast: AnalysisModuleStatus;
    dependencies: AnalysisModuleStatus;
    static: AnalysisModuleStatus;
    history: AnalysisModuleStatus;
  };
  limitations: string[];
}
