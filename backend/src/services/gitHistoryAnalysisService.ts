import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  GitAuthorRecord,
  GitCommitRecord,
  GitFileHistory,
  GitHistoryResult,
  GitMostChangedFile,
} from '../types/gitHistory.js';

/**
 * Git history evidence only. This module does not score risk, rank contributors,
 * or call a language model.
 *
 * Acquisition clones with `git clone --depth 1`. A shallow boundary commit has
 * no parent in the clone. Git still prints that commit's numstat as if every
 * current file were added. Those diffs are omitted. Commit metadata is kept,
 * and `summary.isComplete` stays false.
 *
 * Rename detection uses `git log -M`. A rename is stored on the new path via
 * `renamedFrom`. Older commits remain under the previous path. Rename chains
 * are not stitched together.
 *
 * `changeCount` is additions plus deletions. It is not a risk score.
 * `mostChangedFiles` is the highest available commit counts, capped at 20.
 */

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32_000_000;
const SUBJECT_LIMIT = 200;
const MOST_CHANGED_LIMIT = 20;

const resultCache = new Map<string, Promise<GitHistoryResult>>();

export class GitHistoryError extends Error {
  readonly code: 'NO_GIT_REPOSITORY' | 'GIT_UNAVAILABLE' | 'GIT_TIMEOUT' | 'GIT_FAILED' | 'WORKSPACE_MISSING';

  constructor(
    code: 'NO_GIT_REPOSITORY' | 'GIT_UNAVAILABLE' | 'GIT_TIMEOUT' | 'GIT_FAILED' | 'WORKSPACE_MISSING',
    message: string,
  ) {
    super(message);
    this.name = 'GitHistoryError';
    this.code = code;
  }
}

interface FileAggregate {
  commitCount: number;
  additions: number;
  deletions: number;
  firstSeenAt: string;
  lastChangedAt: string;
  renamedFrom: string | null;
}

export function analyzeAcquiredGitHistory(analysisId: string, workspacePath: string): Promise<GitHistoryResult> {
  const cached = resultCache.get(analysisId);
  if (cached) return cached;

  const pending = analyzeGitHistoryWorkspace(workspacePath).catch((error: unknown) => {
    resultCache.delete(analysisId);
    throw error;
  });
  resultCache.set(analysisId, pending);
  return pending;
}

