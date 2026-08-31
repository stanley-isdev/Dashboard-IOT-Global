import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppProvider, type AppContextValue } from './config/AppContext';
import { I18nProvider } from './i18n/I18nProvider';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { CompanyPage } from './pages/CompanyPage';
import { PlantPage } from './pages/PlantPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Routes mirror the hierarchy from section 3 - country, company, plant, zone,
 * machine - from company downward. Nesting plant under company keeps the
 * breadcrumb and the Back button honest, and avoids assuming plant codes are
 * unique across the group (6332 is a THS code; nothing guarantees SEH will not
 * reuse it).
 *
 * Zone is deliberately not a route. It is a grouping inside the plant page; a
 * fourth level of navigation for an executive view is a level too many.
 */
export function App({ context }: { context: AppContextValue }) {
  // One client for the page's lifetime. Created here rather than at module
  // scope so a test can mount the app twice without sharing a cache.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Each query sets its own polling; these are the floors.
            refetchOnWindowFocus: false,
            gcTime: Infinity,
          },
        },
      }),
  );

  return (
    <AppProvider value={context}>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="company/:companyCode" element={<CompanyPage />} />
                <Route path="company/:companyCode/plant/:plantCode" element={<PlantPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </I18nProvider>
      </QueryClientProvider>
    </AppProvider>
  );
}
