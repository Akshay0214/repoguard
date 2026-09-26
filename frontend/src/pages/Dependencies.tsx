import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { FileCode2, Link2, Network, Package, Unlink } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { DependencyGraph } from '@/components/dependencies/DependencyGraph';
import { selectInternalVisualGraph, VISUAL_NODE_LIMIT } from '@/components/dependencies/graphLayout';
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

function factRow(label: string, value: number) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[var(--color-text-faint)]">{label}</span>
      <span className="font-mono text-[var(--color-text)]">{formatNumber(value)}</span>
    </div>
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
        <PageHeader
          title="Dependency Graph"
          description="Internal files, internal imports, external packages, and unresolved imports for the selected repository."
        />
        <EmptyState
          icon={<Network size={20} />}
          title="No repository selected"
          description="Start an analysis from the Analyze page. This view does not keep dependency evidence after a reload."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dependency Graph"
        description={`Dependency evidence for ${currentAnalysis.repositoryName}. Counts come from the dependency analysis.`}
      />

      {loading || preparing ? (
        <LoadingState label={preparing ? 'Preparing repository…' : 'Collecting dependency evidence…'} />
      ) : error ? (
        <ErrorState
          title="Dependency evidence is unavailable"
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
          selectedPath={selectedPath}
          selectedFacts={selectedFacts}
          onSelect={setSelectedPath}
        />
      ) : null}
    </div>
  );
}

function DependencyEvidence({
  result,
  visualNodes,
  visualEdges,
  bounded,
  selectedPath,
  selectedFacts,
  onSelect,
}: {
  result: DependencyAnalysisResult;
  visualNodes: DependencyAnalysisResult['nodes'];
  visualEdges: DependencyAnalysisResult['edges'];
  bounded: boolean;
  selectedPath: string | null;
  selectedFacts: FileDependencyFacts | null;
  onSelect: (path: string) => void;
}) {
  const { summary } = result;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Internal files" value={formatNumber(summary.totalInternalNodes)} icon={FileCode2} />
        <StatCard label="Internal dependencies" value={formatNumber(summary.totalInternalEdges)} icon={Link2} />
        <StatCard label="External packages" value={formatNumber(summary.totalExternalPackages)} icon={Package} />
        <StatCard label="Unresolved imports" value={formatNumber(summary.unresolvedImports)} icon={Unlink} />
      </div>

      {(summary.truncated || summary.parseErrors > 0 || result.errors.length > 0) && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Limitations</CardTitle>
              <CardDescription>Messages reported by dependency analysis.</CardDescription>
            </div>
          </CardHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-[var(--color-text-muted)]">
            {summary.parseErrors > 0 && (
              <li>{formatNumber(summary.parseErrors)} source files could not be parsed for dependencies.</li>
            )}
            {result.errors.map((item) => (
              <li key={`${item.path}\0${item.message}`}>
                <span className="font-mono text-xs text-[var(--color-text)]">{item.path}</span>
                <span> — {item.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <CardTitle>Internal files</CardTitle>
              <CardDescription>
                {bounded
                  ? `Showing ${formatNumber(visualNodes.length)} of ${formatNumber(summary.totalInternalNodes)} internal nodes and ${formatNumber(visualEdges.length)} of ${formatNumber(summary.totalInternalEdges)} internal edges. This is a visualization subset in analyzer order, limited to ${VISUAL_NODE_LIMIT} nodes. It is not the complete dependency graph.`
                  : `Showing all ${formatNumber(visualNodes.length)} internal nodes and ${formatNumber(visualEdges.length)} internal edges.`}
                {' '}External packages are listed separately and are not drawn as files.
              </CardDescription>
            </div>
            {visualNodes.length > 0 ? (
              <ReactFlowProvider>
                <DependencyGraph
                  nodes={visualNodes}
                  edges={visualEdges}
                  selectedId={selectedPath}
                  onSelect={onSelect}
                />
              </ReactFlowProvider>
            ) : (
              <p className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
                No internal files were reported.
              </p>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Selected file</CardTitle>
              <CardDescription>Counts for the file you select in the graph.</CardDescription>
            </div>
          </CardHeader>
          {selectedFacts ? (
            <div className="space-y-3">
              <p className="break-all font-mono text-xs text-[var(--color-text)]">{selectedFacts.path}</p>
              <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                {factRow('Outgoing internal files', selectedFacts.outgoingInternal)}
                {factRow('Incoming internal files', selectedFacts.incomingInternal)}
                {factRow('External packages', selectedFacts.external)}
                {factRow('Unresolved imports', selectedFacts.unresolved)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">Select an internal file to see its dependency counts.</p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>External packages</CardTitle>
            <CardDescription>
              {formatNumber(summary.totalExternalPackages)} packages. Count is how many times the analyzer recorded the package. This is not a vulnerability list.
            </CardDescription>
          </div>
        </CardHeader>
        {result.externalDependencies.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No external packages were reported.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-[var(--color-border)] px-1 py-2 text-xs font-medium text-[var(--color-text-faint)]">
              <span>Package</span>
              <span>Count</span>
            </div>
            {result.externalDependencies.map((item) => (
              <div key={item.name} className="grid grid-cols-[1fr_auto] gap-x-4 px-1 py-2 text-sm">
                <span className="truncate font-mono text-xs text-[var(--color-text)]">{item.name}</span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Unresolved imports</CardTitle>
            <CardDescription>
              {formatNumber(summary.unresolvedImports)} imports. The current analyzer did not establish a resolution for these specifiers.
            </CardDescription>
          </div>
        </CardHeader>
        {result.unresolved.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No unresolved imports were reported.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <div className="grid min-w-[720px] grid-cols-[1.2fr_1fr_0.7fr_1.4fr] gap-3 border-b border-[var(--color-border)] px-1 py-2 text-xs font-medium text-[var(--color-text-faint)]">
              <span>Source file</span>
              <span>Import specifier</span>
              <span>Kind</span>
              <span>Message</span>
            </div>
            {result.unresolved.map((item) => (
              <div
                key={`${item.source}\0${item.kind}\0${item.importSpecifier}`}
                className="grid min-w-[720px] grid-cols-[1.2fr_1fr_0.7fr_1.4fr] gap-3 px-1 py-2 text-xs"
              >
                <span className="break-all font-mono text-[var(--color-text)]">{item.source}</span>
                <span className="break-all font-mono text-[var(--color-text-muted)]">{item.importSpecifier}</span>
                <span className="text-[var(--color-text-muted)]">{item.kind}</span>
                <span className="text-[var(--color-text-muted)]">{item.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
