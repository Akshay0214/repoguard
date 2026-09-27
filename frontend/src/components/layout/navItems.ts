import { Bug, FileText, History, Landmark, LayoutDashboard, Network, Settings } from 'lucide-react';

export const PRIMARY_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/issues', label: 'Issues', icon: Bug },
  { to: '/dependencies', label: 'Dependencies', icon: Network },
  { to: '/history', label: 'History', icon: History },
  { to: '/technical-debt', label: 'Technical Debt', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: FileText },
] as const;

export const SETTINGS_NAV = { to: '/settings', label: 'Settings', icon: Settings };
