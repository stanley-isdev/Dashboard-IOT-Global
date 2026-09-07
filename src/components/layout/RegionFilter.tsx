import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMeta } from '../../api/queries';
import { formatRegions, parseRegions, type CompanyMeta, type Meta } from '../../api/contract';
import { useI18n, type TFunction } from '../../i18n/I18nProvider';
import { useFilters, useFilterSearch } from '../../state/useFilters';
import { Flag } from '../primitives/Flag';

/**
 * The Region filter, wired - and multi-select, because "Thailand and Japan" is
 * a question this board gets asked and one base at a time cannot answer it.
 *
 * ## Where the list comes from
 *
 * `/api/v1/meta`, not the overview payload - and that is the whole reason meta
 * exists as an endpoint (see its schema comment). The overview payload is
 * already narrowed by whatever is ticked, so deriving the menu from it would
 * mean that ticking Japan left one row in the list and no way back to Hungary
 * except by editing the URL. Meta is the fleet as commissioned: all nine bases,
 * whether or not they have a gateway, cached for an hour.
 *
 * Until it loads the control stays disabled rather than opening a menu that is
 * about to grow rows under the reader's finger.
 *
 * ## What a tick means
 *
 * The selection is a set of *bases*. A country row is the parent of the bases
 * under it: ticking it ticks all of them, and it draws itself checked, mixed or
 * empty from what its children are. Nothing is a header row that looks tappable
 * and is not.
 *
 * The URL keeps the short form: a fully ticked country is written as its own
 * code, so both Thai bases is `?region=TH` and not `?region=THS,ASI`. Both
 * spellings mean the same thing to the matcher in the contract, so a
 * hand-written URL behaves the same as one this menu produced.
 *
 * Everything ticked is written `all` rather than as nine codes - the group is a
 * scope in its own right, not an enumeration of the fleet, and it stays `all`
 * when a tenth base is commissioned.
 *
 * The All row is a switch: it fills the fleet, and tapping it while the fleet
 * is already ticked empties it (`?region=none`). The board opens on all nine,
 * so without that half a reader who wants three of them has to untick six to
 * get there. Nothing ticked is a real answer and the board honestly empties
 * rather than snapping back to everything - the trigger says "No bases
 * selected" so the empty panels have their reason attached.
 *
 * The menu stays open while ticking, and the board behind it updates on each
 * one. Selecting four bases through a menu that closes on the first is four
 * round trips through a control that has already moved.
 *
 * ## What it does on a drill-down page
 *
 * Region scopes the global board, and that board is the only screen which shows
 * a scope, so ticking one from a company or plant page returns the reader to it
 * with the filter applied. The alternative - writing a parameter the page in
 * front of the reader does not use - is the silently ignored tap this row spent
 * its first version avoiding by being disabled.
 */