export async function analyzeGitHistoryWorkspace(workspacePath: string): Promise<GitHistoryResult> {
  const root = path.resolve(workspacePath);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new GitHistoryError('WORKSPACE_MISSING', 'Acquired workspace is no longer available.');
  } catch (error) {
    if (error instanceof GitHistoryError) throw error;
    throw new GitHistoryError('WORKSPACE_MISSING', 'Acquired workspace is no longer available.');
  }

  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.trim() !== 'true') {
    throw new GitHistoryError('NO_GIT_REPOSITORY', 'The acquired workspace does not contain a Git repository.');
  }

  const shallowText = await runGit(root, ['rev-parse', '--is-shallow-repository']);
  const isShallow = shallowText.trim() === 'true';
  const shallowCommits = await readShallowCommits(root);
  const currentFiles = await readTrackedFiles(root);

  let logText = '';
  try {
    logText = await runGit(root, [
      'log',
      '--numstat',
      '-M',
      '--date=iso-strict',
      '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%s',
    ]);
  } catch (error) {
    if (error instanceof GitHistoryError && error.code === 'GIT_FAILED' && /does not have any commits/i.test(error.message)) {
      return emptyHistory(isShallow, 'The Git repository does not contain any commits.');
    }
    throw error;
  }

  const commits: GitCommitRecord[] = [];
  const authorCounts = new Map<string, number>();
  const files = new Map<string, FileAggregate>();
  const errors: GitHistoryResult['errors'] = [];
  let commitsWithoutFileDiff = 0;
  let totalFileChanges = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const chunk of logText.split('\x1e')) {
    const trimmed = chunk.replace(/^\n/, '');
    if (trimmed.trim() === '') continue;
    const lines = trimmed.split(/\r?\n/);
    const header = (lines[0] ?? '').replace(/\r/g, '');
    const [hash, rawTimestamp, rawAuthor, rawSubject] = header.split('\x1f');
    if (!hash || !rawTimestamp || rawAuthor === undefined || rawSubject === undefined) continue;

    const timestamp = toIsoTimestamp(rawTimestamp);
    const author = rawAuthor.trim().slice(0, SUBJECT_LIMIT) || 'Unknown';
    const subject = rawSubject.replace(/\s+/g, ' ').trim().slice(0, SUBJECT_LIMIT);
    commits.push({ hash, author, timestamp, subject });
    authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);

    if (isShallow && (shallowCommits.size === 0 || shallowCommits.has(hash))) {
      commitsWithoutFileDiff += 1;
      errors.push({
        message: `File diff for commit ${hash} was omitted because its parent is not in this shallow clone.`,
      });
      continue;
    }

    const seenInCommit = new Set<string>();
    for (const line of lines.slice(1)) {
      if (line.trim() === '') continue;
      const parsed = parseNumstat(line);
      if (!parsed || seenInCommit.has(parsed.path)) continue;
      seenInCommit.add(parsed.path);
      totalFileChanges += 1;
      totalAdditions += parsed.additions;
      totalDeletions += parsed.deletions;
      addFileTouch(files, parsed.path, parsed.additions, parsed.deletions, timestamp, parsed.renamedFrom);
    }
  }

  const fileRecords: GitFileHistory[] = [...files.entries()]
    .map(([filePath, aggregate]) => ({
      path: filePath,
      commitCount: aggregate.commitCount,
      additions: aggregate.additions,
      deletions: aggregate.deletions,
      changeCount: aggregate.additions + aggregate.deletions,
      firstSeenAt: aggregate.firstSeenAt,
      lastChangedAt: aggregate.lastChangedAt,
      presentInWorkTree: currentFiles.has(filePath),
      renamedFrom: aggregate.renamedFrom,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const mostChangedFiles: GitMostChangedFile[] = [...fileRecords]
    .sort((left, right) => right.commitCount - left.commitCount || left.path.localeCompare(right.path))
    .slice(0, MOST_CHANGED_LIMIT)
    .map((file) => ({ path: file.path, commitCount: file.commitCount }));

  const authors: GitAuthorRecord[] = [...authorCounts.entries()]
    .map(([name, commitCount]) => ({ name, commits: commitCount }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const newest = commits[0]?.timestamp ?? null;
  const oldest = commits[commits.length - 1]?.timestamp ?? null;

  return {
    summary: {
      availableCommits: commits.length,
      uniqueAuthors: authors.length,
      totalFileChanges,
      totalAdditions,
      totalDeletions,
      oldestAvailableCommitAt: oldest,
      newestAvailableCommitAt: newest,
      historyDepth: isShallow ? 'shallow' : 'complete',
      isComplete: !isShallow && commits.length > 0,
      commitsWithoutFileDiff,
    },
    commits,
    authors,
    files: fileRecords,
    mostChangedFiles,
    errors,
  };
}

function emptyHistory(isShallow: boolean, message: string): GitHistoryResult {
  return {
    summary: {
      availableCommits: 0,
      uniqueAuthors: 0,
      totalFileChanges: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      oldestAvailableCommitAt: null,
      newestAvailableCommitAt: null,
      historyDepth: isShallow ? 'shallow' : 'complete',
      isComplete: false,
      commitsWithoutFileDiff: 0,
    },
    commits: [],
    authors: [],
    files: [],
    mostChangedFiles: [],
    errors: [{ message }],
  };
}

function addFileTouch(
  files: Map<string, FileAggregate>,
  filePath: string,
  additions: number,
  deletions: number,
  timestamp: string,
  renamedFrom: string | null,
): void {
  const existing = files.get(filePath);
  if (!existing) {
    files.set(filePath, {
      commitCount: 1,
      additions,
      deletions,
      firstSeenAt: timestamp,
      lastChangedAt: timestamp,
      renamedFrom,
    });
    return;
  }
  existing.commitCount += 1;
  existing.additions += additions;
  existing.deletions += deletions;
  if (Date.parse(timestamp) < Date.parse(existing.firstSeenAt)) existing.firstSeenAt = timestamp;
  if (Date.parse(timestamp) > Date.parse(existing.lastChangedAt)) existing.lastChangedAt = timestamp;
  if (!existing.renamedFrom && renamedFrom) existing.renamedFrom = renamedFrom;
}

function parseNumstat(line: string): { additions: number; deletions: number; path: string; renamedFrom: string | null } | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const additions = parseCount(parts[0] ?? '');
  const deletions = parseCount(parts[1] ?? '');
  if (additions === null || deletions === null) return null;
  const rawPath = parts.slice(2).join('\t').replaceAll('\\', '/');
  const renamed = splitRename(rawPath);
  if (!renamed.path || renamed.path.includes('\0')) return null;
  return { additions, deletions, path: renamed.path, renamedFrom: renamed.renamedFrom };
}

function parseCount(value: string): number | null {
  if (value === '-') return 0;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function splitRename(rawPath: string): { path: string; renamedFrom: string | null } {
  const match = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rawPath);
  if (match) {
    const prefix = match[1] ?? '';
    const before = match[2] ?? '';
    const after = match[3] ?? '';
    const suffix = match[4] ?? '';
    return {
      path: `${prefix}${after}${suffix}`,
      renamedFrom: `${prefix}${before}${suffix}`,
    };
  }
  const arrow = rawPath.indexOf(' => ');
  if (arrow !== -1) {
    return {
      renamedFrom: rawPath.slice(0, arrow),
      path: rawPath.slice(arrow + ' => '.length),
    };
  }
  return { path: rawPath, renamedFrom: null };
}

function toIsoTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

async function readShallowCommits(root: string): Promise<Set<string>> {
  try {
    const gitPath = (await runGit(root, ['rev-parse', '--git-path', 'shallow'])).trim();
    const absolute = path.isAbsolute(gitPath) ? gitPath : path.resolve(root, gitPath);
    const text = await readFile(absolute, 'utf8');
    return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0));
  } catch {
    return new Set();
  }
}

async function readTrackedFiles(root: string): Promise<Set<string>> {
  const output = await runGit(root, ['ls-files', '-z']);
  const files = new Set<string>();
  for (const entry of output.split('\0')) {
    if (entry.trim() === '') continue;
    files.add(entry.replaceAll('\\', '/'));
  }
  return files;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.longpaths=true', '-c', 'core.quotepath=false', ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT_MS,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PATHEXT: process.env.PATHEXT,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        HOMEDRIVE: process.env.HOMEDRIVE,
        HOMEPATH: process.env.HOMEPATH,
        TMP: process.env.TMP,
        TEMP: process.env.TEMP,
        LANG: process.env.LANG,
        COMSPEC: process.env.COMSPEC,
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    let stdout = '';
    let stderr = '';
    let tooLarge = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        tooLarge = true;
        child.kill();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new GitHistoryError('GIT_UNAVAILABLE', 'Git is not available on this machine.'));
        return;
      }
      reject(new GitHistoryError('GIT_FAILED', 'Git history command failed.'));
    });

    child.on('close', (code, signal) => {
      if (tooLarge) {
        reject(new GitHistoryError('GIT_FAILED', 'Git history output exceeded the size limit.'));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (signal === 'SIGTERM') {
        reject(new GitHistoryError('GIT_TIMEOUT', 'Git history analysis timed out.'));
        return;
      }
      const detail = stderr.trim();
      if (/not a git repository|not a git dir/i.test(detail)) {
        reject(new GitHistoryError('NO_GIT_REPOSITORY', 'The acquired workspace does not contain a Git repository.'));
        return;
      }
      reject(new GitHistoryError('GIT_FAILED', detail || 'Git history command failed.'));
    });
  });
}
