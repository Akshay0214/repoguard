import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EvidenceBlock, LimitationList } from '@/components/ui/EvidenceBlock';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { formatNumber } from '@/lib/format';
import { ApiError } from '@/services/apiClient';
import { getTechnicalDebtReport } from '@/services/repositoryService';
const POLL_MS = 2000;
const PENDING_ACQUISITION_MESSAGE = 'Repository acquisition is not complete.';
function groupIndicators(items) {
    const groups = new Map();
    for (const item of items) {
        const current = groups.get(item.indicator) ?? {
            indicator: item.indicator,
            categories: [],
            count: 0,
            contribution: 0,
            items: [],
        };
        current.count += 1;
        current.contribution += item.contribution;
        current.items.push(item);
        if (!current.categories.includes(item.category))
            current.categories.push(item.category);
        groups.set(item.indicator, current);
    }
    return [...groups.values()].sort((left, right) => right.contribution - left.contribution || left.indicator.localeCompare(right.indicator));
}
function IndicatorBody({ item }) {
    return (<article className="border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="min-w-0 break-all font-mono text-xs text-[var(--color-text)]">{item.affectedFile}</p>
        <p className="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">heuristic contribution +{item.contribution}</p>
      </div>
      <div className="mt-2 space-y-2">
        <EvidenceBlock title="Evidence">{item.evidence.detail}</EvidenceBlock>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Why it was flagged</h4>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.explanation}</p>
          <p className="mt-1 text-xs text-[var(--color-text-faint)]">Heuristic explanation from the indicator. Not proof of technical debt.</p>
        </div>
      </div>
    </article>);
}
function isRetryableDebtError(error) {
    return (error.status === 409 &&
        (error.code === 'DEBT_NOT_READY' ||
            (error.code === 'ACQUISITION_NOT_READY' && error.message === PENDING_ACQUISITION_MESSAGE)));
}
export function TechnicalDebt() {
    const { currentAnalysis } = useAnalysis();
    const [report, setReport] = useState(null);
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(Boolean(currentAnalysis));
    const [reloadKey, setReloadKey] = useState(0);
    useEffect(() => {
        if (!currentAnalysis)
            return undefined;
        let cancelled = false;
        let timer = 0;
        const poll = async () => {
            try {
                const next = await getTechnicalDebtReport(currentAnalysis.analysisId);
                if (cancelled)
                    return;
                setReport(next);
                setWaiting(false);
                setError(null);
                setLoading(false);
            }
            catch (caught) {
                if (cancelled)
                    return;
                if (caught instanceof ApiError && isRetryableDebtError(caught)) {
                    setWaiting(true);
                    setError(null);
                    setLoading(false);
                    timer = window.setTimeout(() => void poll(), POLL_MS);
                    return;
                }
                setWaiting(false);
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
        return (<div>
        <PageHeader title="Technical Debt" description="Indicators are calculated from analyzer evidence after a repository is analyzed."/>
        <EmptyState icon={<Landmark size={20}/>} title="No repository selected" description="Start an analysis to see technical debt indicators. This page does not show sample debt hours." action={<Link to="/analyze">
              <Button size="sm">Analyze a repository</Button>
            </Link>}/>
      </div>);
    }
    if (loading)
        return <LoadingState label="Loading technical debt indicators…"/>;
    if (error) {
        return (<ErrorState title="Technical debt indicators unavailable" description={error} onRetry={() => {
                setLoading(true);
                setError(null);
                setReloadKey((value) => value + 1);
            }}/>);
    }
    if (waiting || !report) {
        return <LoadingState label="Waiting for analyzer evidence…"/>;
    }
    const groups = groupIndicators(report.items);
    return (<div>
      <PageHeader title="Technical Debt" description="Evidence-based heuristic indicators, not a validated measurement of technical debt."/>

      <section className="border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Estimated contribution</h2>
        <p className="mt-2 font-mono text-2xl text-[var(--color-text)]">{formatNumber(report.summary.estimatedContribution)}</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          weighted points · {formatNumber(report.summary.itemCount)} {report.summary.itemCount === 1 ? 'indicator' : 'indicators'}
        </p>
        {report.summary.truncated && (<p className="mt-2 text-sm text-[var(--color-text-muted)]">The indicator list was truncated by the analyzer.</p>)}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">How is this calculated?</summary>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            {report.disclaimer} The number is a weighted sum of heuristic contributions. It is not hours, not money, not a scientifically validated measurement, and not proof of technical debt.
          </p>
        </details>
      </section>

      {report.limitations.length > 0 && (<section className="mt-5 border-t border-[var(--color-border)] pt-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Limitations</h2>
          <div className="mt-2">
            <LimitationList items={report.limitations}/>
          </div>
        </section>)}

      {report.items.length === 0 ? (<p className="mt-5 text-sm text-[var(--color-text-muted)]">
          No technical-debt indicators were produced from the available evidence.
        </p>) : (<section className="mt-5 border-t border-[var(--color-border)] pt-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Why was this flagged?</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Grouped by the indicator type returned by the API. Expand a group to read its evidence.
          </p>
          <div className="mt-2 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {groups.map((group) => (<details key={group.indicator} className="py-2">
                <summary className="cursor-pointer">
                  <span className="font-mono text-xs text-[var(--color-text)]">{group.indicator}</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                    {formatNumber(group.count)} {group.count === 1 ? 'indicator' : 'indicators'} · heuristic contribution {formatNumber(group.contribution)}
                    {group.categories.length > 0 ? ` · ${group.categories.join(', ')}` : ''}
                  </span>
                </summary>
                <div className="mt-2">
                  {group.items.map((item) => (<IndicatorBody key={item.id} item={item}/>))}
                </div>
              </details>))}
          </div>
        </section>)}
    </div>);
}
