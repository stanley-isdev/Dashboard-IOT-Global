import { useEffect } from 'react';
import { create } from 'zustand';
import type { ExportDoc } from '../domain/exportDoc';

/**
 * What the Export button needs from whichever page is on screen.
 *
 * The button lives in the filter row - above the router outlet, beside the
 * controls that scope what it would export - and the payload it needs two facts
 * from lives in the page below it. Something has to carry one to the other, and
 * this is the same arrangement `useShellConnection` already uses for the
 * freshness badge: the page publishes upward, the shell renders.
 *
 * ## Why two fields and not the data
 *
 * Because the export *is* the screen: the button photographs the board, so
 * nothing has to be handed up to produce the content. What it cannot work out
 * on its own is the filename and the instant the numbers describe - see
 * exportDoc.ts, which is also where the reason each of those comes from the
 * payload rather than the clock is written down.
 *
 * A finished value and not a builder callback: the pages memoise it on the
 * payload, so the reference only changes when the payload does, which keeps
 * this effect off the 30-second poll's critical path.
 *
 * `null` is a page with nothing to export - a payload that has not landed yet.
 * The button disables itself rather than disappearing: a control that comes and
 * goes as data lands is one a reader has to hunt for, and the row it sits in
 * would reflow around it.
 */
interface ExportState {
  doc: ExportDoc | null;
  setDoc: (doc: ExportDoc | null) => void;
}

export const useExportDoc = create<ExportState>()((set) => ({
  doc: null,
  setDoc: (doc) => set({ doc }),
}));

/**
 * Publishes a page's export descriptor to the button in the top bar, and clears
 * it on the way out.
 *
 * The cleanup is what makes this safe on a route change: without it, navigating
 * from a plant to the overview would leave the machine board's descriptor armed
 * until the new payload landed, and the file would be named - and stamped -
 * after the board the reader had just left.
 */
export function usePublishExport(doc: ExportDoc | null): void {
  useEffect(() => {
    useExportDoc.getState().setDoc(doc);
    return () => useExportDoc.getState().setDoc(null);
  }, [doc]);
}
