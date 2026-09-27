import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildAcquiredContext, ContextRequestError, normalizeRepositoryPath } from '../src/services/contextBuilderService.js';
import { LlmError, requireAiConfig, validateModelInterpretation, interpretAcquiredContext, interpretationRequest } from '../src/services/llmService.js';
import type { RepositoryContext } from '../src/types/context.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../evaluation/fixtures/grounding-v1');

async function commitAll(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd });
  await execFileAsync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=RepoGuard Test', '-c', 'core.autocrlf=false', 'commit', '-m', message],
    { cwd },
  );
}

async function reproducedFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'repoguard-fixture-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  for (const name of ['lib.js', 'clean.js', 'unresolved.js']) {
    await cp(path.join(fixtureRoot, 'src', name), path.join(root, 'src', name));
  }
  const initial = await readFile(path.join(fixtureRoot, 'versions', 'app.initial.js'));
  await writeFile(path.join(root, 'src', 'app.js'), initial);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await commitAll(root, 'add initial files');
  await cp(path.join(fixtureRoot, 'src', 'app.js'), path.join(root, 'src', 'app.js'));
  await commitAll(root, 'record self-compare in app');
  return root;
}

test('context builder rejects path traversal and truncates long function lists', async () => {
  assert.throws(() => normalizeRepositoryPath('../secrets.txt'), ContextRequestError);
  const root = await mkdtemp(path.join(tmpdir(), 'repoguard-context-'));
  const functions = Array.from({ length: 45 }, (_, index) => `export function fn${index}() { return ${index}; }`).join('\n');
  await writeFile(path.join(root, 'many.js'), `${functions}\n`);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await commitAll(root, 'add functions');
  const context = await buildAcquiredContext(
    { analysisId: 'ctx-truncation', repositoryName: 'fixture', branch: 'main', sourceType: 'github' },
    root,
    { mode: 'file', path: 'many.js' },
  );
  assert.equal(context.mode, 'file');
  if (context.mode === 'file') {
    assert.equal(context.file.ast?.functionsTruncated, true);
    assert.ok((context.file.ast?.functions.length ?? 0) <= 40);
  }
  await rm(root, { recursive: true, force: true });
});

test('repository and file context expose analyzer evidence', async () => {
  const root = await reproducedFixture();
  const identity = { analysisId: 'ctx-summary', repositoryName: 'grounding-v1', branch: 'main', sourceType: 'github' as const };
  const summary = await buildAcquiredContext(identity, root, { mode: 'repository-summary' });
  const file = await buildAcquiredContext(
    { ...identity, analysisId: 'ctx-file' },
    root,
    { mode: 'file', path: 'src/app.js' },
  );
  assert.equal(summary.mode, 'repository-summary');
  assert.equal(file.mode, 'file');
  if (summary.mode === 'repository-summary') assert.ok(summary.ast.totalFiles >= 4);
  await rm(root, { recursive: true, force: true });
});

test('research baseline and proposed contexts stay distinct and reproducible', async () => {
  const root = await reproducedFixture();
  const identity = { analysisId: 'experiment-a', repositoryName: 'grounding-v1', branch: 'main', sourceType: 'github' as const };
  const baseline = await buildAcquiredContext(identity, root, { mode: 'experiment-file-baseline', path: 'src/app.js' });
  const proposed = await buildAcquiredContext(
    { ...identity, analysisId: 'experiment-b' },
    root,
    { mode: 'experiment-file-proposed', path: 'src/app.js' },
  );
  assert.equal(baseline.mode, 'experiment-file-baseline');
  assert.equal(proposed.mode, 'experiment-file-proposed');
  assert.equal('dependencies' in baseline, false);
  if (proposed.mode === 'experiment-file-proposed') {
    assert.ok(proposed.dependencies);
    assert.ok(proposed.repository.name === 'grounding-v1');
  }
  const again = await buildAcquiredContext(
    { ...identity, analysisId: 'experiment-c' },
    root,
    { mode: 'experiment-file-baseline', path: 'src/app.js' },
  );
  assert.deepEqual(again, baseline);
  await rm(root, { recursive: true, force: true });
});

