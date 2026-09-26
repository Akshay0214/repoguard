import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Upload, ScanSearch, LoaderCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { toCurrentAnalysis, useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { analyzeRepository } from '@/services/repositoryService';

type Source = 'github' | 'upload';

export function Analyze() {
  const navigate = useNavigate();
  const { setCurrentAnalysis } = useAnalysis();
  const [source, setSource] = useState<Source>('github');
  const [githubUrl, setGithubUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [githubToken, setGithubToken] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAnalyze = source === 'github' ? githubUrl.trim().length > 0 : Boolean(file);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0] ?? null;
    setFile(next);
  };

  const handleAnalyze = async () => {
    setError(null);
    setRunning(true);
    try {
      const job = await analyzeRepository({
        source,
        githubUrl,
        branch,
        githubToken: source === 'github' ? githubToken : undefined,
        file: file ?? undefined,
        fileName: file?.name,
      });
      setGithubToken('');
      setCurrentAnalysis(toCurrentAnalysis(job));
      navigate('/dashboard');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to start repository analysis. Please check the repository and try again.',
      );
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Analyze Repository"
        description="Create an analysis job from a public or private GitHub repository, or from a ZIP archive."
      />

      {!running && (
        <Card>
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-md bg-[var(--color-surface-2)] p-1">
            <button
              onClick={() => setSource('github')}
              className={cn(
                'flex items-center justify-center gap-2 rounded py-2 text-sm transition-colors',
                source === 'github' ? 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              <GitBranch size={14} /> GitHub URL
            </button>
            <button
              onClick={() => setSource('upload')}
              className={cn(
                'flex items-center justify-center gap-2 rounded py-2 text-sm transition-colors',
                source === 'upload' ? 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              <Upload size={14} /> Upload ZIP
            </button>
          </div>

          {source === 'github' ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Repository URL</label>
                <input
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/owner/repository"
                  className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Branch</label>
                <input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">
                  GitHub token for private repositories
                </label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  autoComplete="off"
                  placeholder="Optional. Not stored."
                  className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
                />
                <p className="mt-1.5 text-xs text-[var(--color-text-faint)]">
                  The token is sent once to the API and is not saved in the browser or the analysis record. Public repositories do not need one.
                </p>
              </div>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border-strong)] px-6 py-10 text-center hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]">
              <Upload size={22} className="text-[var(--color-text-faint)]" />
              <span className="text-sm text-[var(--color-text)]">{file ? file.name : 'Click to choose a .zip archive'}</span>
              <span className="text-xs text-[var(--color-text-faint)]">
                {file ? `${Math.ceil(file.size / 1024)} KB selected` : 'The archive is extracted on the server and analyzed with the same pipeline.'}
              </span>
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={handleFileChange} />
            </label>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-[var(--color-critical)]">
              {error}
            </p>
          )}

          <Button className="mt-6 w-full gap-2" size="lg" disabled={!canAnalyze || running} onClick={handleAnalyze}>
            <ScanSearch size={16} />
            Analyze Repository
          </Button>
        </Card>
      )}

      {running && (
        <Card>
          <div className="flex items-center gap-3">
            <LoaderCircle size={18} className="animate-spin text-[var(--color-accent)]" />
            <div>
              <h3 className="font-display text-sm font-semibold text-[var(--color-text)]">
                {source === 'upload' ? 'Uploading archive…' : 'Creating analysis job…'}
              </h3>
              <p className="mt-1 font-mono text-xs text-[var(--color-text-faint)]">
                {source === 'upload' ? file?.name : githubUrl}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-faint)]">
                The dashboard follows acquisition and analyzer status after the job is created.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
