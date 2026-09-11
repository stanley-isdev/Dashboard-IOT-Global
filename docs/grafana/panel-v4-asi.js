/*
 * Machine Status V2.0 - ASI board (`adz5fll`), panel JS, v4.
 * Captured from the live panel on 2026-09-11.
 *
 * ## Not the whole script - and what was left out
 *
 * Kept: every rule that decides a NUMBER or whether a machine appears at all.
 * Dropped: number/percent formatting, the progress bar, the PO "(+n)" hint, the
 * no-fade signature check, card grouping by machine, the 1 s timer loop, and
 * the MutationObserver plumbing. None of those change a count, a percentage,
 * or the set of machines on screen, and carrying them here would mean this file
 * goes stale in ways that do not matter.
 *
 * ## The answer this file was captured for
 *
 * `M-ID-06` was absent from the board on 2026-09-11 while our machine list
 * carried it. Step 5 below says why, in the panel author's own words: the
 * content template renders NO card for `Pending` or `Order End` - only a hidden
 * `.nav-marker` - and the summary bar counts those markers onto a chip that
 * links to a separate dashboard for each status. The machine is not missing
 * from the board; it has been moved off the wall and onto `order-end-v1-0`.
 *
 * That also makes `EXCLUDE_FROM_TOTAL` belt-and-braces: a status with no card
 * can never reach `counts` in the first place.
 */

// ---------------------------------------------------------------- step 5
// "Pending / Order End tallies - Content never renders a full card for these
//  statuses (just a hidden .nav-marker), so counting is a plain query, nothing
//  to strip out."
var NAV_STATUSES = [
    {
        status: 'Pending',
        cls: 'pending',
        url: 'http://10.201.128.87:3000/d/adr29kh/pending-v1-0?orgId=1&from=now-6h&to=now&timezone=Asia%2FBangkok'
    },
    {
        status: 'Order End',
        cls: 'order-end',
        url: 'http://10.201.128.87:3000/d/adj4fq4/order-end-v1-0?orgId=1&from=now-6h&to=now&timezone=Asia%2FBangkok'
    }
];

var navStat = {};
for (var ns = 0; ns < NAV_STATUSES.length; ns++) {
    var navName = NAV_STATUSES[ns].status;
    var navSafe = navName.replace(/["\]/g, '\$&');
    navStat[navName] = { count: document.querySelectorAll('.nav-marker[data-status="' + navSafe + '"]').length };
}

// ---------------------------------------------------------------- step 8
// Legend chips hide a status by stylesheet. Per-viewer, held on `window`, so it
// resets on reload - it is a reader's filter, never a rule about the data.
function applyHiddenStatusStyles() {
    var block = getFilterStyleBlock();
    var rules = Array.from(window.grafanaDashboardHiddenStatuses).map(function (status) {
        var safe = status.replace(/["\]/g, '\$&');
        return '.card-link:has(.card-box[data-status="' + safe + '"]) { display: none !important; }';
    });
    var next = rules.join('\n');
    if (block.textContent !== next) block.textContent = next;
}

// ---------------------------------------------------------------- step 9
var KNOWN_STYLES = {
    'Mass Pro':  { cls: 'mass-pro',  order: 1 },
    'Dandori':   { cls: 'dandori',   order: 2 },
    'Stop':      { cls: 'stop',      order: 3 },
    'No Plan':   { cls: 'no-plan',   order: 4 },
    '4M Change': { cls: 'four-m',    order: 5 },
    'Offline':   { cls: 'offline',   order: 6 },
    'Alarm':     { cls: 'alarm',     order: 7 }
};
var EXCLUDE_FROM_TOTAL = ['Order End', 'Pending'];
var EXCLUDE_FROM_OA = ['Order End', 'Pending', 'Offline', 'No Plan'];

// The census, the average and TOTAL - all three read the rendered CARDS, so the
// unit is (machine x PO group), not machine.
var cards = document.querySelectorAll('.card-box');
var counts = {};
var totalOA = 0;
var oaCount = 0;

for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var st = (card.getAttribute('data-status') || 'Unknown').trim();
    counts[st] = (counts[st] || 0) + 1;

    var oaEl = card.querySelector('.fmt-oa');
    if (oaEl) {
        var oaVal = parseFloat(oaEl.textContent);
        // `oaVal > 0` as well as the status list: a card reading 0% is out of
        // the average. Ours cannot hit that case - a zero numerator leaves
        // `oaPct: null` through `NULLIF` - so it costs no divergence.
        if (!isNaN(oaVal) && oaVal > 0 && EXCLUDE_FROM_OA.indexOf(st) === -1) {
            totalOA += oaVal;
            oaCount++;
        }
    }
}

var avgOA = oaCount > 0 ? (totalOA / oaCount) : 0;

var total = statusKeys
    .filter(function (k) { return EXCLUDE_FROM_TOTAL.indexOf(k) === -1; })
    .reduce(function (sum, k) { return sum + counts[k]; }, 0);

var running = counts['Mass Pro'] || 0;
var dandori = counts['Dandori'] || 0;
var stopped = counts['Stop'] || 0;
// NOTE: the board's RUNNING is `Mass Pro` alone here - Dandori is its own tile,
// not folded in. Ours buckets Dandori into running (BUCKET_OF), which is the
// older v3 rule (`running = Mass Pro + Dandori`). Worth re-checking against the
// tiles on screen before anyone reconciles RUNNING again.

// ------------------------------------------------------------- collapse
// A column with every card hidden collapses. Presentation only.
function collapseEmptyColumns() {
    var hidden = window.grafanaDashboardHiddenStatuses;
    var cols = document.querySelectorAll('.machine-column');
    for (var i = 0; i < cols.length; i++) {
        var boxes = cols[i].querySelectorAll('.card-box');
        var hasVisible = false;
        for (var j = 0; j < boxes.length; j++) {
            var st = (boxes[j].getAttribute('data-status') || 'Unknown').trim();
            if (!hidden.has(st)) { hasVisible = true; break; }
        }
        var want = hasVisible ? 'flex' : 'none';
        if (cols[i].style.display !== want) cols[i].style.display = want;
    }
}

// --------------------------------------------------------------- timers
// `Order End` and `Offline` have no running clock - the card shows `--:--:--`.
var inactive = ['Order End', 'Offline'].indexOf(status) !== -1 || !startStr || isNaN(startTime);
