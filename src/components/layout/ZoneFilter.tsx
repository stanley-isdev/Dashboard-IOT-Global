import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMeta } from '../../api/queries';
import {
  formatRegions,
  parseRegions,
  plantMatcher,
  regionMatcher,
  type Meta,
} from '../../api/contract';
import { useI18n, type TFunction } from '../../i18n/I18nProvider';
import { useFilters, useFilterSearch } from '../../state/useFilters';

/**
 * The Zone filter - the plant board's `${Zone_var}`, and the level below Lamp.
 *
 * ## What a zone is, and why the menu is flat
 *
 * `zone` is a tag on the machine rows, not a row in master data. Nothing above
 * a machine carries one, which is why this filter matches machines and why its
 * choices come off the reported tags rather than off a maintained list.
 *
 * The tags are plant-LOCAL and they collide. Measured 2026-08-28: plant `6051`
 * reports `A`-`F`, `6338` reports `A`, and `6332` reports `2A-A`, `2A-B`,
 * `2A-C`, `2B-A`, `2B-B`. So `zone=A` names a scope in two plants at once, and
 * this menu says so - a tag more than one lamp in scope reports is labelled
 * "in 2 lamps" - rather than pretending the tag is unique or inventing a
 * `6051:A` token that the Lamp filter already expresses better. Narrow Lamp to
 * one plant and the zone list narrows with it, which is the exact move a reader
 * comparing this board against one operator screen is already making.
 *
 * ## Why the choices narrow with the scope above
 *
 * The list is the zones of the plants Region and Lamp have left on the board,
 * not every zone in the group. A menu offering `2A-A` while the board is scoped
 * to Japan would be offering an empty board, and the whole reason this control
 * exists is that a filter naming a scope the numbers do not have is worse than
 * no filter at all - see ProcessFilter.tsx for the version of that mistake this
 * one is built to avoid.
 *
 * ## The rest
 *
 * Shape, keyboard behaviour and URL encoding are deliberately identical to
 * `PlantFilter`: same `all` switch, same draft-while-open, same roving focus,
 * same comma-separated parameter parsed by the same code in the contract's
 * region.ts. Zone tags carry hyphens but never commas, so that encoding holds.
 */
