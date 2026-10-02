import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderGit2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { findingRouteId } from '@/lib/findingId';
import { formatNumber } from '@/lib/format';
import { ApiError } from '@/services/apiClient';
import { getAnalysisIssues } from '@/services/repositoryService';
const POLL_MS = 2000;
function isWaiting(error) {
    return (error.status === 409 &&
        (error.code === 'STATIC_ANALYSIS_NOT_READY' ||
            (error.code === 'ACQUISITION_NOT_READY' && error.message === 'Repository acquisition is not complete.')));
}
function locationText(finding) {
    if (finding.line === null)
        return null;
    if (finding.column === null)
        return `Line ${finding.line}`;
    return `Line ${finding.line} · Column ${finding.column}`;
}
const fieldClass = 'w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';
export function Issues() {
    const { currentAnalysis } = useAnalysis();
    const [result, setResult] = useState(null);
    const [waiting, setWaiting] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(Boolean(currentAnalysis));
    const [reloadKey, setReloadKey] = useState(0);
    const [pathQuery, setPathQuery] = useState('');
    const [ruleQuery, setRuleQuery] = useState('all');
    const [severity, setSeverity] = useState('all');
    useEffect(() => {
        if (!currentAnalysis)
            return undefined;
        let cancelled = false;
        let timer = 0;
        const poll = async () => {
            try {
                const next = await getAnalysisIssues(currentAnalysis.analysisId);
                if (cancelled)
                    return;
                setResult(next);
                setWaiting(null);
                setError(null);
                setLoading(false);
            }
            catch (caught) {
                if (cancelled)
                    return;
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
    const filtersActive = pathQuery.trim().length > 0 || ruleQuery !== 'all' || severity !== 'all';
    const clearFilters = () => {
        setPathQuery('');
        setRuleQuery('all');
        setSeverity('all');
    };
    if (!currentAnalysis) {
        return (<div>
        <PageHeader title="Issues" description="Static-analysis findings detected in the analyzed repository."/>
        <EmptyState icon={<FolderGit2 size={20}/>} title="No repository selected" description="Use Analyze repository in the header. This view does not keep findings after a reload."/>
      </div>);
    }
    if (loading)
        return <LoadingState label="Loading static findings…"/>;
    if (waiting)
        return <LoadingState label={waiting}/>;
    if (error || !result) {
        return (<ErrorState title="Findings could not be loaded" description={error ?? 'Static findings could not be loaded.'} onRetry={() => {
                setLoading(true);
                setError(null);
                setReloadKey((value) => value + 1);
            }}/>);
    }
    const { findingCount, errorCount, warningCount } = result.summary;
    return (<div>
      <PageHeader title="Issues" description="Static-analysis findings detected in the analyzed repository."/>

      <p className="font-mono text-sm text-[var(--color-text)]">
        {formatNumber(findingCount)} {findingCount === 1 ? 'finding' : 'findings'}
        {' · '}
        {formatNumber(errorCount)} {errorCount === 1 ? 'error' : 'errors'}
        {' · '}
        {formatNumber(warningCount)} {warningCount === 1 ? 'warning' : 'warnings'}
      </p>

      {result.summary.truncated && (<p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Static analysis was truncated, so this list does not cover the whole repository.
          {result.limitations.length > 0 ? ` ${result.limitations.join(' ')}` : ''}
        </p>)}

      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs text-[var(--color-text-faint)]">
            Path
            <input value={pathQuery} onChange={(event) => setPathQuery(event.target.value)} placeholder="Filter by file path" aria-label="Filter by file path" className={`${fieldClass} mt-1 ${pathQuery.trim() ? 'border-[var(--color-accent)]' : 'border-[var(--color-border-strong)]'}`}/>
          </label>
          <label className="text-xs text-[var(--color-text-faint)] sm:w-36">
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter by severity" className={`${fieldClass} mt-1 ${severity !== 'all' ? 'border-[var(--color-accent)]' : 'border-[var(--color-border-strong)]'}`}>
              <option value="all">All severities</option>
              <option value="error">error</option>
              <option value="warning">warning</option>
            </select>
          </label>
          <label className="min-w-0 text-xs text-[var(--color-text-faint)] sm:w-56">
            Rule
            <select value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} aria-label="Filter by rule" className={`${fieldClass} mt-1 ${ruleQuery !== 'all' ? 'border-[var(--color-accent)]' : 'border-[var(--color-border-strong)]'}`}>
              <option value="all">All rules</option>
              {ruleIds.map((ruleId) => (<option key={ruleId} value={ruleId}>
                  {ruleId}
                </option>))}
            </select>
          </label>
          {filtersActive && (<Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>)}
        </div>
        {filtersActive && result.findings.length > 0 && (<p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Showing {formatNumber(filtered.length)} of {formatNumber(result.findings.length)} returned findings.
          </p>)}
      </div>

      {result.findings.length === 0 ? (<div className="mt-4">
          <EmptyState title="No static-analysis findings were detected." description="The analyzer returned no findings. That does not mean the repository has no bugs or no technical debt."/>
        </div>) : filtered.length === 0 ? (<div className="mt-4">
          <EmptyState title="No findings match these filters." description="The returned findings are unchanged." action={<Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>}/>
        </div>) : (<ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {filtered.map((finding) => {
                const place = locationText(finding);
                return (<li key={findingRouteId(finding)}>
                <Link to={`/issues/${findingRouteId(finding)}`} className="block py-3 transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)]">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${finding.severity === 'error' ? 'text-[var(--color-critical)]' : 'text-[var(--color-warning)]'}`}>
                      {finding.severity}
                    </span>
                    <span className="font-mono text-sm text-[var(--color-text)]">{finding.ruleId}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text)]">{finding.message}</p>
                  <p className="mt-1 break-all font-mono text-xs text-[var(--color-text-muted)]">{finding.path}</p>
                  {place && <p className="mt-0.5 text-xs text-[var(--color-text-faint)]">{place}</p>}
                </Link>
              </li>);
            })}
        </ul>)}
    </div>);
}
