import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  DependencyAnalysisError,
  DependencyAnalysisResult,
  DependencyEdge,
  DependencyEdgeKind,
  ExternalDependency,
  FileDependencyFacts,
  UnresolvedDependency,
} from '../types/dependency.js';
import {
  IGNORED_DIRECTORIES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  SUPPORTED_EXTENSIONS,
  discoverSourceFiles,
  isInsideRoot,
  parseWorkspaceSource,
  shortParseMessage,
  toRelativePath,
} from './sourceFiles.js';

/**
 * Dependency evidence only. This module does not score risk, detect cycles,
 * or call a language model.
 *
 * Cycle detection is intentionally omitted.
 *
 * Resolution:
 * - Relative specifiers (`.`, `..`, `./`, `../`) resolve to a repository source file,
 *   trying .ts, .tsx, .js, .jsx and index files. A `.js` / `.jsx` specifier
 *   may resolve to the TypeScript file of the same name.
 * - The nearest `tsconfig.json` between the file and the workspace root can
 *   supply simple `compilerOptions.baseUrl` and `paths` mappings. `extends`
 *   is not followed.
 * - A path alias that matches but does not resolve to a source file is
 *   unresolved. It is not recorded as an internal edge.
 * - Other bare specifiers are external packages. `react/jsx-runtime` counts
 *   as `react`. Scoped names keep `@scope/name`. `node:fs/promises` counts
 *   as `node:fs`.
 * - Bare specifiers that are actually internal module names, and are not
 *   relative or configured as a path alias, are classified as external.
 *   React's `shared/...` imports are an example.
 * - Non-literal dynamic import paths are unresolved and are not guessed.
 * - Identical edges (same source, target, classification, kind, and specifier)
 *   are stored once. External occurrence counts still increase.
 */

const resultCache = new Map<string, Promise<DependencyAnalysisResult>>();

interface PathAlias {
  prefix: string;
  suffix: string;
  hasStar: boolean;
  targets: string[];
  baseDir: string;
}

interface TsconfigInfo {
  aliases: PathAlias[];
  baseUrl: string | null;
}

interface ModuleReference {
  specifier: string;
  kind: DependencyEdgeKind;
  unresolvedMessage?: string;
}

export function analyzeAcquiredDependencies(
  analysisId: string,
  workspacePath: string,
): Promise<DependencyAnalysisResult> {
  const cached = resultCache.get(analysisId);
  if (cached) return cached;

  const pending = analyzeDependencyWorkspace(workspacePath).catch((error: unknown) => {
    resultCache.delete(analysisId);
    throw error;
  });
  resultCache.set(analysisId, pending);
  return pending;
}