export function RegionFilter() {
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

  const tree = useMemo(() => buildTree(meta.data ?? null, lang), [meta.data, lang]);
  /* The parameter expanded to the leaves it covers. `all` - and an unreadable
     `?region=ZZ` that matches nothing - both come back as the whole fleet here,
     which is what the board is showing in either case. */
  const fromUrl = useMemo(() => expand(filters.region, tree), [filters.region, tree]);

  /*
   * While the menu is open the ticks are held here, seeded from the URL each
   * time it opens.
   *
   * Not an optimisation. Writing the parameter re-renders the whole board and
   * refetches, and until that lands `filters.region` still describes the state
   * before the tick - so a second tick computed from it would be computed from
   * a set missing the first, and would silently undo it. Measured at about 300ms
   * per commit here, which is well inside the interval somebody ticking four
   * bases in a row taps at.
   */
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const picked = open && draft ? draft : fromUrl;

  /* Seeded here rather than in an effect on `open`, so the menu's first render
     already has it - and so the seed happens on the way in, never on a later
     settle of the URL, which would reintroduce the lag this exists to avoid. */
  const openMenu = () => {
    setDraft(expand(filters.region, tree));
    setOpen(true);
  };

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  /* A tap anywhere else is a dismissal. `pointerdown` rather than `click`, so
     the menu is gone before whatever sits under it reacts. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  /* Focus lands on the first ticked row rather than the top of the list:
     opening the menu is how a reader checks what is selected, and the answer
     belongs under the cursor instead of somewhere below it. */
  useEffect(() => {
    if (!open) return;
    const items = itemsOf(menu.current);
    (items.find((el) => el.getAttribute('aria-checked') !== 'false') ?? items[0])?.focus();
  }, [open]);

  /**
   * Writes a new set of bases as the shortest parameter that means it, and -
   * from a drill-down page - goes back to the board the scope applies to. The
   * draft takes it immediately, so the tick appears under the finger that made
   * it and the next tick is computed from it.
   *
   * Focus is restored by hand afterwards. The row the reader ticked is still
   * under their finger, but React has re-rendered it and a navigation may have
   * happened underneath, so the browser has dropped focus to <body> and the
   * arrow keys would have nothing to move from.
   */
  const apply = (bases: Set<string>, focusValue: string) => {
    const region = collapse(bases, tree);
    setDraft(bases);
    if (region !== filters.region) {
      if (pathname === '/overview') setFilters({ region });
      else navigate({ pathname: '/overview', search: searchWith({ region }) });
    }
    requestAnimationFrame(() => {
      const el = menu.current?.querySelector<HTMLButtonElement>(`[data-value="${focusValue}"]`);
      el?.focus();
    });
  };

  const toggleCompany = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    apply(next, code);
  };

  const toggleCountry = (country: CountryNode) => {
    const next = new Set(picked);
    const codes = country.companies.map((c) => c.code);
    if (codes.every((c) => next.has(c))) for (const c of codes) next.delete(c);
    else for (const c of codes) next.add(c);
    apply(next, country.code);
  };

  /*
   * The group row is a switch, not a one-way widening.
   *
   * Ticking it selects the fleet; tapping it while the fleet is already ticked
   * clears the lot. That second half is the whole reason it is a switch: the
   * board opens on all nine, and a reader who wants three of them would
   * otherwise have to untick six to get there. One tap to empty, three to fill.
   */
  const toggleAll = () => apply(new Set(picked.size === tree.all.length ? [] : tree.all), 'all');

  /* Roving focus. A menu that only answers Tab is a stack of buttons, and this
     one is seventeen rows deep. */
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
  /*
   * Whether the capsule is holding a scope, which is what draws it in the brand
   * pastel (see .filter--on). Deliberately not `!everything`: with master data
   * still in flight the tree is empty, `everything` is false and the control is
   * disabled, so the bare negation would paint a control nobody can press in
   * the colour that means "this is narrowing your numbers".
   *
   * Nothing ticked is narrowed and stays flagged. An empty board above a filter
   * row that looks untouched is this control's worst failure.
   */
  const narrowed = tree.all.length > 0 && !everything;
  const selected = describe(picked, tree, everything, t);
  const bases = (count: number) =>
    t(count === 1 ? 'filter.baseCount.one' : 'filter.baseCount.other', { count });

  return (
    <div className="regionfilter" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={narrowed ? 'filter filter--on tap' : 'filter tap'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        /* Nothing to choose from until master data is here. The same treatment
           the row already gave an unwired control, for the same reason. */
        disabled={tree.all.length === 0}
        /* Which bases are in scope, for the reader who ticked five of them and
           is looking at a control that can only print the count. */
        title={selected.title}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="filter__key">{t('filter.region')}</span>
        <span className="filter__val">
          {selected.country ? (
            <Flag
              code={selected.country}
              countryName={selected.countryName ?? selected.country}
              size="0.9em"
            />
          ) : null}
          {selected.label}
        </span>
        <span className="filter__caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <div
          className="regionmenu"
          id={menuId}
          role="menu"
          aria-label={t('filter.region')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          <Option
            /* Mixed while part of the fleet is ticked, so the row says what a
               tap will do: fill from here, empty from full. */
            state={everything ? 'true' : picked.size > 0 ? 'mixed' : 'false'}
            value="all"
            className="regionmenu__opt regionmenu__opt--all"
            onPick={toggleAll}
          >
            <span className="regionmenu__label">{t('filter.all')}</span>
            <span className="regionmenu__meta">{bases(tree.all.length)}</span>
          </Option>

          {tree.countries.map((c) => {
            const mine = c.companies.filter((co) => picked.has(co.code)).length;
            return (
              <div className="regionmenu__group" role="group" aria-label={c.name} key={c.code}>
                <Option
                  state={mine === c.companies.length ? 'true' : mine > 0 ? 'mixed' : 'false'}
                  value={c.code}
                  className="regionmenu__opt regionmenu__opt--country"
                  onPick={() => toggleCountry(c)}
                >
                  <Flag code={c.code} countryName={c.name} size="0.95em" />
                  <span className="regionmenu__label">{c.name}</span>
                  <span className="regionmenu__meta">{bases(c.companies.length)}</span>
                </Option>

                {c.companies.map((co) => (
                  <Option
                    key={co.code}
                    state={picked.has(co.code) ? 'true' : 'false'}
                    value={co.code}
                    className="regionmenu__opt regionmenu__opt--company"
                    onPick={() => toggleCompany(co.code)}
                  >
                    <span className="regionmenu__code">{co.code}</span>
                    <span className="regionmenu__label">{co.label}</span>
                    {/* One label for every base that is not live. Which stage of
                        commissioning it is at - installing, planned, not recorded -
                        is a fact about the rollout, not about the board, and a reader
                        scanning this menu for numbers only needs to know there are
                        none here yet. The stage itself still shows on the base drawer
                        and the map pin. */}
                    {co.data_readiness === 'live' ? null : (
                      <span className="regionmenu__tag">{t('site.not_connected')}</span>
                    )}
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

/**
 * One row. `menuitemcheckbox` and not `menuitemradio`, which is what this was
 * while the filter took a single scope: the tri-state a country needs -
 * `mixed`, when some of its bases are ticked - exists on a checkbox and has no
 * equivalent on a radio.
 */
function Option({
  state,
  value,
  className,
  onPick,
  children,
}: {
  state: 'true' | 'false' | 'mixed';
  /** Looked up by `apply` to put focus back on this row after the re-render. */
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
      /* -1 so Tab leaves the menu instead of walking it; the arrow keys move
         between rows, which is what the pattern promises a reader. */
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
  return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')) : [];
}

interface CountryNode {
  code: string;
  name: string;
  /** `label` is the company's name in the reading language; `name` stays raw. */
  companies: (CompanyMeta & { label: string })[];
}

interface Tree {
  countries: CountryNode[];
  /** Every company code, in master-data order. */
  all: string[];
}

/**
 * Master data, kept in the order it arrives in - Thailand first, THS before ASI.
 * Both are deliberate in the seed and neither survives an alphabetical sort.
 */
function buildTree(meta: Meta | null, lang: string): Tree {
  if (!meta) return { countries: [], all: [] };
  const countries = meta.countries
    .map((c) => ({
      code: c.code,
      name: (lang === 'th' && c.name_th ? c.name_th : c.name) || c.code,
      companies: meta.companies
        .filter((co) => co.country_code === c.code)
        .map((co) => ({
          ...co,
          label: (lang === 'th' && co.name_th ? co.name_th : co.name) || co.code,
        })),
    }))
    // A country with no commissioned site is not a scope anybody can pick.
    .filter((c) => c.companies.length > 0);
  return { countries, all: countries.flatMap((c) => c.companies.map((co) => co.code)) };
}

/** The parameter, as the set of base codes it puts on the board. */
function expand(region: string, tree: Tree): Set<string> {
  const tokens = parseRegions(region);
  if (tokens === null) return new Set(tree.all);
  const wanted = new Set(tokens);
  return new Set(tree.all.filter((code, i) => wanted.has(code) || wanted.has(countryOf(tree, i))));
}

/** The country a position in `tree.all` belongs to. */
function countryOf(tree: Tree, index: number): string {
  let i = index;
  for (const c of tree.countries) {
    if (i < c.companies.length) return c.code;
    i -= c.companies.length;
  }
  return '';
}

/** The shortest parameter that means this set of bases. */
function collapse(bases: Set<string>, tree: Tree): string {
  // Everything ticked is `all` rather than nine codes - the group is a scope in
  // its own right, and it stays correct when a tenth base is commissioned.
  if (bases.size > 0 && bases.size === tree.all.length) return 'all';
  const tokens: string[] = [];
  for (const c of tree.countries) {
    const mine = c.companies.filter((co) => bases.has(co.code));
    if (mine.length === c.companies.length) tokens.push(c.code);
    else for (const co of mine) tokens.push(co.code);
  }
  return formatRegions(tokens);
}

/** What the trigger reads. */
function describe(
  picked: Set<string>,
  tree: Tree,
  everything: boolean,
  t: TFunction,
): { label: string; country: string | null; countryName: string | null; title: string } {
  if (tree.all.length === 0 || everything) {
    const label =
      tree.all.length === 0 ? t('filter.all') : t('filter.allBases', { count: tree.all.length });
    return { label, country: null, countryName: null, title: label };
  }

  // Nothing ticked. Said plainly, because the board behind it is empty and the
  // reader needs the reason to be the first thing they see.
  if (picked.size === 0) {
    const label = t('filter.noBases');
    return { label, country: null, countryName: null, title: label };
  }

  const names: string[] = [];
  let single: { label: string; country: string; countryName: string } | null = null;
  for (const c of tree.countries) {
    const mine = c.companies.filter((co) => picked.has(co.code));
    if (mine.length === 0) continue;
    const whole = mine.length === c.companies.length;
    names.push(whole ? c.name : mine.map((co) => co.code).join(', '));
    // The one-scope case still names itself: a board filtered to a single base
    // should say which, not "1 base".
    if (picked.size === mine.length) {
      single = whole
        ? { label: c.name, country: c.code, countryName: c.name }
        : mine.length === 1
          ? // The code, not the name: "Asian Stanley International Co., Ltd."
            // does not fit a 30px control, and codes are never translated.
            { label: mine[0].code, country: c.code, countryName: c.name }
          : null;
    }
  }

  const title = names.join(' · ');
  if (single) return { ...single, title };
  return {
    label: t(picked.size === 1 ? 'filter.baseCount.one' : 'filter.baseCount.other', {
      count: picked.size,
    }),
    country: null,
    countryName: null,
    title,
  };
}
