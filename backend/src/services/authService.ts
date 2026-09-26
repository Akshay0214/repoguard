import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';
import { getDatabase } from '../db/database.js';
import { HttpError } from '../utils/httpError.js';

const scryptAsync = promisify(scrypt);
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export const LOCAL_DEV_OWNER = 'local-dev';

export interface AuthUser {
  id: string;
  email: string;
}

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

const users = new Map<string, UserRecord>();

export async function registerUser(emailInput: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const email = normalizeEmail(emailInput);
  assertPassword(password);
  if (await findByEmail(email)) {
    throw new HttpError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
  }
  const user: UserRecord = {
    id: randomBytes(16).toString('hex'),
    email,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  const database = getDatabase();
  if (database) {
    await database.collection<UserRecord>('users').insertOne(user);
  }
  return { user: publicUser(user), token: signToken(publicUser(user)) };
}

export async function loginUser(emailInput: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const email = normalizeEmail(emailInput);
  const user = await findByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  return { user: publicUser(user), token: signToken(publicUser(user)) };
}

export function verifyToken(token: string): AuthUser {
  const secret = requireSecret();
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const [header, body, signature] = parts;
  if (!header || !body || !signature) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }
  if (!isRecord(payload) || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication has expired.');
  }
  return { id: payload.sub, email: payload.email };
}

export async function hydrateUsers(): Promise<void> {
  const database = getDatabase();
  if (!database) return;
  const stored = await database.collection<UserRecord>('users').find({}, { projection: { _id: 0 } }).toArray();
  for (const user of stored) {
    if (typeof user.id === 'string' && typeof user.email === 'string' && typeof user.passwordHash === 'string') {
      users.set(user.id, user);
    }
  }
}

async function findByEmail(email: string): Promise<UserRecord | undefined> {
  for (const user of users.values()) {
    if (user.email === email) return user;
  }
  const database = getDatabase();
  if (!database) return undefined;
  const stored = await database.collection<UserRecord>('users').findOne({ email }, { projection: { _id: 0 } });
  if (!stored) return undefined;
  users.set(stored.id, stored);
  return stored;
}

function signToken(user: AuthUser): string {
  const secret = requireSecret();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function requireSecret(): string {
  if (env.jwtSecret.length < 16) {
    throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured.');
  }
  return env.jwtSecret;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A valid email is required.');
  }
  return normalized;
}

function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters.');
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  const derived = (await scryptAsync(password, parts[1], 32)) as Buffer;
  const actual = Buffer.from(parts[2], 'hex');
  if (actual.length !== derived.length) return false;
  return timingSafeEqual(actual, derived);
}

function publicUser(user: UserRecord): AuthUser {
  return { id: user.id, email: user.email };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