export async function analyzeDependencyWorkspace(workspacePath: string): Promise<DependencyAnalysisResult> {
  const root = path.resolve(workspacePath);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error('WORKSPACE_MISSING');
  } catch {
    throw new Error('WORKSPACE_MISSING');
  }

  const discovered = await discoverSourceFiles(root);
  const fileSet = new Set(discovered.files);
  const configs = await loadTsconfigs(root);
  const errors: DependencyAnalysisError[] = [];
  let syntaxErrors = 0;

  if (discovered.truncated) {
    errors.push({
      path: '.',
      message: `File limit of ${MAX_SOURCE_FILES} reached. Remaining source files were not analyzed.`,
    });
  }

  const edges: DependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const externalCounts = new Map<string, number>();
  const unresolved: UnresolvedDependency[] = [];
  const unresolvedKeys = new Set<string>();
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const externalByFile = new Map<string, Set<string>>();
  const unresolvedByFile = new Map<string, Set<string>>();

  for (const relativePath of discovered.files) {
    outgoing.set(relativePath, new Set());
    incoming.set(relativePath, new Set());
    externalByFile.set(relativePath, new Set());
    unresolvedByFile.set(relativePath, new Set());
  }

  for (const relativePath of discovered.files) {
    const source = await readSource(root, relativePath, errors);
    if (source === null) continue;
    if (source.includes('\0')) {
      errors.push({ path: relativePath, message: 'Skipped binary file.' });
      continue;
    }

    let references: ModuleReference[];
    try {
      references = collectReferences(relativePath, source);
    } catch (error) {
      syntaxErrors += 1;
      errors.push({ path: relativePath, message: shortParseMessage(error) });
      continue;
    }

    const config = nearestTsconfig(root, relativePath, configs);
    for (const reference of references) {
      recordReference(
        root,
        relativePath,
        reference,
        fileSet,
        config,
        edges,
        edgeKeys,
        externalCounts,
        unresolved,
        unresolvedKeys,
        outgoing,
        incoming,
        externalByFile,
        unresolvedByFile,
      );
    }
  }

  const files: FileDependencyFacts[] = discovered.files.map((relativePath) => ({
    path: relativePath,
    outgoingInternal: outgoing.get(relativePath)?.size ?? 0,
    incomingInternal: incoming.get(relativePath)?.size ?? 0,
    external: externalByFile.get(relativePath)?.size ?? 0,
    unresolved: unresolvedByFile.get(relativePath)?.size ?? 0,
  }));

  const filesWithDependencies = files.filter(
    (file) => file.outgoingInternal > 0 || file.external > 0 || file.unresolved > 0,
  ).length;
  const externalDependencies: ExternalDependency[] = [...externalCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));

  edges.sort(compareEdges);
  unresolved.sort((left, right) =>
    left.source.localeCompare(right.source) || left.importSpecifier.localeCompare(right.importSpecifier),
  );

  return {
    summary: {
      totalInternalNodes: discovered.files.length,
      totalInternalEdges: edges.filter((edge) => edge.type === 'internal').length,
      totalExternalPackages: externalDependencies.length,
      unresolvedImports: unresolved.length,
      filesWithDependencies,
      filesWithNoDependencies: files.length - filesWithDependencies,
      maxOutgoingInternalDependencies: files.reduce((max, file) => Math.max(max, file.outgoingInternal), 0),
      filesDiscovered: discovered.files.length,
      parseErrors: syntaxErrors,
      truncated: discovered.truncated,
    },
    nodes: discovered.files.map((id) => ({ id, type: 'file' as const })),
    edges,
    externalDependencies,
    unresolved,
    files,
    errors,
  };
}

async function readSource(
  root: string,
  relativePath: string,
  errors: DependencyAnalysisError[],
): Promise<string | null> {
  const absolutePath = path.resolve(root, relativePath);
  if (!isInsideRoot(root, absolutePath)) return null;
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null;
    if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
      errors.push({
        path: relativePath,
        message: `File exceeds the ${MAX_SOURCE_FILE_BYTES} byte limit and was not parsed.`,
      });
      return null;
    }
    return await readFile(absolutePath, 'utf8');
  } catch {
    errors.push({ path: relativePath, message: 'File could not be read.' });
    return null;
  }
}

