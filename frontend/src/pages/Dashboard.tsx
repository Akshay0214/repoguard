import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderGit2, GitBranch, LoaderCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { formatNumber } from '@/lib/format';
import {
  getAnalysisOverview,
  type AnalysisOverview,
  type RepositoryReadinessStatus,
} from '@/services/repositoryService';

const POLL_MS = 2000;

const MODULE_LABELS: Record<keyof AnalysisOverview['readiness']['modules'], string> = {
  ast: 'AST',
  dependencies: 'Dependencies',
  static: 'Static analysis',
  history: 'Git history',
};

const UNAVAILABLE_METRICS = [
  'Health score',
  'Technical debt',
  'Health trend',
  'Risk ranking',
  'AI insight',
];

function statusLabel(status: RepositoryReadinessStatus | 'preparing'): string {
  if (status === 'preparing' || status === 'queued' || status === 'acquiring') return 'Preparing repository…';
  if (status === 'analyzing') return 'Analyzing repository…';
  if (status === 'ready') return 'Analysis ready';
  if (status === 'partial') return 'Analysis partially complete';
  return 'Analysis failed';
}

function isInProgress(status: RepositoryReadinessStatus | 'preparing'): boolean {
  return status === 'preparing' || status === 'queued' || status === 'acquiring' || status === 'analyzing';
}

function metricValue(value: number | null | undefined): string {
  return typeof value === 'number' ? formatNumber(value) : 'Unavailable';
}

