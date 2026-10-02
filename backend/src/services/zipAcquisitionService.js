import AdmZip from 'adm-zip';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { getAnalysisJob, updateAnalysisJob } from './analysisService.js';
import { analysisWorkspacePath, removeAnalysisWorkspace } from './repositoryAcquisitionService.js';
export class ZipExtractError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ZipExtractError';
        this.code = code;
    }
}
const MAX_ENTRIES = 10_000;
export function assertZipUpload(file) {
    if (!file)
        throw new ZipExtractError('EMPTY', 'A ZIP archive is required.');
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
        throw new ZipExtractError('MALFORMED', 'The uploaded file must be a .zip archive.');
    }
    if (file.size <= 0)
        throw new ZipExtractError('EMPTY', 'The ZIP archive is empty.');
    if (file.size > env.maxZipBytes) {
        throw new ZipExtractError('LIMIT', 'The ZIP archive exceeds the upload size limit.');
    }
}
export async function extractZipSafely(buffer, destination) {
    if (buffer.length > env.maxZipBytes) {
        throw new ZipExtractError('LIMIT', 'The ZIP archive exceeds the upload size limit.');
    }
    let zip;
    try {
        zip = new AdmZip(buffer);
    }
    catch {
        throw new ZipExtractError('MALFORMED', 'The ZIP archive could not be read.');
    }
    let entries;
    try {
        entries = zip.getEntries();
    }
    catch {
        throw new ZipExtractError('MALFORMED', 'The ZIP archive could not be read.');
    }
    if (entries.length === 0)
        throw new ZipExtractError('EMPTY', 'The ZIP archive is empty.');
    if (entries.length > MAX_ENTRIES) {
        throw new ZipExtractError('LIMIT', 'The ZIP archive has too many entries.');
    }
    const root = path.resolve(destination);
    await mkdir(root, { recursive: true });
    let uncompressed = 0;
    for (const entry of entries) {
        const name = entry.entryName.replaceAll('\\', '/').replace(/\0/g, '');
        if (!isSafeZipPath(name)) {
            throw new ZipExtractError('UNSAFE_PATH', 'The ZIP archive contains an unsafe path.');
        }
        if (isSymlinkEntry(entry)) {
            throw new ZipExtractError('UNSAFE_PATH', 'The ZIP archive contains a symbolic link.');
        }
        uncompressed += entry.header.size;
        if (uncompressed > env.maxZipUncompressedBytes) {
            throw new ZipExtractError('LIMIT', 'The ZIP archive expands beyond the size limit.');
        }
        if (entry.isDirectory)
            continue;
        const target = path.resolve(root, ...name.split('/').filter((part) => part !== '' && part !== '.'));
        const relative = path.relative(root, target);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new ZipExtractError('UNSAFE_PATH', 'The ZIP archive contains an unsafe path.');
        }
    }
    try {
        zip.extractAllTo(root, true);
    }
    catch {
        throw new ZipExtractError('MALFORMED', 'The ZIP archive could not be extracted.');
    }
}
export function archiveLabel(originalName) {
    const base = path.basename(originalName).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    return base || 'repository.zip';
}
function isSafeZipPath(name) {
    if (name.trim() === '' || name.startsWith('/') || name.startsWith('//') || /^[a-zA-Z]:/.test(name))
        return false;
    const parts = name.split('/');
    return parts.every((part) => part !== '..');
}
function isSymlinkEntry(entry) {
    const attr = entry.attr ?? entry.header.attr ?? 0;
    const unixMode = attr >>> 16;
    return (unixMode & 0o170000) === 0o120000;
}
export async function acquireUploadedArchive(analysisId, buffer) {
    const job = getAnalysisJob(analysisId);
    if (!job)
        return;
    let workspacePath;
    try {
        workspacePath = analysisWorkspacePath(analysisId);
        updateAnalysisJob(analysisId, {
            status: 'acquiring',
            acquisitionStartedAt: new Date().toISOString(),
            errorMessage: undefined,
            workspacePath: undefined,
        });
        await mkdir(path.dirname(workspacePath), { recursive: true });
        await extractZipSafely(buffer, workspacePath);
        updateAnalysisJob(analysisId, {
            status: 'ready',
            workspacePath,
            acquisitionCompletedAt: new Date().toISOString(),
            errorMessage: undefined,
        });
    }
    catch (error) {
        if (workspacePath) {
            await removeAnalysisWorkspace(analysisId).catch(() => undefined);
        }
        const message = error instanceof ZipExtractError ? error.message : 'The ZIP archive could not be extracted.';
        updateAnalysisJob(analysisId, {
            status: 'failed',
            workspacePath: undefined,
            acquisitionCompletedAt: new Date().toISOString(),
            errorMessage: message,
        });
    }
}
