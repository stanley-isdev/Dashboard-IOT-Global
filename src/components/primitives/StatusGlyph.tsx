import type { StatusToken } from '../../domain/status';
import { useT } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { StatusIcon } from './StatusIcon';

/**
 * A status marker: the icon plus, optionally, the word.
 *
 * The icon is not decoration by default. Red and amber sit at a deuteranope
 * colour distance of roughly 2-6 on this palette against a usable floor of 6-8,
 * so for about one man in twelve - and this dashboard's audience skews male and
 * over forty - the tier colours are indistinguishable. Where the mark is drawn,
 * the shape carries the meaning and the colour only reinforces it.
 *
 * It draws a real SVG now rather than a character (▲ ● ■ ⊘). Same shapes, same
 * argument; see StatusIcon for what depending on a font was costing.
 *
 * `showGlyph={false}` suppresses the shape and keeps the word. It exists because
 * the client asked for the ranking's %OA column to read as a bare tinted figure,
 * and it is deliberately a per-call-site opt-out rather than a default: those
 * cells now rest on colour alone for a sighted reader, which is the tradeoff
 * src/domain/status.ts otherwise refuses. The map legend and the pins - where
 * there is no column header to lean on - still draw theirs.
 *
 * Either way the word goes to assistive technology, so nothing is lost to a
 * screen reader in either mode.
 */
export function StatusGlyph({
  token,
  showLabel = false,
  showGlyph = true,
  tone = 'ink',
}: {
  token: StatusToken;
  showLabel?: boolean;
  /** Draw the shape. When false only the word is emitted - see the note above. */
  showGlyph?: boolean;
  /** `ink` for text contexts, `mark` when sitting on a filled background. */
  tone?: 'ink' | 'mark';
}) {
  const t = useT();
  const label = token.labelKey ? t(token.labelKey as TKey) : '';
  const color = tone === 'ink' ? token.inkVar : token.markVar;

  // A figure that is simply present has no mark and no word - see the `value`
  // arm of MEASURE_TOKENS.
  if (!token.icon) return null;

  const word = showLabel ? <span>{label}</span> : <span className="visually-hidden">{label}</span>;

  if (!showGlyph) return word;

  return (
    <>
      {/* The span keeps `.glyph`'s flex-shrink and baseline behaviour, which
          every caller's layout is already built against; the colour goes on it
          rather than on the svg so `currentColor` inside resolves to the tone. */}
      <span className="glyph" style={{ color }}>
        <StatusIcon name={token.icon} />
      </span>
      {word}
    </>
  );
}