export function Dashboard() {
  const { currentAnalysis } = useAnalysis();
  const [overview, setOverview] = useState<AnalysisOverview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(currentAnalysis));
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentAnalysis) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const next = await getAnalysisOverview(currentAnalysis.analysisId);
        if (cancelled) return;
        setOverview(next);
        setPreparing(false);
        setError(null);
        setLoading(false);
        if (next.readiness.status === 'queued' || next.readiness.status === 'acquiring' || next.readiness.status === 'analyzing') {
          timer = window.setTimeout(() => void poll(), POLL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 409) {
          setPreparing(true);
          setError(null);
          setLoading(false);
          timer = window.setTimeout(() => void poll(), POLL_MS);
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'The analysis status could not be loaded.');
        setLoading(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentAnalysis, reloadKey]);

  if (!currentAnalysis) {
    return (
      <div>
        <PageHeader
          title="Repository Overview"
          description="No repository is selected. Analysis metrics are not available until a job is created."
        />
        <EmptyState
          icon={<FolderGit2 size={20} />}
          title="No repository selected"
          description="Start an analysis from the Analyze page. This view does not keep a repository after a reload."
          action={
            <Link to="/analyze">
              <Button size="sm">Analyze a repository</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) return <LoadingState label="Loading repository overview…" />;
  if (error) {
    return (
      <ErrorState
        title="Repository overview unavailable"
        description={error}
        onRetry={() => {
          setLoading(true);
          setError(null);
          setReloadKey((value) => value + 1);
        }}
      />
    );
  }

  const phase: RepositoryReadinessStatus | 'preparing' = preparing || !overview ? 'preparing' : overview.readiness.status;
  const repositoryName = overview ? `${overview.repository.owner ? `${overview.repository.owner}/` : ''}${overview.repository.name}` : currentAnalysis.repositoryName;
  const owner = overview?.repository.owner ?? (currentAnalysis.repositoryName.includes('/') ? currentAnalysis.repositoryName.split('/')[0] : null);
  const branch = overview?.repository.branch ?? currentAnalysis.branch;
  const sourceType = overview?.repository.sourceType ?? currentAnalysis.sourceType;
  const repositoryUrl = overview?.repository.repositoryUrl ?? currentAnalysis.repositoryUrl;
  const failedModules = overview
    ? (Object.keys(overview.readiness.modules) as Array<keyof AnalysisOverview['readiness']['modules']>).filter(
        (name) => overview.readiness.modules[name] === 'failed',
      )
    : [];
  const facts = [
    ['Files discovered', metricValue(overview?.ast?.filesDiscovered)],
    ['Lines of code', metricValue(overview?.ast?.totalLines)],
    ['Functions', metricValue(overview?.ast?.totalFunctions)],
    ['Classes', metricValue(overview?.ast?.totalClasses)],
    ['Static files analyzed', metricValue(overview?.static?.filesAnalyzed)],
    ['Static findings', metricValue(overview?.static?.findingCount)],
    ['Static errors', metricValue(overview?.static?.errorCount)],
    ['Static warnings', metricValue(overview?.static?.warningCount)],
    ['Internal files', metricValue(overview?.dependencies?.totalInternalNodes)],
    ['Internal dependencies', metricValue(overview?.dependencies?.totalInternalEdges)],
    ['External packages', metricValue(overview?.dependencies?.totalExternalPackages)],
    ['Unresolved imports', metricValue(overview?.dependencies?.unresolvedImports)],
    ['Git commits', metricValue(overview?.history?.availableCommits)],
    ['Authors', metricValue(overview?.history?.uniqueAuthors)],
  ] as const;

  return (
    <div>
      <PageHeader
        title="Repository Overview"
        description="Repository identity and factual module counts come from the analysis overview. Scores, trends, and rankings are not available yet."
        actions={<Badge>{statusLabel(phase)}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Repository</CardTitle>
          </CardHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-[var(--color-text-faint)]">Full name</p>
              <p className="mt-1 font-mono text-[var(--color-text)]">{repositoryName}</p>
            </div>
            {owner && (
              <div>
                <p className="text-xs text-[var(--color-text-faint)]">Owner</p>
                <p className="mt-1 font-mono text-[var(--color-text)]">{owner}</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
                <GitBranch size={13} /> Branch
              </span>
              <span className="font-mono text-[var(--color-text)]">{branch}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-faint)]">Source</span>
              <span className="font-mono text-[var(--color-text)]">{sourceType}</span>
            </div>
            {repositoryUrl && (
              <p className="break-all font-mono text-xs text-[var(--color-text-muted)]">{repositoryUrl}</p>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              {isInProgress(phase) && <LoaderCircle size={16} className="animate-spin text-[var(--color-accent)]" />}
              <div>
                <CardTitle>{statusLabel(phase)}</CardTitle>
                <CardDescription>
                  {phase === 'partial'
                    ? 'Some analysis modules failed. Successful modules are still available from their own results.'
                    : phase === 'failed'
                      ? 'This analysis did not finish. No scores were calculated.'
                      : phase === 'ready'
                        ? 'The repository analysis modules finished.'
                        : 'RepoGuard is still collecting repository evidence. No progress percentage is available.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          {phase === 'partial' && failedModules.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Failed modules</p>
              <div className="flex flex-wrap gap-2">
                {failedModules.map((name) => (
                  <Badge key={name}>{MODULE_LABELS[name]}</Badge>
                ))}
              </div>
            </div>
          )}
          {overview && overview.readiness.limitations.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-muted)]">
              {overview.readiness.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Metrics</CardTitle>
            <CardDescription>Counts are included only after that module finishes. Failed modules stay unavailable.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => {
            const linked = label === 'Static findings' && value !== 'Unavailable';
            const body = (
              <>
                <p className="text-xs text-[var(--color-text-faint)]">{label}</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">{value}</p>
              </>
            );
            if (!linked) {
              return (
                <div key={label} className="rounded-md border border-[var(--color-border)] px-3 py-3">
                  {body}
                </div>
              );
            }
            return (
              <Link key={label} to="/issues" className="rounded-md border border-[var(--color-border)] px-3 py-3 hover:bg-[var(--color-surface-hover)]">
                {body}
              </Link>
            );
          })}
          {UNAVAILABLE_METRICS.map((label) => (
            <div key={label} className="rounded-md border border-[var(--color-border)] px-3 py-3">
              <p className="text-xs text-[var(--color-text-faint)]">{label}</p>
              <p className="mt-1 text-sm text-[var(--color-text)]">Not available yet</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
