import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAnalysisJob, updateAnalysisJob } from '../src/services/analysisService.js';
import { restoreCompletedAnalysis } from '../src/services/analysisOrchestrationService.js';
import { analysisWorkspacePath } from '../src/services/repositoryAcquisitionService.js';
import { verifyToken } from '../src/services/authService.js';
import { estimateTechnicalDebt } from '../src/services/technicalDebtService.js';
process.env.JWT_SECRET = 'test-secret-value-123';
process.env.AUTH_REQUIRED = 'true';
process.env.MONGODB_URI = '';
test('debt endpoint retries only while analysis is still in progress', async () => {
    const app = createApp();
    const server = await listen(app);
    const base = `http://127.0.0.1:${portOf(server)}`;
    const workspaces = [];
    try {
        const owner = await register(base, `debt-readiness-${Date.now()}@example.com`);
        const auth = { Authorization: `Bearer ${owner.token}` };
        const queued = createOwnedJob(owner.userId);
        const queuedDebt = await debt(base, queued.analysisId, auth);
        assert.equal(queuedDebt.status, 409);
        assert.equal(queuedDebt.body.error?.code, 'ACQUISITION_NOT_READY');
        assert.equal(queuedDebt.body.error?.message, 'Repository acquisition is not complete.');
        updateAnalysisJob(queued.analysisId, { status: 'acquiring' });
        const acquiringDebt = await debt(base, queued.analysisId, auth);
        assert.equal(acquiringDebt.status, 409);
        assert.equal(acquiringDebt.body.error?.code, 'ACQUISITION_NOT_READY');
        assert.equal(acquiringDebt.body.error?.message, 'Repository acquisition is not complete.');
        const findings = createOwnedJob(owner.userId);
        workspaces.push(await markReady(findings.analysisId, 'export const value = 1;\nif (false) { value; }\n'));
        const analyzing = await debt(base, findings.analysisId, auth);
        assert.equal(analyzing.status, 409);
        assert.equal(analyzing.body.error?.code, 'DEBT_NOT_READY');
        const findingsReady = await waitForDebt(base, findings.analysisId, auth);
        assert.equal(findingsReady.status, 200);
        assert.equal(findingsReady.body.success, true);
        assert.ok((findingsReady.body.data?.summary.itemCount ?? 0) >= 1);
        assert.match(findingsReady.body.data?.disclaimer ?? '', /not a scientifically validated/i);
        const clean = createOwnedJob(owner.userId);
        workspaces.push(await markReady(clean.analysisId, 'export const value = 1;\n'));
        const cleanReady = await waitForDebt(base, clean.analysisId, auth);
        assert.equal(cleanReady.status, 200);
        assert.equal(cleanReady.body.data?.summary.itemCount, 0);
        assert.equal(cleanReady.body.data?.summary.estimatedContribution, 0);
        assert.match(cleanReady.body.data?.disclaimer ?? '', /not a scientifically validated/i);
        const failed = createOwnedJob(owner.userId);
        const failure = 'The repository could not be cloned. It may be private, missing, or unavailable.';
        updateAnalysisJob(failed.analysisId, { status: 'failed', errorMessage: failure });
        const failedDebt = await debt(base, failed.analysisId, auth);
        assert.equal(failedDebt.status, 422);
        assert.equal(failedDebt.body.error?.code, 'ACQUISITION_FAILED');
        assert.equal(failedDebt.body.error?.message, failure);
        const failedAgain = await debt(base, failed.analysisId, auth);
        assert.equal(failedAgain.status, 422);
        assert.equal(failedAgain.body.error?.code, 'ACQUISITION_FAILED');
        const partial = createOwnedJob(owner.userId);
        workspaces.push(await markReady(partial.analysisId, 'export const value = 1;\nif (false) { value; }\n'));
        restoreTerminalRun(partial.analysisId, null, {
            ast: 'ready',
            dependencies: 'ready',
            static: 'failed',
            history: 'ready',
        }, ['Static analysis failed.']);
        const partialDebt = await debt(base, partial.analysisId, auth);
        assert.equal(partialDebt.status, 422);
        assert.equal(partialDebt.body.error?.code, 'DEBT_UNAVAILABLE');
        assert.match(partialDebt.body.error?.message ?? '', /were not produced/i);
        assert.match(partialDebt.body.error?.message ?? '', /Static analysis failed/);
        const partialAgain = await debt(base, partial.analysisId, auth);
        assert.equal(partialAgain.status, 422);
        assert.equal(partialAgain.body.error?.code, 'DEBT_UNAVAILABLE');
        const restored = createOwnedJob(owner.userId);
        updateAnalysisJob(restored.analysisId, { status: 'ready', workspacePath: undefined });
        const stored = persistedDebt(restored.analysisId);
        restoreTerminalRun(restored.analysisId, stored, readyModules(), ['Git history evidence is unavailable.']);
        const restoredDebt = await debt(base, restored.analysisId, auth);
        assert.equal(restoredDebt.status, 200);
        assert.equal(restoredDebt.body.data?.analysisId, restored.analysisId);
        assert.equal(restoredDebt.body.data?.summary.itemCount, stored.summary.itemCount);
        assert.equal(restoredDebt.body.data?.summary.estimatedContribution, stored.summary.estimatedContribution);
        const restoredEmpty = createOwnedJob(owner.userId);
        updateAnalysisJob(restoredEmpty.analysisId, { status: 'ready', workspacePath: undefined });
        restoreTerminalRun(restoredEmpty.analysisId, null, readyModules(), []);
        const missingDebt = await debt(base, restoredEmpty.analysisId, auth);
        assert.equal(missingDebt.status, 422);
        assert.equal(missingDebt.body.error?.code, 'DEBT_UNAVAILABLE');
        assert.match(missingDebt.body.error?.message ?? '', /were not produced/i);
        const missingAgain = await debt(base, restoredEmpty.analysisId, auth);
        assert.equal(missingAgain.status, 422);
        assert.equal(missingAgain.body.error?.code, 'DEBT_UNAVAILABLE');
    }
    finally {
        await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
        await close(server);
    }
});
function createOwnedJob(ownerId) {
    return createAnalysisJob({
        repositoryUrl: 'https://github.com/acme/widgets',
        repositoryName: 'acme/widgets',
        branch: 'main',
        sourceType: 'github',
        ownerId,
    });
}
async function markReady(analysisId, source) {
    const workspace = analysisWorkspacePath(analysisId);
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await writeFile(path.join(workspace, 'src', 'app.js'), source);
    updateAnalysisJob(analysisId, { status: 'ready', workspacePath: workspace });
    return workspace;
}
function readyModules() {
    return { ast: 'ready', dependencies: 'ready', static: 'ready', history: 'ready' };
}
function restoreTerminalRun(analysisId, debtReport, modules, limitations) {
    restoreCompletedAnalysis(analysisId, {
        ast: null,
        dependencies: null,
        static: null,
        history: null,
        staticFindings: null,
        evidence: { ast: null, dependencies: null, staticAnalysis: null, history: null },
        debt: debtReport,
        modules,
        limitations,
    });
}
function persistedDebt(analysisId) {
    return estimateTechnicalDebt(analysisId, {
        ast: null,
        dependencies: null,
        staticAnalysis: {
            summary: {
                filesAnalyzed: 1,
                findingCount: 1,
                errorCount: 1,
                warningCount: 0,
                truncated: false,
                repositoryConfigUsed: false,
                ruleSet: 'repoguard-fixed',
            },
            findings: [
                {
                    path: 'src/app.js',
                    line: 2,
                    column: 1,
                    ruleId: 'no-constant-condition',
                    severity: 'error',
                    message: 'Unexpected constant condition.',
                    tool: 'eslint',
                    category: 'problem',
                },
            ],
            issues: [],
        },
        history: null,
        unavailable: [],
    });
}
async function register(base, email) {
    const response = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json());
    return { token: body.data.token, userId: verifyToken(body.data.token).id };
}
async function debt(base, analysisId, headers) {
    const response = await fetch(`${base}/api/analyses/${analysisId}/debt`, { headers });
    return { status: response.status, body: (await response.json()) };
}
async function waitForDebt(base, analysisId, headers) {
    const started = Date.now();
    let latest = null;
    while (Date.now() - started < 30_000) {
        latest = await debt(base, analysisId, headers);
        if (latest.status !== 409)
            return latest;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for debt. Last status ${latest?.status ?? 'none'}.`);
}
function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}
function portOf(server) {
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    return address.port;
}
function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}
