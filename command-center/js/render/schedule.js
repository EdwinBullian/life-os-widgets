// Schedule tab: read-only weekly calendar (7 day-columns Sun→Sat) matching the approved mockup.
// Markup/classes are ported verbatim from the mockup (box scbox / cal / calcol / calscroll /
// daily-strip / evt ag-<agent> / caltotal / tray). The per-day token total pins to the bottom of
// each column because .caltotal lives OUTSIDE the scrollable .calscroll. Day totals come from
// dayTotals() (in K) so the unit tests' unit math holds. Drag-drop + "New one-off" are Phase-2
// stubs (toast only). Every dynamic value escaped via esc(); never throws on null/empty schedule.
// v2: recentRuns section added below the tray — reads sched.recentRuns[] (max 5 rows).

import { esc, hh, estCost, dayTotals, safe, isStale } from '../util.js';
import { toast } from './agents.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// schedule.json is regenerated ~daily; flag stale past 2×24h (isStale uses 2× cadence).
const SCHEDULE_CADENCE_MS = 24 * 60 * 60 * 1000;

const STATUS_ICON = { success: '✓', failed: '✗', partial: '~', skipped: '–', running: '⟳' };
const STATUS_COLOR = {
  success: 'var(--success)',
  failed:  'var(--fail)',
  partial: 'var(--warn)',
  skipped: 'var(--faint)',
  running: 'var(--running)',
};

function isSchedule(s) {
  return s && typeof s === 'object' && Array.isArray(s.week);
}

// relative-time helper (no deps)
function relTime(isoStr) {
  if (!isoStr) return '—';
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 0 || ms < 30000) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// One event block. `tok` arrives RAW (e.g. 120000) → convert to K for display + height.
function eventHtml(e) {
  const agent = esc(e.agent || '');
  const tokK = Math.round((Number(e.tok) || 0) / 1000);
  const H = Math.min(150, Math.round(24 + tokK * 0.5));
  return `<div class="evt ag-${agent}" style="min-height:${H}px">`
    + `<div class="tm">${esc(hh(Number(e.hour) || 0))}</div>`
    + `<div class="t">${esc(e.name || '')}</div>`
    + `<div style="margin-top:1px"><span class="chip ${esc(e.tier || '')}">${esc(e.model || '')}</span></div>`
    + `<div class="ft"><span>≈${esc(tokK)}k tok</span>`
    + `<span>${esc(estCost({ tier: e.tier, tok: Number(e.tok) || 0 }))}</span></div></div>`;
}

function buildRecentRunsHtml(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return '<span class="faint" style="font-size:12px">No recent runs yet.</span>';
  }
  return runs.slice(0, 10).map((r) => {
    const status = (r.status || 'success').toLowerCase();
    const icon  = STATUS_ICON[status]  || '·';
    const color = STATUS_COLOR[status] || 'var(--text)';
    const agent = esc(r.agent || '');
    const model = r.model ? `<span class="chip" style="margin-left:auto">${esc(r.model)}</span>` : '<span class="spacer"></span>';
    return `<div class="rr-row">`
      + `<span class="rr-icon" style="color:${color}">${icon}</span>`
      + `<span class="rr-name ag-text-${agent}">${esc(r.name || r.taskId || '?')}</span>`
      + `<span class="rr-sep faint">·</span>`
      + `<span class="rr-agent faint">${agent}</span>`
      + model
      + `<span class="rr-time faint">${esc(relTime(r.ranAt))}</span>`
      + `</div>`;
  }).join('');
}

export function renderSchedule(state, panelArg) {
  const panel = panelArg || document.getElementById('schedule');
  if (!panel) return;
  const sched = safe(state.schedule, null);
  if (!isSchedule(sched)) {
    panel.innerHTML = '<div class="empty-state">No schedule data yet.</div>';
    wireSchedule(panel);
    return;
  }

  const week = sched.week;
  const dailyBaseK = Number(sched.dailyBaseK) || 0;
  const dailies = Array.isArray(sched.dailies) ? sched.dailies : [];
  const totals = dayTotals(week, dailyBaseK); // [{day,k,heavy}] in K, incl. daily base
  const today = new Date().getDay();
  const stale = isStale(sched.updated, SCHEDULE_CADENCE_MS)
    ? ' <span class="stale" title="schedule may be stale">stale</span>' : '';

  const dailyStrip = `<div class="daily-strip" title="Daily locked jobs you never touch">`
    + `⟳ Daily ×${dailies.length} · locked · ~${esc(dailyBaseK)}k<br>`
    + `<span style="opacity:.8">${dailies.map((d) => esc(d)).join(' · ')}</span></div>`;

  const cols = DAYS.map((name, i) => {
    const evts = week
      .filter((e) => Number(e.day) === i)
      .sort((a, b) => (Number(a.hour) || 0) - (Number(b.hour) || 0))
      .map(eventHtml).join('');
    const tot = totals[i];
    const totColor = tot.heavy ? 'var(--warn)' : 'var(--text)';
    return `<div class="calcol${i === today ? ' today' : ''}" data-day="${i}">`
      + `<div class="calhd"><span>${esc(name)}</span>${i === today ? '<span class="td">today</span>' : ''}</div>`
      + `<div class="calscroll">${dailyStrip}${evts}</div>`
      + `<div class="caltotal"><span>day total</span>`
      + `<b style="color:${totColor}">≈${esc(tot.k)}k</b></div></div>`;
  }).join('');

  const trayItemsHtml = '<span class="faint" style="font-size:12px">No one-off jobs.</span>';

  panel.innerHTML = `<div class="box scbox">`
    + `<div class="ptitle">This week${stale} <span class="faint">colored by agent · `
    + `block height ≈ size · live token total per day at the bottom</span></div>`
    + `<div class="cal" id="calRoot">${cols}</div></div>`
    + `<div class="tray">`
    + `<div class="tray-h">⠿ One-off jobs — <b style="color:var(--text)">drag onto a day</b> `
    + `to schedule, or use <span class="chip">soonest available</span>`
    + `<span class="spacer"></span>`
    + `<button class="btn sm ghost" data-action="newOneOff">+ New one-off</button></div>`
    + `<div class="tray-items" id="trayItems">${trayItemsHtml}</div>`
    + `</div>`;
  // Recent-runs block intentionally removed from this tab — that history lives on the Overview tab.
  // Dropping it lets the calendar + one-off tray fill the embed's max height without scrolling.
  wireSchedule(panel);
}

function wireSchedule(panel) {
  if (panel.__schedWired) return;
  panel.__schedWired = true;
  // Drag-drop scheduling + "New one-off" are Phase-2 stubs: toast only, never mutate state.
  const stub = (e) => { e.preventDefault(); toast('Scheduling is Phase 2'); };
  panel.addEventListener('drop', stub);
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="newOneOff"]')) toast('One-off jobs are Phase 2');
  });
}
