import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { getTechnicalDebtReport, type TechnicalDebtReport } from '@/services/repositoryService';

const POLL_MS = 2000;

export function TechnicalDebt() {
  const { currentAnalysis } = useAnalysis();
  const [report, setReport] = useState<TechnicalDebtReport | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(currentAnalysis));
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentAnalysis) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await getTechnicalDebtReport(currentAnalysis.analysisId);
        if (cancelled) return;
        setReport(next);
        setWaiting(false);
        setError(null);
        setLoading(false);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 409) {
          setWaiting(true);
          setError(null);
          setLoading(false);
          timer = window.setTimeout(() => void poll(), POLL_MS);
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'Technical debt indicators could not be loaded.');
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
        <PageHeader title="Technical Debt" description="Indicators are calculated from analyzer evidence after a repository is analyzed." />
        <EmptyState
          icon={<Landmark size={20} />}
          title="No repository selected"
          description="Start an analysis to see technical debt indicators. This page does not show sample debt hours."
          action={
            <Link to="/analyze">
              <Button size="sm">Analyze a repository</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) return <LoadingState label="Loading technical debt indicators…" />;
  if (error) {
    return (
      <ErrorState
        title="Technical debt indicators unavailable"
        description={error}
        onRetry={() => {
          setLoading(true);
          setError(null);
          setReloadKey((value) => value + 1);
        }}
      />
    );
  }
  if (waiting || !report) {
    return <LoadingState label="Waiting for analyzer evidence…" />;
  }

  return (
    <div>
      <PageHeader
        title="Technical Debt"
        description="Indicators and estimated contributions are derived from static analysis, AST nesting, dependencies, and complete Git history."
        actions={<Badge>{report.summary.itemCount} indicators</Badge>}
      />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Estimated contribution {report.summary.estimatedContribution}</CardTitle>
            <CardDescription>{report.disclaimer}</CardDescription>
          </div>
        </CardHeader>
        {report.items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No indicators were produced from the available evidence.</p>
        ) : (
          <div className="space-y-3">
            {report.items.map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--color-border)] px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{item.indicator}</Badge>
                  <Badge>contribution {item.contribution}</Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-[var(--color-text)]">{item.affectedFile}</p>
                <p className="mt-2 text-sm text-[var(--color-text)]">{item.evidence.detail}</p>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">{item.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Limitations</CardTitle>
        </CardHeader>
        {report.limitations.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No limitations were recorded for these indicators.</p>
        ) : (
          <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
