import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { apiRouter } from './routes/index.js';
export function createApp() {
    const app = express();
    app.use(cors({
        origin: env.frontendUrl,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-GitHub-Token'],
    }));
    app.use(express.json({ limit: '1mb' }));
    app.use((req, res, next) => {
        res.setTimeout(env.requestTimeoutMs, () => {
            if (!res.headersSent) {
                res.status(504).json({
                    success: false,
                    error: { code: 'REQUEST_TIMEOUT', message: 'The request timed out.' },
                });
            }
        });
        next();
    });
    app.use('/api', apiRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
