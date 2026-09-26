import { parse, type ParserPlugin } from '@babel/parser';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

export const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  '.turbo',
  'vendor',
]);

/** Enough for a repository the size of React, still bounded. */
export const MAX_SOURCE_FILES = 20_000;
export const MAX_SOURCE_FILE_BYTES = 1_500_000;

export interface DiscoveredSourceFiles {
  files: string[];
  truncated: boolean;
}

export async function discoverSourceFiles(root: string): Promise<DiscoveredSourceFiles> {
  const files: string[] = [];
  let truncated = false;
  const pending: string[] = [root];

  while (pending.length > 0) {
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

      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

      if (files.length >= MAX_SOURCE_FILES) {
        truncated = true;
        break;
      }
      files.push(toRelativePath(root, absolute));
    }

    if (truncated) break;
  }

  files.sort((left, right) => left.localeCompare(right));
  return { files, truncated };
}

export function parseWorkspaceSource(relativePath: string, source: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: false,
    sourceFilename: relativePath,
    plugins: pluginsFor(extension, source),
  });
}

export function pluginsFor(extension: string, source: string): ParserPlugin[] {
  const plugins: ParserPlugin[] = ['importAttributes', ['decorators', { decoratorsBeforeExport: true }]];
  if (extension === '.ts' || extension === '.tsx') plugins.push('typescript');
  if (extension === '.js' || extension === '.jsx' || extension === '.tsx') plugins.push('jsx');
  if ((extension === '.js' || extension === '.jsx') && hasFlowPragma(source)) plugins.push('flow');
  return plugins;
}

function hasFlowPragma(source: string): boolean {
  return /@flow\b/.test(source.slice(0, 4096));
}

export function shortParseMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unable to parse file.';
  const firstLine = raw.split('\n')[0] ?? 'Unable to parse file.';
  return firstLine.slice(0, 240);
}

export function toRelativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
