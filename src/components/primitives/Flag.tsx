import th from '../../assets/flags/th.svg';
import jp from '../../assets/flags/jp.svg';
import vn from '../../assets/flags/vn.svg';
import id from '../../assets/flags/id.svg';
import us from '../../assets/flags/us.svg';
import mx from '../../assets/flags/mx.svg';
import hu from '../../assets/flags/hu.svg';

/**
 * Country flags as SVG.
 *
 * The mockup uses emoji flags (🇹🇭, 🇯🇵). Windows' Segoe UI Emoji does not
 * implement regional-indicator flag sequences, so on Chrome and Edge - the
 * corporate standard per section 14, and the only browsers this will ever run
 * on - they render as two letterboxed characters: "T" "H". Section 2 requires a
 * flag against every base, so emoji was never going to work here.
 *
 * Seven files, about a kilobyte each, identical on every OS and crisp at 4K.
 */

const FLAGS: Record<string, string> = { TH: th, JP: jp, VN: vn, ID: id, US: us, MX: mx, HU: hu };

export function Flag({
  code,
  countryName,
  size = '1.1em',
}: {
  code: string;
  /** Already translated. Used as the accessible name. */
  countryName: string;
  size?: string;
}) {
  const src = FLAGS[code.toUpperCase()];
  if (!src) {
    // Unknown country: show the code rather than nothing, so a new site added
    // to master data before its flag lands is visible rather than invisible.
    return (
      <span className="visually-hidden-fallback" aria-label={countryName}>
        {code}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      role="img"
      aria-label={countryName}
      width="auto"
      style={{
        height: size,
        width: `calc(${size} * 1.5)`,
        objectFit: 'cover',
        borderRadius: '0.125rem',
        border: '1px solid var(--line)',
        verticalAlign: '-0.15em',
        flexShrink: 0,
      }}
    />
  );
}
