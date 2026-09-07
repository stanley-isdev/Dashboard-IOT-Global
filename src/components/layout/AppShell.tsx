import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import type { ConnectionInfo } from '../../domain/connectionState';
import { useApp } from '../../config/AppContext';
import { detectDevice } from '../../config/device';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';
import { ConfigProblemBanner } from '../feedback/ConnectionBanner';
import { TopBar } from './TopBar';

/**
 * The frame every page sits in: brand, filters, freshness badge, and the
 * banners that apply to the whole view rather than one panel.
 *
 * The freshness badge lives above the router outlet but is derived from
 * whichever page is loaded, so pages publish their connection state upward
 * through this small context rather than each rendering their own badge in a
 * slightly different place.
 */

interface ShellState {
  setConnection: (info: ConnectionInfo) => void;
}

const ShellContext = createContext<ShellState | null>(null);

const IDLE: ConnectionInfo = {
  state: 'cold',
  ageSec: null,
  snapshotAt: null,
  degraded: true,
  downSources: [],
  errorKind: null,
};

export function AppShell() {
  const { t } = useI18n();
  const { configProblem } = useApp();
  const kiosk = usePrefs((s) => s.kiosk);
  const theme = usePrefs((s) => s.theme);
  const [connection, setConnectionState] = useState<ConnectionInfo>(IDLE);

  /*
   * Device class is one attribute on <html>, resolved once. It never changes
   * for the lifetime of the page - an iPad does not become a desktop - so
   * unlike density below there is nothing to listen to.
   */
  useEffect(() => {
    document.documentElement.dataset.device = detectDevice();
  }, []);

  /*
   * Theme is a third attribute on <html>, and every colour token keys off it.
   * One line, because that is the entire mechanism: tokens.css defines the dark
   * palette under `:root[data-theme='dark']` and no component knows which theme
   * it is being drawn in.
   *
   * The switch that sets it is in the masthead; the first value comes from the
   * viewer's stored preference, `?theme=`, or the site's `defaultTheme` (see
   * applyBootPrefs). index.html writes the same attribute from localStorage
   * before this bundle parses, so a returning viewer never sees the other theme
   * flash past - this effect is what keeps it in step afterwards.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /*
   * Density is a second attribute, and every size token keys off it. Kiosk is
   * chosen explicitly; a very wide viewport also implies it, because a 4K panel
   * in a meeting room is a TV whether or not anyone passed ?kiosk=1.
   *
   * The width rule is skipped on an iPad. Stage Manager and an external display
   * can hand an iPad a viewport wider than the threshold, and blowing the type
   * up to wall-panel size on a tablet somebody is holding is the opposite of
   * what the rule is for.
   */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 2560px)');
    const apply = () => {
      const wide = mq.matches && document.documentElement.dataset.device !== 'ipad';
      document.documentElement.dataset.density = kiosk || wide ? 'tv' : 'desktop';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [kiosk]);

  // `K` toggles the wall-panel view. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'k' || e.key === 'K') usePrefs.getState().toggleKiosk();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shell = useMemo<ShellState>(
    () => ({
      setConnection: setConnectionState,
    }),
    [],
  );

  return (
    <ShellContext value={shell}>
      {/*
       * `.app` is a fixed-height flex column: the header and any shell-level
       * banner are intrinsic, and the outlet takes everything left over. That is
       * what lets the overview land inside one viewport with no page scrollbar -
       * a banner appearing shortens the board row instead of pushing it off the
       * bottom of the screen.
       */}
      <div className="app">
        <a className="skip-link" href="#main">
          {t('nav.skip')}
        </a>

        <TopBar connection={connection} />

        {configProblem ? <ConfigProblemBanner problem={configProblem} /> : null}

        <main id="main">
          <Outlet />
        </main>
      </div>
    </ShellContext>
  );
}

/** Publishes a page's connection state to the shell's badge. */
// eslint-disable-next-line react-refresh/only-export-components -- context + hook co-located deliberately
export function useShellConnection(info: ConnectionInfo): void {
  const shell = use(ShellContext);
  useEffect(() => {
    shell?.setConnection(info);
    // Comparing on the fields that actually change avoids re-publishing on
    // every one-second clock tick.
  }, [shell, info.state, info.ageSec, info.degraded]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ShellProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