test('AI validation accepts grounded output and rejects schema, pointers, and missing configuration', async () => {
  const context = summaryContext();
  const valid = validateModelInterpretation(
    context,
    JSON.stringify({
      summary: 'The repository context was summarized.',
      observations: [
        {
          category: 'structure',
          interpretation: 'This count is model interpretation, not a new measurement.',
          evidence: [{ source: 'ast', field: 'totalFiles', index: null }],
          confidence: 'low',
        },
      ],
      limitations: ['Only supplied evidence was used.'],
    }),
  );
  assert.match(valid.observations[0]?.observation ?? '', /2/);
  assert.throws(() => validateModelInterpretation(context, '{'), LlmError);
  assert.throws(() => validateModelInterpretation(context, JSON.stringify({ summary: 'Missing fields.' })), LlmError);
  assert.throws(
    () =>
      validateModelInterpretation(
        context,
        JSON.stringify({
          summary: 'Bad pointer.',
          observations: [
            {
              category: 'structure',
              interpretation: 'This cites evidence that is not present.',
              evidence: [{ source: 'static', field: 'rule', index: 3 }],
              confidence: 'low',
            },
          ],
          limitations: [],
        }),
      ),
    LlmError,
  );
  assert.throws(() => requireAiConfig({ apiKey: '', model: '' }), LlmError);
});

