import { useEffect, useState } from 'react';
import { GitCommitHorizontal, History as HistoryIcon, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ApiError } from '@/services/apiClient';
import { getAnalysisGitHistory, type GitHistoryResult } from '@/services/repositoryService';

const POLL_MS = 2000;

function isPreparing(error: ApiError): boolean {
  return (
    error.status === 409 &&
    error.code === 'ACQUISITION_NOT_READY' &&
    error.message === 'Repository acquisition is not complete.'
  );
}

export function History() {
  const { currentAnalysis } = useAnalysis();
  const [result, setResult] = useState<GitHistoryResult | null>(null);
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
        const next = await getAnalysisGitHistory(currentAnalysis.analysisId);
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
    return (
      <div>
        <PageHeader
          title="Git history"
          description="Commits, authors, and file changes from the available Git history. These are repository evidence, not quality or risk scores."
        />
        <EmptyState
          icon={<HistoryIcon size={20} />}
          title="No repository selected"
          description="Start an analysis from the Analyze page. This view does not keep Git history after a reload."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Git history"
        description={`Git history evidence for ${currentAnalysis.repositoryName}. Counts describe the available clone.`}
      />

      {loading || preparing ? (
        <LoadingState label={preparing ? 'Preparing repository…' : 'Collecting Git history…'} />
      ) : error ? (
        <ErrorState
          title="Git history is unavailable"
          description={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            setReloadKey((value) => value + 1);
          }}
        />
      ) : result ? (
        <HistoryEvidence result={result} />
      ) : null}
    </div>
  );
}

function HistoryEvidence({ result }: { result: GitHistoryResult }) {
  const { summary } = result;
  const incomplete = summary.historyDepth === 'shallow' || !summary.isComplete;

  return (
    <div className="space-y-4">
      {incomplete && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Available history is incomplete</CardTitle>
              <CardDescription>
                {summary.historyDepth === 'shallow'
                  ? 'This history comes from a shallow clone. The commit count is the commits present in that clone, not the repository’s complete historical record.'
                  : 'This history is marked incomplete. The commit count is only the commits available to this analysis.'}
              </CardDescription>
            </div>
          </CardHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            Depth: {summary.historyDepth}. Complete record: {summary.isComplete ? 'yes' : 'no'}.
          </p>
          {summary.commitsWithoutFileDiff > 0 && (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {formatNumber(summary.commitsWithoutFileDiff)}{' '}
              {summary.commitsWithoutFileDiff === 1 ? 'commit has' : 'commits have'} no file diff because a parent commit is outside this clone.
            </p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Available commits" value={formatNumber(summary.availableCommits)} icon={GitCommitHorizontal} />
        <StatCard label="Authors" value={formatNumber(summary.uniqueAuthors)} icon={Users} />
        <StatCard label="File changes" value={formatNumber(summary.totalFileChanges)} />
        <StatCard label="Additions" value={formatNumber(summary.totalAdditions)} />
        <StatCard label="Deletions" value={formatNumber(summary.totalDeletions)} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Available range</CardTitle>
            <CardDescription>Oldest and newest commit timestamps in this result.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-2 text-sm text-[var(--color-text-muted)] sm:grid-cols-2">
          <p>Oldest: {summary.oldestAvailableCommitAt ? formatDateTime(summary.oldestAvailableCommitAt) : 'None reported'}</p>
          <p>Newest: {summary.newestAvailableCommitAt ? formatDateTime(summary.newestAvailableCommitAt) : 'None reported'}</p>
        </div>
      </Card>

      {result.errors.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>History notes</CardTitle>
              <CardDescription>Messages reported with this Git history result.</CardDescription>
            </div>
          </CardHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-[var(--color-text-muted)]">
            {result.errors.map((item) => (
              <li key={item.message}>{item.message}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Commits</CardTitle>
            <CardDescription>
              {summary.availableCommits === 0
                ? 'No commits were reported in the available history.'
                : summary.availableCommits === 1
                  ? '1 commit in the available history.'
                  : `${formatNumber(summary.availableCommits)} commits in the available history.`}
            </CardDescription>
          </div>
        </CardHeader>
        {result.commits.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No commits were reported.</p>
        ) : (
          <div className="max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto">
            {result.commits.map((commit) => (
              <div key={commit.hash} className="py-3">
                <p className="text-sm text-[var(--color-text)]">{commit.subject || 'No subject reported'}</p>
                <p className="mt-1 font-mono text-xs text-[var(--color-text-faint)]">{commit.hash}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {commit.author} · {formatDateTime(commit.timestamp)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Authors in the available history</CardTitle>
              <CardDescription>Commit counts are how many available commits name that author.</CardDescription>
            </div>
          </CardHeader>
          {result.authors.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No authors were reported.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {result.authors.map((author) => (
                <div key={author.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-[var(--color-text)]">{author.name}</span>
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatNumber(author.commits)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Most changed files by commit count</CardTitle>
              <CardDescription>
                Commit count is how many available commits touch the file. It is not a quality or risk score. The analyzer returns at most 20 files.
              </CardDescription>
            </div>
          </CardHeader>
          {result.mostChangedFiles.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No file changes were recorded in the available history.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {result.mostChangedFiles.map((file) => (
                <div key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate font-mono text-xs text-[var(--color-text)]">{file.path}</span>
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatNumber(file.commitCount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
