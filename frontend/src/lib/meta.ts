import {
  Bug,
  Network,
  ShieldAlert,
  Copy,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import type { IssueCategory, Severity, DependencyRisk } from '@/types';

export const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; soft: string; textVar: string }
> = {
  critical: { label: 'Critical', color: 'var(--color-critical)', soft: 'var(--color-critical-soft)', textVar: 'var(--color-critical)' },
  high: { label: 'High', color: 'var(--color-high)', soft: 'var(--color-high-soft)', textVar: 'var(--color-high)' },
  medium: { label: 'Medium', color: 'var(--color-medium)', soft: 'var(--color-medium-soft)', textVar: 'var(--color-medium)' },
  low: { label: 'Low', color: 'var(--color-low)', soft: 'var(--color-low-soft)', textVar: 'var(--color-low)' },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const CATEGORY_META: Record<
  IssueCategory,
  { label: string; icon: LucideIcon }
> = {
  'code-smell': { label: 'Code Smell', icon: Bug },
  complexity: { label: 'Complexity', icon: GitBranch },
  duplication: { label: 'Duplication', icon: Copy },
  security: { label: 'Security', icon: ShieldAlert },
  architecture: { label: 'Architecture', icon: Network },
};

export const RISK_META: Record<DependencyRisk, { label: string; color: string }> = {
  none: { label: 'No known risk', color: 'var(--color-text-faint)' },
  low: { label: 'Low risk', color: 'var(--color-low)' },
  medium: { label: 'Medium risk', color: 'var(--color-medium)' },
  high: { label: 'High risk', color: 'var(--color-critical)' },
};
