export type HistoryDepth = 'shallow' | 'complete';

export interface GitHistorySummary {
  /** Commits present in this clone, not the upstream repository's full history. */
  availableCommits: number;
  uniqueAuthors: number;
  /** File appearances across available commits whose diffs could be read. */
  totalFileChanges: number;
  totalAdditions: number;
  totalDeletions: number;
  oldestAvailableCommitAt: string | null;
  newestAvailableCommitAt: string | null;
  historyDepth: HistoryDepth;
  /** False when the clone is shallow or contains no commits. */
  isComplete: boolean;
  /**
   * Commits whose parent is outside this clone.
   * Their file diffs are omitted so a shallow boundary is not reported as a full-tree rewrite.
   */
  commitsWithoutFileDiff: number;
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
