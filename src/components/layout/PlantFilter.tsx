import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMeta } from '../../api/queries';
import { formatRegions, parseRegions, regionMatcher, type Meta } from '../../api/contract';
import { useI18n, type TFunction } from '../../i18n/I18nProvider';
import { useFilters, useFilterSearch } from '../../state/useFilters';

/**
 * The Lamp filter - the plant level, one below Region.
 *
 * ## Why it exists
 *
 * The operator boards on the wall are scoped to one plant (`Lamp_var`), and
 * this board is scoped to a company. Until this control existed there was no way
 * to put the two side by side, so a reader comparing them saw "THS 30" against
 * "Lamp 2: 29" and read it as a bug. It is not: measured 2026-08-27, THS is
 * plant 6332 (29 machines) plus 6338 (1). Picking `Lamp 2` here makes the two
 * screens answer the same question, and then they agree.
 *
 * ## Why it is its own control and not part of the Region menu
 *
 * A plant belongs to exactly one company, so nesting it would work - and would
 * make the common case worse. "Which base" and "which Lamp" are separate
 * thoughts, asked in separate sentences, and a reader who wants Lamp 2 should
 * not have to expand THS to find it. The two filters intersect, so Region=TH
 * plus Lamp=6332 is the one plant.
 *
 * ## Why the choices narrow with the region above
 *
 * The list is the lamps of the companies Region has left on the board, not
 * every lamp in the group. Scoped to Thailand this menu was still reading
 * "All - 6 lamps" with Japan's `STJ-1` ticked under it: a control naming a
 * scope the numbers behind it do not have, which is the mistake
 * ProcessFilter.tsx documents.
 *
 * It is also what makes the default follow the region with no second tap.
 * `all` is not an enumeration of six codes, it is "every lamp in scope", so
 * picking Thailand re-reads it as Thailand's five and picking Japan re-reads
 * it as `STJ-1`. A lamp the reader ticked by hand stays in the URL and simply
 * stops being ticked while its company is off the board - so the tick is
 * theirs until they change it, and it never counts a plant the board is not
 * showing.
 *
 * ## The rest
 *
 * Shape, keyboard behaviour and URL encoding are deliberately identical to
 * `RegionFilter`: same `all` switch, same draft-while-open, same roving focus,
 * same comma-separated parameter parsed by the same code in the contract's
 * region.ts. Two filter menus on one row that behaved differently would be worse
 * than either of them being slightly wrong.
 */