function recordReference(
  root: string,
  relativePath: string,
  reference: ModuleReference,
  fileSet: Set<string>,
  config: TsconfigInfo | null,
  edges: DependencyEdge[],
  edgeKeys: Set<string>,
  externalCounts: Map<string, number>,
  unresolved: UnresolvedDependency[],
  unresolvedKeys: Set<string>,
  outgoing: Map<string, Set<string>>,
  incoming: Map<string, Set<string>>,
  externalByFile: Map<string, Set<string>>,
  unresolvedByFile: Map<string, Set<string>>,
): void {
  if (reference.unresolvedMessage) {
    addUnresolved(relativePath, reference, reference.unresolvedMessage, unresolved, unresolvedKeys, unresolvedByFile);
    return;
  }

  const specifier = reference.specifier.trim();
  if (specifier === '' || specifier.includes('?') || specifier.includes('#')) {
    addUnresolved(relativePath, reference, 'Import specifier is empty or contains a query or hash.', unresolved, unresolvedKeys, unresolvedByFile);
    return;
  }
  if (/^(?:data|https?|file|blob):/i.test(specifier)) {
    addUnresolved(relativePath, reference, 'URL and data imports are not resolved.', unresolved, unresolvedKeys, unresolvedByFile);
    return;
  }
  if (specifier.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(specifier)) {
    addUnresolved(relativePath, reference, 'Absolute import specifiers are not resolved.', unresolved, unresolvedKeys, unresolvedByFile);
    return;
  }

  if (isRelativeSpecifier(specifier)) {
    const resolved = resolveRelative(relativePath, specifier, fileSet);
    if (!resolved) {
      addUnresolved(
        relativePath,
        reference,
        'Relative import did not resolve to a source file in the repository.',
        unresolved,
        unresolvedKeys,
        unresolvedByFile,
      );
      return;
    }
    addEdge(relativePath, resolved, 'internal', reference, edges, edgeKeys);
    outgoing.get(relativePath)?.add(resolved);
    incoming.get(resolved)?.add(relativePath);
    return;
  }

  const aliased = resolveAlias(root, specifier, config, fileSet);
  if (aliased.status === 'resolved') {
    addEdge(relativePath, aliased.target, 'internal', reference, edges, edgeKeys);
    outgoing.get(relativePath)?.add(aliased.target);
    incoming.get(aliased.target)?.add(relativePath);
    return;
  }
  if (aliased.status === 'unresolved') {
    addUnresolved(relativePath, reference, aliased.message, unresolved, unresolvedKeys, unresolvedByFile);
    return;
  }

  const fromBase = resolveFromBaseUrl(root, specifier, config, fileSet);
  if (fromBase) {
    addEdge(relativePath, fromBase, 'internal', reference, edges, edgeKeys);
    outgoing.get(relativePath)?.add(fromBase);
    incoming.get(fromBase)?.add(relativePath);
    return;
  }

  const packageName = externalPackageName(specifier);
  externalCounts.set(packageName, (externalCounts.get(packageName) ?? 0) + 1);
  externalByFile.get(relativePath)?.add(packageName);
  addEdge(relativePath, packageName, 'external', reference, edges, edgeKeys);
}

