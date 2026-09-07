/**
 * The board on screen, as a PDF file in the reader's downloads folder.
 *
 * ## Why a picture and not a report
 *
 * Whatever is on screen is what lands in the file. No second render, no second
 * fetch, no re-derived figure - which is the only property of an export anybody
 * actually cares about: a file that disagrees with the board it came from, over
 * a cache generation or a denominator, is worse than no file at all. The board
 * is also *designed*; the panel that groups two figures and the tint that says
 * "below target" are the reading, and a table of the same numbers is not the
 * same document.
 *
 * ## Why it rasterises rather than printing
 *
 * `window.print()` renders sharper text and costs nothing to ship, and it
 * cannot hand anybody a file: every browser routes it through a dialog where
 * the reader has to choose "Save as PDF" themselves. This is one press, one
 * file, which is what was asked for.
 *
 * The cost is two dependencies and about a megabyte of them, so both are
 * `import()`ed at the moment the button is pressed rather than bundled into the
 * boot path. A board that opens on an iPad in a stand and is never exported
 * never fetches either one - the same arrangement createApi already uses for
 * the mock adapter.
 *
 * ## Why html2canvas-pro and not html2canvas
 *
 * tokens.css builds four chip fills and two borders with `color-mix(in oklab,
 * ...)`. The original html2canvas parses colours itself and has no `color-mix`,
 * so those six resolve to transparent or throw outright, which is a status chip
 * with no status in it. The maintained fork implements the modern colour
 * functions; it is otherwise the same renderer and the same API.
 */
import type { Lang } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';

/**
 * Device pixels per CSS pixel in the capture.
 *
 * 2 is the iPad this board runs on, and it is what makes a 12px axis label
 * legible when the PDF is opened at 200%. 3 is visibly no better on a screen
 * and turns a 700KB file into one over 1.5MB.
 */
const SCALE = 2;

/** CSS pixels to PostScript points: PDF units are 1/72in, CSS px are 1/96in. */
const PX_TO_PT = 72 / 96;

export interface PdfHeader {
  /** The masthead line, e.g. "One Stanley Narong-Pat Global Executive Dashboard". */
  title: string;
  /** Which board this is, e.g. "Global overview" or "6332 LAMP 2". */
  board: string;
  /** Row labels, already translated. */
  generatedLabel: string;
  exportedLabel: string;
  /** The payload's `generated_at`, ISO UTC. */
  generatedAt: string;
  /** The IANA zone both instants are printed in, and its own short label. */
  timeZone: string;
  timeZoneLabel: string;
  lang: Lang;
}

/**
 * The strip above the picture: what this is, and when.
 *
 * Built as real DOM rather than drawn into the PDF with jsPDF's text API, for
 * one reason that decides it on its own: jsPDF ships Helvetica, Times and
 * Courier, all of them WinAnsi, none of them able to render a Thai codepoint.
 * Half this board's readers set the interface to Thai, and a header that prints
 * their language as a row of empty boxes is not a header. Building it as DOM
 * and rasterising it with the board hands the whole problem to the browser,
 * which is already rendering Sarabun three inches below.
 *
 * It is also the cheaper answer: the strip inherits tokens.css, so it is the
 * board's own type scale and the board's own ink on the board's own ground, in
 * whichever theme the reader is in, with no second palette to keep in step.
 *
 * Rendered off-screen and captured separately rather than inserted at the top
 * of the frame. The frame is `height: 100%` with the outlet taking whatever the
 * masthead leaves, so a strip pushed into it does not sit *above* the board -
 * it takes its own height away from it, and the exported picture is a board
 * that much shorter than the one the reader was looking at.
 */
