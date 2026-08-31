import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useRefreshMs } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { REFRESH_CHOICES, usePrefs, type RefreshMs } from '../../state/prefsStore';

/**
 * The refresh control - Grafana's, deliberately.
 *
 * ## Why it looks like somebody else's control
 *
 * The plant board this dashboard is read beside has one, set to 5 s, and the
 * question that produced this component was "why does ours not keep up". Part of
 * the answer was real lag and got fixed behind the scenes (the %OA aggregate was
 * on a 30 s clock); the other part is that Grafana *shows* its interval and lets
 * you change it, so a reader can see that the screen is live rather than infer
 * it. Copying the affordance is cheaper than teaching a different one, and the
 * two screens now agree about what "5s" means.
 *
 * ## The button doubles as the manual refresh
 *
 * Left half re-fetches now, right half picks the interval - the same split
 * Grafana uses. "Refresh now" matters most in the one state the interval cannot
 * cover: with auto-refresh Off, which is a state somebody reading numbers into a
 * meeting actually wants.
 *
 * ## Why it spins
 *
 * `useIsFetching` rather than a local flag, so the spinner reflects every query
 * on the page - overview, company, plant - and not just the one this button
 * happened to trigger. A control that looks idle while the board is mid-fetch is
 * how a reader concludes it is frozen.
 */
export function RefreshPicker() {
  const { t } = useI18n();
  const refreshMs = useRefreshMs();
  const setRefreshMs = usePrefs((s) => s.setRefreshMs);
  const client = useQueryClient();
  const fetching = useIsFetching() > 0;

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) caret.current?.focus();
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

  /* Every active query, not just the overview: the reader pressed refresh on the
     board in front of them, whichever page that is. */
  const refreshNow = () => void client.refetchQueries({ type: 'active' });

  const pick = (choice: RefreshMs) => {
    setRefreshMs(choice);
    close(true);
    // Choosing an interval is also a request to be up to date now - waiting a
    // full cycle to see the effect makes the control feel broken.
    if (choice !== null) refreshNow();
  };

  return (
    <div className="refreshpicker" ref={wrap}>
      <button
        type="button"
        className="refreshpicker__now tap"
        onClick={refreshNow}
        title={t('refresh.now')}
        aria-label={t('refresh.now')}
      >
        <span
          className={fetching ? 'refreshpicker__icon is-spinning' : 'refreshpicker__icon'}
          aria-hidden="true"
        >
          ↻
        </span>
        <span className="refreshpicker__val">{label(refreshMs, t('refresh.off'))}</span>
      </button>

      <button
        ref={caret}
        type="button"
        className="refreshpicker__caret tap"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('refresh.interval')}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">▼</span>
      </button>

      {open ? (
        <div
          className="refreshmenu"
          id={menuId}
          role="menu"
          aria-label={t('refresh.interval')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          {REFRESH_CHOICES.map((choice) => (
            <button
              key={choice ?? 'off'}
              type="button"
              role="menuitemradio"
              aria-checked={choice === refreshMs}
              className="refreshmenu__opt"
              tabIndex={-1}
              onClick={() => pick(choice)}
            >
              <span className="refreshmenu__label">{label(choice, t('refresh.off'))}</span>
              <span className="refreshmenu__check" aria-hidden="true">
                {choice === refreshMs ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function itemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')) : [];
}

/**
 * `5s`, `10s`, `1m` - Grafana's spelling, and not localised.
 *
 * Deliberate, and the same rule the status names follow (see i18n/th.ts): these
 * are read against the other screen, and a reader holding both should not have
 * to map `1 นาที` onto `1m`. An interval is closer to a unit than to prose.
 *
 * A deployment-configured value that is not one of the choices still prints
 * correctly - `runtime-config.json` owns the default and is not obliged to pick
 * from this menu.
 */
function label(ms: RefreshMs, off: string): string {
  if (ms === null) return off;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}
