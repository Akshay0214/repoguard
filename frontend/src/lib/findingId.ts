import type { StaticFinding } from '@/services/repositoryService';

export function findingRouteId(finding: Pick<StaticFinding, 'path' | 'line' | 'column' | 'ruleId' | 'message'>): string {
  const key = `${finding.path}\u0000${finding.line ?? ''}\u0000${finding.column ?? ''}\u0000${finding.ruleId}\u0000${finding.message}`;
  const bytes = new TextEncoder().encode(key);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
