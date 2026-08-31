import { create } from 'zustand';

/**
 * Which base the drawer is showing, if any.
 *
 * A store rather than state in OverviewPage, for one structural reason: the thing
 * that *opens* the drawer is a pin card four levels down - OverviewPage → WorldMap
 * → MapLabelLayer → CompanyPin - and the thing that *renders* it is the page. A
 * callback threaded through those four would put a `onSelectBase` prop on
 * WorldMap and MapLabelLayer, neither of which has any business knowing a drawer
 * exists.
 *
 * It also makes the second opener free. The ranking beside the map lists the same
 * nine bases and will want the same drawer; with the selection here that is one
 * `open(code)` call from a row, not a second prop chain.
 *
 * Not persisted and not in the URL, unlike the filters. A drawer is a transient
 * reading of one base, not a location: restoring it on the next load would mean a
 * wall panel comes up in the morning with yesterday's base covering a third of
 * the board.
 *
 * The code, not the object. A `CompanySummary` captured here would be a copy that
 * stops updating on the next 30-second poll - the drawer would sit there quoting
 * figures the board behind it had already replaced. Holding the code means the
 * drawer looks the base up in the current payload on every render.
 */
interface SelectionState {
  /** `code` of the selected company, e.g. 'STJ'. */
  selected: string | null;
  open: (code: string) => void;
  close: () => void;
  /** Open `code`, or close if it is already the one open. */
  toggle: (code: string) => void;
}

export const useSelection = create<SelectionState>()((set) => ({
  selected: null,
  open: (code) => set({ selected: code }),
  close: () => set({ selected: null }),
  toggle: (code) => set((s) => ({ selected: s.selected === code ? null : code })),
}));
