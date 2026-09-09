import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { zoneOffsetShort } from '../../i18n/format';
import { useConfig } from '../../config/AppContext';
import { useExportDoc } from '../../state/exportStore';
import { downloadDashboardPdf } from '../../domain/exportPdf';
import { useMastheadCrumbs } from './useMastheadCrumbs';

/**
 * Downloads the board on screen as a PDF.
 *
 * ## Why it is at the right-hand end of the filter row
 *
 * Because it exports what that row scopes. Region, Lamp, Process, the refresh
 * interval and the range all narrow what is drawn, and the file is that board -
 * so the control that writes it belongs after the controls that decide what is
 * in it, not in a panel head where it would look like it exported one panel.
 *
 * ## Why it is the one filled control on the board
 *
 * It is the only thing in either band that *does* something rather than
 * changing what is shown: every other control re-scopes the screen and says so
 * by turning orange, and this one produces a file. A solid fill is the ordinary
 * way to say "primary action", and there is exactly one of them, which is what
 * keeps that meaning readable.
 *
 * The fill is `--accent-fill`, not `--accent`. White on the artboard's orange
 * measures 2.4:1 and was this board's one documented AA failure - see the note
 * on the accent tokens in tokens.css, which named this button as the case that
 * would need a passing pair, and check-contrast.mjs, which now measures it.
 *
 * ## What this file owns, and what it does not
 *
 * It owns the press: which frame to photograph, what the header should say, and
 * what the control looks like while that is happening. How the picture is taken
 * and turned into a file is exportPdf.ts; what the board and the header strip
 * look like in the file is export.css. Three files, three questions.
 *
 * ## Why the board name comes from the route
 *
 * `useMastheadCrumbs` is the same hook drawing the breadcrumb two rows up, so
 * the name in the PDF header is by construction the name the reader saw when
 * they pressed the button. The pages publish only what the route cannot answer
 * - the filename and the payload's own timestamp.
 *
 * ## Disabled rather than absent
 *
 * A page with nothing to export - a payload that has not landed yet - leaves
 * the button in place and disabled. Rendering it conditionally would reflow the
 * row every time a poll returned, and a reader who reached for it once would
 * have to look for it again.
 */
export function ExportButton() {
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const doc = useExportDoc((s) => s.doc);
  const crumbs = useMastheadCrumbs();

  /*
   * Rasterising 1180 x 820 at 2x takes about half a second on the iPad, and the
   * two libraries have to be fetched before that on the first press. A button
   * that looks idle for a second and a half is one a reader presses again, and
   * a second press mid-capture would photograph a board with a header strip
   * already parked in the document.
   */
  const [busy, setBusy] = useState(false);

  /* The last crumb, which is the board: "6332 LAMP 2" on a plant, the base code
     on a company. The overview has no trail at all - it is the root - so it
     names itself the way the trail's own root crumb would. */
  const board = crumbs.at(-1)?.label ?? t('nav.overview');

  const run = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      /*
       * `.app`, not `#main` and not `<body>`.
       *
       * The frame is the board: the masthead says whose it is and whether it is
       * live, and the filter row says what it is scoped to. A picture of the
       * outlet alone would be figures with no statement of what they cover,
       * which is the one thing an exported number must not be. `<body>` would
       * add nothing but the page margin.
       */
      const root = document.querySelector<HTMLElement>('.app');
      if (!root) return;

      await downloadDashboardPdf(
        root,
        {
          title: t('app.title'),
          board,
          generatedLabel: t('export.generated'),
          exportedLabel: t('export.exported'),
          generatedAt: doc.generatedAt,
          /*
           * The reference zone, in both time modes.
           *
           * This stamps when the FILE was made, which is a fact about the
           * export and not about any one base - so there is no site clock for
           * site-local mode to resolve it against, and it takes the same
           * fallback every fleet-wide timestamp on the board takes. See
           * src/state/useDisplayZone.ts for the rule.
           *
           * It is not silent about it either: `timeZoneLabel` prints the offset
           * beside the stamp, so a header on GMT+07 over a picture of nine
           * local clocks says which of the two it is rather than leaving the
           * reader to assume they match.
           */
          timeZone: cfg.referenceTimezone,
          timeZoneLabel: `GMT${zoneOffsetShort(cfg.referenceTimezone)}`,
          lang,
        },
        doc.name,
      );
    } catch (err) {
      /*
       * A failed export is a failed export - there is no half-file to hand
       * over, and no state on the board that needs unwinding, because
       * downloadDashboardPdf clears its own export mode in a `finally`. So the
       * button simply becomes pressable again and the reason goes to the
       * console for whoever is asked about it later. A toast would be the first
       * one on this board, for the rarest failure on it.
       */
      console.error('PDF export failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="exportbtn tap"
      onClick={() => void run()}
      disabled={doc === null || busy}
      aria-busy={busy}
      /* The reason it is disabled, on the control itself. "Export" with no
         explanation reads as a broken button rather than as "there is nothing
         to export yet". */
      title={doc === null ? t('export.empty') : t('export.pdf')}
    >
      {/*
       * A tray with an arrow leaving it, drawn on the same 16 box and in the
       * same currentColor as the board tabs' two glyphs - see the note on those
       * in OverviewPage for why these are inline SVG and not an icon set.
       *
       * The arrow points down into the tray, which is the direction this action
       * goes: a file arrives. It used to point up and out, from when the button
       * opened a print dialog rather than writing a download. It is decoration
       * either way - the word beside it is the label - hence aria-hidden.
       */}
      <svg
        className="exportbtn__icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 2.6v7.8" />
        <path d="M5.1 7.5 8 10.4l2.9-2.9" />
        <path d="M2.7 10.2v2.1a1 1 0 0 0 1 1h8.6a1 1 0 0 0 1-1v-2.1" />
      </svg>
      {busy ? t('export.busy') : t('export.label')}
    </button>
  );
}
