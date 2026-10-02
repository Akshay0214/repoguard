import dotenv from 'dotenv';
dotenv.config();
function readPort(raw) {
    if (!raw || raw.trim() === '')
        return 4000;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    return port;
}
function readNodeEnv(raw) {
    if (raw === 'production' || raw === 'test' || raw === 'development')
        return raw;
    return 'development';
}
function readPositiveInt(raw, fallback) {
    if (!raw || raw.trim() === '')
        return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1)
        return fallback;
    return value;
}
export const env = {
    get port() {
        return readPort(process.env.PORT);
    },
    get frontendUrl() {
        return process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
    },
    get nodeEnv() {
        return readNodeEnv(process.env.NODE_ENV);
    },
    get openaiApiKey() {
        return process.env.OPENAI_API_KEY?.trim() ?? '';
    },
    get openaiModel() {
        return process.env.OPENAI_MODEL?.trim() ?? '';
    },
    get mongoUri() {
        return process.env.MONGODB_URI?.trim() ?? '';
    },
    get mongoDb() {
        return process.env.MONGODB_DB?.trim() || 'repoguard';
    },
    get jwtSecret() {
        return process.env.JWT_SECRET?.trim() ?? '';
    },
    get authRequired() {
        const raw = process.env.AUTH_REQUIRED?.trim().toLowerCase();
        if (raw === 'true')
            return true;
        if (raw === 'false')
            return false;
        return readNodeEnv(process.env.NODE_ENV) === 'production';
    },
    /** Server-side default for private GitHub clones. Never returned to clients. */
    get githubToken() {
        return process.env.GITHUB_TOKEN?.trim() ?? '';
    },
    get maxZipBytes() {
        return readPositiveInt(process.env.MAX_ZIP_BYTES, 50 * 1024 * 1024);
    },
    get maxZipUncompressedBytes() {
        return readPositiveInt(process.env.MAX_ZIP_UNCOMPRESSED_BYTES, 200 * 1024 * 1024);
    },
    get requestTimeoutMs() {
        return readPositiveInt(process.env.REQUEST_TIMEOUT_MS, 60_000);
    },
    get cloneTimeoutMs() {
        return readPositiveInt(process.env.CLONE_TIMEOUT_MS, 180_000);
    },
    /**
     * Commits to fetch for the requested branch.
     * `0` or unset clones the full branch history. A positive integer passes `--depth`.
     */
    get gitHistoryDepth() {
        const raw = process.env.GIT_HISTORY_DEPTH?.trim() ?? '';
        if (raw === '' || raw === '0')
            return 0;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0)
            return 0;
        return value;
    },
    /** Maximum commits the history analyzer records from the clone. */
    get gitHistoryCommitLimit() {
        return readPositiveInt(process.env.GIT_HISTORY_COMMIT_LIMIT, 2_000);
    },
};
export function assertProductionConfig() {
    if (!env.authRequired)
        return;
    if (env.jwtSecret.length < 16) {
        throw new Error('JWT_SECRET must be set to at least 16 characters when authentication is required');
    }
}
