import { useT } from '../../i18n/I18nProvider';
import { StateGlyph, type StateGlyphName } from './StateGlyph';

/**
 * One panel with nothing in it, while the rest of the board is fine.
 *
 * The small sibling of StatePage, and the distinction is which question the
 * screen is answering. StatePage replaces the whole board because there are no
 * numbers anywhere; this replaces the rows inside one panel because the site is
 * real, its KPI cards are correct, and only this list came back empty. Blanking
 * a drill-down to a full-page notice because the Zone filter excluded six
 * machines would throw away every figure that was still true.
 *
 * ## The bug this exists to fix
 *
 * The three panels that could come back empty each printed one hardcoded
 * sentence for two different causes:
 *
 *   MachineGrid       "No telemetry yet"     - also shown when Zone excluded all
 *   CompanyPage       the site's status mark - also shown when Lamp excluded all
 *
 * "No telemetry yet" over a plant that is reporting perfectly, because somebody
 * left a Zone ticked, sends an engineer to check a gateway that is fine. The
 * two causes need different sentences and only one of them offers a way out,
 * which is what `action` is for: a filter the reader set is a filter the reader
 * can be handed back.
 *
 * The mark is the same funnel StatePage uses for the board-level version of
 * this, at panel scale - so a reader who has seen the big one recognises the
 * small one without being told.
 */
export function PanelEmpty({
  glyph = 'funnel',
  message,
  action,
}: {
  glyph?: StateGlyphName;
  message: string;
  /** Offered only when the cause is something the reader can undo. */
  action?: { label: string; onClick: () => void };
}) {
  const t = useT();
  return (
    <div className="panel-empty">
      {/* 1.75rem against the state page's 3rem: this has to sit inside a panel
          without competing with the panel's own heading. */}
      <StateGlyph name={glyph} size="1.75rem" />
      <p className="panel-empty__message">{message}</p>
      {action ? (
        <button type="button" className="chip tap" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      {/* The reassurance the board-level empty state also leads with: the
          system is working, and this is a consequence of a choice. Only shown
          alongside an action, because without one the cause is not a choice. */}
      {action ? <p className="panel-empty__note">{t('empty.panel.working')}</p> : null}
    </div>
  );
}
