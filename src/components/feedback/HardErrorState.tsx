import { useState } from 'react';
import { Link } from 'react-router';
import { isApiError, type ApiErrorKind } from '../../api/ApiError';
import { useConfig } from '../../config/AppContext';
import { useI18n, useT } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatClockSeconds } from '../../i18n/format';
import type { RetryState } from '../../api/queries';
import { useFilters, useLinkWithFilters } from '../../state/useFilters';
import { StatePage, type StateTone } from './StatePage';
import type { StateGlyphName } from './StateGlyph';

/**
 * The states where no numbers appear at all, and what each of them says.
 *
 * Everywhere else on this board the last good payload stays visible under a
 * banner, desaturated but present - that is section 14's rule and
 * ConnectionBanner is what keeps it. This file is the other case: nothing has
 * ever loaded, so there is nothing to keep, and inventing a figure to fill the
 * space is the exact failure that rule exists to prevent.
 *
 * ## Why there is a table below and not one red box
 *
 * ApiError has carried six `kind`s since the adapter was written, and until now
 * all six rendered as the same red square over the same sentence. The kinds are
 * not variations on one fault - they are six different faults with six
 * different owners:
 *
 *   network       the LAN, or a server that is not running   -> IT, or the plug
 *   timeout       a window wider than the database can answer -> the reader
 *   http          the API is up, InfluxDB is not              -> whoever owns Influx
 *   contract      the API answered with the wrong shape       -> the dev team
 *   unauthorized  no session                                  -> sign in
 *   notfound      the code in the URL is not a site           -> the link
 *
 * A reader who cannot tell those apart from the screen has to ask somebody, and
 * on a wall panel in a corridor there is nobody to ask. So each one gets its own
 * mark, its own sentence, its own list of things to go and check, and its own
 * machine-readable line to photograph. The table is a `Record` over the union so
 * a seventh kind added to ApiError.ts is a compile error here rather than a
 * silent fall-through to a generic message.
 */

interface Descriptor {
  tone: StateTone;
  glyph: StateGlyphName;
  /**
   * The heading. These are the flat `error.<kind>` keys that were the whole of
   * the old panel's message - reworded from sentences into titles, and still
   * what `ApiError.messageKey` resolves to.
   */
  titleKey: TKey;
  bodyKey: TKey;
  /** The "try this" list, in the order somebody should work through it. */
  checkKeys: readonly TKey[];
  /**
   * The stable half of the code line. The status, the endpoint and the clock
   * time are appended from the error itself.
   */
  code: string;
  /**
   * True when the useful detail is the server's own multi-line message rather
   * than a status code - which is only `contract`, where the detail names the
   * offending field and is the single most useful string on the page.
   */
  detailIsCode?: boolean;
}

const DESCRIPTORS: Record<ApiErrorKind, Descriptor> = {
  network: {
    tone: 'crit',
    glyph: 'chain-broken',
    titleKey: 'error.network',
    bodyKey: 'error.network.body',
    checkKeys: ['error.network.check1', 'error.network.check2'],
    code: 'ERR_CONNECTION_REFUSED',
  },
  timeout: {
    tone: 'warn',
    glyph: 'clock',
    titleKey: 'error.timeout',
    bodyKey: 'error.timeout.body',
    checkKeys: ['error.timeout.check1', 'error.timeout.check2'],
    code: 'ERR_TIMED_OUT',
  },
  http: {
    tone: 'crit',
    glyph: 'database-slash',
    titleKey: 'error.http',
    bodyKey: 'error.http.body',
    checkKeys: ['error.http.check1', 'error.http.check2', 'error.http.check3'],
    code: 'ERR_INFLUX_UNREACHABLE',
  },
  contract: {
    /*
     * `other`, not `crit`. The board is broken either way, but this is the one
     * kind nobody on site can do anything about - it is a release defect - and
     * the violet is the same ink StatusSummary gives the `other` bucket: "this
     * is a category of its own, not a worse red".
     */
    tone: 'other',
    glyph: 'braces',
    titleKey: 'error.contract',
    bodyKey: 'error.contract.body',
    checkKeys: [],
    code: 'ERR_CONTRACT_MISMATCH',
    detailIsCode: true,
  },
  unauthorized: {
    tone: 'other',
    glyph: 'lock',
    titleKey: 'error.unauthorized',
    bodyKey: 'error.unauthorized.body',
    checkKeys: [],
    code: 'ERR_UNAUTHORIZED',
  },
  notfound: {
    /*
     * Neutral. A mistyped or stale link is not a fault in the system, and
     * painting it red sends somebody to check a database that is working.
     */
    tone: 'neutral',
    glyph: 'map-pin',
    titleKey: 'error.notfound',
    bodyKey: 'error.notfound.body',
    checkKeys: [],
    code: 'ERR_SITE_NOT_FOUND',
  },
};

/** The fallback for a thrown `Error` that never went through the adapter. */
const UNKNOWN: Descriptor = {
  tone: 'crit',
  glyph: 'chain-broken',
  titleKey: 'error.title',
  bodyKey: 'error.network.body',
  checkKeys: ['error.network.check1', 'error.network.check2'],
  code: 'ERR_UNKNOWN',
};

