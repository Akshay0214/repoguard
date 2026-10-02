import { loginUser, registerUser } from '../services/authService.js';
import { HttpError } from '../utils/httpError.js';
export async function postRegister(req, res) {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const result = await registerUser(email, password);
    res.status(201).json({ success: true, data: result });
}
export async function postLogin(req, res) {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const result = await loginUser(email, password);
    res.status(200).json({ success: true, data: result });
}
export async function postLogout(_req, res) {
    res.status(204).send();
}
export async function getSession(req, res) {
    if (!req.user || req.user.id === 'local-dev') {
        throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    res.status(200).json({ success: true, data: { id: req.user.id, email: req.user.email } });
}
