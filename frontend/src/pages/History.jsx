import { useEffect, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ApiError } from '@/services/apiClient';
import { getAnalysisGitHistory } from '@/services/repositoryService';
const POLL_MS = 2000;
function isPreparing(error) {
    return (error.status === 409 &&
        error.code === 'ACQUISITION_NOT_READY' &&
        error.message === 'Repository acquisition is not complete.');
}
export function History() {
    const { currentAnalysis } = useAnalysis();
    const [result, setResult] = useState(null);
    const [preparing, setPreparing] = useState(false);
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
                const next = await getAnalysisGitHistory(currentAnalysis.analysisId);
                if (cancelled)
                    return;
                setResult(next);
                setPreparing(false);
                setError(null);
                setLoading(false);
            }
            catch (caught) {
                if (cancelled)
                    return;
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
                setError(caught instanceof ApiError ? caught.message : 'Git history could not be loaded.');
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
        <PageHeader title="Git History" description="Commits, authors, and file changes from the available Git history. These are repository evidence, not quality or risk scores."/>
        <EmptyState icon={<HistoryIcon size={20}/>} title="No repository selected" description="Start an analysis from the Analyze page. This view does not keep Git history after a reload."/>
      </div>);
    }
    const historyDescription = result
        ? result.summary.historyDepth === 'shallow'
            ? 'Shallow history · limited historical evidence'
            : result.summary.historyDepth === 'limited'
                ? 'Limited history · the configured commit or file cap was reached'
                : result.summary.isComplete
                    ? 'Complete recorded history for this branch.'
                    : 'Incomplete history · limited historical evidence'
        : `Git history evidence for ${currentAnalysis.repositoryName}. Counts describe the available clone.`;
    return (<div>
      <PageHeader title="Git History" description={historyDescription}/>

      {loading || preparing ? (<LoadingState label={preparing ? 'Preparing repository…' : 'Collecting Git history…'}/>) : error ? (<ErrorState title="Git history is unavailable" description={error} onRetry={() => {
                setLoading(true);
                setError(null);
                setReloadKey((value) => value + 1);
            }}/>) : result ? (<HistoryEvidence result={result}/>) : null}
    </div>);
}
function HistoryEvidence({ result }) {
    const { summary } = result;
    const shallow = summary.historyDepth === 'shallow';
    const missingDiffs = summary.commitsWithoutFileDiff > 0;
    const recordedChangesAreZero = summary.totalFileChanges === 0 && summary.totalAdditions === 0 && summary.totalDeletions === 0;
    return (<div>
      {shallow && (<p className="text-sm text-[var(--color-text-muted)]">
          This repository was analyzed from a shallow clone, so the available history is incomplete.
        </p>)}
      {summary.historyDepth === 'limited' && (<p className="text-sm text-[var(--color-text)]">
          {formatNumber(summary.availableCommits)} / {formatNumber(summary.cloneCommitCount)} commits analyzed. History was truncated at the configured limit.
        </p>)}
      {!shallow && summary.historyDepth !== 'limited' && !summary.isComplete && (<p className="text-sm text-[var(--color-text)]">
          This history is marked incomplete. The commit count is only the commits available to this analysis.
        </p>)}

      <section className="mt-4 border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Available history</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-xs text-[var(--color-text-faint)]">Commits</dt>
            <dd className="mt-0.5 font-mono text-sm text-[var(--color-text)]">{formatNumber(summary.availableCommits)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-faint)]">Authors</dt>
            <dd className="mt-0.5 font-mono text-sm text-[var(--color-text)]">{formatNumber(summary.uniqueAuthors)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">File-change statistics</h2>
        {(shallow || missingDiffs) && (<p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Historical file changes are incomplete because the parent commit is outside this clone.
          </p>)}
        {(shallow || missingDiffs) && recordedChangesAreZero && (<p className="mt-1 max-w-2xl text-sm text-[var(--color-text)]">
            A zero here does not mean the repository had no changes.
          </p>)}
        <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2">
            <dt className="text-xs text-[var(--color-text-faint)]">File changes recorded</dt>
            <dd className="mt-0.5 font-mono text-sm text-[var(--color-text-muted)]">{formatNumber(summary.totalFileChanges)}</dd>
          </div>
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2">
            <dt className="text-xs text-[var(--color-text-faint)]">Additions recorded</dt>
            <dd className="mt-0.5 font-mono text-sm text-[var(--color-text-muted)]">{formatNumber(summary.totalAdditions)}</dd>
          </div>
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2">
            <dt className="text-xs text-[var(--color-text-faint)]">Deletions recorded</dt>
            <dd className="mt-0.5 font-mono text-sm text-[var(--color-text-muted)]">{formatNumber(summary.totalDeletions)}</dd>
          </div>
        </dl>
      </section>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">Historical range</summary>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Oldest: {summary.oldestAvailableCommitAt ? formatDateTime(summary.oldestAvailableCommitAt) : 'None reported'}
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Newest: {summary.newestAvailableCommitAt ? formatDateTime(summary.newestAvailableCommitAt) : 'None reported'}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">
          Depth: {summary.historyDepth}. Complete record: {summary.isComplete ? 'yes' : 'no'}.
        </p>
      </details>

      {result.errors.length > 0 && (<details className="mt-4">
          <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">
            History notes ({formatNumber(result.errors.length)})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-[var(--color-text-muted)]">
            {result.errors.map((item) => (<li key={item.message}>{item.message}</li>))}
          </ul>
        </details>)}

      <section className="mt-5 border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Commits</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {summary.availableCommits === 0
            ? 'No commits were reported in the available history.'
            : `${formatNumber(result.commits.length)} shown from the available history.`}
        </p>
        {result.commits.length === 0 ? (<p className="mt-3 text-sm text-[var(--color-text-muted)]">No commits were reported.</p>) : (<div className="mt-2 max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto border-y border-[var(--color-border)]">
            {result.commits.map((commit) => (<div key={commit.hash} className="py-3">
                <p className="text-sm text-[var(--color-text)]">{commit.subject || 'No subject reported'}</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--color-text-faint)]">{commit.hash}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {commit.author} · {formatDateTime(commit.timestamp)}
                </p>
              </div>))}
          </div>)}
      </section>

      <section className="mt-5 border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Authors</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Commit counts are how many available commits name that author.</p>
        {result.authors.length === 0 ? (<p className="mt-3 text-sm text-[var(--color-text-muted)]">No authors were reported.</p>) : (<ul className="mt-2 max-h-72 divide-y divide-[var(--color-border)] overflow-y-auto border-y border-[var(--color-border)]">
            {result.authors.map((author) => (<li key={author.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--color-text)]">{author.name}</span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatNumber(author.commits)}</span>
              </li>))}
          </ul>)}
      </section>

      <section className="mt-5 border-t border-[var(--color-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Most changed files</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Commit count is how many available commits touch the file. It is not a quality or risk score. The analyzer returns at most 20 files.
        </p>
        {result.mostChangedFiles.length === 0 ? (<p className="mt-3 text-sm text-[var(--color-text-muted)]">
            {shallow || missingDiffs
                ? 'No file changes were recorded in the available history. That does not mean the repository had no changes.'
                : 'No file changes were recorded in the available history.'}
          </p>) : (<ul className="mt-2 max-h-72 divide-y divide-[var(--color-border)] overflow-y-auto border-y border-[var(--color-border)]">
            {result.mostChangedFiles.map((file) => (<li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-mono text-xs text-[var(--color-text)]">{file.path}</span>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatNumber(file.commitCount)}</span>
              </li>))}
          </ul>)}
      </section>

      {result.files.length > 0 && (<details className="mt-6">
          <summary className="cursor-pointer text-sm text-[var(--color-text-muted)]">
            File history details ({formatNumber(result.files.length)})
          </summary>
          <ul className="mt-2 max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto border-y border-[var(--color-border)]">
            {result.files.map((file) => (<li key={file.path} className="py-2">
                <p className="break-all font-mono text-xs text-[var(--color-text)]">{file.path}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {formatNumber(file.commitCount)} commits · {formatNumber(file.additions)} additions · {formatNumber(file.deletions)} deletions
                </p>
              </li>))}
          </ul>
        </details>)}
    </div>);
}
