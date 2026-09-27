import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { getAnalysisJob, updateAnalysisJob } from './analysisService.js';

/** Shallow clones are killed if git has not finished within this limit. */
function cloneTimeoutMs(): number {
  return env.cloneTimeoutMs;
}

const WORKSPACE_ROOT = path.resolve(path.join(os.tmpdir(), 'repoguard'));
const ANALYSIS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function analysisWorkspacePath(analysisId: string): string {
  if (!ANALYSIS_ID_PATTERN.test(analysisId)) {
    throw new Error('Invalid analysis id');
  }

  const target = path.resolve(WORKSPACE_ROOT, analysisId);
  const relative = path.relative(WORKSPACE_ROOT, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe workspace path');
  }
  return target;
}

const githubTokens = new Map<string, string>();

/** Holds a token only until acquisition consumes it. Never persisted. */
export function holdGithubToken(analysisId: string, token: string): void {
  const trimmed = token.trim();
  if (trimmed) githubTokens.set(analysisId, trimmed);
}

function consumeGithubToken(analysisId: string): string | undefined {
  const token = githubTokens.get(analysisId);
  githubTokens.delete(analysisId);
  return token;
}

export async function cleanupStaleWorkspaces(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  let entries;
  try {
    entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || !ANALYSIS_ID_PATTERN.test(entry.name)) return;
      const job = getAnalysisJob(entry.name);
      if (job && (job.status === 'queued' || job.status === 'acquiring')) return;
      const target = path.join(WORKSPACE_ROOT, entry.name);
      try {
        const info = await stat(target);
        if (now - info.mtimeMs < maxAgeMs) return;
        await rm(target, { recursive: true, force: true });
      } catch {
        // A workspace that disappears during cleanup is already gone.
      }
    }),
  );
}
export async function removeAnalysisWorkspace(analysisId: string): Promise<void> {
  const target = analysisWorkspacePath(analysisId);
  await rm(target, { recursive: true, force: true });
}

/**
 * Clones the job's GitHub repository into a unique temp workspace.
 * Failures are stored on the job and do not propagate to the HTTP server.
 */
export async function acquireRepository(analysisId: string): Promise<void> {
  const job = getAnalysisJob(analysisId);
  if (!job) return;

  let workspacePath: string | undefined;
  let authenticated = false;
  const token = consumeGithubToken(job.analysisId) ?? (env.githubToken || undefined);
  authenticated = Boolean(token);
  try {
    if (job.sourceType !== 'github') {
      throw new Error('Only GitHub repositories can be acquired.');
    }
    assertSafeBranch(job.branch);
    const cloneUrl = canonicalGithubCloneUrl(job.repositoryName);
    workspacePath = analysisWorkspacePath(job.analysisId);

    updateAnalysisJob(job.analysisId, {
      status: 'acquiring',
      acquisitionStartedAt: new Date().toISOString(),
      errorMessage: undefined,
      workspacePath: undefined,
    });

    await mkdir(WORKSPACE_ROOT, { recursive: true });
    await cloneGitRepository(cloneUrl, job.branch, workspacePath, token);
    await stat(path.join(workspacePath, '.git'));

    updateAnalysisJob(job.analysisId, {
      status: 'ready',
      workspacePath,
      acquisitionCompletedAt: new Date().toISOString(),
      errorMessage: undefined,
    });
  } catch (error) {
    const errorMessage = describeCloneFailure(error instanceof Error ? error.message : 'Repository acquisition failed.', authenticated);
    console.error('Repository acquisition failed:', errorMessage);
    if (workspacePath) {
      await removeAnalysisWorkspace(job.analysisId).catch((cleanupError: unknown) => {
        console.error('Failed to remove an incomplete repository workspace', cleanupError);
      });
    }
    updateAnalysisJob(job.analysisId, {
      status: 'failed',
      workspacePath: undefined,
      acquisitionCompletedAt: new Date().toISOString(),
      errorMessage,
    });
  }
}

function assertSafeBranch(branch: string): void {
  if (branch.trim() === '' || branch !== branch.trim()) {
    throw new Error('Branch is required.');
  }
  if (branch.startsWith('-') || branch.includes('..') || /[\u0000-\u001f\u007f]/.test(branch)) {
    throw new Error('Branch name is not valid.');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error('Branch name is not valid.');
  }
}

