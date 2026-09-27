import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FolderGit2, LoaderCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { LimitationList } from '@/components/ui/EvidenceBlock';
import { StatusBadge, type ProductStatus } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { formatNumber } from '@/lib/format';
import {
  getAnalysisOverview,
  getRepositoryAiInterpretation,
  type AnalysisOverview,
  type FileAiInterpretation,
  type RepositoryReadinessStatus,
} from '@/services/repositoryService';

const POLL_MS = 2000;

const MODULE_LABELS: Record<keyof AnalysisOverview['readiness']['modules'], string> = {
  ast: 'AST analysis',
  static: 'Static analysis',
  dependencies: 'Dependency analysis',
  history: 'Git history',
};

function statusLabel(status: RepositoryReadinessStatus | 'preparing'): string {
  if (status === 'preparing' || status === 'queued' || status === 'acquiring') return 'Preparing repository';
  if (status === 'analyzing') return 'Analyzing repository';
  if (status === 'ready') return 'Analysis ready';
  if (status === 'partial') return 'Analysis partially complete';
  return 'Analysis failed';
}

function phaseStatus(status: RepositoryReadinessStatus | 'preparing'): ProductStatus {
  if (status === 'ready') return 'complete';
  if (status === 'partial') return 'partial';
  if (status === 'failed') return 'failed';
  if (status === 'analyzing') return 'analyzing';
  return 'acquiring';
}

function isInProgress(status: RepositoryReadinessStatus | 'preparing'): boolean {
  return status === 'preparing' || status === 'queued' || status === 'acquiring' || status === 'analyzing';
}

type AttentionItem = {
  id: string;
  label: string;
  value: string;
  href?: string;
  action?: string;
};

function attentionItems(overview: AnalysisOverview): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (overview.static && overview.static.findingCount > 0) {
    const { errorCount, warningCount, findingCount } = overview.static;
    items.push({
      id: 'static',
      label: 'Static findings',
      value: `${formatNumber(findingCount)} (${formatNumber(errorCount)} errors, ${formatNumber(warningCount)} warnings)`,
      href: '/issues',
      action: 'View findings',
    });
  }
  if (overview.dependencies && overview.dependencies.unresolvedImports > 0) {
    items.push({
      id: 'unresolved',
      label: 'Unresolved imports',
      value: formatNumber(overview.dependencies.unresolvedImports),
      href: '/dependencies',
      action: 'View dependencies',
    });
  }
  if (overview.debt && overview.debt.summary.itemCount > 0) {
    items.push({
      id: 'debt',
      label: 'Technical-debt indicators',
      value: formatNumber(overview.debt.summary.itemCount),
      href: '/technical-debt',
      action: 'View technical debt',
    });
  }
  if (overview.history && (overview.history.historyDepth === 'shallow' || !overview.history.isComplete)) {
    items.push({
      id: 'history',
      label: overview.history.historyDepth === 'shallow' ? 'Git history is shallow' : 'Git history is incomplete',
      value: `${formatNumber(overview.history.availableCommits)} ${overview.history.availableCommits === 1 ? 'commit' : 'commits'} available`,
      href: '/history',
      action: 'View history',
    });
  }
  const failed = (Object.keys(overview.readiness.modules) as Array<keyof typeof MODULE_LABELS>).filter(
    (name) => overview.readiness.modules[name] === 'failed',
  );
  if (failed.length > 0) {
    items.push({
      id: 'failed',
      label: 'Analysis modules failed',
      value: failed.map((name) => MODULE_LABELS[name]).join(', '),
    });
  }
  if (overview.ast && overview.ast.parseErrors > 0) {
    items.push({
      id: 'parse',
      label: 'Parse errors',
      value: formatNumber(overview.ast.parseErrors),
    });
  }
  return items;
}

function signalRows(overview: AnalysisOverview): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (overview.ast) {
    rows.push({ label: 'Files analyzed', value: formatNumber(overview.ast.totalFiles) });
    rows.push({ label: 'Lines analyzed', value: formatNumber(overview.ast.totalLines) });
  }
  if (overview.static) rows.push({ label: 'Static findings', value: formatNumber(overview.static.findingCount) });
  if (overview.dependencies) {
    rows.push({ label: 'Internal edges', value: formatNumber(overview.dependencies.totalInternalEdges) });
    rows.push({ label: 'Unresolved imports', value: formatNumber(overview.dependencies.unresolvedImports) });
  }
  if (overview.debt) {
    rows.push({ label: 'Debt contribution', value: formatNumber(overview.debt.summary.estimatedContribution) });
  }
  return rows;
}

