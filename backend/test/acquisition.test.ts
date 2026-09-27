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
  gitCloneArgs,
  removeAnalysisWorkspace,
} from '../src/services/repositoryAcquisitionService.js';

const execFileAsync = promisify(execFile);

test('clone arguments request full branch history unless a depth is configured', () => {
  const full = gitCloneArgs('main', 'https://github.com/octocat/Spoon-Knife.git', 'dest', 0);
  assert.equal(full.includes('--depth'), false);
  assert.ok(full.includes('--single-branch'));
  assert.equal(full.at(-4), '--branch');
  assert.equal(full.at(-3), 'main');
  assert.equal(full.at(-2), 'https://github.com/octocat/Spoon-Knife.git');
  const shallow = gitCloneArgs('main', 'https://github.com/octocat/Spoon-Knife.git', 'dest', 1);
  assert.equal(shallow[shallow.indexOf('--depth') + 1], '1');
});

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
  await writeFile(path.join(source, 'index.js'), 'export const value = 2;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: source });
  await execFileAsync('git', ['-c', 'user.email=second@example.com', '-c', 'user.name=Second Author', 'commit', '-m', 'edit file'], { cwd: source });

  const destination = path.join(cloneDest, 'repo');
  await cloneGitRepository(source, 'main', destination);
  const shallow = (await execFileAsync('git', ['rev-parse', '--is-shallow-repository'], { cwd: destination })).stdout.trim();
  const count = Number((await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: destination })).stdout.trim());
  assert.equal(shallow, 'false');
  assert.equal(count, 2);
  await assert.rejects(() => cloneGitRepository(source, 'missing-branch', path.join(cloneDest, 'bad')), /branch/i);
  await assert.rejects(() => cloneGitRepository(path.join(source, 'missing'), 'main', path.join(cloneDest, 'failed')));

  const analysisId = '11111111-1111-4111-8111-111111111111';
  await mkdir(analysisWorkspacePath(analysisId), { recursive: true });
  await removeAnalysisWorkspace(analysisId);
  assert.throws(() => analysisWorkspacePath('../escape'), /Invalid analysis id/);
  await rm(source, { recursive: true, force: true });
  await rm(cloneDest, { recursive: true, force: true });
});
