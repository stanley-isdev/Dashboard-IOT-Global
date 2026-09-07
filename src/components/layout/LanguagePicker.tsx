import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';
import type { Lang } from '../../i18n/I18nProvider';

/**
 * The language switch: a "Language" capsule in the masthead that drops a menu
 * of the two locales.
 *
 * ## Why this is no longer a TH/EN tile pair
 *
 * It was, and the argument for the pair was that a lone button labelled with the
 * *other* language is indistinguishable from a label until you press it. That
 * argument holds against a one-button toggle and not against a menu: the trigger
 * here says what it opens rather than what it would do, which is the one label
 * that cannot be misread, and the choices are then spelled out in full.
 *
 * Spelled out in their own script, and never translated - `ไทย` and `English`,
 * the same two strings in both locales. An endonym is the only form a reader who
 * cannot read the current language can recognise, which is the whole population
 * this control exists for; "Thai" is no use to somebody who needs the Thai board.
 *
 * The trigger's visible text is the generic word, so its width does not change
 * when the locale does - it sits between a live badge whose age text is already
 * moving and a round button, and a capsule that resizes on selection drags both.
 * What the sighted reader loses (which language is in force, without opening it)
 * a screen reader must not, so the accessible name carries it: "Language:
 * English". The open menu carries it too - in `aria-checked`, and for the eye
 * in the row's weight. No tick disc, unlike the region and interval menus:
 * those are lists you scan for a mark, where this is two rows of which one is
 * always the board you are already reading, and a column of discs down a
 * two-row menu is furniture rather than information.
 *
 * ## Behaviour
 *
 * The same menu contract as RefreshPicker and RegionFilter - opens on click or
 * Arrow, focus lands on the checked row, Up/Down/Home/End move, Escape closes
 * and returns focus, Tab closes and lets focus leave, a pointer outside closes.
 * Three menus on one board that behave differently is three controls to learn.
 */

const LANGS: readonly Lang[] = ['th', 'en'];

/* Drawn in the same 16-unit box and at the same 1.8 stroke as StatusIcon and the
   theme switch, so the two icons in this corner sit at one optical weight. The
   meridian is an ellipse rather than an arc pair: a globe reads as a globe from
   one curved meridian and two parallels, and anything more turns to mud at 16px. */
const GLOBE = (
  <>
    <circle cx="8" cy="8" r="6.2" />
    <ellipse cx="8" cy="8" rx="2.6" ry="6.2" />
    <path d="M2.1 5.9h11.8M2.1 10.1h11.8" />
  </>
);

export function LanguagePicker() {
  const { t } = useI18n();
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const headId = useId();

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = itemsOf(menu.current);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    const items = itemsOf(menu.current);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  const pick = (choice: Lang) => {
    setLang(choice);
    close(true);
  };

  return (
    <div className="langpicker" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="langpicker__btn tap"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        /* The state the visible label leaves out - see the note above. */
        aria-label={`${t('lang.label')}: ${t(nameKey(lang))}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="langpicker__label">{t('lang.label')}</span>
        <span className="langpicker__chev" aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="langmenu"
          id={menuId}
          role="menu"
          aria-labelledby={headId}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          {/* The globe lives here rather than on the trigger. On the capsule it
              would be a second thing to read beside a word that already says
              the same; on the open panel it is what tells the eye, mid-scan,
              which of the menus dropping out of this corner it is looking at. */}
          <p className="langmenu__head" id={headId}>
            <svg
              className="langmenu__globe"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {GLOBE}
            </svg>
            {t('lang.label')}
          </p>

          {LANGS.map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={choice === lang}
              className="langmenu__opt"
              /* The locale's own script, whatever the board is currently set
                 to: `lang` on the element so the browser reaches for a Thai
                 face for the Thai row even on an English board. */
              lang={choice}
              tabIndex={-1}
              onClick={() => pick(choice)}
            >
              <span className="langmenu__label">{t(nameKey(choice))}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function nameKey(lang: Lang) {
  return lang === 'th' ? ('lang.th' as const) : ('lang.en' as const);
}

function itemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')) : [];
}
