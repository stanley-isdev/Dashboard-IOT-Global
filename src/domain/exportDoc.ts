import type { CompanyDetail, GlobalOverview, PlantDetail } from '../api/contract';

/**
 * What the Export button needs from the page below it.
 *
 * The button prints a picture of the board, so the board itself is the content
 * and nothing has to be handed up to produce it. Two things it cannot work out
 * on its own, and this is both of them: what to call the file, and which
 * instant the numbers in the picture describe.
 *
 * Everything else on the exported page - the board name, the timezone, the
 * language the header is written in - the button can read from the route, the
 * config and the locale, which is why none of it is here. See ExportButton.
 */
export interface ExportDoc {
  /** File basename, no extension. */
  name: string;
  /** The payload's `generated_at`, ISO UTC. Printed in the PDF header. */
  generatedAt: string;
}

/**
 * The name the exported PDF is saved under.
 *
 * ## Why a filename is load-bearing here
 *
 * The picture carries its own scope on its face: the filter row is in it, so a
 * reader looking at the page can see it is 24 hours of Injection in Thailand.
 * The *filename* is the one part that survives the file being dropped in a
 * folder with thirty others, so it repeats the scope rather than saying
 * `dashboard.pdf` thirty times.
 *
 * That makes the scope lists below load-bearing rather than decorative: a
 * filter added to the row without a line here is a filename that silently
 * stops describing its own contents. Zone is the most recent one.
 *
 * ## Why the name is built from the payload, not from the clock
 *
 * The stamp is the instant the *data* was generated, not the instant somebody
 * pressed the button. Two people exporting the same board a minute apart get
 * the same filename, which is the point: the file is named after what is in
 * it. Naming it in the exporter's local time would give the same numbers two
 * names, and a Japanese reader and a Thai reader two different dates for one
 * shift. The header inside the PDF prints both instants, so the reader can see
 * the difference the filename deliberately hides.
 *
 * ## Why it is not translated
 *
 * Everything else on this board is, the PDF header included. A filename is not
 * read on the board - it is read in a downloads folder, quoted in an email, and
 * sometimes typed at a shell. ASCII, dots and dashes only, so it survives all
 * three; the character class below is what enforces that, and it is also what
 * keeps a Thai base name from arriving as percent-escapes.
 */
export function exportName(parts: (string | null)[], generatedAt: string): string {
  const stamp = generatedAt.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}).*$/,
    (_, date, h, m) => `${date}-${h}${m}Z`,
  );
  return [...parts.filter((p): p is string => p !== null && p !== ''), stamp]
    .join('_')
    .replace(/[^A-Za-z0-9._-]+/g, '-');
}

/**
 * The window and the process, in the filename.
 *
 * `all` is omitted: it is the default, and naming it makes every filename
 * longer for nothing.
 */
function scopeSuffix(range: string, process: string): string {
  return process === 'all' ? range : `${range}-${process.toLowerCase()}`;
}

/**
 * The global board.
 *
 * Every scope the board was narrowed by goes in the name, unlike on the two
 * drill-downs where the base and the lamp *are* the page.
 */
export function overviewExportDoc(data: GlobalOverview): ExportDoc {
  const { range, process, region, plant, zone } = data.filters_applied;
  return {
    name: exportName(
      [
        'fleet',
        region === 'all' ? null : region,
        plant === 'all' ? null : plant,
        zone === 'all' ? null : zone,
        scopeSuffix(range, process),
      ],
      data.meta.generated_at,
    ),
    generatedAt: data.meta.generated_at,
  };
}

/** One base and the lamps under it. */
export function companyExportDoc(data: CompanyDetail): ExportDoc {
  return {
    name: exportName(
      [data.company.code, scopeSuffix(data.filters_applied.range, data.filters_applied.process)],
      data.meta.generated_at,
    ),
    generatedAt: data.meta.generated_at,
  };
}

/** One lamp and its machines. */
export function plantExportDoc(data: PlantDetail): ExportDoc {
  return {
    name: exportName(
      [
        data.company.code,
        data.plant.code,
        'machines',
        scopeSuffix(data.filters_applied.range, data.filters_applied.process),
      ],
      data.meta.generated_at,
    ),
    generatedAt: data.meta.generated_at,
  };
}
