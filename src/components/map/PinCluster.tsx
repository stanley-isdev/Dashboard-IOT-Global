import { useI18n } from '../../i18n/I18nProvider';
import { formatInt } from '../../i18n/format';
import type { Cluster } from './cluster';

/**
 * How many bases are under a dot, when the answer is more than one.
 *
 * See cluster.ts for why this exists and why nothing is allowed to move to
 * solve it. In short: THS and ASI cannot be separated at any zoom this map
 * offers, so the dot at that coordinate is permanently two bases, and it used to
 * wear one of their tiers without ever saying the other was there.
 *
 * The badge says the one thing the dot cannot: how many. What state each of them
 * is in is already carried, in full, by the two cards it belongs to - colour,
 * glyph and word - each joined back to this point by its own leader. A marker
 * that repeated the tiers here would be saying twice what the board already says
 * once, on the busiest twenty pixels of the panel.
 *
 * It is hung off the corner of the group's footprint rather than on the dots
 * themselves, so it never covers the coordinate it is annotating. The layout
 * pass sizes that footprint - see MapLabelLayer.
 *
 * ## It is decoration, and says so
 *
 * `aria-hidden`, because every fact behind it is already in text: both bases
 * have a card carrying a name, a country and a status. A screen reader gains
 * nothing from "2" floating between them.
 */
export function PinCluster({
  cluster,
  registerBadge,
}: {
  cluster: Cluster;
  /** Hands the element to the layout pass, which positions and sizes it. */
  registerBadge: (key: string, el: HTMLElement | null) => void;
}) {
  const { lang } = useI18n();

  return (
    <div
      className="pin-cluster"
      data-cluster={cluster.key}
      ref={(el) => registerBadge(cluster.key, el)}
      aria-hidden="true"
    >
      <span className="pin-cluster__count">{formatInt(cluster.codes.length, lang)}</span>
    </div>
  );
}
