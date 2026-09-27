import { Link } from 'react-router-dom';
import {
  ScanSearch,
  GitBranch,
  Network,
  Bug,
  FileCode2,
  History,
  ArrowRight,
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';

const CAPABILITIES = [
  {
    icon: FileCode2,
    title: 'Code structure',
    body: 'AST analysis reports files, functions, classes, and parse errors. Nesting depth is structural, not a quality score.',
  },
  {
    icon: Bug,
    title: 'Fixed-rule static analysis',
    body: 'A fixed rule set reports findings with file, line, and rule. Parse, execution, and limit issues stay separate from findings.',
  },
  {
    icon: Network,
    title: 'Dependency relationships',
    body: 'Imports are classified as internal, external, or unresolved. An unresolved import is not reported as a bug.',
  },
  {
    icon: History,
    title: 'Git history',
    body: 'History records commits, authors, and file changes. A shallow clone is reported as incomplete history.',
  },
];

const WORKFLOW = [
  {
    icon: GitBranch,
    title: 'Submit a GitHub repository',
    body: 'Start from a public GitHub URL and branch. ZIP upload is not available.',
  },
  {
    icon: ScanSearch,
    title: 'Collect repository evidence',
    body: 'Structure, static analysis, dependencies, and Git history run from the cloned repository.',
  },
  {
    icon: Bug,
    title: 'Explore static findings',
    body: 'The issue list shows findings from the fixed rule set, with file, line, rule, and message.',
  },
  {
    icon: FileCode2,
    title: 'Read an AI interpretation',
    body: 'A file-level interpretation explains the evidence already collected. It does not replace that evidence or apply fixes.',
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo size={24} />
        <nav className="flex items-center gap-3">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:flex"
          >
            <GitBranch size={15} />
            GitHub
          </a>
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">Open Dashboard</Button>
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-6 pt-14 text-center sm:pt-20">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
          Repository evidence and AI-assisted interpretation
        </div>
        <h1 className="text-balance font-display text-4xl font-bold leading-[1.1] text-[var(--color-text)] sm:text-5xl">
          Read a repository
          <br />
          from the evidence.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-balance text-base leading-relaxed text-[var(--color-text-muted)]">
          RepoGuard clones a GitHub repository, collects structure, static findings, dependency
          relationships, and Git history, then lets you explore those findings and read an
          AI interpretation of the evidence.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/analyze">
            <Button size="lg" className="gap-2">
              <ScanSearch size={16} />
              Analyze Repository
            </Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="secondary" size="lg" className="gap-2">
              Open Dashboard
              <ArrowRight size={15} />
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-12 text-center">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">What an analysis collects</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--color-text-muted)]">
            Analyzer results are evidence. Heuristic indicators and AI text are labeled separately and are not validated quality scores.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Icon size={17} />
              </span>
              <h3 className="mt-4 font-display text-sm font-semibold text-[var(--color-text)]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-bg-raised)]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="mb-12 text-center">
            <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">How an analysis is used</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--color-text-muted)]">
              From a GitHub URL to findings and a file-level interpretation.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="relative">
                {i < WORKFLOW.length - 1 && (
                  <div className="absolute right-[-14px] top-5 hidden h-px w-6 bg-[var(--color-border-strong)] lg:block" />
                )}
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
                  <Icon size={16} />
                </span>
                <h3 className="mt-4 font-display text-sm font-semibold text-[var(--color-text)]">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-balance font-display text-2xl font-semibold text-[var(--color-text)] sm:text-3xl">
          Start from a GitHub repository.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-[var(--color-text-muted)]">
          Dashboard, findings, dependencies, Git history, technical-debt indicators, and reports use the analysis you start. AI text is an interpretation of that evidence.
        </p>
        <div className="mt-7">
          <Link to="/analyze">
            <Button size="lg" className="gap-2">
              <ScanSearch size={16} />
              Analyze Repository
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <Logo size={18} />
          <p className="text-xs text-[var(--color-text-faint)]">
            B.Tech final year project — repository evidence and AI-assisted interpretation
          </p>
        </div>
      </footer>
    </div>
  );
}
