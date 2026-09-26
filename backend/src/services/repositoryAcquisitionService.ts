import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAnalysisJob, updateAnalysisJob } from './analysisService.js';

/** Shallow clones are killed if git has not finished within this limit. */
const CLONE_TIMEOUT_MS = 180_000;

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

/** Removes an analysis workspace. Safe to call when the directory is already gone. */
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
    await cloneRepository(cloneUrl, job.branch, workspacePath);
    await stat(path.join(workspacePath, '.git'));

    updateAnalysisJob(job.analysisId, {
      status: 'ready',
      workspacePath,
      acquisitionCompletedAt: new Date().toISOString(),
      errorMessage: undefined,
    });
  } catch (error) {
    const errorMessage = acquisitionErrorMessage(error);
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

function cloneRepository(cloneUrl: string, branch: string, destination: string): Promise<void> {
  // core.longpaths applies only to this process so Windows can check out
  // repositories whose paths exceed MAX_PATH. It does not change global git config.
  const args = ['-c', 'core.longpaths=true', 'clone', '--depth', '1', '--branch', branch, cloneUrl, destination];

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not available on this machine.'));
        return;
      }
      reject(error);
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
      reject(new Error(stderr || `git clone exited with code ${code ?? 'unknown'}`));
    });
  });
}

function acquisitionErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Repository acquisition failed.';
  if (/timed out/i.test(raw)) return 'Repository clone timed out.';
  if (/Git is not available/i.test(raw)) return 'Git is not available on this machine.';
  if (/Branch name is not valid|Branch is required/i.test(raw)) return 'Branch name is not valid.';
  if (/could not find remote branch|remote branch .+ not found/i.test(raw)) {
    return 'The requested branch does not exist on this repository.';
  }
  if (/filename too long|unable to checkout working tree/i.test(raw)) {
    return 'The repository could not be checked out because some file paths are too long.';
  }
  if (/repository not found|authentication failed|terminal prompts disabled|could not read from remote/i.test(raw)) {
    return 'The repository could not be cloned. It may be private, missing, or unavailable.';
  }
  return 'Repository acquisition failed.';
}
