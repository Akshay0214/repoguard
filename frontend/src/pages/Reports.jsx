import { useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';
import { ApiError } from '@/services/apiClient';
import { downloadAnalysisReport, downloadAnalysisReportHtml } from '@/services/repositoryService';
export function Reports() {
    const { currentAnalysis } = useAnalysis();
    const [jsonError, setJsonError] = useState(null);
    const [htmlError, setHtmlError] = useState(null);
    const [pending, setPending] = useState(null);
    if (!currentAnalysis) {
        return (<div>
        <PageIntro />
        <div className="mt-6">
          <EmptyState icon={<FolderGit2 size={20}/>} title="No repository selected" description="Use Analyze repository in the header. An export needs an analysis from this session."/>
        </div>
      </div>);
    }
    const exportJson = async () => {
        setJsonError(null);
        setPending('json');
        try {
            const report = await downloadAnalysisReport(currentAnalysis.analysisId);
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${currentAnalysis.repositoryName.replaceAll('/', '-')}-repoguard.json`;
            anchor.click();
            URL.revokeObjectURL(url);
        }
        catch (caught) {
            setJsonError(caught instanceof ApiError ? caught.message : 'The JSON export could not be downloaded.');
        }
        finally {
            setPending(null);
        }
    };
    const exportHtml = async () => {
        setHtmlError(null);
        setPending('html');
        try {
            const html = await downloadAnalysisReportHtml(currentAnalysis.analysisId);
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
        }
        catch (caught) {
            setHtmlError(caught instanceof ApiError ? caught.message : 'The HTML export could not be opened.');
        }
        finally {
            setPending(null);
        }
    };
    return (<div className="max-w-3xl">
      <PageIntro />
      <p className="mt-4 text-sm text-[var(--color-text-muted)]">Export analysis data.</p>

      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">JSON</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Downloads the stored analysis document: identity, overview, findings, dependencies, history, heuristic indicators, limitations, and a saved AI interpretation when one exists. This is an export, not a formal audit report. Tokens and API keys are not included.
        </p>
        <Button className="mt-3" size="sm" disabled={pending !== null} onClick={() => void exportJson()}>
          {pending === 'json' ? 'Exporting JSON…' : 'Export JSON'}
        </Button>
        {jsonError && <p role="alert" className="mt-2 text-sm text-[var(--color-critical)]">{jsonError}</p>}
      </section>

      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">HTML</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Opens a printable view of the same stored fields. This is an export, not a formal audit report.
        </p>
        <Button className="mt-3" size="sm" variant="secondary" disabled={pending !== null} onClick={() => void exportHtml()}>
          {pending === 'html' ? 'Opening HTML…' : 'Export HTML'}
        </Button>
        {htmlError && <p role="alert" className="mt-2 text-sm text-[var(--color-critical)]">{htmlError}</p>}
      </section>
    </div>);
}
function PageIntro() {
    return (<div>
      <h1 className="font-display text-xl font-semibold text-[var(--color-text)]">Reports</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-text-muted)]">Export the current repository analysis.</p>
    </div>);
}