function analysisLimitations(overview: AnalysisOverview): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  const add = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    items.push(trimmed);
  };
  for (const item of overview.readiness.limitations) add(item);
  if (overview.debt) {
    for (const item of overview.debt.limitations) add(item);
  }
  const historyAlreadyNoted = items.some((item) => /shallow|incomplete/i.test(item));
  if (!historyAlreadyNoted && overview.history?.historyDepth === 'shallow') {
    add('Git history is incomplete because this repository was analyzed from a shallow clone.');
  } else if (!historyAlreadyNoted && overview.history && !overview.history.isComplete) {
    add('The available Git history for this analysis is incomplete.');
  }
  return items;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-[var(--color-border)] pt-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
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
          title="Dashboard"
          description="Repository evidence, heuristic indicators, and AI interpretation for the selected analysis."
        />
        <EmptyState
          icon={<FolderGit2 size={20} />}
          title="No repository selected"
          description="Use Analyze repository in the header. This view does not keep a repository after a reload."
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
  const attention = overview ? attentionItems(overview) : [];
  const signals = overview ? signalRows(overview) : [];
  const limitations = overview ? analysisLimitations(overview) : [];
  const summaryParts: string[] = [];
  if (overview?.ast) {
    summaryParts.push(
      `${formatNumber(overview.ast.totalFiles)} ${overview.ast.totalFiles === 1 ? 'file' : 'files'} analyzed`,
    );
  }
  if (overview?.static) {
    summaryParts.push(
      `${formatNumber(overview.static.findingCount)} static ${overview.static.findingCount === 1 ? 'finding' : 'findings'}`,
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={summaryParts.join(' · ')}
        actions={<StatusBadge status={phaseStatus(phase)} label={statusLabel(phase)} />}
      />
      {isInProgress(phase) && (
        <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />
          Collecting repository evidence. Counts appear when each module returns.
        </p>
      )}

      {overview && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">Module status</summary>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Repository acquisition</span>
              <span className="font-mono text-xs text-[var(--color-text)]">
                {phase === 'queued' || phase === 'acquiring' || phase === 'preparing' ? 'running' : 'completed'}
              </span>
            </li>
            {(Object.keys(MODULE_LABELS) as Array<keyof typeof MODULE_LABELS>).map((name) => (
              <li key={name} className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">{MODULE_LABELS[name]}</span>
                <span className="font-mono text-xs text-[var(--color-text)]">{overview.readiness.modules[name]}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">Technical debt</span>
              <span className="font-mono text-xs text-[var(--color-text)]">
                {overview.debt ? 'ready' : isInProgress(phase) ? 'pending' : 'unavailable'}
              </span>
            </li>
          </ul>
        </details>
      )}

      <Section
        title="Findings & signals"
        description="Counts from this analysis. Unresolved imports are unresolved references. Technical-debt counts are heuristic signals."
      >
        {attention.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {overview
              ? 'None of the tracked signals were reported for this analysis. That is not a claim that the repository has no problems.'
              : 'Signals appear after the overview returns.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {attention.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p className="text-sm text-[var(--color-text)]">{item.label}</p>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{item.value}</span>
                  {item.href && item.action && (
                    <Link to={item.href} className="shrink-0 text-sm text-[var(--color-accent-text)] hover:underline">
                      {item.action}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Repository signals">
        {signals.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No module counts are available yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {signals.map((row) => (
              <div key={row.label} className="min-w-0 border-b border-[var(--color-border)] pb-2">
                <dt className="text-xs text-[var(--color-text-faint)]">{row.label}</dt>
                <dd className="mt-0.5 font-mono text-sm text-[var(--color-text)]">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {overview?.health && (
        <Section
          title="Heuristic health"
          description="Computed from analyzer evidence; not a validated repository quality score."
        >
          <p className="font-mono text-sm text-[var(--color-text)]">
            {overview.health.heuristicScore === null ? 'Unavailable' : overview.health.heuristicScore}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">How is this calculated?</summary>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{overview.health.disclaimer}</p>
            <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--color-text-faint)]">{overview.health.formula}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {overview.health.indicators.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">{item.label}</span>
                  <span className="font-mono text-xs text-[var(--color-text)]">
                    {item.available && item.value !== null ? String(item.value) : 'Unavailable'}
                  </span>
                </li>
              ))}
            </ul>
            {overview.health.omittedInputs.length > 0 && (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                Omitted inputs: {overview.health.omittedInputs.join(', ')}
              </p>
            )}
          </details>
        </Section>
      )}

      <RepositoryAi
        analysisId={currentAnalysis.analysisId}
        ready={phase === 'ready' || phase === 'partial'}
        hiddenLimitations={limitations}
      />

      {limitations.length > 0 && (
        <Section title="Analysis limitations" description="Limits recorded for this analysis.">
          <LimitationList items={limitations} />
        </Section>
      )}

      <p className="mt-5 text-sm text-[var(--color-text-muted)]">
        <Link to="/reports" className="text-[var(--color-accent-text)] hover:underline">
          Open reports
        </Link>{' '}
        to export the stored JSON or printable HTML.
      </p>
    </div>
  );
}

function RepositoryAi({
  analysisId,
  ready,
  hiddenLimitations,
}: {
  analysisId: string;
  ready: boolean;
  hiddenLimitations: string[];
}) {
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

  const aiLimitations = (interpretation?.limitations ?? []).filter((item) => !hiddenLimitations.includes(item));

  return (
    <section className="mt-5 border-t border-[var(--color-border)] pt-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">Repository AI</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Model-generated interpretation of repository evidence
      </p>
      <div className="mt-3">
        {!ready ? (
          <p className="text-sm text-[var(--color-text-muted)]">Waiting until analysis evidence is ready.</p>
        ) : loading ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />
            Generating interpretation...
          </p>
        ) : error ? (
          <p className="text-sm text-[var(--color-text)]">{error}</p>
        ) : interpretation ? (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Analyzer evidence</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">What RepoGuard measured.</p>
              {interpretation.observations.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">No analyzer observations were returned.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {interpretation.observations.map((observation, index) => (
                    <li key={`${observation.observation}:${index}`}>
                      <p className="break-words text-sm leading-relaxed text-[var(--color-text)]">{observation.observation}</p>
                      {observation.evidence.length > 0 && (
                        <p className="mt-1 break-all text-xs text-[var(--color-text-faint)]">
                          Evidence source{' '}
                          {observation.evidence
                            .map((item) => `${item.source}.${item.field}${item.index === null ? '' : `[${item.index}]`}`)
                            .join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-medium text-[var(--color-text-muted)]">AI interpretation</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">What the model infers from that evidence.</p>
              {interpretation.summary.trim() !== '' && (
                <p className="mt-3 break-words text-sm leading-relaxed text-[var(--color-text)]">{interpretation.summary}</p>
              )}
              <ul className="mt-3 space-y-3">
                {interpretation.observations.map((observation, index) => (
                  <li key={`${observation.interpretation}:${index}`}>
                    <p className="break-words text-sm leading-relaxed text-[var(--color-text)]">{observation.interpretation}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-faint)]">
                      {observation.confidence} confidence
                      {observation.category.trim() !== '' ? ` · ${observation.category}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            {aiLimitations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                  Analysis limitations
                </h3>
                <div className="mt-2">
                  <LimitationList items={aiLimitations} />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function repositoryAiMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'AI interpretation is temporarily unavailable.';
  if (caught.code === 'AI_NOT_CONFIGURED') {
    return 'AI interpretation is unavailable because the AI service is not configured.';
  }
  if (caught.code === 'AI_TIMEOUT' || caught.status === 504) return 'AI interpretation timed out.';
  if (caught.code === 'AI_RESPONSE_INVALID' || caught.status === 502) return 'AI interpretation could not be validated.';
  if (caught.code === 'AI_RATE_LIMIT') return 'AI interpretation is temporarily rate-limited.';
  if (caught.status === 409) return 'Repository analysis is not ready.';
  const message = caught.message.trim();
  return message === '' ? 'AI interpretation is temporarily unavailable.' : message;
}
