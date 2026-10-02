import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
export function NotFound() {
    return (<div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg)] px-6 text-center">
      <Logo size={26}/>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-faint)]">
        <ShieldAlert size={22}/>
      </span>
      <h1 className="font-display text-2xl font-semibold text-[var(--color-text)]">Page not found</h1>
      <p className="max-w-sm text-sm text-[var(--color-text-muted)]">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Link to="/">
        <Button variant="secondary" size="md">Back to home</Button>
      </Link>
    </div>);
}
