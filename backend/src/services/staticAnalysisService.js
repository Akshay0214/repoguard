import tsParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { discoverSourceFiles, isInsideRoot, MAX_SOURCE_FILE_BYTES } from './sourceFiles.js';
/**
 * RepoGuard-owned static analysis.
 * ESLint runs with a fixed flat config. Repository eslint.config.js,
 * .eslintrc.*, and package.json ESLint settings are never loaded.
 * This is not type-aware analysis and does not execute repository code.
 */
export class StaticAnalysisUnavailableError extends Error {
    constructor() {
        super('ESLint is not available.');
        this.name = 'StaticAnalysisUnavailableError';
    }
}
const MAX_STATIC_FILES = 2_000;
const MAX_FINDINGS = 500;
const WALL_CLOCK_MS = 60_000;
/** Explicit problem-oriented core rules. Not eslint:recommended and not the repository's rules. */
const FIXED_RULES = {
    'no-constant-binary-expression': 'error',
    'no-constant-condition': 'error',
    'no-debugger': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty-pattern': 'error',
    'no-ex-assign': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-loss-of-precision': 'error',
    'no-obj-calls': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'no-setter-return': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};
export const REPOGUARD_RULE_IDS = Object.keys(FIXED_RULES);
const resultCache = new Map();
export function analyzeAcquiredStatic(analysisId, workspacePath) {
    const cached = resultCache.get(analysisId);
    if (cached)
        return cached;
    const pending = analyzeStaticWorkspace(workspacePath).catch((error) => {
        resultCache.delete(analysisId);
        throw error;
    });
    resultCache.set(analysisId, pending);
    return pending;
}
export async function analyzeStaticWorkspace(workspacePath, options = {}) {
    const maxFiles = options.maxFiles ?? MAX_STATIC_FILES;
    const maxFindings = options.maxFindings ?? MAX_FINDINGS;
    const budgetMs = options.budgetMs ?? WALL_CLOCK_MS;
    const passes = options.passes ?? 1;
    const root = path.resolve(workspacePath);
    try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory())
            throw new Error('WORKSPACE_MISSING');
    }
    catch (error) {
        if (error instanceof Error && error.message === 'WORKSPACE_MISSING')
            throw error;
        throw new Error('WORKSPACE_MISSING');
    }
    const eslint = createEslint(root);
    const discovered = await discoverSourceFiles(root);
    const selected = discovered.files.slice(0, maxFiles);
    const findings = [];
    const issues = [];
    const seen = new Set();
    const started = Date.now();
    let truncated = false;
    let filesAnalyzed = 0;
    let findingLimitNoted = false;
    const lintResults = [];
    if (discovered.files.length > maxFiles || discovered.truncated) {
        truncated = true;
        issues.push({
            kind: 'limit',
            path: null,
            message: `Static analysis stopped after ${maxFiles} source files.`,
        });
    }
    for (const relativePath of selected) {
        if (Date.now() - started >= budgetMs) {
            truncated = true;
            issues.push({
                kind: 'limit',
                path: null,
                message: `Static analysis stopped after the ${budgetMs}ms time budget.`,
            });
            break;
        }
        const absolute = path.resolve(root, relativePath);
        if (!isInsideRoot(root, absolute))
            continue;
        let fileStat;
        try {
            fileStat = await stat(absolute);
        }
        catch {
            issues.push({
                kind: 'execution',
                path: relativePath,
                message: 'Unable to read file.',
            });
            continue;
        }
        if (!fileStat.isFile() || fileStat.isSymbolicLink())
            continue;
        if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
            issues.push({
                kind: 'limit',
                path: relativePath,
                message: 'File exceeds the source size limit and was not analyzed.',
            });
            continue;
        }
        let source;
        try {
            source = await readFile(absolute, 'utf8');
        }
        catch {
            issues.push({
                kind: 'execution',
                path: relativePath,
                message: 'Unable to read file.',
            });
            continue;
        }
        let stopped = false;
        for (let pass = 0; pass < passes; pass += 1) {
            let results;
            try {
                results = await eslint.lintText(source, { filePath: absolute, warnIgnored: false });
            }
            catch {
                issues.push({
                    kind: 'execution',
                    path: relativePath,
                    message: 'Static analysis failed for this file.',
                });
                break;
            }
            if (pass === 0) {
                filesAnalyzed += 1;
                lintResults.push(...results);
            }
            for (const result of results) {
                for (const message of result.messages) {
                    const stored = rememberMessage(findings, seen, issues, relativePath, message, maxFindings, root);
                    if (stored === 'limit') {
                        truncated = true;
                        if (!findingLimitNoted) {
                            findingLimitNoted = true;
                            issues.push({
                                kind: 'limit',
                                path: null,
                                message: `Static analysis stored ${maxFindings} findings and stopped.`,
                            });
                        }
                        stopped = true;
                        break;
                    }
                }
                if (stopped)
                    break;
            }
            if (stopped)
                break;
        }
        if (stopped)
            break;
    }
    let rulesMeta = {};
    try {
        rulesMeta = eslint.getRulesMetaForResults(lintResults);
    }
    catch {
        rulesMeta = {};
    }
    for (const finding of findings) {
        finding.category = categoryFor(rulesMeta[finding.ruleId]?.type);
    }
    findings.sort((left, right) => {
        const pathOrder = left.path.localeCompare(right.path);
        if (pathOrder !== 0)
            return pathOrder;
        const lineOrder = (left.line ?? 0) - (right.line ?? 0);
        if (lineOrder !== 0)
            return lineOrder;
        const columnOrder = (left.column ?? 0) - (right.column ?? 0);
        if (columnOrder !== 0)
            return columnOrder;
        return left.ruleId.localeCompare(right.ruleId);
    });
    const errorCount = findings.filter((finding) => finding.severity === 'error').length;
    const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
    return {
        summary: {
            filesAnalyzed,
            findingCount: findings.length,
            errorCount,
            warningCount,
            truncated,
            repositoryConfigUsed: false,
            ruleSet: 'repoguard-fixed',
        },
        findings,
        issues,
    };
}
function createEslint(workspaceRoot) {
    try {
        return new ESLint({
            // cwd must be the workspace so files match the config base path.
            // overrideConfigFile: true disables config lookup, so cwd does not load repository config.
            cwd: workspaceRoot,
            overrideConfigFile: true,
            errorOnUnmatchedPattern: false,
            allowInlineConfig: false,
            cache: false,
            fix: false,
            concurrency: 'off',
            ignore: false,
            overrideConfig: {
                files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
                linterOptions: {
                    reportUnusedDisableDirectives: 'off',
                },
                languageOptions: {
                    parser: tsParser,
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    parserOptions: {
                        ecmaFeatures: { jsx: true },
                    },
                },
                rules: FIXED_RULES,
            },
        });
    }
    catch (error) {
        if (error instanceof StaticAnalysisUnavailableError)
            throw error;
        throw new StaticAnalysisUnavailableError();
    }
}
function rememberMessage(findings, seen, issues, relativePath, message, maxFindings, root) {
    const ruleId = message.ruleId;
    if (message.fatal || !ruleId) {
        issues.push({
            kind: message.fatal ? 'parse' : 'execution',
            path: relativePath,
            message: clip(message.message, root),
        });
        return 'issue';
    }
    const severity = message.severity === 2 ? 'error' : message.severity === 1 ? 'warning' : null;
    if (!severity)
        return 'issue';
    const finding = {
        path: relativePath,
        line: typeof message.line === 'number' ? message.line : null,
        column: typeof message.column === 'number' ? message.column : null,
        ruleId,
        severity,
        message: clip(message.message, root),
        tool: 'eslint',
        category: null,
    };
    const key = `${finding.path}\0${finding.line ?? ''}\0${finding.column ?? ''}\0${finding.ruleId}\0${finding.message}`;
    if (seen.has(key))
        return 'duplicate';
    if (findings.length >= maxFindings)
        return 'limit';
    seen.add(key);
    findings.push(finding);
    return 'stored';
}
function categoryFor(type) {
    if (type === 'problem' || type === 'suggestion' || type === 'layout')
        return type;
    return null;
}
function clip(message, root) {
    const forwardRoot = root.split(path.sep).join('/');
    const stripped = message.split(root).join('').split(forwardRoot).join('');
    const firstLine = stripped.split('\n')[0] ?? 'Static analysis reported a message.';
    return firstLine.slice(0, 240);
}
