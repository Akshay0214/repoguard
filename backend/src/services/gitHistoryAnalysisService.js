import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
/**
 * Git history evidence only. This module does not score risk, rank contributors,
 * or call a language model.
 *
 * Acquisition clones the requested branch. `GIT_HISTORY_DEPTH=0` (the default)
 * fetches that branch's history. A positive depth passes `git clone --depth`.
 * The analyzer records at most `GIT_HISTORY_COMMIT_LIMIT` commits (default 2000).
 *
 * A shallow boundary commit has no parent in the clone. Git still prints that
 * commit's numstat as if every current file were added. Those diffs are omitted.
 * Commit metadata is kept, and `summary.isComplete` stays false.
 *
 * `historyDepth` is `complete` only for a non-shallow clone whose commits and
 * file records fit the configured caps. `limited` means RepoGuard stopped at a
 * cap. `shallow` means Git reports a shallow repository and the cap was not hit.
 *
 * Rename and copy detection uses `git log -M -C`. A rename is stored on the new
 * path via `renamedFrom`. Older commits remain under the previous path. Rename
 * chains are not stitched together.
 *
 * `changeCount` is additions plus deletions. It is not a risk score.
 * `mostChangedFiles` is the highest recorded commit counts, capped at 20.
 * It is not a risk or debt ranking.
 */
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32_000_000;
const SUBJECT_LIMIT = 200;
const MOST_CHANGED_LIMIT = 20;
const MAX_FILE_RECORDS = 5_000;
const resultCache = new Map();
export class GitHistoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'GitHistoryError';
        this.code = code;
    }
}
export function analyzeAcquiredGitHistory(analysisId, workspacePath) {
    const cached = resultCache.get(analysisId);
    if (cached)
        return cached;
    const pending = analyzeGitHistoryWorkspace(workspacePath).catch((error) => {
        resultCache.delete(analysisId);
        throw error;
    });
    resultCache.set(analysisId, pending);
    return pending;
}
export async function analyzeGitHistoryWorkspace(workspacePath) {
    const root = path.resolve(workspacePath);
    try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory())
            throw new GitHistoryError('WORKSPACE_MISSING', 'Acquired workspace is no longer available.');
    }
    catch (error) {
        if (error instanceof GitHistoryError)
            throw error;
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
    const commitLimit = env.gitHistoryCommitLimit;
    let logText = '';
    let cloneCommitCount = 0;
    try {
        const countText = await runGit(root, ['rev-list', '--count', 'HEAD']);
        cloneCommitCount = Number(countText.trim());
        if (!Number.isInteger(cloneCommitCount) || cloneCommitCount < 0)
            cloneCommitCount = 0;
        logText = await runGit(root, [
            'log',
            '-n',
            String(commitLimit),
            '--numstat',
            '-M',
            '-C',
            '--date=iso-strict',
            '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%s',
        ]);
    }
    catch (error) {
        if (error instanceof GitHistoryError && error.code === 'GIT_FAILED' && /does not have any commits|unknown revision|ambiguous argument 'HEAD'/i.test(error.message)) {
            return emptyHistory(isShallow, 'The Git repository does not contain any commits.');
        }
        throw error;
    }
    const commits = [];
    const authorsByIdentity = new Map();
    const files = new Map();
    const errors = [];
    let commitsWithoutFileDiff = 0;
    let totalFileChanges = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const chunk of logText.split('\x1e')) {
        const trimmed = chunk.replace(/^\n/, '');
        if (trimmed.trim() === '')
            continue;
        const lines = trimmed.split(/\r?\n/);
        const header = (lines[0] ?? '').replace(/\r/g, '');
        const [hash, rawTimestamp, rawAuthor, rawEmail, rawSubject] = header.split('\x1f');
        if (!hash || !rawTimestamp || rawAuthor === undefined || rawEmail === undefined || rawSubject === undefined)
            continue;
        const timestamp = toIsoTimestamp(rawTimestamp);
        const author = normalizeAuthorName(rawAuthor);
        const subject = rawSubject.replace(/\s+/g, ' ').trim().slice(0, SUBJECT_LIMIT);
        commits.push({ hash, author, timestamp, subject });
        const identity = `${author}\0${rawEmail.trim().toLowerCase()}`;
        const existingAuthor = authorsByIdentity.get(identity);
        if (existingAuthor)
            existingAuthor.commits += 1;
        else
            authorsByIdentity.set(identity, { name: author, commits: 1 });
        if (isShallow && (shallowCommits.size === 0 || shallowCommits.has(hash))) {
            commitsWithoutFileDiff += 1;
            errors.push({
                message: `File diff for commit ${hash} was omitted because its parent is not in this shallow clone.`,
            });
            continue;
        }
        const seenInCommit = new Set();
        for (const line of lines.slice(1)) {
            if (line.trim() === '')
                continue;
            const parsed = parseNumstat(line);
            if (!parsed || seenInCommit.has(parsed.path))
                continue;
            seenInCommit.add(parsed.path);
            totalFileChanges += 1;
            totalAdditions += parsed.additions;
            totalDeletions += parsed.deletions;
            addFileTouch(files, parsed.path, parsed.additions, parsed.deletions, timestamp, parsed.renamedFrom);
        }
    }
    const fileRecords = [...files.entries()]
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
    const mostChangedFiles = [...fileRecords]
        .sort((left, right) => right.commitCount - left.commitCount || left.path.localeCompare(right.path))
        .slice(0, MOST_CHANGED_LIMIT)
        .map((file) => ({ path: file.path, commitCount: file.commitCount }));
    const returnedFiles = fileRecords.length > MAX_FILE_RECORDS
        ? [...fileRecords].sort((left, right) => right.commitCount - left.commitCount || left.path.localeCompare(right.path)).slice(0, MAX_FILE_RECORDS)
        : fileRecords;
    const filesTruncated = returnedFiles.length < fileRecords.length;
    const commitsTruncated = cloneCommitCount > commits.length;
    const truncated = commitsTruncated || filesTruncated;
    if (commitsTruncated) {
        errors.push({
            message: `Git history recorded ${commits.length} of ${cloneCommitCount} commits in this clone. The configured limit is ${commitLimit}.`,
        });
    }
    if (filesTruncated) {
        errors.push({
            message: `File history was limited to ${MAX_FILE_RECORDS} paths. Totals still include every recorded file change.`,
        });
    }
    const authors = [...authorsByIdentity.values()]
        .sort((left, right) => left.name.localeCompare(right.name) || right.commits - left.commits);
    const newest = commits[0]?.timestamp ?? null;
    const oldest = commits[commits.length - 1]?.timestamp ?? null;
    const historyDepth = historyDepthFor(isShallow, truncated);
    return {
        summary: {
            availableCommits: commits.length,
            uniqueAuthors: authors.length,
            totalFileChanges,
            totalAdditions,
            totalDeletions,
            oldestAvailableCommitAt: oldest,
            newestAvailableCommitAt: newest,
            historyDepth,
            isComplete: historyDepth === 'complete' && commits.length > 0,
            commitsWithoutFileDiff,
            cloneCommitCount,
            truncated,
            commitLimit: commitsTruncated ? commitLimit : null,
        },
        commits,
        authors,
        files: returnedFiles,
        mostChangedFiles,
        errors,
    };
}
function historyDepthFor(isShallow, truncated) {
    if (truncated)
        return 'limited';
    if (isShallow)
        return 'shallow';
    return 'complete';
}
function normalizeAuthorName(value) {
    const name = value.replace(/\s+/g, ' ').trim().slice(0, SUBJECT_LIMIT);
    return name === '' ? 'Unknown' : name;
}
function emptyHistory(isShallow, message) {
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
            cloneCommitCount: 0,
            truncated: false,
            commitLimit: null,
        },
        commits: [],
        authors: [],
        files: [],
        mostChangedFiles: [],
        errors: [{ message }],
    };
}
function addFileTouch(files, filePath, additions, deletions, timestamp, renamedFrom) {
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
    if (Date.parse(timestamp) < Date.parse(existing.firstSeenAt))
        existing.firstSeenAt = timestamp;
    if (Date.parse(timestamp) > Date.parse(existing.lastChangedAt))
        existing.lastChangedAt = timestamp;
    if (!existing.renamedFrom && renamedFrom)
        existing.renamedFrom = renamedFrom;
}
function parseNumstat(line) {
    const parts = line.split('\t');
    if (parts.length < 3)
        return null;
    const additions = parseCount(parts[0] ?? '');
    const deletions = parseCount(parts[1] ?? '');
    if (additions === null || deletions === null)
        return null;
    const rawPath = parts.slice(2).join('\t').replaceAll('\\', '/');
    const renamed = splitRename(rawPath);
    if (!renamed.path || renamed.path.includes('\0'))
        return null;
    return { additions, deletions, path: renamed.path, renamedFrom: renamed.renamedFrom };
}
function parseCount(value) {
    if (value === '-')
        return 0;
    if (!/^\d+$/.test(value))
        return null;
    return Number(value);
}
function splitRename(rawPath) {
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
function toIsoTimestamp(value) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        return value;
    return new Date(parsed).toISOString();
}
async function readShallowCommits(root) {
    try {
        const gitPath = (await runGit(root, ['rev-parse', '--git-path', 'shallow'])).trim();
        const absolute = path.isAbsolute(gitPath) ? gitPath : path.resolve(root, gitPath);
        const text = await readFile(absolute, 'utf8');
        return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0));
    }
    catch {
        return new Set();
    }
}
async function readTrackedFiles(root) {
    const output = await runGit(root, ['ls-files', '-z']);
    const files = new Set();
    for (const entry of output.split('\0')) {
        if (entry.trim() === '')
            continue;
        files.add(entry.replaceAll('\\', '/'));
    }
    return files;
}
function runGit(cwd, args) {
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
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            if (stdout.length > MAX_OUTPUT_BYTES) {
                tooLarge = true;
                child.kill();
            }
        });
        child.stderr?.on('data', (chunk) => {
            stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000);
        });
        child.on('error', (error) => {
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
