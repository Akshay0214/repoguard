export type AnalysisSourceType = 'github' | 'zip';

export type AnalysisStatus = 'queued' | 'acquiring' | 'ready' | 'failed';

export interface CreateGithubAnalysisRequest {
  sourceType: 'github';
  repositoryUrl: string;
  branch: string;
}

export interface AnalysisJob {
  analysisId: string;
  repositoryUrl: string;
  repositoryName: string;
  branch: string;
  sourceType: 'github';
  status: AnalysisStatus;
  createdAt: string;
  updatedAt: string;
  /** Internal clone location. Never returned by the API. */
  workspacePath?: string;
  acquisitionStartedAt?: string;
  acquisitionCompletedAt?: string;
  errorMessage?: string;
}

/** Analysis job fields that are safe to return to clients. */
export type PublicAnalysisJob = Omit<AnalysisJob, 'workspacePath'>;
