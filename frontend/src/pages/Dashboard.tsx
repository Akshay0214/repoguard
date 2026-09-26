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
  downloadAnalysisReport,
  downloadAnalysisReportHtml,
  getAnalysisOverview,
  getRepositoryAiInterpretation,
  type AnalysisOverview,
  type FileAiInterpretation,
  type RepositoryReadinessStatus,
} from '@/services/repositoryService';

const POLL_MS = 2000;

const MODULE_LABELS: Record<keyof AnalysisOverview['readiness']['modules'], string> = {
  ast: 'AST',
  dependencies: 'Dependencies',
  static: 'Static analysis',
  history: 'Git history',
};

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
        description="Counts, heuristic indicators, and repository AI come from the analysis APIs."
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
        </div>
      </Card>

      {overview?.health && (
        <Card className="mt-4">
          <CardHeader>
            <div>
              <CardTitle>
                Heuristic indicator {overview.health.heuristicScore === null ? 'unavailable' : overview.health.heuristicScore}
              </CardTitle>
              <CardDescription>{overview.health.disclaimer}</CardDescription>
            </div>
          </CardHeader>
          <p className="mb-3 text-xs text-[var(--color-text-faint)]">{overview.health.formula}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.health.indicators.map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--color-border)] px-3 py-3">
                <p className="text-xs text-[var(--color-text-faint)]">{item.label}</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">
                  {item.available ? String(item.value) : 'Unavailable'}
                </p>
              </div>
            ))}
          </div>
          {overview.health.omittedInputs.length > 0 && (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Omitted inputs: {overview.health.omittedInputs.join(', ')}
            </p>
          )}
        </Card>
      )}

      {overview?.debt && (
        <Card className="mt-4">
          <CardHeader>
            <div>
              <CardTitle>Technical debt indicators</CardTitle>
              <CardDescription>
                {overview.debt.summary.itemCount} indicators, estimated contribution {overview.debt.summary.estimatedContribution}.{' '}
                {overview.debt.disclaimer}
              </CardDescription>
            </div>
          </CardHeader>
          <Link to="/technical-debt">
            <Button size="sm" variant="secondary">Open indicators</Button>
          </Link>
        </Card>
      )}

      <RepositoryAi
        analysisId={currentAnalysis.analysisId}
        ready={phase === 'ready' || phase === 'partial'}
      />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Report</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void downloadAnalysisReport(currentAnalysis.analysisId).then((report) => {
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'repoguard-report.json';
                anchor.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            Download JSON
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void downloadAnalysisReportHtml(currentAnalysis.analysisId).then((html) => {
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank', 'noopener');
              });
            }}
          >
            Open printable HTML
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RepositoryAi({ analysisId, ready }: { analysisId: string; ready: boolean }) {
  const [interpretation, setInterpretation] = useState<FileAiInterpretation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getRepositoryAiInterpretation(analysisId)
      .then((next) => {
        if (!cancelled) setInterpretation(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(repositoryAiMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, ready]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle>Repository AI interpretation</CardTitle>
          <CardDescription>
            Observations are rendered by the server from evidence pointers. Interpretation text is the model and is not a fact.
          </CardDescription>
        </div>
      </CardHeader>
      {!ready ? (
        <p className="text-sm text-[var(--color-text-muted)]">Waiting until analysis evidence is ready.</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />
          Requesting repository interpretation…
        </p>
      ) : error ? (
        <p className="text-sm text-[var(--color-text)]">{error}</p>
      ) : interpretation ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[var(--color-text)]">{interpretation.summary}</p>
          <ul className="space-y-3">
            {interpretation.observations.map((observation, index) => (
              <li key={`${observation.category}:${index}`} className="rounded-md border border-[var(--color-border)] px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>{observation.category}</Badge>
                  <Badge>{observation.confidence} confidence</Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--color-text)]">{observation.observation}</p>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">Interpretation: {observation.interpretation}</p>
                <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                  {observation.evidence.map((item, evidenceIndex) => (
                    <li key={`${item.source}:${item.field}:${evidenceIndex}`}>
                      {item.source}.{item.field}
                      {item.index === null ? '' : `[${item.index}]`}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text)]">Limitations</h3>
            <ul className="mt-2 space-y-1 text-sm text-[var(--color-text-muted)]">
              {interpretation.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function repositoryAiMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'AI interpretation is temporarily unavailable.';
  if (caught.code === 'AI_NOT_CONFIGURED') {
    return 'AI interpretation is not configured.';
  }
  if (caught.code === 'AI_TIMEOUT' || caught.status === 504) return 'AI interpretation timed out.';
  if (caught.code === 'AI_RESPONSE_INVALID' || caught.status === 502) return 'AI interpretation returned an invalid response.';
  if (caught.code === 'AI_RATE_LIMIT') return 'AI interpretation is temporarily rate-limited.';
  if (caught.status === 409) return 'Repository analysis is not ready.';
  if (caught.status === 503) return caught.message || 'AI interpretation is temporarily unavailable.';
  return caught.message || 'AI interpretation is temporarily unavailable.';
}
