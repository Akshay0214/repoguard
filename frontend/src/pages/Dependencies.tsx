import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Network } from 'lucide-react';
import { DependencyGraph } from '@/components/dependencies/DependencyGraph';
import { selectInternalVisualGraph, VISUAL_NODE_LIMIT } from '@/components/dependencies/graphLayout';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { formatNumber } from '@/lib/format';
import { ApiError } from '@/services/apiClient';
import {
  getAnalysisDependencies,
  type DependencyAnalysisResult,
  type FileDependencyFacts,
} from '@/services/repositoryService';

const POLL_MS = 2000;

function isPreparing(error: ApiError): boolean {
  return (
    error.status === 409 &&
    error.code === 'ACQUISITION_NOT_READY' &&
    error.message === 'Repository acquisition is not complete.'
  );
}

export function Dependencies() {
  const { currentAnalysis } = useAnalysis();
  const [result, setResult] = useState<DependencyAnalysisResult | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(currentAnalysis));
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!currentAnalysis) return undefined;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const next = await getAnalysisDependencies(currentAnalysis.analysisId);
        if (cancelled) return;
        setResult(next);
        setPreparing(false);
        setError(null);
        setLoading(false);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && isPreparing(caught)) {
          setPreparing(true);
          setResult(null);
          setError(null);
          setLoading(false);
          timer = window.setTimeout(() => void poll(), POLL_MS);
          return;
        }
        setResult(null);
        setPreparing(false);
        setError(caught instanceof ApiError ? caught.message : 'Dependency evidence could not be loaded.');
        setLoading(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentAnalysis, reloadKey]);

  const visual = useMemo(
    () => (result ? selectInternalVisualGraph(result.nodes, result.edges) : null),
    [result],
  );

  const selectedFacts: FileDependencyFacts | null = useMemo(() => {
    if (!result || !selectedPath) return null;
    return result.files.find((file) => file.path === selectedPath) ?? null;
  }, [result, selectedPath]);

  if (!currentAnalysis) {
    return (
      <div>
        <PageIntro />
        <EmptyState
          icon={<Network size={20} />}
          title="No repository selected"
          description="Use Analyze repository in the header. This view does not keep dependency evidence after a reload."
        />
      </div>
    );
  }

  return (
    <div>
      <PageIntro />
      {loading || preparing ? (
        <LoadingState label={preparing ? 'Repository acquisition is not complete.' : 'Loading dependency evidence…'} />
      ) : error ? (
        <ErrorState
          title="Dependencies could not be loaded"
          description={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            setReloadKey((value) => value + 1);
          }}
        />
      ) : result && visual ? (
        <DependencyEvidence
          result={result}
          visualNodes={visual.nodes}
          visualEdges={visual.edges}
          bounded={visual.bounded}
          selectedFacts={selectedFacts}
          onSelect={setSelectedPath}
        />
      ) : null}
    </div>
  );
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function PageIntro() {
  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-[var(--color-text)]">Dependencies</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Repository dependency structure derived from imports and module resolution.
      </p>
    </div>
  );
}

