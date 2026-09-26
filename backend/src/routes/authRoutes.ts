import { Router } from 'express';
import { getSession, postLogin, postLogout, postRegister } from '../controllers/authController.js';
import { requireUser } from '../middleware/requireUser.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRouter = Router();

authRouter.post('/register', asyncHandler(postRegister));
authRouter.post('/login', asyncHandler(postLogin));
authRouter.post('/logout', requireUser, asyncHandler(postLogout));
authRouter.get('/me', requireUser, asyncHandler(getSession));
