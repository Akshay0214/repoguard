import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, getAuthToken, getJson, postJson, setAuthToken } from '@/services/apiClient';

export interface SessionUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setReady(true);
      return;
    }
    void getJson('/auth/me')
      .then((payload) => {
        const session = readSession(payload);
        setUser(session);
      })
      .catch(() => {
        setAuthToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      async register(email, password) {
        const payload = await postJson('/auth/register', { email, password }, 'Unable to create an account.');
        const session = readAuthResult(payload);
        setAuthToken(session.token);
        setUser(session.user);
      },
      async login(email, password) {
        const payload = await postJson('/auth/login', { email, password }, 'Unable to sign in.');
        const session = readAuthResult(payload);
        setAuthToken(session.token);
        setUser(session.user);
      },
      async logout() {
        try {
          await postJson('/auth/logout', {}, 'Unable to sign out.');
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 204) {
            // Logout is complete once the browser token is discarded.
          }
        }
        setAuthToken(null);
        setUser(null);
      },
    }),
    [ready, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

function readSession(payload: unknown): SessionUser | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: { id?: unknown; email?: unknown } }).data;
  if (!data || typeof data.id !== 'string' || typeof data.email !== 'string') return null;
  return { id: data.id, email: data.email };
}

function readAuthResult(payload: unknown): { token: string; user: SessionUser } {
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError('The API returned an unexpected account response.', 0);
  }
  const data = (payload as { data?: { token?: unknown; user?: { id?: unknown; email?: unknown } } }).data;
  if (!data || typeof data.token !== 'string' || !data.user || typeof data.user.id !== 'string' || typeof data.user.email !== 'string') {
    throw new ApiError('The API returned an unexpected account response.', 0);
  }
  return { token: data.token, user: { id: data.user.id, email: data.user.email } };
}