test('AI interpretation may explain cited evidence and may not add an unsupported analyzer fact', () => {
  const context = fileContext();
  const grounded = validateModelInterpretation(
    context,
    JSON.stringify({
      summary: 'The file has one static finding.',
      observations: [
        {
          category: 'static finding',
          interpretation: 'This may warrant review because constant conditions can make control flow harder to reason about.',
          evidence: [{ source: 'static', field: 'finding', index: 0 }],
          confidence: 'medium',
        },
      ],
      limitations: ['Git history was not supplied for this file.'],
    }),
  );
  assert.match(grounded.observations[0]?.observation ?? '', /no-constant-condition/);
  assert.match(grounded.observations[0]?.observation ?? '', /line 2/);
  assert.doesNotMatch(grounded.observations[0]?.interpretation ?? '', /git history/i);

  const unsupported = {
    summary: 'The file has one static finding.',
    observations: [
      {
        category: 'static finding',
        interpretation: 'This file has incomplete Git history.',
        evidence: [{ source: 'static', field: 'finding', index: 0 }],
        confidence: 'low',
      },
    ],
    limitations: [],
  };
  assert.throws(() => validateModelInterpretation(context, JSON.stringify(unsupported)), (error: unknown) => {
    assert.ok(error instanceof LlmError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.match(error.message, /Git-history/);
    return true;
  });

  const truncated = {
    summary: 'Static findings for this file may be capped.',
    observations: [
      {
        category: 'limitations',
        interpretation: 'The Git history for this file is incomplete.',
        evidence: [{ source: 'static', field: 'findingsTruncated', index: null }],
        confidence: 'low',
      },
    ],
    limitations: [],
  };
  assert.throws(() => validateModelInterpretation(context, JSON.stringify(truncated)), LlmError);

  const noEdges = {
    summary: 'Dependency truncation is recorded.',
    observations: [
      {
        category: 'dependencies',
        interpretation: 'This file has no dependencies.',
        evidence: [{ source: 'dependencies', field: 'dependenciesTruncated', index: null }],
        confidence: 'low',
      },
    ],
    limitations: [],
  };
  assert.throws(() => validateModelInterpretation(context, JSON.stringify(noEdges)), (error: unknown) => {
    assert.ok(error instanceof LlmError);
    assert.match(error.message, /dependency/);
    return true;
  });

  const historyCited = validateModelInterpretation(context, JSON.stringify({
    summary: 'History coverage is part of the supplied evidence.',
    observations: [
      {
        category: 'history',
        interpretation: 'The cited history flag means Git history for this file is incomplete.',
        evidence: [{ source: 'history', field: 'isComplete', index: null }],
        confidence: 'high',
      },
    ],
    limitations: [],
  }));
  assert.match(historyCited.observations[0]?.observation ?? '', /isComplete/);
});

test('file AI requests cite the static finding and omit other analyzers', () => {
  const file = interpretationRequest(fileContext());
  assert.deepEqual(file.pointers, [{ source: 'static', field: 'finding', index: 0 }]);
  assert.equal(file.user.includes('History is incomplete'), false);
  assert.equal(file.user.includes('dependencies'), false);
  assert.match(file.user, /no-constant-condition/);
  assert.doesNotMatch(file.instructions, /State important incomplete evidence/);

  const summary = interpretationRequest(summaryContext());
  assert.equal(
    summary.pointers.some((pointer) => pointer.source === 'history'),
    true,
  );
  assert.match(summary.user, /availableCommits/);
});

test('AI interpretation cache returns the same in-flight promise', async () => {
  const context = summaryContext();
  const config = { apiKey: 'sk-test', model: 'cache-test-model' };
  const first = interpretAcquiredContext('cache-case', context, config);
  const second = interpretAcquiredContext('cache-case', context, config);
  assert.equal(first, second);
  await first.catch(() => undefined);
});

function summaryContext(): RepositoryContext {
  return {
    mode: 'repository-summary',
    repository: { name: 'fixture', branch: 'main', sourceType: 'github' },
    ast: {
      totalFiles: 2,
      totalLines: 10,
      totalFunctions: 1,
      totalClasses: 0,
      totalImports: 1,
      totalExports: 1,
      parseErrors: 0,
      maxNestingDepth: 1,
    },
    dependencies: {
      totalInternalNodes: 2,
      totalInternalEdges: 1,
      totalExternalPackages: 0,
      unresolvedImports: 0,
      filesWithDependencies: 1,
      filesWithNoDependencies: 1,
      maxOutgoingInternalDependencies: 1,
    },
    history: {
      availableCommits: 1,
      uniqueAuthors: 1,
      totalFileChanges: 1,
      totalAdditions: 1,
      totalDeletions: 0,
      oldestAvailableCommitAt: null,
      newestAvailableCommitAt: null,
      historyDepth: 'complete',
      isComplete: true,
      commitsWithoutFileDiff: 0,
    },
    static: {
      filesAnalyzed: 2,
      findingCount: 0,
      errorCount: 0,
      warningCount: 0,
      truncated: false,
      repositoryConfigUsed: false,
      ruleSet: 'repoguard-fixed',
      issueCounts: { execution: 0, parse: 0, limit: 0 },
      globalLimitMessages: [],
      rules: [],
    },
    limitations: [],
  };
}

function fileContext(): RepositoryContext {
  return {
    mode: 'file',
    repository: { name: 'fixture', branch: 'main', sourceType: 'zip' },
    file: {
      path: 'src/app.js',
      truncated: false,
      ast: {
        lineCount: 2,
        functionCount: 0,
        classCount: 0,
        importCount: 0,
        exportCount: 1,
        maxNestingDepth: 1,
        functions: [],
        functionsTruncated: false,
      },
      dependencies: { outgoing: [], incoming: [], external: [], unresolved: [], truncated: false },
      history: {
        commitCount: 0,
        additions: 0,
        deletions: 0,
        changeCount: 0,
        firstSeenAt: '',
        lastChangedAt: '',
        renamedFrom: null,
        presentInWorkTree: true,
        historyDepth: 'shallow',
        isComplete: false,
      },
      static: {
        repositoryConfigUsed: false,
        ruleSet: 'repoguard-fixed',
        repositoryTruncated: false,
        findingsTruncated: false,
        findings: [
          {
            path: 'src/app.js',
            line: 2,
            column: 5,
            ruleId: 'no-constant-condition',
            severity: 'error',
            message: 'Unexpected constant condition.',
            tool: 'eslint',
            category: 'problem',
          },
        ],
        issues: [],
      },
    },
    limitations: [{ source: 'history', message: 'Git history is shallow and incomplete.' }],
  };
}
