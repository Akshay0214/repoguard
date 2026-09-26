import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnalysisProvider } from '@/context/AnalysisContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { Analyze } from '@/pages/Analyze';
import { Issues } from '@/pages/Issues';
import { IssueDetail } from '@/pages/IssueDetail';
import { TechnicalDebt } from '@/pages/TechnicalDebt';
import { Dependencies } from '@/pages/Dependencies';
import { History } from '@/pages/History';
import { Settings } from '@/pages/Settings';
import { NotFound } from '@/pages/NotFound';

export default function App() {
  return (
    <AnalysisProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />

          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/issues/:id" element={<IssueDetail />} />
            <Route path="/technical-debt" element={<TechnicalDebt />} />
            <Route path="/dependencies" element={<Dependencies />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AnalysisProvider>
  );
}
