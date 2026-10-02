import { env } from '../config/env.js';
import { LOCAL_DEV_OWNER, verifyToken } from '../services/authService.js';
import { HttpError } from '../utils/httpError.js';
export function requireUser(req, _res, next) {
    const header = req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!token) {
        if (!env.authRequired) {
            req.user = { id: LOCAL_DEV_OWNER, email: 'local-dev@localhost' };
            next();
            return;
        }
        next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.'));
        return;
    }
    try {
        req.user = verifyToken(token);
        next();
    }
    catch (error) {
        next(error);
    }
}
