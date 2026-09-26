import { Router } from 'express';
import { analysisRouter } from './analysisRoutes.js';
import { authRouter } from './authRoutes.js';
import { healthRouter } from './healthRoutes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/analyses', analysisRouter);