function buildHeader(head: PdfHeader, width: number): HTMLElement {
  const at = (iso: string) => formatDateTime(iso, head.timeZone, head.lang);

  const el = document.createElement('div');
  el.className = 'exporthead';
  /* Off-screen rather than `display: none` or zero opacity: it has to be laid
     out and painted for html2canvas to have anything to read, and `left` puts
     it where no reader will see it for the half-second it exists. Pinned to the
     capture width so the strip and the board come out the same size and the
     composite needs no scaling. */
  el.style.position = 'fixed';
  el.style.left = '-20000px';
  el.style.top = '0';
  el.style.width = `${width}px`;

  const left = document.createElement('div');
  left.className = 'exporthead__id';
  const title = document.createElement('div');
  title.className = 'exporthead__title';
  title.textContent = head.title;
  const board = document.createElement('div');
  board.className = 'exporthead__board';
  board.textContent = head.board;
  left.append(title, board);

  const right = document.createElement('dl');
  right.className = 'exporthead__when';
  for (const [label, value] of [
    [head.generatedLabel, at(head.generatedAt)],
    [head.exportedLabel, at(new Date().toISOString())],
  ]) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    /* The zone rides on both rows on purpose. The two instants are usually
       seconds apart and read as one clock; without it, a reader in Japan has no
       way to tell whether either is their own wall time or the reference
       zone's. */
    dd.textContent = `${value} ${head.timeZoneLabel}`;
    right.append(dt, dd);
  }

  el.append(left, right);
  return el;
}

/** Stacks the strip on top of the board, on the board's own ground. */
function compose(header: HTMLCanvasElement, board: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(header.width, board.width);
  out.height = header.height + board.height;

  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  /* The ground behind both. Only visible where the two captures differ in
     width, which they should not - but a strip of transparent canvas turns into
     a strip of white in the PDF, on a board that is usually dark. */
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(header, 0, 0);
  ctx.drawImage(board, 0, header.height);
  return out;
}

/**
 * Captures `root`, stacks the header above it, and saves the result.
 *
 * Resolves once the file has been handed to the browser; throws if either
 * library fails to load or the canvas cannot be read, which the caller turns
 * back into a usable button.
 */
export async function downloadDashboardPdf(
  root: HTMLElement,
  head: PdfHeader,
  fileName: string,
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);

  /*
   * Export mode, on the live document.
   *
   * html2canvas works on a clone in a detached iframe and takes an `onclone`
   * hook, which would keep this off the screen entirely - but it measures the
   * box to capture from the *original* element, so a clone that unclipped a
   * scrolling drill-down would be laid out tall and then cropped back to the
   * height of the clipped original. Toggling the real document is what makes
   * the measurement and the render agree.
   *
   * The visible cost is one reflow, for as long as the capture takes. That is
   * also the honest thing to show: the button says it is working, and the board
   * visibly is.
   */
  const html = document.documentElement;
  html.dataset.exporting = '';
  const header = buildHeader(head, root.getBoundingClientRect().width);
  document.body.append(header);

  try {
    /* Two frames, not one: the first lets style and layout settle, the second
       guarantees a paint has happened before anything is read back. */
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    const shoot = (el: HTMLElement) =>
      html2canvas(el, { scale: SCALE, backgroundColor: null, logging: false });
    const composed = compose(await shoot(header), await shoot(root));

    /*
     * One page, cut to the picture.
     *
     * Not A4. The board is 1180 x 820 and a drill-down is taller again; fitted
     * to a sheet, either one gains bands of dead paper down two sides, and the
     * export stops looking like the board and starts looking like a photocopy
     * of it. A page the shape of its own content is what a picture wants, and
     * every viewer opens it at whatever size the window is. A reader who does
     * send it to a printer gets "fit to page", which is the same scaling this
     * would have baked in, done at the moment it is actually needed.
     */
    const w = (composed.width / SCALE) * PX_TO_PT;
    const h = (composed.height / SCALE) * PX_TO_PT;
    const pdf = new jsPDF({
      orientation: w >= h ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [w, h],
      compress: true,
    });
    /* PNG, not JPEG. The board is type, hairlines and flat fills - everything
       JPEG is worst at - and the quality setting that stops a 10px column label
       fringing costs more than the lossless file does. */
    pdf.addImage(composed.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    pdf.save(`${fileName}.pdf`);
  } finally {
    header.remove();
    delete html.dataset.exporting;
  }
}
