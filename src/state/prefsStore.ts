import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../i18n/I18nProvider';
import type { ThemePref } from '../config/runtimeConfig';

/**
 * Viewer preferences - language, theme, kiosk density, and how timestamps are
 * anchored.
 *
 * These are preferences, not locations, so they live here and not in the URL.
 * Filters go the other way: they belong in the query string so a view can be
 * bookmarked, shared, and pointed at from a kiosk shortcut.
 *
 * All three still accept a one-shot URL override (`?lang=en&theme=dark&kiosk=1`),
 * which is how a wall panel gets configured with a single bookmark. That
 * override applies for the session and is not written back to localStorage -
 * otherwise a colleague opening the kiosk URL once would find their own browser
 * stuck in kiosk mode.
 */

export type TimeMode = 'site_local' | 'reference';

/**
 * Resolved, never 'system'. The moon/sun switch in the masthead is a two-state
 * control and has to be able to show which state it is in, so the store holds
 * the answer rather than the question; `resolveTheme` below is where a site's
 * `defaultTheme: 'system'` becomes one of these, once, at boot.
 */
export type Theme = 'light' | 'dark';

/**
 * How often the board re-reads the API, in milliseconds, or `null` for off -
 * the same control Grafana puts beside its time picker, and deliberately the
 * same set of choices.
 *
 * It is a preference rather than a filter: it changes how the viewer watches the
 * board, not what the board is showing, so it does not belong in a URL somebody
 * shares. A kiosk still gets it, because it persists per browser.
 *
 * `null` (Off) is a real answer: somebody reading the numbers into a meeting
 * does not want the row moving under them mid-sentence.
 */
export type RefreshMs = number | null;

/**
 * Grafana's list, trimmed to what this board can honour.
 *
 * Nothing below 5 s, and that is a constraint rather than taste: the backend
 * polls InfluxDB every `SNAPSHOT_INTERVAL_MS` (2 s) and the UI's freeze
 * detector calls the feed frozen after three identical payloads, so a client
 * that outruns the poller raises a false alarm on a healthy system. 5 s is also
 * exactly what the plant board next to it is set to.
 *
 * Nothing above 5 m either: the longer end of Grafana's list (1 h, 1 d) is for
 * dashboards nobody is watching, and this one is on a wall.
 */
export const REFRESH_CHOICES: readonly RefreshMs[] = [null, 5_000, 10_000, 30_000, 60_000, 300_000];

interface PrefsState {
  lang: Lang;
  theme: Theme;
  kiosk: boolean;
  timeMode: TimeMode;
  /** `undefined` means "not chosen" - the deployment's runtime-config wins. */
  refreshMs: RefreshMs | undefined;
  setRefreshMs: (refreshMs: RefreshMs) => void;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setKiosk: (kiosk: boolean) => void;
  toggleKiosk: () => void;
  setTimeMode: (mode: TimeMode) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      lang: 'th',
      theme: 'light',
      kiosk: false,
      timeMode: 'site_local',
      refreshMs: undefined,
      setRefreshMs: (refreshMs) => set({ refreshMs }),
      setLang: (lang) => set({ lang }),
      toggleLang: () => set((s) => ({ lang: s.lang === 'th' ? 'en' : 'th' })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setKiosk: (kiosk) => set({ kiosk }),
      toggleKiosk: () => set((s) => ({ kiosk: !s.kiosk })),
      setTimeMode: (timeMode) => set({ timeMode }),
    }),
    {
      name: 'osnp.prefs',
      // timeMode is deliberately not persisted: it changes how timestamps read,
      // and a viewer returning tomorrow should start from the honest default of
      // each site's own clock.
      // `refreshMs` persists, unlike timeMode: a wall panel set to 30 s should
      // still be on 30 s after a power cut, and somebody who turned refresh Off
      // to read the board aloud has not asked for it back.
      partialize: (s) => ({
        lang: s.lang,
        theme: s.theme,
        kiosk: s.kiosk,
        refreshMs: s.refreshMs,
      }),
    },
  ),
);

/**
 * A site's `defaultTheme` reduced to a theme that exists.
 *
 * 'system' is honoured once, at boot, and then forgotten. Following the OS live
 * would fight the switch: a board somebody deliberately set to light would flip
 * itself at dusk on any laptop with automatic appearance turned on, and a wall
 * panel would change theme on a schedule nobody configured here. So the OS gets
 * to pick the *first* value for a viewer who has expressed no preference, and
 * the switch owns it from then on.
 */
export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies `?lang=`, `?theme=` and `?kiosk=` once at boot, and seeds language and
 * theme from runtime config when the viewer has no stored preference yet.
 */
export function applyBootPrefs(opts: {
  defaultLang: Lang;
  defaultTheme: ThemePref;
  kioskDefault: boolean;
}): void {
  const params = new URLSearchParams(window.location.search);
  const stored = localStorage.getItem('osnp.prefs');

  const urlLang = params.get('lang');
  const urlTheme = params.get('theme');
  const urlKiosk = params.get('kiosk');

  const state = usePrefs.getState();

  if (urlLang === 'th' || urlLang === 'en') {
    state.setLang(urlLang);
  } else if (!stored) {
    state.setLang(opts.defaultLang);
  }

  /*
   * The stored-preference check is the whole point of the `stored` guard here:
   * `defaultTheme` is the site's opening position, not its policy. Re-applying
   * it on every load would make the masthead switch look broken - it would work,
   * and then undo itself on the next refresh.
   */
  if (urlTheme === 'light' || urlTheme === 'dark' || urlTheme === 'system') {
    state.setTheme(resolveTheme(urlTheme));
  } else if (!stored) {
    state.setTheme(resolveTheme(opts.defaultTheme));
  }

  if (urlKiosk !== null) {
    state.setKiosk(urlKiosk !== '0' && urlKiosk !== 'false');
  } else if (!stored && opts.kioskDefault) {
    state.setKiosk(true);
  }
}
