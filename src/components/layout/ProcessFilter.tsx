import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMeta } from '../../api/queries';
import type { Process } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { useFilters } from '../../state/useFilters';

/**
 * The Process filter - the plant board's `${process_var}`, and the last scope
 * difference between this board and that one.
 *
 * ## Why it had to become real
 *
 * It was a disabled chip that printed `Injection` while nothing filtered by
 * process at all, so the label named a scope the numbers did not have. Measured
 * 2026-08-27: THS 6332 has 26 `Injection` machines and 3 `Surface`
 * (`AF2`, `BP6`, `HC2`). The Lamp 2 board is `Injection`-scoped and shows none
 * of the three, so until this worked the two screens counted different machines
 * and the totals only agreed by coincidence.
 *
 * ## Single-select, unlike Region and Lamp
 *
 * The contract's `process` is one value or `all` (`zProcess`), because that is
 * how the operator board asks the question - one process at a time - and the
 * drill-down link this board hands the reader carries exactly one. A
 * multi-select here would produce scopes the drill-down could not follow.
 *
 * The list comes from `/meta`, not from a constant, for the same reason the
 * Region menu does: master data owns what exists, and a process nobody runs yet
 * should appear the day it is commissioned without a front-end release.
 */
export function ProcessFilter() {
  const { t } = useI18n();
  const [filters, setFilters] = useFilters();
  const meta = useMeta();

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const choices: (Process | 'all')[] = ['all', ...(meta.data?.processes ?? [])];

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

  const pick = (choice: Process | 'all') => {
    if (choice !== filters.process) setFilters({ process: choice });
    close(true);
  };

  const label = (p: Process | 'all') => (p === 'all' ? t('filter.all') : p);

  return (
    <div className="regionfilter" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="filter tap"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // Until master data lands there is nothing to choose from - the same
        // treatment the Region and Lamp menus give an empty list.
        disabled={choices.length <= 1}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="filter__key">{t('filter.process')}</span>
        <span className="filter__val">{label(filters.process)}</span>
        <span className="filter__caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <div
          className="refreshmenu"
          id={menuId}
          role="menu"
          aria-label={t('filter.process')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={c === filters.process}
              className="refreshmenu__opt"
              tabIndex={-1}
              onClick={() => pick(c)}
            >
              <span className="refreshmenu__label">{label(c)}</span>
              <span className="refreshmenu__check" aria-hidden="true">
                {c === filters.process ? '✓' : ''}
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
