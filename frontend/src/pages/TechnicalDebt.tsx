import { Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/States';
import { useAnalysis } from '@/context/analysisState';

export function TechnicalDebt() {
  const { currentAnalysis } = useAnalysis();

  return (
    <div>
      <PageHeader
        title="Technical Debt"
        description="Technical-debt measurement is not part of the current analysis."
      />
      <EmptyState
        icon={<Landmark size={20} />}
        title="Technical debt is not available yet"
        description={
          currentAnalysis
            ? `No debt hours or hotspots are calculated for ${currentAnalysis.repositoryName}. Static findings stay on the Issues page and are not labeled as debt.`
            : 'No repository is selected. This page does not show sample debt hours or hotspots.'
        }
      />
    </div>
  );
}
