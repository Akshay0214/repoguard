export type HistoryDepth = 'shallow' | 'limited' | 'complete';

export interface GitHistorySummary {
  /** Commits recorded by this analysis. This matches `commits.length`. */
  availableCommits: number;
  uniqueAuthors: number;
  /** File appearances across commits whose diffs could be read. */
  totalFileChanges: number;
  totalAdditions: number;
  totalDeletions: number;
  oldestAvailableCommitAt: string | null;
  newestAvailableCommitAt: string | null;
  historyDepth: HistoryDepth;
  /**
   * True only when the clone is not shallow, the configured commit and file caps
   * were not hit, and at least one commit was recorded.
   */
  isComplete: boolean;
  /**
   * Commits whose parent is outside this clone.
   * Their file diffs are omitted so a shallow boundary is not reported as a full-tree rewrite.
   */
  commitsWithoutFileDiff: number;
  /** Commits present in this clone, including commits past the analysis cap. */
  cloneCommitCount: number;
  /** True when RepoGuard stopped before recording every commit or file in the clone. */
  truncated: boolean;
  /** Configured maximum commits recorded, when that cap was applied. */
  commitLimit: number | null;
}

export interface GitCommitRecord {
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
}

export interface GitAuthorRecord {
  name: string;
  commits: number;
}

export interface GitFileHistory {
  path: string;
  commitCount: number;
  additions: number;
  deletions: number;
  /** Additions plus deletions in the available diffs. */
  changeCount: number;
  firstSeenAt: string;
  lastChangedAt: string;
  presentInWorkTree: boolean;
  /** Set when a diff in the available history renamed another path to this one. */
  renamedFrom: string | null;
}

export interface GitMostChangedFile {
  path: string;
  commitCount: number;
}

export interface GitHistoryErrorRecord {
  message: string;
}

export interface GitHistoryResult {
  summary: GitHistorySummary;
  commits: GitCommitRecord[];
  authors: GitAuthorRecord[];
  files: GitFileHistory[];
  mostChangedFiles: GitMostChangedFile[];
  errors: GitHistoryErrorRecord[];
}
