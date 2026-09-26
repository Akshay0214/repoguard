import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { extractZipSafely, ZipExtractError } from '../src/services/zipAcquisitionService.js';

process.env.JWT_SECRET = 'test-secret-value-123';
process.env.AUTH_REQUIRED = 'true';
process.env.MONGODB_URI = '';

test('authentication, authorization, analysis lifecycle, and zip upload', async () => {
  const app = createApp();
  const server = await listen(app);
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);

    const anonymous = await fetch(`${base}/api/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'github', repositoryUrl: 'https://github.com/acme/widgets', branch: 'main' }),
    });
    assert.equal(anonymous.status, 401);

    const owner = await register(base, 'owner@example.com', 'password123');
    const other = await register(base, 'other@example.com', 'password123');
    const invalid = await fetch(`${base}/api/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ sourceType: 'github', repositoryUrl: 'not a url', branch: 'main' }),
    });
    assert.equal(invalid.status, 400);

    const created = await fetch(`${base}/api/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/acme/widgets',
        branch: 'missing-branch-name',
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { data: { analysisId: string } };
    const analysisId = createdBody.data.analysisId;
    const denied = await fetch(`${base}/api/analyses/${analysisId}`, {
      headers: { Authorization: `Bearer ${other.token}` },
    });
    assert.equal(denied.status, 404);

    const zip = new AdmZip();
    zip.addFile('src/app.js', Buffer.from('export const value = 1;\nif (false) { value; }\n'));
    const form = new FormData();
    form.append('archive', new Blob([zip.toBuffer()]), 'repo.zip');
    const uploaded = await fetch(`${base}/api/analyses/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.token}` },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const uploadedBody = (await uploaded.json()) as { data: { analysisId: string; sourceType: string } };
    assert.equal(uploadedBody.data.sourceType, 'zip');
    const zipId = uploadedBody.data.analysisId;

    const overview = await waitFor(async () => {
      const response = await fetch(`${base}/api/analyses/${zipId}/overview`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      if (response.status === 409) return null;
      assert.equal(response.status, 200);
      return response.json() as Promise<{ data: { health: { formula: string }; ast: { totalFiles: number } | null } }>;
    });
    assert.ok(overview.data.health.formula.includes('heuristicScore'));

    const issues = await fetch(`${base}/api/analyses/${zipId}/issues`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert.equal(issues.status, 200);
    const dependencies = await fetch(`${base}/api/analyses/${zipId}/dependencies`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert.equal(dependencies.status, 200);
    const history = await fetch(`${base}/api/analyses/${zipId}/history`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert.ok(history.status === 200 || history.status === 422);
    const debt = await fetch(`${base}/api/analyses/${zipId}/debt`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert.equal(debt.status, 200);
    const debtBody = (await debt.json()) as { data: { disclaimer: string } };
    assert.match(debtBody.data.disclaimer, /not a scientifically validated/i);
    const report = await fetch(`${base}/api/analyses/${zipId}/report`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert.equal(report.status, 200);
    const reportText = JSON.stringify(await report.json());
    assert.doesNotMatch(reportText, /OPENAI_API_KEY|workspacePath|GITHUB_TOKEN/);

    process.env.OPENAI_API_KEY = '';
    process.env.OPENAI_MODEL = '';
    const ai = await fetch(`${base}/api/analyses/${zipId}/ai-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
      body: '{}',
    });
    assert.equal(ai.status, 503);
  } finally {
    await close(server);
  }
});

test('zip extraction rejects malformed archives and unsafe paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'repoguard-zip-'));
  await assert.rejects(() => extractZipSafely(Buffer.from('not-a-zip'), root), ZipExtractError);
  await assert.rejects(() => extractZipSafely(zipSlip('../evil.js'), root), ZipExtractError);
  await rm(root, { recursive: true, force: true });
});

async function register(base: string, email: string, password: string): Promise<{ token: string }> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { data: { token: string } };
  assert.equal(typeof body.data.token, 'string');
  return body.data;
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for analysis.');
}

function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function zipSlip(entryName: string): Buffer {
  const name = Buffer.from(entryName);
  const content = Buffer.from('export const value = 1;\n');
  const compressed = deflateRawSync(content);
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  const localRecord = Buffer.concat([local, name, compressed]);
  const centralRecord = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}
