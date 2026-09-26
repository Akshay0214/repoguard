import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { analyzeWorkspace } from '../src/services/astAnalysisService.js';
import { analyzeDependencyWorkspace } from '../src/services/dependencyAnalysisService.js';
import { analyzeGitHistoryWorkspace } from '../src/services/gitHistoryAnalysisService.js';
import { analyzeStaticWorkspace } from '../src/services/staticAnalysisService.js';
import { MAX_SOURCE_FILE_BYTES } from '../src/services/sourceFiles.js';

const execFileAsync = promisify(execFile);

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'repoguard-analyzer-'));
}

test('AST parses JS, TS, JSX, and TSX and records a parse error', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'a.js'), 'export function jsFn() { return 1; }\n');
  await writeFile(path.join(root, 'b.ts'), 'export class Box { value = 1; }\n');
  await writeFile(path.join(root, 'c.jsx'), 'export const View = () => <div />;\n');
  await writeFile(path.join(root, 'd.tsx'), 'export const Typed = () => <span />;\n');
  await writeFile(path.join(root, 'broken.js'), 'function ( {\n');
  const result = await analyzeWorkspace(root);
  assert.equal(result.summary.totalFiles, 4);
  assert.equal(result.summary.parseErrors, 1);
  assert.equal(result.summary.totalClasses, 1);
  await rm(root, { recursive: true, force: true });
});

test('AST ignores dependency directories, oversized files, and non-source binaries', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'export const hidden = 1;\n');
  await writeFile(path.join(root, 'kept.js'), 'export const kept = 1;\n');
  await writeFile(path.join(root, 'big.js'), 'x'.repeat(MAX_SOURCE_FILE_BYTES + 1));
  await writeFile(path.join(root, 'image.png'), Buffer.from([0, 1, 2, 3, 255]));
  const result = await analyzeWorkspace(root);
  assert.equal(result.summary.totalFiles, 1);
  assert.equal(result.summary.skippedOversizeFiles, 1);
  assert.equal(result.files.some((file) => file.path.includes('node_modules')), false);
  assert.equal(result.files.some((file) => file.path.endsWith('.png')), false);
  await rm(root, { recursive: true, force: true });
});

test('static analysis reports a known finding, a clean file, a finding limit, and a parse issue', async () => {
  const root = await tempDir();
  await writeFile(path.join(root, 'bug.js'), 'if (false) { console.log(1); }\nif (false) { console.log(2); }\n');
  await writeFile(path.join(root, 'clean.js'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'broken.js'), 'function ( {\n');
  const result = await analyzeStaticWorkspace(root, { maxFindings: 1 });
  assert.ok(result.findings.some((finding) => finding.ruleId === 'no-constant-condition'));
  assert.equal(result.summary.truncated, true);
  assert.ok(result.issues.some((issue) => issue.kind === 'limit' || issue.kind === 'parse'));
  const cleanRoot = await tempDir();
  await writeFile(path.join(cleanRoot, 'clean.js'), 'export const value = 1;\n');
  const clean = await analyzeStaticWorkspace(cleanRoot);
  assert.equal(clean.summary.findingCount, 0);
  await rm(root, { recursive: true, force: true });
  await rm(cleanRoot, { recursive: true, force: true });
});

test('dependencies classify internal, external, unresolved, and TypeScript paths', async () => {
  const root = await tempDir();
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['src/*'] } } }),
  );
  await writeFile(path.join(root, 'src', 'lib.ts'), 'export const name = "lib";\n');
  await writeFile(
    path.join(root, 'src', 'app.ts'),
    'import { name } from "@lib/lib";\nimport express from "express";\nimport missing from "./missing.js";\nexport const app = name;\n',
  );
  const result = await analyzeDependencyWorkspace(root);
  assert.ok(result.summary.totalInternalEdges >= 1);
  assert.ok(result.externalDependencies.some((item) => item.name === 'express'));
  assert.ok(result.unresolved.some((item) => item.importSpecifier.includes('missing')));
  assert.ok(result.summary.totalInternalNodes >= 2);
  await rm(root, { recursive: true, force: true });
});

async function commit(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd });
  await execFileAsync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=RepoGuard Test', 'commit', '-m', message],
    { cwd },
  );
}

test('git history reports a complete fixture, a rename, shallow history, and a repository without commits', async () => {
  const root = await tempDir();
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await writeFile(path.join(root, 'old.js'), 'export const value = 1;\n');
  await commit(root, 'add old');
  await execFileAsync('git', ['mv', 'old.js', 'new.js'], { cwd: root });
  await commit(root, 'rename');
  const complete = await analyzeGitHistoryWorkspace(root);
  assert.equal(complete.summary.historyDepth, 'complete');
  assert.equal(complete.summary.availableCommits, 2);
  assert.ok(complete.files.some((file) => file.path === 'new.js' && file.renamedFrom === 'old.js'));

  const shallowDest = path.join(root, '..', `shallow-${path.basename(root)}`);
  await execFileAsync('git', ['clone', '--no-local', '--depth', '1', root, shallowDest]);
  const shallow = await analyzeGitHistoryWorkspace(shallowDest);
  assert.equal(shallow.summary.historyDepth, 'shallow');
  assert.equal(shallow.summary.isComplete, false);

  const empty = await tempDir();
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: empty });
  const noHistory = await analyzeGitHistoryWorkspace(empty);
  assert.equal(noHistory.summary.availableCommits, 0);

  await rm(root, { recursive: true, force: true });
  await rm(shallowDest, { recursive: true, force: true });
  await rm(empty, { recursive: true, force: true });
});
