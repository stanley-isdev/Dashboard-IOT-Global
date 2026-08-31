import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { en, type Dict, type TKey } from './en';
import { th } from './th';
import { usePrefs } from '../state/prefsStore';
import { interpolate, interpolateNodes } from './interpolate';

export type Lang = 'th' | 'en';

const DICTS: Record<Lang, Dict> = { en, th };

export type TFunction = (key: TKey, params?: Record<string, string | number>) => string;
export type TNodeFunction = (key: TKey, params: Record<string, ReactNode>) => ReactNode;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
  tNode: TNodeFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);

  /*
   * `lang` on <html> drives two things beyond screen readers: the Thai
   * line-height override in tokens.css (Thai stacks tone marks above and
   * vowels below the baseline, and the mockup's tight leading clips them), and
   * the browser's own font fallback for Thai codepoints.
   */
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback<TFunction>(
    (key, params) => interpolate(DICTS[lang][key] ?? en[key] ?? key, params),
    [lang],
  );

  const tNode = useCallback<TNodeFunction>(
    (key, params) => interpolateNodes(DICTS[lang][key] ?? en[key] ?? key, params),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, tNode }), [lang, setLang, t, tNode]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context + hook co-located deliberately
export function useI18n(): I18nValue {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience for the common case. */
// eslint-disable-next-line react-refresh/only-export-components -- same as useI18n above
export function useT(): TFunction {
  return useI18n().t;
}
