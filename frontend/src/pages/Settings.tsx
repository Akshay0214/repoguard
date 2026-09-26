import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/services/apiClient';

export function Settings() {
  const { user, ready, login, register, logout } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setError(null);
    setPending(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      setPassword('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The account request failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Account session only. Nothing here changes analyzer rules, model settings, or repository evidence."
      />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {ready
                ? user
                  ? `Signed in as ${user.email}. Analyses you create are visible only to this account.`
                  : 'Development can run without an account. Sign in when authentication is enabled.'
                : 'Checking session…'}
            </CardDescription>
          </div>
        </CardHeader>
        {user ? (
          <Button
            onClick={() => {
              void logout();
            }}
          >
            Log out
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={mode === 'login' ? 'primary' : 'secondary'} onClick={() => setMode('login')}>
                Log in
              </Button>
              <Button size="sm" variant={mode === 'register' ? 'primary' : 'secondary'} onClick={() => setMode('register')}>
                Register
              </Button>
            </div>
            <label className="block text-xs text-[var(--color-text-muted)]">
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-[var(--color-text-muted)]">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-sm text-[var(--color-critical)]">{error}</p>}
            <Button disabled={pending || !email || password.length < 8} onClick={() => void submit()}>
              {pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
