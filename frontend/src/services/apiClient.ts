function authHeaders(): Record<string, string> {
  const token = authToken ?? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TOKEN_KEY = 'repoguard.token';
const DEFAULT_API_BASE_URL = 'http://localhost:4000/api';
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (typeof sessionStorage === 'undefined') return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof sessionStorage === 'undefined') return null;
  authToken = sessionStorage.getItem(TOKEN_KEY);
  return authToken;
}

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
).replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function joinUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

function codeFromErrorBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() !== '' ? code : null;
}

function messageFromErrorBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}

async function requestJson(path: string, init: RequestInit, fallbackMessage: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(joinUrl(path), {
      ...init,
      headers: { Accept: 'application/json', ...authHeaders(), ...init.headers },
    });
  } catch {
    throw new ApiError('Unable to reach the RepoGuard API. Check that the backend is running.', 0);
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError('The API returned a response that could not be read.', response.status);
    }
  }

  if (!response.ok) {
    throw new ApiError(messageFromErrorBody(payload) ?? fallbackMessage, response.status, codeFromErrorBody(payload));
  }

  return payload;
}

export async function postJson(
  path: string,
  body: unknown,
  fallbackMessage = 'Unable to start repository analysis. Please check the repository URL and try again.',
  headers: Record<string, string> = {},
): Promise<unknown> {
  return requestJson(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    fallbackMessage,
  );
}

export async function postForm(
  path: string,
  body: FormData,
  fallbackMessage = 'The ZIP archive could not be uploaded.',
): Promise<unknown> {
  return requestJson(
    path,
    {
      method: 'POST',
      body,
    },
    fallbackMessage,
  );
}

export async function getJson(path: string): Promise<unknown> {
  return requestJson(path, { method: 'GET' }, 'The analysis status could not be loaded.');
}

export async function getText(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(joinUrl(path), {
      method: 'GET',
      headers: { ...authHeaders() },
    });
  } catch {
    throw new ApiError('Unable to reach the RepoGuard API. Check that the backend is running.', 0);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError('The report could not be downloaded.', response.status);
  }
  return text;
}
