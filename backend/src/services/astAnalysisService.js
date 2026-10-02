import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_FILES, discoverSourceFiles, isInsideRoot, parseWorkspaceSource, shortParseMessage, } from './sourceFiles.js';
/**
 * Nesting depth counts enclosing structural nodes, not cyclomatic complexity.
 * A node increases depth when it is one of:
 * - IfStatement
 * - ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement
 * - SwitchStatement
 * - TryStatement
 * - FunctionDeclaration, FunctionExpression, ArrowFunctionExpression
 * - ObjectMethod, ClassMethod, ClassPrivateMethod
 * Bare blocks are not an extra level; the function or control-flow node already is.
 * Depth 0 means none of those nodes appear. A top-level function has depth 1.
 *
 * Import and export counts are static ES module declarations.
 * CommonJS `require` and `module.exports` are not counted.
 * `.js` / `.jsx` files whose header contains an `@flow` pragma are parsed with
 * Babel's Flow plugin so `import type` is recognized. Other files are not.
 */
const NESTING_NODE_TYPES = new Set([
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'TryStatement',
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
]);
const FUNCTION_NODE_TYPES = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
]);
const SKIPPED_NODE_KEYS = new Set([
    'type',
    'loc',
    'range',
    'start',
    'end',
    'leadingComments',
    'trailingComments',
    'innerComments',
    'extra',
    'errors',
]);
const resultCache = new Map();
export function analyzeAcquiredRepository(analysisId, workspacePath) {
    const cached = resultCache.get(analysisId);
    if (cached)
        return cached;
    const pending = analyzeWorkspace(workspacePath).catch((error) => {
        resultCache.delete(analysisId);
        throw error;
    });
    resultCache.set(analysisId, pending);
    return pending;
}
export async function analyzeWorkspace(workspacePath) {
    const root = path.resolve(workspacePath);
    try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
            throw new Error('WORKSPACE_MISSING');
        }
    }
    catch {
        throw new Error('WORKSPACE_MISSING');
    }
    const discovered = await discoverSourceFiles(root);
    const truncated = discovered.truncated;
    const files = [];
    const errors = [];
    let skippedOversizeFiles = 0;
    let syntaxErrors = 0;
    if (truncated) {
        errors.push({
            path: '.',
            message: `File limit of ${MAX_SOURCE_FILES} reached. Remaining source files were not analyzed.`,
        });
    }
    for (const relativePath of discovered.files) {
        const absolutePath = path.resolve(root, relativePath);
        if (!isInsideRoot(root, absolutePath))
            continue;
        let source;
        try {
            const fileStat = await stat(absolutePath);
            if (!fileStat.isFile() || fileStat.isSymbolicLink())
                continue;
            if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
                skippedOversizeFiles += 1;
                errors.push({
                    path: relativePath,
                    message: `File exceeds the ${MAX_SOURCE_FILE_BYTES} byte limit and was not parsed.`,
                });
                continue;
            }
            source = await readFile(absolutePath, 'utf8');
        }
        catch {
            errors.push({ path: relativePath, message: 'File could not be read.' });
            continue;
        }
        if (source.includes('\0')) {
            errors.push({ path: relativePath, message: 'Skipped binary file.' });
            continue;
        }
        try {
            files.push(analyzeSource(relativePath, source));
        }
        catch (error) {
            syntaxErrors += 1;
            errors.push({ path: relativePath, message: shortParseMessage(error) });
        }
    }
    const summary = {
        totalFiles: files.length,
        totalLines: files.reduce((sum, file) => sum + file.lineCount, 0),
        totalFunctions: files.reduce((sum, file) => sum + file.functionCount, 0),
        totalClasses: files.reduce((sum, file) => sum + file.classCount, 0),
        totalImports: files.reduce((sum, file) => sum + file.importCount, 0),
        totalExports: files.reduce((sum, file) => sum + file.exportCount, 0),
        parseErrors: syntaxErrors,
        maxNestingDepth: files.reduce((max, file) => Math.max(max, file.maxNestingDepth), 0),
        filesDiscovered: discovered.files.length,
        skippedOversizeFiles,
        truncated,
    };
    return { summary, files, errors };
}
function analyzeSource(relativePath, source) {
    const extension = path.extname(relativePath).toLowerCase();
    const ast = parseWorkspaceSource(relativePath, source);
    const state = {
        functionCount: 0,
        classCount: 0,
        importCount: 0,
        exportCount: 0,
        maxNestingDepth: 0,
        functions: [],
    };
    walk(ast, 0, state);
    return {
        path: relativePath,
        extension,
        lineCount: countLines(source),
        functionCount: state.functionCount,
        classCount: state.classCount,
        importCount: state.importCount,
        exportCount: state.exportCount,
        maxNestingDepth: state.maxNestingDepth,
        functions: state.functions,
    };
}
function walk(value, depth, state) {
    if (!isAstNode(value))
        return;
    let nextDepth = depth;
    if (NESTING_NODE_TYPES.has(value.type)) {
        nextDepth = depth + 1;
        if (nextDepth > state.maxNestingDepth)
            state.maxNestingDepth = nextDepth;
    }
    if (FUNCTION_NODE_TYPES.has(value.type)) {
        state.functionCount += 1;
        state.functions.push({
            name: functionName(value),
            line: value.loc?.start.line ?? 0,
            nestingDepth: nextDepth,
        });
    }
    else if (value.type === 'ClassDeclaration' || value.type === 'ClassExpression') {
        state.classCount += 1;
    }
    else if (value.type === 'ImportDeclaration') {
        state.importCount += 1;
    }
    else if (value.type === 'ExportNamedDeclaration' ||
        value.type === 'ExportDefaultDeclaration' ||
        value.type === 'ExportAllDeclaration') {
        state.exportCount += 1;
    }
    for (const [key, child] of Object.entries(value)) {
        if (SKIPPED_NODE_KEYS.has(key))
            continue;
        if (Array.isArray(child)) {
            for (const item of child)
                walk(item, nextDepth, state);
        }
        else {
            walk(child, nextDepth, state);
        }
    }
}
function functionName(node) {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        return identifierName(node.id);
    }
    if (node.type === 'ObjectMethod' || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
        if (node.computed === true)
            return null;
        return identifierName(node.key);
    }
    return null;
}
function identifierName(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const record = value;
    if (record.type === 'Identifier' && typeof record.name === 'string')
        return record.name;
    if (record.type === 'StringLiteral' && typeof record.value === 'string')
        return record.value;
    return null;
}
function isAstNode(value) {
    return typeof value === 'object' && value !== null && typeof value.type === 'string';
}
function countLines(source) {
    if (source.length === 0)
        return 0;
    const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');
    if (parts[parts.length - 1] === '')
        parts.pop();
    return parts.length;
}
