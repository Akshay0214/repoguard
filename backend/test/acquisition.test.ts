import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { parseGithubRepositoryName } from '../src/utils/githubRepository.js';
import {
  analysisWorkspacePath,
  cloneGitRepository,
  describeCloneFailure,
  removeAnalysisWorkspace,
} from '../src/services/repositoryAcquisitionService.js';

const execFileAsync = promisify(execFile);

test('rejects an invalid GitHub URL', () => {
  assert.equal(parseGithubRepositoryName('https://example.com/owner/repo'), null);
  assert.equal(parseGithubRepositoryName('https://github.com/only-owner'), null);
});

test('describes an invalid branch and a failed clone without secrets', () => {
  assert.equal(describeCloneFailure('remote branch missing not found', false), 'The requested branch does not exist on this repository.');
  assert.match(describeCloneFailure('repository not found', false), /private, missing, or unavailable/);
  assert.match(describeCloneFailure('authentication failed for secret-token', true), /authentication failed/i);
  assert.doesNotMatch(describeCloneFailure('authentication failed', true), /secret/);
});

test('clones a valid local repository, rejects a bad branch, and cleans the workspace', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'repoguard-src-'));
  const cloneDest = await mkdtemp(path.join(tmpdir(), 'repoguard-clone-'));
  await writeFile(path.join(source, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: source });
  await execFileAsync('git', ['add', 'index.js'], { cwd: source });
  await execFileAsync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=RepoGuard Test', 'commit', '-m', 'add file'], { cwd: source });

  const destination = path.join(cloneDest, 'repo');
  await cloneGitRepository(source, 'main', destination);
  await assert.rejects(() => cloneGitRepository(source, 'missing-branch', path.join(cloneDest, 'bad')), /branch/i);
  await assert.rejects(() => cloneGitRepository(path.join(source, 'missing'), 'main', path.join(cloneDest, 'failed')));

  const analysisId = '11111111-1111-4111-8111-111111111111';
  await mkdir(analysisWorkspacePath(analysisId), { recursive: true });
  await removeAnalysisWorkspace(analysisId);
  assert.throws(() => analysisWorkspacePath('../escape'), /Invalid analysis id/);
  await rm(source, { recursive: true, force: true });
  await rm(cloneDest, { recursive: true, force: true });
});
