import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileCode2, FolderGit2, LoaderCircle } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { findingRouteId } from '@/lib/findingId';
import { ApiError } from '@/services/apiClient';
import {
  getAnalysisIssues,
  getFileAiInterpretation,
  type FileAiEvidenceReference,
  type FileAiInterpretation,
  type FileAiObservation,
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

function locationText(finding: StaticFinding): string | null {
  if (finding.line === null && finding.column === null) return null;
  if (finding.line === null) return `Column ${finding.column}`;
  if (finding.column === null) return `Line ${finding.line}`;
  return `Line ${finding.line} · Column ${finding.column}`;
}

function findingFact(finding: StaticFinding): string {
  const line = finding.line === null ? 'an unknown line' : `line ${finding.line}`;
  const column = finding.column === null ? 'an unknown column' : `column ${finding.column}`;
  return `${finding.path} has a ${finding.ruleId} finding at ${line}, ${column}: ${finding.message}`;
}

function evidencePointer(item: FileAiEvidenceReference): string {
  return `${item.source}.${item.field}${item.index === null ? '' : `[${item.index}]`}`;
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\s+/g, ' ').trim() === right.replace(/\s+/g, ' ').trim();
}

function uniqueLimitations(items: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of items) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (text === '' || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}

function aiStatusMessage(caught: unknown): string {
  if (!(caught instanceof ApiError)) return 'AI interpretation is temporarily unavailable.';
  if (caught.code === 'AI_NOT_CONFIGURED') {
    return 'AI interpretation is unavailable because the AI service is not configured.';
  }
  if (caught.code === 'AI_TIMEOUT') return 'AI interpretation timed out.';
  if (caught.code === 'AI_RESPONSE_INVALID') return 'AI interpretation could not be validated.';
  const message = caught.message.trim();
  return message === '' ? 'AI interpretation is temporarily unavailable.' : message;
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
        <IssueTitle />
        <EmptyState
          icon={<FolderGit2 size={20} />}
          title="No repository selected"
          description="Use Analyze repository in the header. This view does not keep findings after a reload."
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
      <div>
        <IssueTitle />
        <BackToIssues />
        <EmptyState
          icon={<FileCode2 size={18} />}
          title="Finding not found"
          description="This finding is not in the current static-analysis result."
        />
      </div>
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

function IssueTitle() {
  return <h1 className="font-display text-xl font-semibold text-[var(--color-text)]">Issue Detail</h1>;
}

function BackToIssues() {
  return (
    <Link
      to="/issues"
      className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <ArrowLeft size={14} aria-hidden />
      Back to Issues
    </Link>
  );
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
  const [interpretation, setInterpretation] = useState<FileAiInterpretation | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fact = findingFact(finding);
  const where = locationText(finding);

  useEffect(() => {
    let cancelled = false;
    void getFileAiInterpretation(analysisId, finding.path)
      .then((next) => {
        if (cancelled) return;
        setInterpretation(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setAiError(aiStatusMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, finding.path]);

  const matched = interpretation?.observations.filter((item) => sameText(item.observation, fact)) ?? [];
  const otherEvidence = interpretation?.observations.filter((item) => !sameText(item.observation, fact)) ?? [];
  const shownLimitations = uniqueLimitations([
    ...limitations,
    ...(truncated
      ? ['Static analysis was truncated, so this result does not cover the whole repository.']
      : []),
    ...(interpretation?.limitations ?? []),
  ]);

  const copyPath = () => {
    const reset = () => window.setTimeout(() => setCopyState('idle'), 1500);
    void navigator.clipboard.writeText(finding.path).then(
      () => {
        setCopyState('copied');
        reset();
      },
      () => {
        setCopyState('failed');
        reset();
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <IssueTitle />
      <BackToIssues />

      <div className="mt-6">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`text-sm font-medium ${finding.severity === 'error' ? 'text-[var(--color-critical)]' : 'text-[var(--color-warning)]'}`}
          >
            {finding.severity}
          </span>
          <span className="break-all font-mono text-sm text-[var(--color-text)]">{finding.ruleId}</span>
        </p>
        <p className="mt-2 text-base leading-relaxed text-[var(--color-text)]">{finding.message}</p>
      </div>

      <div className="mt-5">
        <p className="break-all font-mono text-sm text-[var(--color-text)]">{finding.path}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {where && <p className="text-sm text-[var(--color-text-muted)]">{where}</p>}
          <button
            type="button"
            onClick={copyPath}
            className="rounded-sm text-xs text-[var(--color-accent-text)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {copyState === 'copied' ? 'Path copied' : copyState === 'failed' ? 'Could not copy path' : 'Copy path'}
          </button>
        </div>
      </div>

      <section className="mt-8 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Analyzer evidence</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Evidence from RepoGuard's static analysis</p>
        <p className="mt-4 break-words text-sm leading-relaxed text-[var(--color-text)]">{fact}</p>
        <EvidenceSources items={matched.flatMap((item) => item.evidence)} />
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          <div>
            <dt className="text-[var(--color-text-faint)]">Tool</dt>
            <dd className="mt-0.5 text-[var(--color-text)]">{finding.tool}</dd>
          </div>
          {finding.category && (
            <div>
              <dt className="text-[var(--color-text-faint)]">Category</dt>
              <dd className="mt-0.5 text-[var(--color-text)]">{finding.category}</dd>
            </div>
          )}
        </dl>
        {otherEvidence.length > 0 && (
          <div className="mt-5 space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-faint)]">
              Other evidence cited for this file
            </h3>
            {otherEvidence.map((item, index) => (
              <div key={`${item.observation}:${index}`}>
                <p className="break-words text-sm leading-relaxed text-[var(--color-text)]">{item.observation}</p>
                <EvidenceSources items={item.evidence} />
              </div>
            ))}
          </div>
        )}
      </section>

      <AiInterpretation error={aiError} interpretation={interpretation} />

      {shownLimitations.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-5">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Analysis limitations</h2>
          <ul className="mt-3 space-y-2">
            {shownLimitations.map((item) => (
              <li key={item} className="break-words text-sm leading-relaxed text-[var(--color-text-muted)]">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EvidenceSources({ items }: { items: FileAiEvidenceReference[] }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-2 break-all text-xs text-[var(--color-text-faint)]">
      Evidence source {items.map(evidencePointer).join(', ')}
    </p>
  );
}

function AiInterpretation({
  error,
  interpretation,
}: {
  error: string | null;
  interpretation: FileAiInterpretation | null;
}) {
  return (
    <section className="mt-8 border-t border-[var(--color-border)] pt-5" aria-live="polite">
      <h2 className="text-base font-medium text-[var(--color-text-muted)]">AI interpretation</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Model-generated interpretation of the supplied evidence</p>
      {error ? (
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-text)]">{error}</p>
      ) : !interpretation ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Generating interpretation...
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {interpretation.summary.trim() !== '' && (
            <p className="break-words text-sm leading-relaxed text-[var(--color-text)]">{interpretation.summary}</p>
          )}
          {interpretation.observations.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No interpretation was returned.</p>
          ) : (
            interpretation.observations.map((observation, index) => (
              <InterpretationItem key={`${observation.interpretation}:${index}`} observation={observation} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function InterpretationItem({ observation }: { observation: FileAiObservation }) {
  return (
    <div>
      <p className="break-words text-sm leading-relaxed text-[var(--color-text)]">{observation.interpretation}</p>
      <p className="mt-1 break-all text-xs text-[var(--color-text-faint)]">
        {observation.confidence} confidence
        {observation.category.trim() !== '' ? ` · ${observation.category}` : ''}
        {observation.evidence.length > 0 ? ` · Evidence source ${observation.evidence.map(evidencePointer).join(', ')}` : ''}
      </p>
    </div>
  );
}