function DependencyEvidence({
  result,
  visualNodes,
  visualEdges,
  bounded,
  selectedFacts,
  onSelect,
}: {
  result: DependencyAnalysisResult;
  visualNodes: DependencyAnalysisResult['nodes'];
  visualEdges: DependencyAnalysisResult['edges'];
  bounded: boolean;
  selectedFacts: FileDependencyFacts | null;
  onSelect: (path: string) => void;
}) {
  const { summary } = result;
  const internalEdges = result.edges.filter((edge) => edge.type === 'internal');
  const notes = [
    ...(summary.truncated
      ? ['Dependency discovery stopped at a limit. These counts and lists are the returned result, not every dependency in the repository.']
      : []),
    ...(summary.parseErrors > 0
      ? [`${formatNumber(summary.parseErrors)} source files could not be parsed for dependencies.`]
      : []),
    ...result.errors.map((item) => `${item.path}: ${item.message}`),
  ];

  return (
    <div>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-text)]">
        <span>{countLabel(summary.totalInternalNodes, 'internal file', 'internal files')}</span>
        <span>{countLabel(summary.totalInternalEdges, 'internal edge', 'internal edges')}</span>
        <span>{countLabel(summary.totalExternalPackages, 'external package', 'external packages')}</span>
        <span>{countLabel(summary.unresolvedImports, 'unresolved reference', 'unresolved references')}</span>
      </p>

      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Dependency graph</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          {bounded
            ? `Showing ${formatNumber(visualNodes.length)} of ${formatNumber(summary.totalInternalNodes)} internal files and ${formatNumber(visualEdges.length)} of ${formatNumber(summary.totalInternalEdges)} internal edges. The picture is limited to ${VISUAL_NODE_LIMIT} files and is not the complete dependency graph.`
            : `Showing all ${formatNumber(visualNodes.length)} returned internal files and ${formatNumber(visualEdges.length)} internal edges.`}
          {' '}External packages are listed below and are not drawn as files.
        </p>
        {visualNodes.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-md border border-[var(--color-border)]">
            <ReactFlowProvider>
              <DependencyGraph
                nodes={visualNodes}
                edges={visualEdges}
                selectedId={selectedFacts?.path ?? null}
                onSelect={onSelect}
              />
            </ReactFlowProvider>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">No internal files were returned.</p>
        )}
        {selectedFacts && (
          <div className="mt-3">
            <p className="break-all font-mono text-xs text-[var(--color-text)]">{selectedFacts.path}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {formatNumber(selectedFacts.outgoingInternal)} outgoing internal · {formatNumber(selectedFacts.incomingInternal)} incoming internal · {formatNumber(selectedFacts.external)} external packages · {formatNumber(selectedFacts.unresolved)} unresolved
            </p>
          </div>
        )}
      </section>

      {notes.length > 0 && (
        <section className="mt-6 border-t border-[var(--color-border)] pt-5">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Analysis limitations</h2>
          <ul className="mt-3 space-y-2">
            {notes.map((item) => (
              <li key={item} className="break-words text-sm text-[var(--color-text-muted)]">{item}</li>
            ))}
          </ul>
        </section>
      )}

      <DetailSection title="Internal dependencies" count={internalEdges.length} empty="No internal dependency edges were returned.">
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {internalEdges.map((edge) => (
            <li key={`${edge.source}\0${edge.target}\0${edge.kind}\0${edge.importSpecifier}`} className="text-sm">
              <p className="break-all font-mono text-xs text-[var(--color-text)]">
                {edge.source} → {edge.target}
              </p>
              <p className="break-all text-xs text-[var(--color-text-muted)]">
                {edge.kind} · {edge.importSpecifier}
              </p>
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection title="External packages" count={result.externalDependencies.length} empty="No external packages were returned.">
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Count is how many times the analyzer recorded the package.
        </p>
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {result.externalDependencies.map((item) => (
            <li key={item.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="break-all font-mono text-xs text-[var(--color-text)]">{item.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{formatNumber(item.count)}</span>
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection title="Unresolved references" count={result.unresolved.length} empty="No unresolved references were returned.">
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">
          Unresolved means RepoGuard could not resolve the reference with its current resolver.
        </p>
        <ul className="max-h-96 space-y-3 overflow-y-auto">
          {result.unresolved.map((item) => (
            <li key={`${item.source}\0${item.kind}\0${item.importSpecifier}`}>
              <p className="break-all font-mono text-xs text-[var(--color-text)]">{item.source}</p>
              <p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">
                {item.kind} · {item.importSpecifier}
              </p>
              <p className="mt-1 break-words text-sm text-[var(--color-text-muted)]">{item.message}</p>
            </li>
          ))}
        </ul>
      </DetailSection>
    </div>
  );
}

function DetailSection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-[var(--color-border)] pt-5">
      <details>
        <summary className="cursor-pointer text-base font-semibold text-[var(--color-text)]">
          {title}
          <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">{formatNumber(count)}</span>
        </summary>
        <div className="mt-3">
          {count === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{empty}</p> : children}
        </div>
      </details>
    </section>
  );
}
