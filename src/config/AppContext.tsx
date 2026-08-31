import { createContext, use, type ReactNode } from 'react';
import type { DashboardApi } from '../api/DashboardApi';
import type { RuntimeConfig } from './runtimeConfig';

/**
 * Config and the data adapter, resolved once during boot and then constant for
 * the life of the page.
 *
 * Both are created before React mounts (see main.tsx) rather than inside an
 * effect, so no component ever has to cope with "the API does not exist yet".
 */

export interface AppContextValue {
  config: RuntimeConfig;
  api: DashboardApi;
  /** Set when runtime-config.json was missing or invalid and defaults are in use. */
  configProblem: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}) {
  return <AppContext value={value}>{children}</AppContext>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context + hook co-located deliberately; see file header
export function useApp(): AppContextValue {
  const ctx = use(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components -- same as useApp above
export function useConfig(): RuntimeConfig {
  return useApp().config;
}

// eslint-disable-next-line react-refresh/only-export-components -- same as useApp above
export function useApi(): DashboardApi {
  return useApp().api;
}
