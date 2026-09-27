import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/services/apiClient';

const fieldClass =
  'mt-1 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';

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
    <div className="max-w-xl">
      <h1 className="font-display text-xl font-semibold text-[var(--color-text)]">Settings</h1>
      <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
        Account session for this application. Development can run without signing in. This is not an enterprise security console.
      </p>

      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Account</h2>
        {!ready ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Checking session…</p>
        ) : user ? (
          <div className="mt-3">
            <p className="text-sm text-[var(--color-text)]">{user.email}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Signed in. Analyses created with this session belong to this account.</p>
            <Button
              className="mt-4"
              size="sm"
              variant="secondary"
              onClick={() => {
                void logout();
              }}
            >
              Log out
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">Not signed in. A local development session can analyze a repository without an account.</p>
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
              <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={fieldClass} />
            </label>
            <label className="block text-xs text-[var(--color-text-muted)]">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={fieldClass}
              />
            </label>
            {error && <p role="alert" className="text-sm text-[var(--color-critical)]">{error}</p>}
            <Button disabled={pending || !email || password.length < 8} onClick={() => void submit()}>
              {pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Application</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Analyzer rules, model selection, and evidence thresholds are not changed from this screen. GitHub tokens, API keys, and database credentials are not displayed.
        </p>
      </section>
    </div>
  );
}