function canonicalGithubCloneUrl(repositoryName: string): string {
  const parts = repositoryName.split('/');
  if (parts.length !== 2) {
    throw new Error('Repository name is not valid.');
  }
  const [owner, repo] = parts;
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Repository name is not valid.');
  }
  return `https://github.com/${owner}/${repo}.git`;
}

export function describeCloneFailure(raw: string, authenticated: boolean): string {
  const text = raw.replace(/\s+/g, ' ').slice(0, 500);
  if (/timed out/i.test(text)) return 'Repository clone timed out.';
  if (/Git is not available/i.test(text)) return 'Git is not available on this machine.';
  if (/Branch name is not valid|Branch is required/i.test(text)) return 'Branch name is not valid.';
  if (/could not find remote branch|remote branch .+ not found/i.test(text)) {
    return 'The requested branch does not exist on this repository.';
  }
  if (/filename too long|unable to checkout working tree/i.test(text)) {
    return 'The repository could not be checked out because some file paths are too long.';
  }
  if (/authentication failed|invalid username or token|bad credentials|terminal prompts disabled/i.test(text)) {
    return authenticated
      ? 'GitHub authentication failed. The access token is invalid or does not have access to this repository.'
      : 'The repository could not be cloned. It may be private, missing, or unavailable.';
  }
  if (/repository not found|could not read from remote/i.test(text)) {
    return authenticated
      ? 'The repository is inaccessible with the provided token, or it does not exist.'
      : 'The repository could not be cloned. It may be private, missing, or unavailable.';
  }
  return 'Repository acquisition failed.';
}

export async function cloneGitRepository(
  cloneUrl: string,
  branch: string,
  destination: string,
  token?: string,
): Promise<void> {
  assertSafeBranch(branch);
  await withAskpass(token, (credentialEnv) => runGitClone(cloneUrl, branch, destination, credentialEnv, token));
}

const ASKPASS_SOURCE = `#!/usr/bin/env node
const prompt = process.argv.slice(2).join(' ');
if (/username/i.test(prompt)) process.stdout.write('x-access-token');
else process.stdout.write(process.env.REPOGUARD_GIT_TOKEN ?? '');
`;

async function withAskpass(
  token: string | undefined,
  run: (credentialEnv: Record<string, string>) => Promise<void>,
): Promise<void> {
  if (!token) {
    await run({});
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'repoguard-askpass-'));
  try {
    const script = path.join(directory, 'askpass.mjs');
    await writeFile(script, ASKPASS_SOURCE, 'utf8');
    let askpass = script;
    if (process.platform === 'win32') {
      askpass = path.join(directory, 'askpass.cmd');
      await writeFile(askpass, `@echo off\r\nnode "%~dp0askpass.mjs" %*\r\n`, 'utf8');
    } else {
      await chmod(script, 0o700);
    }
    await run({
      GIT_ASKPASS: askpass,
      REPOGUARD_GIT_TOKEN: token,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Full branch history when depth is 0. A positive depth keeps the clone shallow on purpose. */
export function gitCloneArgs(branch: string, cloneUrl: string, destination: string, depth = env.gitHistoryDepth): string[] {
  const args = ['-c', 'core.longpaths=true', 'clone', '--single-branch', '--branch', branch];
  if (depth > 0) args.push('--depth', String(depth));
  args.push(cloneUrl, destination);
  return args;
}

function runGitClone(
  cloneUrl: string,
  branch: string,
  destination: string,
  credentialEnv: Record<string, string>,
  token: string | undefined,
): Promise<void> {
  const args = gitCloneArgs(branch, cloneUrl, destination);

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: cloneTimeoutMs(),
      env: gitChildEnv(credentialEnv),
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = redactSecret(`${stderr}${chunk.toString()}`, token).slice(-4000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not available on this machine.'));
        return;
      }
      reject(new Error('Git clone failed.'));
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal === 'SIGTERM') {
        reject(new Error('Repository clone timed out.'));
        return;
      }
      reject(new Error(redactSecret(stderr, token) || `git clone exited with code ${code ?? 'unknown'}`));
    });
  });
}

function gitChildEnv(credentialEnv: Record<string, string>): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'SystemRoot', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMP', 'TEMP', 'LANG', 'COMSPEC'];
  const childEnv: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
  for (const key of allowed) {
    if (process.env[key]) childEnv[key] = process.env[key];
  }
  return { ...childEnv, ...credentialEnv };
}

function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}
