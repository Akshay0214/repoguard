import { analyzeAcquiredRepository } from './astAnalysisService.js';
import { analyzeAcquiredDependencies } from './dependencyAnalysisService.js';
import { analyzeAcquiredGitHistory, GitHistoryError } from './gitHistoryAnalysisService.js';
import { analyzeAcquiredStatic } from './staticAnalysisService.js';
/**
 * Selects bounded evidence for a future language model.
 * This module does not call a model, score debt, or include source text.
 *
 * Repository-summary context is aggregates plus limitation records.
 * Static evidence is a separate object: rule frequencies in the summary, and
 * only the requested file's findings in file context.
 * File context is one discovered path, at most 40 function facts, at most
 * 25 outgoing edges, 25 incoming edges, 25 external uses, and 25 unresolved
 * imports, and at most 25 static findings. When a list is cut, `truncated`
 * is true and a limitation is recorded.
 *
 * The file path is matched only against paths already returned by the analyzers.
 * It is never resolved as a filesystem path.
 *
 * Experimental conditions reuse those analyzer results and the same file-local
 * AST and static slice. Baseline stops there. Proposed adds this file's
 * dependency relationships, its Git history, and repository identity.
 * Production file context is unchanged and is not either condition.
 */
const MAX_FUNCTIONS = 40;
const MAX_RELATIONS = 25;
const MAX_STATIC_RULES = 20;
const MAX_GLOBAL_LIMIT_MESSAGES = 5;
const MAX_FILE_STATIC_FINDINGS = 25;
const MAX_FILE_STATIC_ISSUES = 5;
export class ContextRequestError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ContextRequestError';
        this.code = code;
    }
}
const resultCache = new Map();
export function buildAcquiredContext(identity, workspacePath, request) {
    const pathKey = request.mode === 'repository-summary' ? '' : normalizeRepositoryPath(request.path);
    const cacheKey = `${identity.analysisId}:${request.mode}:${pathKey}`;
    const cached = resultCache.get(cacheKey);
    if (cached)
        return cached;
    const pending = assembleContext(identity, workspacePath, request, pathKey).catch((error) => {
        resultCache.delete(cacheKey);
        throw error;
    });
    resultCache.set(cacheKey, pending);
    return pending;
}
export function normalizeRepositoryPath(input) {
    if (input.includes('\0')) {
        throw new ContextRequestError('INVALID_PATH', 'File path is not valid.');
    }
    const slashed = input.replaceAll('\\', '/').trim();
    if (slashed === '' || slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) {
        throw new ContextRequestError('INVALID_PATH', 'File path must be repository-relative.');
    }
    const parts = slashed.split('/').filter((part) => part !== '' && part !== '.');
    if (parts.length === 0 || parts.some((part) => part === '..')) {
        throw new ContextRequestError('INVALID_PATH', 'File path must stay inside the repository.');
    }
    return parts.join('/');
}
async function assembleContext(identity, workspacePath, request, normalizedPath) {
    const [ast, dependencies, history, staticAnalysis] = await Promise.all([
        analyzeAcquiredRepository(identity.analysisId, workspacePath),
        analyzeAcquiredDependencies(identity.analysisId, workspacePath),
        loadHistory(identity.analysisId, workspacePath),
        analyzeAcquiredStatic(identity.analysisId, workspacePath),
    ]);
    const repository = {
        name: identity.repositoryName,
        branch: identity.branch,
        sourceType: identity.sourceType,
    };
    if (request.mode === 'repository-summary') {
        return buildSummary(repository, ast, dependencies, history, staticAnalysis);
    }
    if (request.mode === 'file') {
        return buildFile(repository, normalizedPath, ast, dependencies, history, staticAnalysis);
    }
    return buildExperiment(request.mode, repository, normalizedPath, ast, dependencies, history, staticAnalysis);
}
async function loadHistory(analysisId, workspacePath) {
    try {
        return await analyzeAcquiredGitHistory(analysisId, workspacePath);
    }
    catch (error) {
        if (error instanceof GitHistoryError && error.code === 'NO_GIT_REPOSITORY') {
            return {
                summary: {
                    availableCommits: 0,
                    uniqueAuthors: 0,
                    totalFileChanges: 0,
                    totalAdditions: 0,
                    totalDeletions: 0,
                    oldestAvailableCommitAt: null,
                    newestAvailableCommitAt: null,
                    historyDepth: 'complete',
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
                errors: [{ message: error.message }],
            };
        }
        throw error;
    }
}
function buildSummary(repository, ast, dependencies, history, staticAnalysis) {
    const staticSummary = staticSummaryFor(staticAnalysis);
    return {
        mode: 'repository-summary',
        repository,
        ast: {
            totalFiles: ast.summary.totalFiles,
            totalLines: ast.summary.totalLines,
            totalFunctions: ast.summary.totalFunctions,
            totalClasses: ast.summary.totalClasses,
            totalImports: ast.summary.totalImports,
            totalExports: ast.summary.totalExports,
            parseErrors: ast.summary.parseErrors,
            maxNestingDepth: ast.summary.maxNestingDepth,
        },
        dependencies: {
            totalInternalNodes: dependencies.summary.totalInternalNodes,
            totalInternalEdges: dependencies.summary.totalInternalEdges,
            totalExternalPackages: dependencies.summary.totalExternalPackages,
            unresolvedImports: dependencies.summary.unresolvedImports,
            filesWithDependencies: dependencies.summary.filesWithDependencies,
            filesWithNoDependencies: dependencies.summary.filesWithNoDependencies,
            maxOutgoingInternalDependencies: dependencies.summary.maxOutgoingInternalDependencies,
        },
        history: {
            availableCommits: history.summary.availableCommits,
            uniqueAuthors: history.summary.uniqueAuthors,
            totalFileChanges: history.summary.totalFileChanges,
            totalAdditions: history.summary.totalAdditions,
            totalDeletions: history.summary.totalDeletions,
            oldestAvailableCommitAt: history.summary.oldestAvailableCommitAt,
            newestAvailableCommitAt: history.summary.newestAvailableCommitAt,
            historyDepth: history.summary.historyDepth,
            isComplete: history.summary.isComplete,
            commitsWithoutFileDiff: history.summary.commitsWithoutFileDiff,
        },
        static: staticSummary,
        limitations: [
            ...summaryLimitations(ast, dependencies, history),
            ...staticSummaryLimitations(staticAnalysis, staticSummary.globalLimitMessages),
        ],
    };
}
function buildFile(repository, filePath, ast, dependencies, history, staticAnalysis) {
    if (!isKnownPath(filePath, ast, dependencies, history)) {
        throw new ContextRequestError('FILE_NOT_FOUND', 'File was not found in the analyzed repository.');
    }
    const limitations = [];
    const astFile = ast.files.find((file) => file.path === filePath) ?? null;
    const parseError = ast.errors.find((error) => error.path === filePath);
    if (!astFile && parseError) {
        limitations.push({ source: 'ast', message: `This file could not be parsed: ${parseError.message}` });
    }
    else if (!astFile) {
        limitations.push({ source: 'ast', message: 'No AST evidence is available for this file.' });
    }
    const functions = astFile?.functions ?? [];
    const functionsTruncated = functions.length > MAX_FUNCTIONS;
    if (functionsTruncated) {
        limitations.push({ source: 'context', message: `Function metadata was limited to ${MAX_FUNCTIONS} entries.` });
    }
    const dependencyContext = fileDependencies(filePath, dependencies, limitations);
    const historyFile = history.files.find((file) => file.path === filePath) ?? null;
    if (!historyFile) {
        limitations.push({
            source: 'history',
            message: history.summary.isComplete
                ? 'No Git diff in the available history mentions this file.'
                : 'No file-level Git diff is available. History is incomplete.',
        });
    }
    if (history.summary.historyDepth === 'shallow') {
        limitations.push({ source: 'history', message: 'Git history is shallow and incomplete.' });
    }
    const fileStatic = fileStaticFor(filePath, staticAnalysis);
    if (fileStatic.findingsTruncated) {
        limitations.push({
            source: 'context',
            message: `Static findings for this file were limited to ${MAX_FILE_STATIC_FINDINGS} entries.`,
        });
    }
    if (fileStatic.repositoryTruncated) {
        limitations.push({
            source: 'static',
            message: 'Repository static analysis was truncated. An empty finding list does not mean this file was checked.',
        });
    }
    const truncated = functionsTruncated || dependencyContext.truncated || fileStatic.findingsTruncated;
    return {
        mode: 'file',
        repository,
        file: {
            path: filePath,
            truncated,
            ast: astFile
                ? {
                    lineCount: astFile.lineCount,
                    functionCount: astFile.functionCount,
                    classCount: astFile.classCount,
                    importCount: astFile.importCount,
                    exportCount: astFile.exportCount,
                    maxNestingDepth: astFile.maxNestingDepth,
                    functions: functions.slice(0, MAX_FUNCTIONS).map((fn) => ({
                        name: fn.name,
                        line: fn.line,
                        nestingDepth: fn.nestingDepth,
                    })),
                    functionsTruncated,
                }
                : null,
            dependencies: dependencyContext,
            history: historyFile
                ? {
                    commitCount: historyFile.commitCount,
                    additions: historyFile.additions,
                    deletions: historyFile.deletions,
                    changeCount: historyFile.changeCount,
                    firstSeenAt: historyFile.firstSeenAt,
                    lastChangedAt: historyFile.lastChangedAt,
                    renamedFrom: historyFile.renamedFrom,
                    presentInWorkTree: historyFile.presentInWorkTree,
                    historyDepth: history.summary.historyDepth,
                    isComplete: history.summary.isComplete,
                }
                : null,
            static: fileStatic,
        },
        limitations,
    };
}
function buildExperiment(mode, repository, filePath, ast, dependencies, history, staticAnalysis) {
    if (!isKnownPath(filePath, ast, dependencies, history)) {
        throw new ContextRequestError('FILE_NOT_FOUND', 'File was not found in the analyzed repository.');
    }
    const file = fileLocalEvidence(filePath, ast, staticAnalysis);
    const localLimitations = fileLocalLimitations(filePath, ast, file);
    if (mode === 'experiment-file-baseline') {
        return {
            mode,
            condition: 'baseline',
            file,
            limitations: localLimitations,
        };
    }
    const limitations = [...localLimitations];
    const dependencyContext = fileDependencies(filePath, dependencies, limitations);
    const historyContext = relevantFileHistory(filePath, history, limitations);
    if (staticAnalysis.summary.truncated) {
        limitations.push({
            source: 'static',
            message: 'Repository static analysis was truncated. An empty finding list does not mean this file was checked.',
        });
    }
    return {
        mode,
        condition: 'proposed',
        file,
        repository,
        dependencies: dependencyContext,
        history: historyContext,
        limitations,
    };
}
function fileLocalEvidence(filePath, ast, staticAnalysis) {
    const astFile = ast.files.find((file) => file.path === filePath) ?? null;
    const functions = astFile?.functions ?? [];
    const fileStatic = fileStaticFor(filePath, staticAnalysis);
    return {
        path: filePath,
        truncated: functions.length > MAX_FUNCTIONS || fileStatic.findingsTruncated,
        ast: astFile ? fileAstFacts(astFile, functions) : null,
        static: {
            repositoryConfigUsed: fileStatic.repositoryConfigUsed,
            ruleSet: fileStatic.ruleSet,
            findingsTruncated: fileStatic.findingsTruncated,
            findings: fileStatic.findings,
            issues: fileStatic.issues,
        },
    };
}
function fileAstFacts(astFile, functions) {
    return {
        lineCount: astFile.lineCount,
        functionCount: astFile.functionCount,
        classCount: astFile.classCount,
        importCount: astFile.importCount,
        exportCount: astFile.exportCount,
        maxNestingDepth: astFile.maxNestingDepth,
        functions: functions.slice(0, MAX_FUNCTIONS).map((fn) => ({
            name: fn.name,
            line: fn.line,
            nestingDepth: fn.nestingDepth,
        })),
        functionsTruncated: functions.length > MAX_FUNCTIONS,
    };
}
function fileLocalLimitations(filePath, ast, file) {
    const limitations = [];
    const astFile = ast.files.find((item) => item.path === filePath) ?? null;
    const parseError = ast.errors.find((error) => error.path === filePath);
    if (!astFile && parseError) {
        limitations.push({ source: 'ast', message: `This file could not be parsed: ${parseError.message}` });
    }
    else if (!astFile) {
        limitations.push({ source: 'ast', message: 'No AST evidence is available for this file.' });
    }
    if (file.ast?.functionsTruncated) {
        limitations.push({ source: 'context', message: `Function metadata was limited to ${MAX_FUNCTIONS} entries.` });
    }
    if (file.static.findingsTruncated) {
        limitations.push({
            source: 'context',
            message: `Static findings for this file were limited to ${MAX_FILE_STATIC_FINDINGS} entries.`,
        });
    }
    return limitations;
}
function relevantFileHistory(filePath, history, limitations) {
    const historyFile = history.files.find((file) => file.path === filePath) ?? null;
    if (!historyFile) {
        limitations.push({
            source: 'history',
            message: history.summary.isComplete
                ? 'No Git diff in the available history mentions this file.'
                : 'No file-level Git diff is available. History is incomplete.',
        });
    }
    if (history.summary.historyDepth === 'shallow') {
        limitations.push({ source: 'history', message: 'Git history is shallow and incomplete.' });
    }
    if (!historyFile)
        return null;
    return {
        commitCount: historyFile.commitCount,
        additions: historyFile.additions,
        deletions: historyFile.deletions,
        changeCount: historyFile.changeCount,
        firstSeenAt: historyFile.firstSeenAt,
        lastChangedAt: historyFile.lastChangedAt,
        renamedFrom: historyFile.renamedFrom,
        presentInWorkTree: historyFile.presentInWorkTree,
        historyDepth: history.summary.historyDepth,
        isComplete: history.summary.isComplete,
    };
}
function fileDependencies(filePath, dependencies, limitations) {
    const outgoing = takeRelations(dependencies.edges
        .filter((edge) => edge.source === filePath && edge.type === 'internal')
        .map(toOutgoing)
        .sort(compareEdge));
    const incoming = takeRelations(dependencies.edges
        .filter((edge) => edge.target === filePath && edge.type === 'internal')
        .map(toIncoming)
        .sort(compareEdge));
    const external = takeRelations(dependencies.edges
        .filter((edge) => edge.source === filePath && edge.type === 'external')
        .map(toExternal)
        .sort((left, right) => left.name.localeCompare(right.name) || left.importSpecifier.localeCompare(right.importSpecifier)));
    const unresolved = takeRelations(dependencies.unresolved
        .filter((item) => item.source === filePath)
        .map((item) => ({
        importSpecifier: item.importSpecifier,
        kind: item.kind,
        message: item.message,
    }))
        .sort((left, right) => left.importSpecifier.localeCompare(right.importSpecifier)));
    const truncated = outgoing.truncated || incoming.truncated || external.truncated || unresolved.truncated;
    if (truncated) {
        limitations.push({
            source: 'context',
            message: `Dependency context for this file was limited to ${MAX_RELATIONS} entries per list.`,
        });
    }
    return {
        outgoing: outgoing.items,
        incoming: incoming.items,
        external: external.items,
        unresolved: unresolved.items,
        truncated,
    };
}
function toOutgoing(edge) {
    return { path: edge.target, kind: edge.kind, importSpecifier: edge.importSpecifier };
}
function toIncoming(edge) {
    return { path: edge.source, kind: edge.kind, importSpecifier: edge.importSpecifier };
}
function toExternal(edge) {
    return { name: edge.target, kind: edge.kind, importSpecifier: edge.importSpecifier };
}
function compareEdge(left, right) {
    return left.path.localeCompare(right.path) || left.importSpecifier.localeCompare(right.importSpecifier);
}
function takeRelations(items) {
    if (items.length <= MAX_RELATIONS)
        return { items, truncated: false };
    return { items: items.slice(0, MAX_RELATIONS), truncated: true };
}
function staticSummaryFor(staticAnalysis) {
    const counts = new Map();
    for (const finding of staticAnalysis.findings) {
        const key = `${finding.ruleId}\0${finding.severity}\0${finding.category ?? ''}`;
        const existing = counts.get(key);
        if (existing)
            existing.count += 1;
        else
            counts.set(key, { ruleId: finding.ruleId, severity: finding.severity, category: finding.category, count: 1 });
    }
    const rules = [...counts.values()]
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.severity.localeCompare(right.severity))
        .slice(0, MAX_STATIC_RULES);
    return {
        filesAnalyzed: staticAnalysis.summary.filesAnalyzed,
        findingCount: staticAnalysis.summary.findingCount,
        errorCount: staticAnalysis.summary.errorCount,
        warningCount: staticAnalysis.summary.warningCount,
        truncated: staticAnalysis.summary.truncated,
        repositoryConfigUsed: false,
        ruleSet: 'repoguard-fixed',
        issueCounts: {
            execution: staticAnalysis.issues.filter((issue) => issue.kind === 'execution').length,
            parse: staticAnalysis.issues.filter((issue) => issue.kind === 'parse').length,
            limit: staticAnalysis.issues.filter((issue) => issue.kind === 'limit').length,
        },
        globalLimitMessages: staticAnalysis.issues
            .filter((issue) => issue.kind === 'limit' && issue.path === null)
            .map((issue) => issue.message)
            .slice(0, MAX_GLOBAL_LIMIT_MESSAGES),
        rules,
    };
}
function staticSummaryLimitations(staticAnalysis, globalLimitMessages) {
    const limitations = [];
    if (staticAnalysis.summary.truncated) {
        limitations.push({
            source: 'static',
            message: 'Static analysis stopped before the repository was fully checked.',
        });
    }
    for (const message of globalLimitMessages) {
        limitations.push({ source: 'static', message });
    }
    const parseCount = staticAnalysis.issues.filter((issue) => issue.kind === 'parse').length;
    if (parseCount > 0) {
        limitations.push({
            source: 'static',
            message: `${parseCount} files could not be parsed by static analysis. Those are issues, not rule findings.`,
        });
    }
    const executionCount = staticAnalysis.issues.filter((issue) => issue.kind === 'execution').length;
    if (executionCount > 0) {
        limitations.push({
            source: 'static',
            message: `Static analysis failed to execute on ${executionCount} files.`,
        });
    }
    const sizeLimitCount = staticAnalysis.issues.filter((issue) => issue.kind === 'limit' && issue.path !== null).length;
    if (sizeLimitCount > 0) {
        limitations.push({
            source: 'static',
            message: `${sizeLimitCount} files exceeded the source size limit and were not statically analyzed.`,
        });
    }
    return limitations;
}
function fileStaticFor(filePath, staticAnalysis) {
    const findings = staticAnalysis.findings
        .filter((finding) => finding.path === filePath)
        .map((finding) => ({
        path: finding.path,
        line: finding.line,
        column: finding.column,
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        tool: 'eslint',
        category: finding.category,
    }))
        .sort((left, right) => (left.line ?? 0) - (right.line ?? 0) ||
        (left.column ?? 0) - (right.column ?? 0) ||
        left.ruleId.localeCompare(right.ruleId) ||
        left.message.localeCompare(right.message));
    const issues = staticAnalysis.issues
        .filter((issue) => issue.path === filePath)
        .map((issue) => ({ kind: issue.kind, message: issue.message }))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.message.localeCompare(right.message));
    return {
        repositoryConfigUsed: false,
        ruleSet: 'repoguard-fixed',
        repositoryTruncated: staticAnalysis.summary.truncated,
        findingsTruncated: findings.length > MAX_FILE_STATIC_FINDINGS,
        findings: findings.slice(0, MAX_FILE_STATIC_FINDINGS),
        issues: issues.slice(0, MAX_FILE_STATIC_ISSUES),
    };
}
function isKnownPath(filePath, ast, dependencies, history) {
    if (ast.files.some((file) => file.path === filePath))
        return true;
    if (ast.errors.some((error) => error.path === filePath))
        return true;
    if (dependencies.nodes.some((node) => node.id === filePath))
        return true;
    if (history.files.some((file) => file.path === filePath))
        return true;
    return false;
}
function summaryLimitations(ast, dependencies, history) {
    const limitations = [];
    if (ast.summary.parseErrors > 0) {
        limitations.push({
            source: 'ast',
            message: `${ast.summary.parseErrors} source files could not be parsed.`,
        });
    }
    if (ast.summary.skippedOversizeFiles > 0) {
        limitations.push({
            source: 'ast',
            message: `${ast.summary.skippedOversizeFiles} files were skipped because they exceed the file size limit.`,
        });
    }
    if (ast.summary.truncated) {
        limitations.push({ source: 'ast', message: 'AST file discovery stopped at the file limit.' });
    }
    if (dependencies.summary.parseErrors > 0) {
        limitations.push({
            source: 'dependencies',
            message: `${dependencies.summary.parseErrors} source files could not be parsed for dependencies.`,
        });
    }
    if (dependencies.summary.unresolvedImports > 0) {
        limitations.push({
            source: 'dependencies',
            message: `${dependencies.summary.unresolvedImports} dependency references could not be resolved.`,
        });
    }
    if (dependencies.summary.truncated) {
        limitations.push({ source: 'dependencies', message: 'Dependency file discovery stopped at the file limit.' });
    }
    if (history.summary.historyDepth === 'shallow') {
        limitations.push({ source: 'history', message: 'Git history is shallow and incomplete.' });
    }
    else if (history.summary.historyDepth === 'limited') {
        limitations.push({ source: 'history', message: 'Git history was limited before every commit in the clone was recorded.' });
    }
    if (history.summary.commitsWithoutFileDiff > 0) {
        const count = history.summary.commitsWithoutFileDiff;
        const commits = count === 1 ? 'commit has' : 'commits have';
        const parents = count === 1 ? 'its parent is' : 'their parents are';
        limitations.push({
            source: 'history',
            message: `${count} ${commits} no file diff because ${parents} outside this clone.`,
        });
    }
    for (const error of history.errors) {
        if (limitations.length >= 20)
            break;
        if (limitations.some((item) => item.message === error.message))
            continue;
        limitations.push({ source: 'history', message: error.message });
    }
    return limitations;
}
