/**
 * Which class of device is this board running on?
 *
 * The dashboard is drawn for one target: an iPad Air in landscape, 1180 x 820.
 * That layout is the default everywhere - it is the approved design, and it is
 * fluid enough to hold up on a desktop browser - so this function does not pick
 * a *layout*. It picks the handful of behaviours that only make sense on the
 * real device, all of which live in tokens.css and base.css:
 *
 *   - the wide-viewport font-size steps are suppressed, because an iPad never
 *     legitimately reaches them and a Stage Manager window that happens to be
 *     wide is not a television;
 *   - hit areas grow to Apple's 44px while the drawn controls stay at the
 *     artboard's 28px (see `.tap` in base.css);
 *   - hover styling is already gated behind `@media (hover: hover)`, which
 *     covers the iPad without needing this flag at all.
 *
 * Detection is user-agent sniffing, which is normally the wrong tool. It is the
 * right one here for a specific reason: there is no feature query that
 * distinguishes an iPad from a touchscreen Windows laptop, and the two want
 * different answers - `pointer: coarse` matches both, and the laptop is a
 * desktop for our purposes.
 */

export type Device = 'ipad' | 'desktop';

/**
 * `?device=ipad` forces the answer, which is how this gets verified in CI and
 * in a desktop browser during review. It is read once at boot and never written
 * back to storage: a colleague opening a shared link should not inherit it.
 */
export function detectDevice(search: string = window.location.search): Device {
  const forced = new URLSearchParams(search).get('device');
  if (forced === 'ipad' || forced === 'desktop') return forced;

  const ua = navigator.userAgent;

  // iPadOS 12 and earlier, and any iPad running a browser that still says so.
  if (/\biPad\b/.test(ua)) return 'ipad';

  /*
   * iPadOS 13+ requests desktop sites by default and ships the *Mac* UA string:
   * "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...". There is no iPad
   * token left anywhere in it, so the only discriminator is the touchscreen -
   * a real Mac reports maxTouchPoints 0, and no Mac has ever reported more than
   * one. This is the check every framework converged on for the same reason.
   */
  if (/\bMacintosh\b/.test(ua) && navigator.maxTouchPoints > 1) return 'ipad';

  return 'desktop';
}
