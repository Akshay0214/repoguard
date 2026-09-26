import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ScanSearch,
  Bug,
  Landmark,
  Network,
  History,
  Settings,
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/analyze', label: 'Analyze', icon: ScanSearch },
  { to: '/issues', label: 'Issues', icon: Bug },
  { to: '/technical-debt', label: 'Technical Debt', icon: Landmark },
  { to: '/dependencies', label: 'Dependencies', icon: Network },
  { to: '/history', label: 'History', icon: History },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)] md:flex">
      <div className="flex h-14 items-center border-b border-[var(--color-border)] px-5">
        <NavLink to="/">
          <Logo />
        </NavLink>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-text)] font-medium'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
              )
            }
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-text)] font-medium'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]',
            )
          }
        >
          <Settings size={16} strokeWidth={2} />
          Settings
        </NavLink>
        <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <span className="text-[11px] text-[var(--color-text-faint)]">RepoGuard</span>
        </div>
      </div>
    </aside>
  );
}
