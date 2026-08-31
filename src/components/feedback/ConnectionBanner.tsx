import { useState } from 'react';
import type { ConnectionInfo } from '../../domain/connectionState';
import type { StatusIconName } from '../../domain/status';
import { useI18n, type Lang, type TFunction } from '../../i18n/I18nProvider';
import { formatAge, formatDateTime } from '../../i18n/format';
import { StatusIcon } from '../primitives/StatusIcon';

/**
 * The banner that keeps the "never show 0 or a blank" requirement honest.
 *
 * It floats over the top-right corner of the data region rather than sitting in
 * the flow above it. In the flow it shortened the board row every time a source
 * blinked, so the KPI strip and the map stepped down and back up while somebody
 * was reading them; over the corner it costs the layout nothing and covering a
 * card's caption is the cheaper of the two prices.
 *
 * It can be dismissed, but the dismissal is keyed to what the banner is
 * actually saying - the state plus the sources named - so a different fault, or
 * the same one after a recovery, raises it again. The data underneath stays
 * rendered - desaturated and hatched, but present - because the last thing that
 * was true is more useful to an executive than an empty grid, provided nothing
 * on screen claims it is current.
 *
 * Note there is no skeleton here on refetch. Blanking to skeletons every thirty
 * seconds would hide the last known truth and make the page flicker on a wall
 * panel; `aria-busy` communicates the same thing to assistive technology
 * without destroying the view.
 */

interface Notice {
  /** Identity of the message, so dismissing one fault does not silence the next. */
  key: string;
  tone: 'warn' | 'crit';
  /* Drawn, not typed. The set in StatusIcon is where a warning already looks
     like a warning - a rounded exclamation triangle rather than a ▲ the font
     happens to draw as a pointy bullet. */
  icon: StatusIconName;
  title: string;
  body: string;
  role: 'alert' | 'status';
  retry: boolean;
}

function describe(
  info: ConnectionInfo,
  t: TFunction,
  lang: Lang,
  referenceTimezone: string,
): Notice | null {
  if (info.state === 'live' && !info.degraded) return null;
  if (info.state === 'cold' || info.state === 'cold_fail') return null;

  if (info.state === 'frozen' && info.snapshotAt) {
    return {
      key: `frozen:${info.snapshotAt}`,
      tone: 'crit',
      icon: 'clock',
      role: 'alert',
      retry: true,
      title: t('banner.frozen.title'),
      body: t('banner.frozen.body', {
        time: formatDateTime(info.snapshotAt, referenceTimezone, lang),
      }),
    };
  }

  if (info.state === 'stale' && info.snapshotAt) {
    return {
      key: `stale:${info.snapshotAt}`,
      tone: 'warn',
      icon: 'clock',
      role: 'alert',
      retry: true,
      title: t('banner.stale.title'),
      body: t('banner.stale.body', {
        time: formatDateTime(info.snapshotAt, referenceTimezone, lang),
        age: formatAge(info.ageSec ?? 0, lang),
      }),
    };
  }

  // Live, but the backend told us a source is unavailable. Naming the source
  // beats silently serving an incomplete page as if it were whole.
  if (info.downSources.length > 0) {
    const sources = info.downSources.join(', ');
    return {
      key: `partial:${sources}`,
      tone: 'warn',
      icon: 'alert-triangle',
      role: 'status',
      retry: false,
      title: t('banner.partial.title'),
      body: t('banner.partial.body', { sources }),
    };
  }

  return null;
}

export function ConnectionBanner({
  info,
  referenceTimezone,
  onRetry,
}: {
  info: ConnectionInfo;
  referenceTimezone: string;
  onRetry: () => void;
}) {
  const { t, lang } = useI18n();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const notice = describe(info, t, lang, referenceTimezone);
  if (!notice || notice.key === dismissed) return null;

  return (
    <div className={`banner banner--${notice.tone} banner--float`} role={notice.role}>
      <span className="banner__icon" aria-hidden="true">
        <StatusIcon name={notice.icon} size="1.4em" />
      </span>
      <div className="banner__body">
        <div className="banner__title">{notice.title}</div>
        <div>{notice.body}</div>
      </div>
      {notice.retry ? (
        <button type="button" className="banner__action" onClick={onRetry}>
          {t('banner.retry')}
        </button>
      ) : null}
      <button
        type="button"
        className="banner__close tap"
        onClick={() => setDismissed(notice.key)}
      >
        <span aria-hidden="true">✕</span>
        <span className="visually-hidden">{t('banner.dismiss')}</span>
      </button>
    </div>
  );
}

/** Shown whenever the build is serving generated data, so a demo is never mistaken for production. */
export function MockDataBanner() {
  const { t } = useI18n();
  return (
    <div className="banner banner--info" role="status">
      <span className="glyph" aria-hidden="true">
        ◇
      </span>
      <div className="banner__body">
        <div className="banner__title">{t('banner.mock.title')}</div>
        <div>{t('banner.mock.body')}</div>
      </div>
    </div>
  );
}

/** Shown when runtime-config.json could not be read and defaults are in use. */
export function ConfigProblemBanner({ problem }: { problem: string }) {
  const { t } = useI18n();
  return (
    <div className="banner banner--crit" role="alert">
      <span className="glyph" aria-hidden="true">
        ■
      </span>
      <div className="banner__body">
        <div className="banner__title">{t('banner.config.title')}</div>
        <div className="mono">{problem}</div>
      </div>
    </div>
  );
}
