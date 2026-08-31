import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import './theme/components.css';
import './theme/leaflet-overrides.css';

import { App } from './App';
import { createApi } from './api/createApi';
import { loadRuntimeConfig } from './config/runtimeConfig';
import { applyBootPrefs } from './state/prefsStore';

/**
 * Boot.
 *
 * Config and the data adapter are resolved before React mounts, so no component
 * ever has to handle "the API does not exist yet". The cost is one round trip
 * to a small local JSON file; the benefit is that every downstream component
 * can treat `api` as a plain value.
 */
async function boot() {
  const { config, problem } = await loadRuntimeConfig();
  applyBootPrefs({
    defaultLang: config.defaultLang,
    defaultTheme: config.defaultTheme,
    kioskDefault: config.kioskDefault,
  });
  const api = await createApi(config);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App context={{ config, api, configProblem: problem }} />
    </StrictMode>,
  );
}

void boot();