/**
 * The one screen where the board is empty because something failed.
 *
 * `retry` is optional so a route that has no query behind it - NotFoundPage -
 * can render this without inventing one.
 */
export function HardErrorState({
  error,
  onRetry,
  retry,
  siteCode,
}: {
  error: unknown;
  onRetry: () => void;
  retry?: RetryState;
  /** The company or plant code from the URL, for the `notfound` sentence. */
  siteCode?: string;
}) {
  const { t, lang } = useI18n();
  const cfg = useConfig();
  const [copied, setCopied] = useState(false);

  const api = isApiError(error) ? error : null;
  const d = api ? DESCRIPTORS[api.kind] : UNKNOWN;
  const detail = api ? api.detail : (error as Error | undefined)?.message;

  /*
   * The code line, assembled rather than templated, because which parts exist
   * depends on the kind: only `http` and `unauthorized` carry a status, only a
   * failure that has been recorded carries a time, and `contract` replaces the
   * whole line with the server's own message about the offending field.
   */
  const code = d.detailIsCode
    ? (detail ?? d.code)
    : [
        d.code,
        api?.status ? `HTTP ${api.status}` : null,
        api?.kind === 'timeout' ? `${cfg.requestTimeoutMs} MS` : null,
        api?.kind === 'notfound' ? detail : null,
        retry?.failedAt
          ? formatClockSeconds(new Date(retry.failedAt).toISOString(), cfg.referenceTimezone, lang)
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

  const copy = () => {
    void navigator.clipboard?.writeText(`${d.code}\n${detail ?? ''}`).then(
      () => setCopied(true),
      // A denied or unavailable clipboard is not worth an error state of its
      // own; the line is on screen and can be photographed, which is what the
      // code line is for in the first place.
      () => undefined,
    );
  };

  return (
    <StatePage
      tone={d.tone}
      glyph={d.glyph}
      title={t(d.titleKey, { sec: Math.round(cfg.requestTimeoutMs / 1000) })}
      body={t(d.bodyKey, { code: siteCode ?? '' })}
      checks={d.checkKeys.map((k) => t(k))}
      checksLabel={t('state.try')}
      code={code}
      codeMultiline={d.detailIsCode}
      busy={retry?.inFlight ?? false}
      reload={{ label: t('state.reload'), onClick: onRetry }}
      actions={
        <>
          {/* The one thing this particular fault can be acted on with, first. */}
          <KindAction kind={api?.kind} onCopy={copy} copied={copied} />
          <RetryLine retry={retry} onRetry={onRetry} />
        </>
      }
    />
  );
}

/**
 * The button that does something about *this* fault, where one exists.
 *
 * It lives here rather than being passed in by each page because two of the
 * three actions are shell-level - narrowing the time range and going back to
 * the overview are both filter/router operations, not page ones - and having
 * three pages each construct their own copy of them is three chances for them
 * to drift. `useFilters` and `useLinkWithFilters` are usable from anywhere
 * inside the router, which is the whole reason the filters live in the URL.
 *
 * `network`, `http` and `unknown` get nothing: there is no button that fixes a
 * dead service, and offering one that only looks like it might is worse than
 * offering none. Those three carry the check list and Retry alone.
 */
function KindAction({
  kind,
  onCopy,
  copied,
}: {
  kind: ApiErrorKind | undefined;
  onCopy: () => void;
  copied: boolean;
}) {
  const t = useT();
  const [, setFilters] = useFilters();
  const link = useLinkWithFilters();

  switch (kind) {
    case 'timeout':
      /* Clears the absolute window as well as the quick range: leaving `from`
         and `to` set would send the same too-wide request the picker's own
         label no longer showed. */
      return (
        <button
          type="button"
          className="chip chip--action tap"
          onClick={() => setFilters({ range: '24h', from: null, to: null })}
        >
          {t('error.timeout.narrow')}
        </button>
      );

    case 'notfound':
      return (
        <Link className="chip chip--action tap" to={link('/overview')}>
          {t('error.notfound.home')}
        </Link>
      );

    case 'contract':
      return (
        <button type="button" className="chip chip--action tap" onClick={onCopy}>
          {copied ? t('state.copied') : t('state.copy')}
        </button>
      );

    /*
     * No sign-in button, and no string for one either.
     *
     * There is no sign-in route yet - D-08 - and a button that goes nowhere is
     * worse than the sentence above it, which at least says what has happened.
     * `error.unauthorized.action` was written for this and then deleted rather
     * than left sitting in both dictionaries unused: a translated string with
     * no caller is a claim that a feature exists. Both come back with the route.
     */
    case 'unauthorized':
    default:
      return null;
  }
}

/**
 * What the board is doing about the failure, as one line inside the actions row.
 *
 * Deliberately not a page of its own. A separate "reconnecting" screen was the
 * first design, and on a wall panel it swapped the whole page in and out every
 * few seconds while the backoff climbed - the diagnosis a reader was halfway
 * through reading kept vanishing. One line changing under a page that holds
 * still says the same thing and costs nothing.
 *
 * No countdown. TanStack Query does not publish when the next attempt fires,
 * and a timer this end guessed at would be a fabricated figure on a board whose
 * whole design forbids them.
 */
function RetryLine({ retry, onRetry }: { retry?: RetryState; onRetry: () => void }) {
  const t = useT();
  if (!retry) return null;

  if (retry.inFlight) {
    return (
      <span className="statepage__note">
        {t('state.retrying', { n: Math.min(retry.attempt + 1, retry.limit), total: retry.limit })}
      </span>
    );
  }

  return (
    <>
      <button type="button" className="chip tap" onClick={onRetry}>
        {t('state.retryNow')}
      </button>
      <span className="statepage__note">
        {retry.autoMs === null ? t('state.retryOff') : t('state.retryAuto')}
      </span>
    </>
  );
}

/**
 * Nothing has loaded yet and nothing has failed.
 *
 * This replaced a bare `<div className="skeleton" style={{ height: '24rem' }} />`
 * on the two drill-downs - one grey slab, which says "something is here" and
 * not "this is working". It says what is being fetched instead, because on a
 * cold InfluxDB the first load can sit here for seconds and the difference
 * between "slow" and "broken" is the only question a reader has.
 *
 * `role="status"` rather than `alert`: this is not news, and a wall panel that
 * announced every first paint would be unusable with a screen reader.
 *
 * Note there is no count of bases in the title. The board does not know how
 * many there are until the payload it is waiting for arrives, and printing a
 * remembered nine would be the same invention as a remembered figure.
 */
export function LoadingState({ name }: { name?: string }) {
  const t = useT();
  const [filters] = useFilters();

  /*
   * The scope being waited on, from the filter row rather than from the payload
   * - which is the point: this is the one screen where there is no payload to
   * read it off, and "loading" without saying loading *what* is what the grey
   * slab this replaced already said.
   *
   * Process names are never translated. They are SAP's values, like the company
   * and plant codes, and ProcessFilter prints them raw for the same reason.
   */
  const detail = t('state.loading.body', {
    range: t(`range.${filters.range}.short`),
    process: filters.process === 'all' ? t('filter.all') : filters.process,
  });

  return (
    <StatePage
      tone="neutral"
      glyph="database"
      title={name ? t('state.loading.scope', { name }) : t('state.loading.overview')}
      body={detail}
      busy
      live="status"
      code={t('state.loading.code')}
    />
  );
}

/**
 * The query succeeded and matched nothing.
 *
 * The state the board had no answer for at all: `region=none` returns HTTP 200
 * with an empty array, so every panel rendered empty and the screen was
 * indistinguishable from a fault. It is the opposite of a fault - the system is
 * working and the reader narrowed it to nothing - which is why the tone is
 * neutral, the mark is a funnel, the freshness badge stays Live, and there is
 * no error code anywhere on it.
 *
 * The filter row is NOT hidden behind this state. Everywhere else on this file
 * the row comes off because pressing anything in it would do nothing; here it
 * is where the fix is, and the Region capsule is already flagged as narrowed by
 * RegionFilter's own `narrowed` rule.
 */
export function EmptyState({
  noRegion,
  onSelectAll,
  onClear,
}: {
  /** True when the cause is specifically an empty Region tick-list. */
  noRegion: boolean;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <StatePage
      tone="neutral"
      glyph="funnel"
      title={t('empty.title')}
      body={t(noRegion ? 'empty.noRegion' : 'empty.narrowed')}
      live="status"
      actions={
        <>
          {noRegion ? (
            <button type="button" className="chip chip--action tap" onClick={onSelectAll}>
              {t('empty.selectAll')}
            </button>
          ) : null}
          <button type="button" className="chip tap" onClick={onClear}>
            {t('empty.clear')}
          </button>
        </>
      }
    />
  );
}

/**
 * Loading placeholder for one KPI card. Deliberately never renders a zero.
 *
 * Same order as a real card - label, figure, caption - so the strip does not
 * visibly reflow when the first payload lands.
 *
 * Kept, and deliberately not replaced by LoadingState above. This is the one
 * place a skeleton earns its keep: the overview's strip is six cards in a fixed
 * row, and holding that row at its real height is what stops the whole board
 * stepping down and back up when a poll lands. A state page cannot do that,
 * because a state page is what replaces the board rather than standing in for
 * one row of it.
 */
export function SkeletonKpi() {
  return (
    /* `kpi--feature` because that is what every card of the overview strip now
       renders as, and this placeholder's whole job is to hold the row at the
       height the real card will take. Without it the strip steps taller the
       moment the first payload lands, which is the reflow this exists to
       prevent. */
    <div className="kpi kpi--feature" aria-hidden="true">
      <div className="kpi__head">
        <div className="kpi__label skeleton" style={{ width: '60%' }}>
          &nbsp;
        </div>
      </div>
      <div className="kpi__value skeleton" style={{ width: '45%' }}>
        &nbsp;
      </div>
      <div className="kpi__foot">
        <span className="skeleton" style={{ display: 'inline-block', width: '75%' }}>
          &nbsp;
        </span>
      </div>
    </div>
  );
}
