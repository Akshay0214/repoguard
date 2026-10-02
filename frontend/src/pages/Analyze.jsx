import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ScanSearch, LoaderCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toCurrentAnalysis, useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { analyzeRepository } from '@/services/repositoryService';
export function Analyze() {
    const navigate = useNavigate();
    const { setCurrentAnalysis } = useAnalysis();
    const [source, setSource] = useState('github');
    const [githubUrl, setGithubUrl] = useState('');
    const [branch, setBranch] = useState('main');
    const [githubToken, setGithubToken] = useState('');
    const [file, setFile] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);
    const acceptZip = (next) => {
        if (!next)
            return;
        const isZip = next.name.toLowerCase().endsWith('.zip') || next.type === 'application/zip' || next.type === 'application/x-zip-compressed';
        if (!isZip) {
            setFile(null);
            setError('Choose a .zip archive.');
            return;
        }
        setError(null);
        setFile(next);
    };
    const handleFileChange = (e) => {
        acceptZip(e.target.files?.[0] ?? null);
    };
    const handleAnalyze = async (nextSource) => {
        setSource(nextSource);
        setError(null);
        setRunning(true);
        try {
            const job = await analyzeRepository({
                source: nextSource,
                githubUrl,
                branch,
                githubToken: nextSource === 'github' ? githubToken : undefined,
                file: file ?? undefined,
                fileName: file?.name,
            });
            setGithubToken('');
            setCurrentAnalysis(toCurrentAnalysis(job));
            navigate('/dashboard');
        }
        catch (caught) {
            setError(caught instanceof ApiError
                ? caught.message
                : 'Unable to start repository analysis. Please check the repository and try again.');
            setRunning(false);
        }
    };
    return (<div>
      <PageHeader title="Analyze a repository" description="Analyze source structure, static findings, dependencies, Git history, technical-debt indicators, and AI-assisted interpretations."/>

      {!running && (<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-display text-sm font-semibold text-[var(--color-text)]">GitHub repository</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Public repositories do not need a token.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Repository URL</label>
                <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/owner/repository" className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"/>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">Branch</label>
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"/>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">
                  GitHub token for private repositories
                </label>
                <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} autoComplete="off" placeholder="Optional. Not stored." className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"/>
                <p className="mt-1.5 text-xs text-[var(--color-text-faint)]">
                  The token is sent once to the API and is not saved in the browser or the analysis record. Public repositories do not need one.
                </p>
              </div>
            </div>
              <Button className="mt-4 w-full gap-2" disabled={githubUrl.trim().length === 0 || running} onClick={() => void handleAnalyze('github')}>
                <ScanSearch size={16}/>
                Analyze repository
              </Button>
          </Card>
          <Card>
            <h2 className="font-display text-sm font-semibold text-[var(--color-text)]">ZIP upload</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">The archive is extracted on the server and analyzed with the same pipeline.</p>
            <label className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center ${dragOver ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]' : 'border-[var(--color-border-strong)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]'}`} onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
            }} onDragLeave={() => setDragOver(false)} onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                acceptZip(event.dataTransfer.files?.[0] ?? null);
            }}>
              <Upload size={22} className="text-[var(--color-text-faint)]"/>
              <span className="text-sm text-[var(--color-text)]">{file ? file.name : 'Drop a repository ZIP here'}</span>
              <span className="text-xs text-[var(--color-text-faint)]">{file ? `${Math.ceil(file.size / 1024)} KB` : 'or choose a file'}</span>
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={handleFileChange}/>
            </label>
            {file && (<button type="button" className="mt-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => setFile(null)}>
                Remove file
              </button>)}
            <Button className="mt-4 w-full gap-2" variant="secondary" disabled={!file || running} onClick={() => void handleAnalyze('upload')}>
              <Upload size={16}/>
              Analyze ZIP
            </Button>
          </Card>
        </div>)}
      {error && !running && (<p role="alert" className="mt-4 text-sm text-[var(--color-critical)]">{error}</p>)}

      {running && (<Card>
          <div className="flex items-center gap-3">
            <LoaderCircle size={18} className="animate-spin text-[var(--color-accent)]"/>
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
        </Card>)}
    </div>);
}
