import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileCode2, FolderGit2, LoaderCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { findingRouteId } from '@/lib/findingId';
import { ApiError } from '@/services/apiClient';
import {
  getAnalysisIssues,
  getFileAiInterpretation,
  type FileAiInterpretation,
  type IssueListResponse,
  type StaticFinding,
} from '@/services/repositoryService';

const POLL_MS = 2000;

function isWaiting(error: ApiError): boolean {
  return (
    error.status === 409 &&
    (error.code === 'STATIC_ANALYSIS_NOT_READY' ||
      (error.code === 'ACQUISITION_NOT_READY' && error.message === 'Repository acquisition is not complete.'))
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span className="break-all text-right font-mono text-sm text-[var(--color-text)]">{value}</span>
    </div>
  );
}

export function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const { currentAnalysis } = useAnalysis();
  const [result, setResult] = useState<IssueListResponse | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(currentAnalysis));
  const [reloadKey, setReloadKey] = useState(0);

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

  if (!currentAnalysis) {
    return (
      <div>
        <PageHeader title="Finding" description="No repository is selected." />
        <EmptyState
          icon={<FolderGit2 size={20} />}
          title="No repository selected"
          description="Findings are only available for the analysis started in this session."
          action={
            <Link to="/analyze">
              <Button size="sm">Analyze a repository</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) return <LoadingState label="Loading finding…" />;
  if (waiting) return <LoadingState label={waiting} />;
  if (error || !result) {
    return (
      <ErrorState
        title="Finding unavailable"
        description={error ?? 'Static findings could not be loaded.'}
        onRetry={() => {
          setLoading(true);
          setError(null);
          setReloadKey((value) => value + 1);
        }}
      />
    );
  }

  const finding = result.findings.find((item) => findingRouteId(item) === id) ?? null;
  if (!finding) {
    return (
      <EmptyState
        icon={<FileCode2 size={18} />}
        title="Finding not found"
        description="This finding is not in the current static-analysis result."
        action={
          <Link to="/issues" className="text-sm text-[var(--color-accent-text)] hover:underline">
            Back to findings
          </Link>
        }
      />
    );
  }

  return (
    <FindingDetail
      analysisId={currentAnalysis.analysisId}
      finding={finding}
      limitations={result.limitations}
      truncated={result.summary.truncated}
    />
  );
}

function aiStatusMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'AI interpretation is temporarily unavailable.';
  if (caught.code === 'AI_NOT_CONFIGURED') return 'AI interpretation is not configured.';
  if (caught.code === 'AI_SERVICE_UNAVAILABLE') return 'AI interpretation is temporarily unavailable.';
  if (caught.code === 'AI_RATE_LIMIT') return 'AI interpretation is temporarily rate-limited.';
  if (caught.code === 'AI_TIMEOUT') return 'AI interpretation timed out.';
  if (caught.code === 'AI_RESPONSE_INVALID') return 'AI interpretation returned an invalid response.';
  if (caught.code === 'ACQUISITION_NOT_READY' || caught.status === 409) return 'Repository analysis is not ready.';
  if (caught.code === 'FILE_NOT_FOUND') return 'This file was not found in the analyzed repository.';
  if (caught.code === 'ANALYSIS_NOT_FOUND' || caught.status === 404) return 'This analysis is no longer available.';
  return 'AI interpretation is temporarily unavailable.';
}

function FindingDetail({
  analysisId,
  finding,
  limitations,
  truncated,
}: {
  analysisId: string;
  finding: StaticFinding;
  limitations: string[];
  truncated: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/issues" className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={13} />
        Back to findings
      </Link>

      <PageHeader
        title={finding.message}
        description={finding.ruleId}
        actions={
          <Badge color={finding.severity === 'error' ? 'var(--color-critical)' : 'var(--color-medium)'} className="text-sm">
            {finding.severity}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Finding</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <DetailRow label="File" value={finding.path} />
            <DetailRow label="Line" value={finding.line === null ? 'Unavailable' : String(finding.line)} />
            <DetailRow label="Column" value={finding.column === null ? 'Unavailable' : String(finding.column)} />
            <DetailRow label="Rule" value={finding.ruleId} />
            <DetailRow label="Severity" value={finding.severity} />
            <DetailRow label="Message" value={finding.message} />
            <DetailRow label="Tool" value={finding.tool} />
            <DetailRow label="Category" value={finding.category ?? 'Unavailable'} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Limitations</CardTitle>
          </CardHeader>
          {truncated && (
            <p className="mb-3 text-sm text-[var(--color-text)]">
              Static analysis was truncated. This finding is from the stored result, which does not cover the whole repository.
            </p>
          )}
          {limitations.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No static-analysis limitations were reported.</p>
          ) : (
            <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
              {limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <FindingAi key={`${analysisId}:${finding.path}`} analysisId={analysisId} path={finding.path} />
    </div>
  );
}

function FindingAi({ analysisId, path }: { analysisId: string; path: string }) {
  const [interpretation, setInterpretation] = useState<FileAiInterpretation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getFileAiInterpretation(analysisId, path)
      .then((next) => {
        if (cancelled) return;
        setInterpretation(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(aiStatusMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, path]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>AI interpretation</CardTitle>
      </CardHeader>
      {error ? (
        <p className="text-sm text-[var(--color-text)]">{error}</p>
      ) : !interpretation ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <LoaderCircle size={14} className="animate-spin text-[var(--color-accent)]" />
          Generating AI interpretation...
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-[var(--color-text)]">{interpretation.summary}</p>
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text)]">Observations</h3>
            {interpretation.observations.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">No observations were returned.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {interpretation.observations.map((observation, index) => (
                  <li key={`${observation.category}:${observation.observation}:${index}`} className="rounded-md border border-[var(--color-border)] px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{observation.category}</Badge>
                      <Badge>{observation.confidence} confidence</Badge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--color-text)]">{observation.observation}</p>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">Interpretation: {observation.interpretation}</p>
                    <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                      {observation.evidence.map((item, evidenceIndex) => (
                        <li key={`${item.source}:${item.field}:${item.index ?? 'none'}:${evidenceIndex}`}>
                          {item.source}.{item.field}
                          {item.index === null ? '' : `[${item.index}]`}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text)]">Limitations</h3>
            {interpretation.limitations.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">No AI limitations were returned.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-[var(--color-text-muted)]">
                {interpretation.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
