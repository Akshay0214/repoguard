import { NavLink } from 'react-router-dom';
import { PRIMARY_NAV } from '@/components/layout/navItems';
import { cn } from '@/lib/cn';
export function AppNav({ onNavigate }) {
    return (<nav className="flex flex-1 flex-col" aria-label="Application">
      <div className="space-y-0.5">
        {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (<NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors', isActive
                ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-text)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]')}>
            <Icon size={16} strokeWidth={2}/>
            {label}
          </NavLink>))}
      </div>
    </nav>);
}
