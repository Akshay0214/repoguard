import { Settings as SettingsIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/States';

export function Settings() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="RepoGuard does not store account, repository, or analysis settings."
      />
      <EmptyState
        icon={<SettingsIcon size={20} />}
        title="Settings are not available yet"
        description="Nothing on this page is saved to a repository, an account, or the backend, and nothing here changes an analysis."
      />
    </div>
  );
}
