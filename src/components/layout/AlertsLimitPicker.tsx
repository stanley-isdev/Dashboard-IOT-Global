import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { ALERT_LIMIT_CHOICES, useFilters } from '../../state/useFilters';

/**
 * The Top-N picker beside the longest-active-stops panel title.
 *
 * The panel used to hardcode "Top 10" into its own title, which named a count
 * the reader had no way to change. The number now lives in the URL alongside
 * every other filter (`alertsLimit`, see useFilters.ts) and this is its
 * control.
 *
 * Picking a number costs nothing and fetches nothing. `buildLongestActiveStops`
 * on the server still does the ranking, and the board always asks it for the
 * widest cut the choices below offer, so every row this picker can reveal is
 * already on the machine and already in the server's order - Top 50 is not
 * fifty rows padded out from ten. All that changes here is where the reader
 * stops. See ALERT_LIMIT_MAX in useFilters.ts for why it is fetched that way.
 */
export function AlertsLimitPicker() {
  const { t } = useI18n();
  const [filters, setFilters] = useFilters();

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

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

  const pick = (n: number) => {
    if (n !== filters.alertsLimit) setFilters({ alertsLimit: n });
    close(true);
  };

  return (
    <div className="toppicker" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="chip toppicker__trigger tap"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('alerts.topAria')}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {t('alerts.top', { n: filters.alertsLimit })}
        <span className="filter__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="regionmenu regionmenu--compact"
          id={menuId}
          role="menu"
          aria-label={t('alerts.topAria')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          {ALERT_LIMIT_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitemradio"
              aria-checked={n === filters.alertsLimit}
              className="regionmenu__opt"
              tabIndex={-1}
              onClick={() => pick(n)}
            >
              <span className="regionmenu__label">{t('alerts.top', { n })}</span>
              <span className="regionmenu__check" aria-hidden="true">
                {n === filters.alertsLimit ? '✓' : ''}
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