function addEdge(
  source: string,
  target: string,
  type: 'internal' | 'external',
  reference: ModuleReference,
  edges: DependencyEdge[],
  edgeKeys: Set<string>,
): void {
  const key = `${source}\0${type}\0${target}\0${reference.kind}\0${reference.specifier}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({
    source,
    target,
    type,
    kind: reference.kind,
    importSpecifier: reference.specifier,
  });
}

function addUnresolved(
  source: string,
  reference: ModuleReference,
  message: string,
  unresolved: UnresolvedDependency[],
  unresolvedKeys: Set<string>,
  unresolvedByFile: Map<string, Set<string>>,
): void {
  const key = `${source}\0${reference.kind}\0${reference.specifier}`;
  unresolvedByFile.get(source)?.add(key);
  if (unresolvedKeys.has(key)) return;
  unresolvedKeys.add(key);
  unresolved.push({
    source,
    importSpecifier: reference.specifier,
    kind: reference.kind,
    message,
  });
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function resolveRelative(fromFile: string, specifier: string, fileSet: Set<string>): string | null {
  const fromDir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
  if (joined === '..' || joined.startsWith('../') || path.posix.isAbsolute(joined)) return null;
  return resolveAgainstFiles(joined, fileSet);
}

function resolveAgainstFiles(candidate: string, fileSet: Set<string>): string | null {
  const normalized = candidate.replace(/\/+$/, '');
  const extension = path.posix.extname(normalized).toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(extension)) {
    if (fileSet.has(normalized)) return normalized;
    if (extension === '.js' || extension === '.jsx') {
      const stem = normalized.slice(0, -extension.length);
      for (const alternate of ['.ts', '.tsx', '.js', '.jsx']) {
        const next = stem + alternate;
        if (fileSet.has(next)) return next;
      }
    }
    return null;
  }
  if (extension !== '') return null;

  for (const alternate of ['.ts', '.tsx', '.js', '.jsx']) {
    const next = normalized + alternate;
    if (fileSet.has(next)) return next;
  }
  for (const alternate of ['.ts', '.tsx', '.js', '.jsx']) {
    const next = `${normalized}/index${alternate}`;
    if (fileSet.has(next)) return next;
  }
  return null;
}

function resolveAlias(
  root: string,
  specifier: string,
  config: TsconfigInfo | null,
  fileSet: Set<string>,
): { status: 'none' } | { status: 'resolved'; target: string } | { status: 'unresolved'; message: string } {
  if (!config || config.aliases.length === 0) return { status: 'none' };
  const matches = config.aliases.filter((alias) => aliasMatches(alias, specifier));
  if (matches.length === 0) return { status: 'none' };

  for (const alias of matches) {
    const star = alias.hasStar ? specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length) : '';
    for (const target of alias.targets) {
      const replaced = alias.hasStar ? target.replace('*', star) : target;
      const relativeBase = workspaceRelative(root, path.resolve(alias.baseDir, replaced));
      if (relativeBase === null) continue;
      const resolved = resolveAgainstFiles(relativeBase, fileSet);
      if (resolved) return { status: 'resolved', target: resolved };
    }
  }
  return { status: 'unresolved', message: 'Path alias did not resolve to a source file in the repository.' };
}

function resolveFromBaseUrl(
  root: string,
  specifier: string,
  config: TsconfigInfo | null,
  fileSet: Set<string>,
): string | null {
  if (!config?.baseUrl) return null;
  const relativeBase = workspaceRelative(root, path.resolve(config.baseUrl, specifier));
  if (relativeBase === null) return null;
  return resolveAgainstFiles(relativeBase, fileSet);
}

function aliasMatches(alias: PathAlias, specifier: string): boolean {
  if (!alias.hasStar) return specifier === alias.prefix;
  return specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix) && specifier.length >= alias.prefix.length + alias.suffix.length;
}

function workspaceRelative(root: string, absolute: string): string | null {
  const resolved = path.resolve(absolute);
  if (!isInsideRoot(root, resolved)) return null;
  const relative = toRelativePath(root, resolved);
  if (relative.startsWith('..') || relative === '') return null;
  return relative;
}

function externalPackageName(specifier: string): string {
  if (specifier.startsWith('node:')) {
    const head = specifier.slice('node:'.length).split('/')[0] ?? specifier;
    return `node:${head}`;
  }
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    if (scope && name) return `${scope}/${name}`;
    return specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}

function collectReferences(relativePath: string, source: string): ModuleReference[] {
  const ast = parseWorkspaceSource(relativePath, source);
  const references: ModuleReference[] = [];
  walk(ast, references);
  return references;
}

function walk(value: unknown, references: ModuleReference[]): void {
  if (!isRecord(value) || typeof value.type !== 'string') return;
  const type = value.type;

  if (type === 'ImportDeclaration') {
    const specifier = literalValue(value.source);
    if (specifier !== null) references.push({ specifier, kind: 'import' });
  } else if (type === 'ExportAllDeclaration') {
    const specifier = literalValue(value.source);
    if (specifier !== null) references.push({ specifier, kind: 're-export' });
  } else if (type === 'ExportNamedDeclaration') {
    const specifier = literalValue(value.source);
    if (specifier !== null) references.push({ specifier, kind: 're-export' });
  } else if (type === 'ImportExpression' || (type === 'CallExpression' && isImportCallee(value.callee))) {
    const sourceNode = type === 'ImportExpression'
      ? value.source
      : (Array.isArray(value.arguments) ? value.arguments[0] : undefined);
    const specifier = literalValue(sourceNode);
    if (specifier !== null) references.push({ specifier, kind: 'dynamic-import' });
    else {
      references.push({
        specifier: dynamicLabel(sourceNode),
        kind: 'dynamic-import',
        unresolvedMessage: 'Dynamic import path is not a static string.',
      });
    }
  } else if (type === 'CallExpression' && isRequireCallee(value.callee)) {
    const first = Array.isArray(value.arguments) ? value.arguments[0] : undefined;
    const specifier = literalValue(first);
    if (specifier !== null) references.push({ specifier, kind: 'require' });
  } else if (type === 'TSImportEqualsDeclaration') {
    const specifier = literalValue(moduleReferenceExpression(value.moduleReference));
    if (specifier !== null) references.push({ specifier, kind: 'require' });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'range' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') {
      continue;
    }
    if (Array.isArray(child)) {
      for (const item of child) walk(item, references);
    } else {
      walk(child, references);
    }
  }
}

function dynamicLabel(source: unknown): string {
  if (isRecord(source) && source.type === 'TemplateLiteral') return '[dynamic template]';
  return '[dynamic expression]';
}

function isImportCallee(callee: unknown): boolean {
  return isRecord(callee) && callee.type === 'Import';
}

function isRequireCallee(callee: unknown): boolean {
  return isRecord(callee) && callee.type === 'Identifier' && callee.name === 'require';
}

function moduleReferenceExpression(value: unknown): unknown {
  if (!isRecord(value) || value.type !== 'TSExternalModuleReference') return null;
  return value.expression;
}

function literalValue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if ((value.type === 'StringLiteral' || value.type === 'Literal') && typeof value.value === 'string') {
    return value.value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function loadTsconfigs(root: string): Promise<Map<string, TsconfigInfo>> {
  const configs = new Map<string, TsconfigInfo>();
  const pending: string[] = [root];
  let seen = 0;

  while (pending.length > 0 && seen < 100) {
    const directory = pending.pop();
    if (!directory) break;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.resolve(directory, entry.name);
      if (!isInsideRoot(root, absolute) && absolute !== root) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        pending.push(absolute);
        continue;
      }
      if (entry.name !== 'tsconfig.json' || !entry.isFile()) continue;
      seen += 1;
      const info = await readTsconfig(absolute);
      if (info) configs.set(path.resolve(directory), info);
    }
  }
  return configs;
}

async function readTsconfig(absolutePath: string): Promise<TsconfigInfo | null> {
  try {
    const text = await readFile(absolutePath, 'utf8');
    const parsed = parseJsonc(text);
    if (!isRecord(parsed)) return null;
    const options = isRecord(parsed.compilerOptions) ? parsed.compilerOptions : {};
    const directory = path.dirname(absolutePath);
    const baseUrlValue = typeof options.baseUrl === 'string' ? options.baseUrl : null;
    const baseUrl = baseUrlValue ? path.resolve(directory, baseUrlValue) : null;
    const baseDir = baseUrl ?? directory;
    const aliases: PathAlias[] = [];
    if (isRecord(options.paths)) {
      for (const [pattern, targets] of Object.entries(options.paths)) {
        if (!Array.isArray(targets)) continue;
        const stringTargets = targets.filter((target): target is string => typeof target === 'string');
        if (stringTargets.length === 0) continue;
        const star = pattern.indexOf('*');
        aliases.push({
          prefix: star === -1 ? pattern : pattern.slice(0, star),
          suffix: star === -1 ? '' : pattern.slice(star + 1),
          hasStar: star !== -1,
          targets: stringTargets,
          baseDir,
        });
      }
    }
    aliases.sort((left, right) => right.prefix.length - left.prefix.length);
    return { aliases, baseUrl };
  } catch {
    return null;
  }
}

function nearestTsconfig(root: string, relativePath: string, configs: Map<string, TsconfigInfo>): TsconfigInfo | null {
  let directory = path.resolve(root, path.dirname(relativePath));
  const resolvedRoot = path.resolve(root);
  while (isInsideRoot(resolvedRoot, directory) || directory === resolvedRoot) {
    const found = configs.get(directory);
    if (found) return found;
    if (directory === resolvedRoot) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

function parseJsonc(text: string): unknown {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLine = withoutBlock.replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const withoutTrailing = withoutLine.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(withoutTrailing) as unknown;
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.kind.localeCompare(right.kind) ||
    left.importSpecifier.localeCompare(right.importSpecifier)
  );
}
