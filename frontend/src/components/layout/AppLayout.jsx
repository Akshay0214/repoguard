import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AppNav } from './AppNav';
import { SETTINGS_NAV } from './navItems';
import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/cn';
export function AppLayout() {
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const { user, logout } = useAuth();
    const SettingsIcon = SETTINGS_NAV.icon;
    return (<div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <Sidebar />

      {mobileNavOpen && (<div className="fixed inset-0 z-50 flex md:hidden">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>
          <div className="relative flex w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)]">
            <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
              <Logo />
              <button onClick={() => setMobileNavOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]" aria-label="Close navigation">
                <X size={18}/>
              </button>
            </div>
            <div className="flex flex-1 flex-col p-3">
              <AppNav onNavigate={() => setMobileNavOpen(false)}/>
              <NavLink to={SETTINGS_NAV.to} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => cn('mt-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', isActive ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-text)]' : 'text-[var(--color-text-muted)]')}>
                <SettingsIcon size={16}/>
                Settings
              </NavLink>
              <div className="mt-3 border-t border-[var(--color-border)] px-3 pt-3">
                <p className="truncate text-xs text-[var(--color-text-faint)]">{user ? user.email : 'Not signed in'}</p>
                {user && (<button type="button" className="mt-1 text-xs text-[var(--color-text-muted)]" onClick={() => void logout()}>
                    Log out
                  </button>)}
              </div>
            </div>
          </div>
        </div>)}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)}/>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-5 md:px-6 md:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>);
}