export function ZoneFilter() {
  const { t } = useI18n();
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

  const universe = useMemo(
    () => buildUniverse(meta.data ?? null, filters.region, filters.plant),
    [meta.data, filters.region, filters.plant],
  );
  const fromUrl = useMemo(() => expand(filters.zone, universe), [filters.zone, universe]);

  /* Held while the menu is open, for the same reason PlantFilter holds one:
     writing the parameter refetches, and until that lands `filters.zone` still
     describes the state before the tick - so a second tick would undo the first. */
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const picked = open && draft ? draft : fromUrl;

  const openMenu = () => {
    setDraft(expand(filters.zone, universe));
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

  const apply = (zones: Set<string>, focusValue: string) => {
    const zone = collapse(zones, universe);
    setDraft(zones);
    if (zone !== filters.zone) {
      if (pathname === '/overview') setFilters({ zone });
      else navigate({ pathname: '/overview', search: searchWith({ zone }) });
    }
    requestAnimationFrame(() => {
      const el = menu.current?.querySelector<HTMLButtonElement>(`[data-value="${focusValue}"]`);
      el?.focus();
    });
  };

  const toggleZone = (tag: string) => {
    const next = new Set(picked);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    apply(next, tag);
  };

  const toggleAll = () =>
    apply(new Set(picked.size === universe.tags.length ? [] : universe.tags), 'all');

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

  const everything = universe.tags.length > 0 && picked.size === universe.tags.length;
  /* Whether the capsule is holding a scope, which draws it in the brand pastel.
     Same rule, and the same reason for the length guard, as the Lamp control. */
  const narrowed = universe.tags.length > 0 && !everything;
  /* Two keys because `t` does plain substitution, and a menu row reading
     "1 zones" over a plant with one zone is the kind of thing a reader stops on
     - the same reason the region menu carries a pair. */
  const zones = (count: number) =>
    t(count === 1 ? 'filter.zoneCount.one' : 'filter.zoneCount.other', { count });
  const selected = describe(picked, universe, everything, t, zones);

  return (
    <div className="regionfilter" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={narrowed ? 'filter filter--on tap' : 'filter tap'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        /* Nothing to choose from, and there are two ways to get there: master
           data has not landed, or every plant left in scope is silent. A plant
           with no rows reports no zone tags either, so the control goes quiet
           along with the numbers instead of offering a scope with nothing
           behind it. */
        disabled={universe.tags.length === 0}
        title={selected.title}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="filter__key">{t('filter.zone')}</span>
        <span className="filter__val">{selected.label}</span>
        <span className="filter__caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open ? (
        <div
          /* --compact: the rows are a short zone tag, never the country name,
             code and count the Region menu sizes its 17rem around. Same frame,
             shrunk to its content. */
          className="regionmenu regionmenu--compact"
          id={menuId}
          role="menu"
          aria-label={t('filter.zone')}
          ref={menu}
          onKeyDown={onMenuKey}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={everything ? 'true' : picked.size > 0 ? 'mixed' : 'false'}
            data-value="all"
            className="regionmenu__opt regionmenu__opt--all"
            tabIndex={-1}
            onClick={toggleAll}
          >
            <span className="regionmenu__label">{t('filter.all')}</span>
            <span className="regionmenu__meta">{zones(universe.tags.length)}</span>
            <span className="regionmenu__check" aria-hidden="true">
              {everything ? '✓' : picked.size > 0 ? '–' : ''}
            </span>
          </button>

          {/* The All row is a switch over the whole list, not its first entry.
              Region and Lamp get that separation from the country group's
              hairline; a flat list has no group, so the rule is drawn here. */}
          <div className="regionmenu__sep" role="separator" />

          {universe.tags.map((tag) => {
            const lamps = universe.lampsByTag.get(tag) ?? [];
            return (
              <button
                key={tag}
                type="button"
                role="menuitemcheckbox"
                aria-checked={picked.has(tag) ? 'true' : 'false'}
                data-value={tag}
                /* A plain row, not the indented --company one it borrowed at
                   first: nothing sits above a zone tag in this menu, so the
                   indent was pointing at a parent that is not there and the
                   muted ink made the whole list read as somebody else's
                   detail. */
                className="regionmenu__opt"
                tabIndex={-1}
                title={lamps.join(' · ')}
                onClick={() => toggleZone(tag)}
              >
                {/* The tag itself, never a prettified version of it: it is what
                    the machine row carries, what `Zone_var` takes, and what is
                    painted on the floor. */}
                <span className="regionmenu__code">{tag}</span>
                {/* Only when it collides. A tag one lamp reports needs no
                    explaining, and the common case stays a bare list. */}
                {lamps.length > 1 ? (
                  <span className="regionmenu__meta">
                    {t('filter.zoneLamps', { count: lamps.length })}
                  </span>
                ) : null}
                <span className="regionmenu__check" aria-hidden="true">
                  {picked.has(tag) ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function itemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'))
    : [];
}

interface Universe {
  /** Every distinct zone tag in scope, sorted. */
  tags: string[];
  /** The lamp codes reporting each tag - what makes a collision visible. */
  lampsByTag: Map<string, string[]>;
}

/**
 * The zones a reader can pick right now: the tags of every plant Region and
 * Lamp have left on the board, de-duplicated.
 *
 * Sorted with `localeCompare` and `numeric`, so `Z2` lands before `Z10` rather
 * than after it. Zone tags are short mixed alphanumerics and a plain lexical
 * sort puts them in an order nobody on the floor would recognise.
 */
function buildUniverse(meta: Meta | null, region: string, plant: string): Universe {
  const lampsByTag = new Map<string, string[]>();
  if (!meta) return { tags: [], lampsByTag };

  const inRegion = regionMatcher(region);
  const inPlant = plantMatcher(plant);
  for (const company of meta.companies) {
    if (!inRegion(company)) continue;
    for (const p of company.plants) {
      if (!inPlant(p)) continue;
      for (const tag of p.zones) {
        const lamps = lampsByTag.get(tag);
        if (lamps) lamps.push(p.code);
        else lampsByTag.set(tag, [p.code]);
      }
    }
  }

  const tags = [...lampsByTag.keys()].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }),
  );
  return { tags, lampsByTag };
}

/** The parameter, as the set of zone tags it puts on the board. */
function expand(zone: string, universe: Universe): Set<string> {
  const tokens = parseRegions(zone);
  if (tokens === null) return new Set(universe.tags);
  const wanted = new Set(tokens);
  // Intersected with what is in scope, so a tag left in the URL by a Lamp
  // change stops being ticked the moment its plant leaves the board.
  return new Set(universe.tags.filter((tag) => wanted.has(tag)));
}

/**
 * The shortest parameter that means this set.
 *
 * Everything ticked collapses to `all`, which keeps the common URL bare - and,
 * unlike a literal list, stays correct when the scope above it changes: `all`
 * still means "every zone here" after the reader picks a different lamp.
 */
function collapse(zones: Set<string>, universe: Universe): string {
  if (zones.size > 0 && zones.size === universe.tags.length) return 'all';
  return formatRegions(universe.tags.filter((tag) => zones.has(tag)));
}

/** What the trigger reads. */
function describe(
  picked: Set<string>,
  universe: Universe,
  everything: boolean,
  t: TFunction,
  zones: (count: number) => string,
): { label: string; title: string } {
  if (universe.tags.length === 0 || everything) {
    const label =
      universe.tags.length === 0
        ? t('filter.all')
        : t('filter.allZones', { count: universe.tags.length });
    return { label, title: label };
  }

  if (picked.size === 0) {
    const label = t('filter.noZones');
    return { label, title: label };
  }

  const names = universe.tags.filter((tag) => picked.has(tag));
  const title = names.join(' · ');
  // One zone names itself. A board scoped to a single zone should say which -
  // that is the comparison against one operator screen this control exists for.
  if (picked.size === 1) return { label: names[0], title };
  return { label: zones(picked.size), title };
}
