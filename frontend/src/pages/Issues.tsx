import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bug, ChevronRight, FolderGit2, Search, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { findingRouteId } from '@/lib/findingId';
import { ApiError } from '@/services/apiClient';
import { getAnalysisIssues, type IssueListResponse, type StaticFinding } from '@/services/repositoryService';

const POLL_MS = 2000;

function isWaiting(error: ApiError): boolean {
  return (
    error.status === 409 &&
    (error.code === 'STATIC_ANALYSIS_NOT_READY' ||
      (error.code === 'ACQUISITION_NOT_READY' && error.message === 'Repository acquisition is not complete.'))
  );
}

function locationLabel(finding: StaticFinding): string {
  if (finding.line === null) return finding.path;
  if (finding.column === null) return `${finding.path}:${finding.line}`;
  return `${finding.path}:${finding.line}:${finding.column}`;
}

export function Issues() {
  const { currentAnalysis } = useAnalysis();
  const [result, setResult] = useState<IssueListResponse | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(currentAnalysis));
  const [reloadKey, setReloadKey] = useState(0);
  const [pathQuery, setPathQuery] = useState('');
  const [ruleQuery, setRuleQuery] = useState('all');
  const [severity, setSeverity] = useState<'all' | StaticFinding['severity']>('all');

  useEffect(() => {
    if (!currentAnalysis) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const next = await getAnalysisIssues(currentAnalysis.analysisId);
        if (cancelled) return;
        setResult(next);
        setWaiting(null);
        setError(null);
        setLoading(false);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && isWaiting(caught)) {
          setWaiting(caught.message);
          setError(null);
          setLoading(false);
          timer = window.setTimeout(() => void poll(), POLL_MS);
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'Static findings could not be loaded.');
        setLoading(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentAnalysis, reloadKey]);

  const ruleIds = useMemo(() => {
    const ids = new Set((result?.findings ?? []).map((finding) => finding.ruleId));
    return [...ids].sort((left, right) => left.localeCompare(right));
  }, [result]);

  const filtered = useMemo(() => {
    const findings = result?.findings ?? [];
    const pathNeedle = pathQuery.trim().toLowerCase();
    return findings.filter((finding) => {
      const matchesPath = pathNeedle.length === 0 || finding.path.toLowerCase().includes(pathNeedle);
      const matchesRule = ruleQuery === 'all' || finding.ruleId === ruleQuery;
      const matchesSeverity = severity === 'all' || finding.severity === severity;
      return matchesPath && matchesRule && matchesSeverity;
    });
  }, [result, pathQuery, ruleQuery, severity]);

  if (!currentAnalysis) {
    return (
      <div>
        <PageHeader
          title="Static findings"
          description="No repository is selected. Findings are not available until a job is created."
        />
        <EmptyState
          icon={<FolderGit2 size={20} />}
          title="No repository selected"
          description="Start an analysis from the Analyze page. This view does not keep findings after a reload."
          action={
            <Link to="/analyze">
              <Button size="sm">Analyze a repository</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) return <LoadingState label="Loading static findings…" />;
  if (waiting) return <LoadingState label={waiting} />;
  if (error || !result) {
    return (
      <ErrorState
        title="Static findings unavailable"
        description={error ?? 'Static findings could not be loaded.'}
        onRetry={() => {
          setLoading(true);
          setError(null);
          setReloadKey((value) => value + 1);
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Static findings"
        description={`${result.summary.findingCount} findings from the fixed ESLint rule set. Filtering only changes what is shown.`}
      />

      {result.summary.truncated && (
        <div className="mb-4 rounded-md border border-[var(--color-medium)]/40 bg-[var(--color-medium-soft)] px-4 py-3 text-sm text-[var(--color-text)]">
          <p>These findings do not cover the whole repository. Static analysis was truncated.</p>
          {result.limitations.length > 0 && (
            <ul className="mt-2 space-y-1 text-[var(--color-text-muted)]">
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            value={pathQuery}
            onChange={(event) => setPathQuery(event.target.value)}
            placeholder="Filter by file path…"
            className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value as 'all' | StaticFinding['severity'])}
          className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="all">All severities</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
        </select>
        <select
          value={ruleQuery}
          onChange={(event) => setRuleQuery(event.target.value)}
          className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="all">All rules</option>
          {ruleIds.map((ruleId) => (
            <option key={ruleId} value={ruleId}>
              {ruleId}
            </option>
          ))}
        </select>
      </div>

      {result.findings.length === 0 ? (
        <EmptyState
          icon={<Bug size={18} />}
          title="No static-analysis findings"
          description="No static-analysis findings were reported by the current fixed rule set."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={18} />}
          title="No findings match these filters"
          description="The analysis result is unchanged. Clear a filter to see the returned findings."
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="hidden grid-cols-[1fr_180px_220px_90px] gap-4 border-b border-[var(--color-border)] px-4 py-2.5 text-xs font-medium text-[var(--color-text-faint)] md:grid">
            <span>Message</span>
            <span>Rule</span>
            <span>File</span>
            <span>Severity</span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {filtered.map((finding) => (
              <Link
                key={findingRouteId(finding)}
                to={`/issues/${findingRouteId(finding)}`}
                className="grid grid-cols-1 gap-2 px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-hover)] md:grid-cols-[1fr_180px_220px_90px] md:items-center md:gap-4"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="hidden shrink-0 text-[var(--color-text-faint)] md:block">
                    <ChevronRight size={14} />
                  </span>
                  <span className="truncate text-sm text-[var(--color-text)]">{finding.message}</span>
                </div>
                <span className="truncate font-mono text-xs text-[var(--color-text-muted)]">{finding.ruleId}</span>
                <span className="truncate font-mono text-xs text-[var(--color-text-faint)]">{locationLabel(finding)}</span>
                <Badge color={finding.severity === 'error' ? 'var(--color-critical)' : 'var(--color-medium)'} className="w-fit">
                  {finding.severity}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {result.findings.length > 0 && filtered.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-faint)]">
          <Badge>{filtered.length} shown</Badge>
          <span>of {result.findings.length} returned findings</span>
        </div>
      )}
    </div>
  );
}
