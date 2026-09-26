import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepositoryHealth, HEALTH_SCORE_FORMULA } from '../src/services/healthIndicatorService.js';
import { DEBT_WEIGHTS, estimateTechnicalDebt } from '../src/services/technicalDebtService.js';
import type { StaticFinding } from '../src/types/staticAnalysis.js';

const finding: StaticFinding = {
  path: 'src/app.js',
  line: 2,
  column: 1,
  ruleId: 'no-self-compare',
  severity: 'error',
  message: 'Comparing to itself is potentially pointless.',
  tool: 'eslint',
  category: 'problem',
};

test('technical debt indicators are deterministic and map to evidence', () => {
  const input = {
    ast: {
      summary: {
        totalFiles: 1,
        totalLines: 4,
        totalFunctions: 1,
        totalClasses: 0,
        totalImports: 0,
        totalExports: 1,
        parseErrors: 0,
        maxNestingDepth: 5,
        filesDiscovered: 1,
        skippedOversizeFiles: 0,
        truncated: false,
      },
      files: [
        {
          path: 'src/app.js',
          extension: '.js',
          lineCount: 4,
          functionCount: 1,
          classCount: 0,
          importCount: 0,
          exportCount: 1,
          maxNestingDepth: 5,
          functions: [{ name: 'run', line: 1, nestingDepth: 5 }],
        },
      ],
      errors: [],
    },
    dependencies: {
      summary: {
        totalInternalNodes: 1,
        totalInternalEdges: 0,
        totalExternalPackages: 0,
        unresolvedImports: 1,
        filesWithDependencies: 1,
        filesWithNoDependencies: 0,
        maxOutgoingInternalDependencies: 0,
        filesDiscovered: 1,
        parseErrors: 0,
        truncated: false,
      },
      nodes: [],
      edges: [],
      externalDependencies: [],
      unresolved: [
        {
          source: 'src/app.js',
          importSpecifier: './missing.js',
          kind: 'import' as const,
          message: 'No matching file was found.',
        },
      ],
      files: [{ path: 'src/app.js', outgoingInternal: 9, incomingInternal: 0, external: 0, unresolved: 1 }],
      errors: [],
    },
    staticAnalysis: {
      summary: {
        filesAnalyzed: 1,
        findingCount: 1,
        errorCount: 1,
        warningCount: 0,
        truncated: false,
        repositoryConfigUsed: false as const,
        ruleSet: 'repoguard-fixed' as const,
      },
      findings: [finding],
      issues: [],
    },
    history: null,
    unavailable: [],
  };
  const first = estimateTechnicalDebt('debt-1', input);
  const second = estimateTechnicalDebt('debt-1', input);
  assert.deepEqual(first, second);
  const staticItem = first.items.find((item) => item.indicator === 'static-analysis');
  assert.equal(staticItem?.affectedFile, 'src/app.js');
  assert.equal(staticItem?.contribution, DEBT_WEIGHTS.staticError);
  assert.match(staticItem?.evidence.detail ?? '', /no-self-compare/);
  assert.match(first.limitations.join(' '), /shallow|unavailable|change-frequency/i);
  assert.match(first.disclaimer, /not a scientifically validated/i);
});

test('health indicators use the documented heuristic and omit missing modules', () => {
  const health = buildRepositoryHealth(
    {
      ast: {
        totalFiles: 2,
        totalLines: 20,
        totalFunctions: 1,
        totalClasses: 0,
        totalImports: 0,
        totalExports: 0,
        parseErrors: 1,
        maxNestingDepth: 1,
        filesDiscovered: 2,
        skippedOversizeFiles: 0,
        truncated: false,
      },
      dependencies: null,
      static: null,
      history: null,
      readiness: {
        status: 'partial',
        modules: { ast: 'ready', dependencies: 'failed', static: 'failed', history: 'failed' },
        limitations: ['Dependency analysis failed.'],
      },
    },
    null,
  );
  assert.equal(health.formula, HEALTH_SCORE_FORMULA);
  assert.equal(health.heuristicScore, 99);
  assert.ok(health.omittedInputs.includes('static findings'));
  assert.match(health.disclaimer, /not a validated/i);
});