export function PlantFilter() {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useFilters();
  const searchWith = useFilterSearch();
  const meta = useMeta();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const tree = useMemo(
    () => buildTree(meta.data ?? null, lang, filters.region),
    [meta.data, lang, filters.region],
  );
  const fromUrl = useMemo(() => expand(filters.plant, tree), [filters.plant, tree]);

  /* Held while the menu is open, for the same reason RegionFilter holds one:
     writing the parameter refetches, and until that lands `filters.plant` still
     describes the state before the tick - so a second tick would undo the first. */
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const picked = open && draft ? draft : fromUrl;

  const openMenu = () => {
    setDraft(expand(filters.plant, tree));
    setOpen(true);
  };

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
    (items.find((el) => el.getAttribute('aria-checked') !== 'false') ?? items[0])?.focus();
  }, [open]);

  const apply = (plants: Set<string>, focusValue: string) => {
    const plant = collapse(plants, tree);
    setDraft(plants);
    if (plant !== filters.plant) {
      if (pathname === '/overview') setFilters({ plant });
      else navigate({ pathname: '/overview', search: searchWith({ plant }) });
    }
    requestAnimationFrame(() => {
      const el = menu.current?.querySelector<HTMLButtonElement>(`[data-value="${focusValue}"]`);
      el?.focus();
    });
  };

  const togglePlant = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    apply(next, code);
  };

  const toggleCompany = (company: CompanyNode) => {
    const next = new Set(picked);
    const codes = company.plants.map((p) => p.code);
    if (codes.every((c) => next.has(c))) for (const c of codes) next.delete(c);
    else for (const c of codes) next.add(c);
    apply(next, company.code);
  };

  const toggleAll = () => apply(new Set(picked.size === tree.all.length ? [] : tree.all), 'all');

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

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };

  const everything = tree.all.length > 0 && picked.size === tree.all.length;
  /* Whether the capsule is holding a scope. Same rule, and the same reason for
     the length guard, as the Region control - see the note there. */
  const narrowed = tree.all.length > 0 && !everything;
  const selected = describe(picked, tree, everything, t);
  const lamps = (count: number) =>
    t(count === 1 ? 'filter.plantCount.one' : 'filter.plantCount.other', { count });

  return (
    <div className="regionfilter" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={narrowed ? 'filter filter--on tap' : 'filter tap'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={tree.all.length === 0}
        title={selected.title}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="filter__key">{t('filter.plant')}</span>
        <span className="filter__val">{selected.label}</span>
        <span className="filter__caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <div
          className="regionmenu"
          id={menuId}
          role="menu"
          aria-label={t('filter.plant')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          <Option
            state={everything ? 'true' : picked.size > 0 ? 'mixed' : 'false'}
            value="all"
            className="regionmenu__opt regionmenu__opt--all"
            onPick={toggleAll}
          >
            <span className="regionmenu__label">{t('filter.all')}</span>
            <span className="regionmenu__meta">{lamps(tree.all.length)}</span>
          </Option>

          {tree.companies.map((c) => {
            const mine = c.plants.filter((p) => picked.has(p.code)).length;
            return (
              <div className="regionmenu__group" role="group" aria-label={c.label} key={c.code}>
                <Option
                  state={mine === c.plants.length ? 'true' : mine > 0 ? 'mixed' : 'false'}
                  value={c.code}
                  className="regionmenu__opt regionmenu__opt--country"
                  onPick={() => toggleCompany(c)}
                >
                  <span className="regionmenu__code">{c.code}</span>
                  <span className="regionmenu__label">{c.label}</span>
                  <span className="regionmenu__meta">{lamps(c.plants.length)}</span>
                </Option>

                {c.plants.map((p) => (
                  <Option
                    key={p.code}
                    state={picked.has(p.code) ? 'true' : 'false'}
                    value={p.code}
                    className="regionmenu__opt regionmenu__opt--company"
                    onPick={() => togglePlant(p.code)}
                  >
                    {/* The plant CODE leads, because that is what `Lamp_var`
                        carries and what the reader is holding on the other
                        screen; the label follows for anyone who thinks in
                        "LAMP 2" rather than "6332". */}
                    <span className="regionmenu__code">{p.code}</span>
                    <span className="regionmenu__label">{p.label}</span>
                  </Option>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Option({
  state,
  value,
  className,
  onPick,
  children,
}: {
  state: 'true' | 'false' | 'mixed';
  value: string;
  className: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={state}
      data-value={value}
      className={className}
      tabIndex={-1}
      onClick={onPick}
    >
      {children}
      <span className="regionmenu__check" aria-hidden="true">
        {state === 'true' ? '✓' : state === 'mixed' ? '–' : ''}
      </span>
    </button>
  );
}

function itemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
    : [];
}

interface PlantNode {
  code: string;
  label: string;
}

interface CompanyNode {
  code: string;
  /** The company's name in the reading language - the group heading. */
  label: string;
  plants: PlantNode[];
}

interface Tree {
  companies: CompanyNode[];
  /** Every plant code, in master-data order. */
  all: string[];
}

/**
 * Grouped by company, in master-data order - THS first, and its lamps in the
 * order the config lists them. Neither survives an alphabetical sort, and both
 * are how the floor refers to them.
 *
 * Only the companies the `region` parameter has left on the board, matched with
 * the same code the server filters by - so this menu and the numbers above it
 * can never disagree about what is in scope.
 *
 * A company with no plants in master data is not a group anybody can pick.
 *
 * Neither is a plant that has never reported. THS's 6337 and 6321 sit in master
 * data with 8 and 2 machines and have never sent a row, so picking either could
 * only ever produce an empty board - a dead end dressed as a choice, and the
 * same two plants the board itself now leaves off.
 *
 * `ever_reported` is an observation the server makes, not a hidden-plants list
 * somebody maintains, so this reverses itself: the first row either plant sends
 * puts it back in this menu with no edit and no deploy. A plant that HAS
 * reported and gone quiet is never filtered here - that is an outage, and it
 * has to stay pickable.
 */
function buildTree(meta: Meta | null, lang: string, region: string): Tree {
  if (!meta) return { companies: [], all: [] };
  const inRegion = regionMatcher(region);
  const companies = meta.companies
    .filter(inRegion)
    .map((co) => ({
      code: co.code,
      label: (lang === 'th' && co.name_th ? co.name_th : co.name) || co.code,
      plants: co.plants
        .filter((p) => p.ever_reported)
        .map((p) => ({ code: p.code, label: p.label })),
    }))
    .filter((c) => c.plants.length > 0);
  return { companies, all: companies.flatMap((c) => c.plants.map((p) => p.code)) };
}

/**
 * The parameter, as the set of plant codes it puts on the board.
 *
 * Intersected with the region's scope, which is what the filter over
 * `tree.all` already does: a lamp left in the URL from a wider region stops
 * being ticked the moment its company leaves the board.
 */
function expand(plant: string, tree: Tree): Set<string> {
  const tokens = parseRegions(plant);
  if (tokens === null) return new Set(tree.all);
  const wanted = new Set(tokens);
  return new Set(tree.all.filter((code) => wanted.has(code)));
}

/**
 * The shortest parameter that means this set.
 *
 * Unlike `region`, a fully-ticked company does NOT collapse to its own code:
 * `plant=THS` would be ambiguous with a plant literally named THS, and the
 * matcher only ever compares plant codes. Everything ticked still collapses to
 * `all`, which keeps the common URL bare, stays correct when a plant is
 * commissioned, and - because `all` means "every lamp in scope" rather than a
 * list of codes - re-reads itself against whatever region is picked next.
 */
function collapse(plants: Set<string>, tree: Tree): string {
  if (plants.size > 0 && plants.size === tree.all.length) return 'all';
  return formatRegions(tree.all.filter((code) => plants.has(code)));
}

/** What the trigger reads. */
function describe(
  picked: Set<string>,
  tree: Tree,
  everything: boolean,
  t: TFunction,
): { label: string; title: string } {
  if (tree.all.length === 0 || everything) {
    const label =
      tree.all.length === 0 ? t('filter.all') : t('filter.allPlants', { count: tree.all.length });
    return { label, title: label };
  }

  if (picked.size === 0) {
    const label = t('filter.noPlants');
    return { label, title: label };
  }

  const names = tree.all.filter((code) => picked.has(code));
  const title = names.join(' · ');
  // One lamp names itself - a board filtered to a single plant should say
  // which, not "1 lamp". That is the whole comparison this control exists for.
  if (picked.size === 1) return { label: names[0], title };
  return {
    label: t(picked.size === 1 ? 'filter.plantCount.one' : 'filter.plantCount.other', {
      count: picked.size,
    }),
    title,
  };
}
