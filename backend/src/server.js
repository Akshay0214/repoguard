import { createApp } from './app.js';
import { assertProductionConfig, env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/database.js';
import { hydrateUsers } from './services/authService.js';
import { enablePersistenceMirrors, hydratePersistence } from './services/persistenceService.js';
import { cleanupStaleWorkspaces } from './services/repositoryAcquisitionService.js';
assertProductionConfig();
enablePersistenceMirrors();
const app = createApp();
await connectDatabase()
    .then(async (connected) => {
    if (!connected) {
        console.log('MongoDB is not configured. Analysis state stays in process memory.');
        return;
    }
    await hydrateUsers();
    await hydratePersistence();
    console.log('MongoDB persistence enabled');
})
    .catch((error) => {
    console.error('MongoDB connection failed', error instanceof Error ? error.name : 'error');
    if (env.nodeEnv === 'production')
        throw error;
});
await cleanupStaleWorkspaces().catch(() => undefined);
const server = app.listen(env.port, () => {
    console.log(`RepoGuard API listening on port ${env.port}`);
});
let shuttingDown = false;
function shutdown() {
    if (shuttingDown)
        return;
    shuttingDown = true;
    server.close(() => {
        void disconnectDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
