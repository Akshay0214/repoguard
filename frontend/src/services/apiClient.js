function authHeaders() {
    const token = authToken ?? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null);
    return token ? { Authorization: `Bearer ${token}` } : {};
}
const TOKEN_KEY = 'repoguard.token';
const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';
let authToken = null;
export function setAuthToken(token) {
    authToken = token;
    if (typeof sessionStorage === 'undefined')
        return;
    if (token)
        sessionStorage.setItem(TOKEN_KEY, token);
    else
        sessionStorage.removeItem(TOKEN_KEY);
}
export function getAuthToken() {
    if (authToken)
        return authToken;
    if (typeof sessionStorage === 'undefined')
        return null;
    authToken = sessionStorage.getItem(TOKEN_KEY);
    return authToken;
}
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/$/, '');
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}
function joinUrl(path) {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${suffix}`;
}
function codeFromErrorBody(body) {
    if (typeof body !== 'object' || body === null)
        return null;
    const error = body.error;
    if (typeof error !== 'object' || error === null)
        return null;
    const code = error.code;
    return typeof code === 'string' && code.trim() !== '' ? code : null;
}
function messageFromErrorBody(body) {
    if (typeof body !== 'object' || body === null)
        return null;
    const error = body.error;
    if (typeof error !== 'object' || error === null)
        return null;
    const message = error.message;
    return typeof message === 'string' && message.trim() !== '' ? message : null;
}
async function requestJson(path, init, fallbackMessage) {
    let response;
    try {
        response = await fetch(joinUrl(path), {
            ...init,
            headers: { Accept: 'application/json', ...authHeaders(), ...init.headers },
        });
    }
    catch {
        throw new ApiError('Unable to reach the RepoGuard API. Check that the backend is running.', 0);
    }
    let payload = null;
    const text = await response.text();
    if (text) {
        try {
            payload = JSON.parse(text);
        }
        catch {
            throw new ApiError('The API returned a response that could not be read.', response.status);
        }
    }
    if (!response.ok) {
        throw new ApiError(messageFromErrorBody(payload) ?? fallbackMessage, response.status, codeFromErrorBody(payload));
    }
    return payload;
}
export async function postJson(path, body, fallbackMessage = 'Unable to start repository analysis. Please check the repository URL and try again.', headers = {}) {
    return requestJson(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    }, fallbackMessage);
}
export async function postForm(path, body, fallbackMessage = 'The ZIP archive could not be uploaded.') {
    return requestJson(path, {
        method: 'POST',
        body,
    }, fallbackMessage);
}
export async function getJson(path) {
    return requestJson(path, { method: 'GET' }, 'The analysis status could not be loaded.');
}
export async function getText(path) {
    let response;
    try {
        response = await fetch(joinUrl(path), {
            method: 'GET',
            headers: { ...authHeaders() },
        });
    }
    catch {
        throw new ApiError('Unable to reach the RepoGuard API. Check that the backend is running.', 0);
    }
    const text = await response.text();
    if (!response.ok) {
        throw new ApiError('The report could not be downloaded.', response.status);
    }
    return text;
}
