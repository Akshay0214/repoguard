import { NavLink } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { AppNav } from '@/components/layout/AppNav';
import { SETTINGS_NAV } from '@/components/layout/navItems';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/cn';
export function Sidebar() {
    const { user, logout } = useAuth();
    const SettingsIcon = SETTINGS_NAV.icon;
    return (<aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)] md:flex">
      <div className="flex h-14 items-center border-b border-[var(--color-border)] px-4">
        <NavLink to="/dashboard" aria-label="RepoGuard dashboard">
          <Logo />
        </NavLink>
      </div>
      <div className="flex flex-1 flex-col px-3 py-3">
        <AppNav />
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <NavLink to={SETTINGS_NAV.to} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors', isActive
            ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-text)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]')}>
            <SettingsIcon size={16} strokeWidth={2}/>
            {SETTINGS_NAV.label}
          </NavLink>
          <div className="mt-3 px-3">
            <p className="truncate text-xs text-[var(--color-text-faint)]">{user ? user.email : 'Not signed in'}</p>
            {user && (<button type="button" onClick={() => {
                void logout();
            }} className="mt-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Log out
              </button>)}
          </div>
        </div>
      </div>
    </aside>);
}
