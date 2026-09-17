// Schedule tab: read-only weekly calendar (7 day-columns Sun→Sat) matching the approved mockup.
// Markup/classes are ported verbatim from the mockup (box scbox / cal / calcol / calscroll /
// daily-strip / evt ag-<agent> / caltotal / tray). The per-day token total pins to the bottom of
// each column because .caltotal lives OUTSIDE the scrollable .calscroll. Day totals come from
// dayTotals() (in K) so the unit tests' unit math holds. Every dynamic value escaped via esc();
// never throws on null/empty schedule.
//
// The one-off tray is REAL as of 2026-07-26. It used to be a hardcoded "No one-off jobs." string
// with a "+ New one-off" button that only toasted "Phase 2" — so a job you fired from the Agents
// tab could never appear here no matter what happened to it. Both are now wired: the button opens
// the same dispatch form the Agents tab uses, and the tray renders js/oneoffs.js's ledger with the
// job's true state (submitting / pending / accepted / refused / failed). Nothing is shown as
// succeeded on optimism.

import { esc, hh, estCost, dayTotals, safe, isStale } from '../util.js';
import { toast, openDispatchModal, dispatchOneOff } from './agents.js';
import { listOneOffs, reconcileOneOffs, removeOneOff, clearFinishedOneOffs, TERMINAL } from '../oneoffs.js';
import { busConfigured } from '../busclient.js';
import { setState } from '../state.js';

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
  // Under a minute is "just now" — flooring to "0m ago" read as a broken clock on a row the
  // user had only just created.
  if (ms < 0 || ms < 60000) return 'just now';
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

// ── One-off tray ──────────────────────────────────────────────────────────────
// Each state gets its own label + colour. `submitting` and `pending` are deliberately NOT
// green: the job has been handed off, not confirmed. Green only appears once the consumer
// has actually replied ok.
const OO_STATE = {
  submitting: { icon: '◌', label: 'Sending…',  color: 'var(--faint)' },
  pending:    { icon: '⟳', label: 'Queued',    color: 'var(--running, var(--warn))' },
  accepted:   { icon: '✓', label: 'Accepted',  color: 'var(--success)' },
  refused:    { icon: '✗', label: 'Refused',   color: 'var(--fail)' },
  failed:     { icon: '!', label: 'Not sent',  color: 'var(--fail)' },
};

function oneOffRowHtml(r) {
  const st = OO_STATE[r.state] || OO_STATE.submitting;
  const agent = esc(String(r.agent || '').toLowerCase());
  // A refusal reason is the single most useful thing on this row — never truncate it away.
  const reason = r.reason
    ? `<div class="oo-reason faint">${esc(r.reason)}</div>`
    : '';
  // Only a job that never left the browser can be retried as-is; a refused one needs editing.
  const retry = r.state === 'failed'
    ? `<button class="btn sm ghost" data-action="ooRetry" data-lid="${esc(r.lid)}" title="Send this job again">Retry</button>`
    : '';
  const when = r.runMode && r.runMode !== 'Downtime' ? `<span class="chip">${esc(r.runMode)}</span>` : '';
  return `<div class="oo-row" data-lid="${esc(r.lid)}">`
    + `<span class="oo-icon" style="color:${st.color}" title="${esc(st.label)}">${st.icon}</span>`
    + `<span class="oo-name ag-text-${agent}">${esc(r.title || 'One-off job')}</span>`
    + `<span class="oo-agent faint">${esc(r.agent || '—')}</span>`
    + when
    + `<span class="oo-state" style="color:${st.color}">${esc(st.label)}</span>`
    + `<span class="oo-time faint">${esc(relTime(r.ts))}</span>`
    + retry
    + `<button class="oo-x" data-action="ooDismiss" data-lid="${esc(r.lid)}" title="Remove from this list" aria-label="Dismiss">×</button>`
    + reason
    + `</div>`;
}

function trayHtml() {
  const rows = listOneOffs();
  if (!rows.length) {
    // Distinguish "nothing fired yet" from "nothing can be fired" — an unset bus token is the
    // reason every write button on this dashboard silently did nothing, so name it here.
    return busConfigured()
      ? '<span class="faint" style="font-size:12px">No one-off jobs yet — hit <b>+ New one-off</b> to fire one.</span>'
      : '<span class="faint" style="font-size:12px">Not connected to the bus — open <b>Settings (⚙)</b> and add your acc-bus token, '
        + 'or one-off jobs can\'t be sent.</span>';
  }
  return rows.map(oneOffRowHtml).join('');
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

  const anyFinished = listOneOffs().some((r) => TERMINAL.has(r.state));
  const clearBtn = anyFinished
    ? '<button class="btn sm ghost" data-action="ooClear" title="Remove finished rows">Clear finished</button>'
    : '';

  panel.innerHTML = `<div class="box scbox">`
    + `<div class="ptitle">This week${stale} <span class="faint">colored by agent · `
    + `block height ≈ size · live token total per day at the bottom</span></div>`
    + `<div class="cal" id="calRoot">${cols}</div></div>`
    + `<div class="tray">`
    + `<div class="tray-h">⚡ One-off jobs <span class="faint">— fired by hand, tracked until the desk answers</span>`
    + `<span class="spacer"></span>${clearBtn}`
    + `<button class="btn sm" data-action="newOneOff">+ New one-off</button></div>`
    + `<div class="tray-items oo-list" id="trayItems">${trayHtml()}</div>`
    + `</div>`;
  // Recent-runs block intentionally removed from this tab — that history lives on the Overview tab.
  // Dropping it lets the calendar + one-off tray fill the embed's max height without scrolling.
  wireSchedule(panel);
  pokeReconcile();
}

// Ask the bus whether any queued one-off has been answered, and re-render only if something
// actually changed. Guarded against re-entry so the setState it triggers can't loop: render →
// pokeReconcile → setState → render.
let reconcileBusy = false;
function pokeReconcile() {
  if (reconcileBusy) return;
  const pending = listOneOffs().some((r) => r.state === 'pending');
  if (!pending) return;
  reconcileBusy = true;
  reconcileOneOffs()
    .then((changed) => { if (changed) setState({ oneOffsRev: Date.now() }); })
    .catch(() => { /* offline — rows stay queued, which is the honest state */ })
    .finally(() => { reconcileBusy = false; });
}

function wireSchedule(panel) {
  if (panel.__schedWired) return;
  panel.__schedWired = true;

  // Drag-to-schedule was a stub that toasted "Scheduling is Phase 2" on any drop — it looked
  // like a feature and moved nothing. There is no bus action for "put this job on Thursday"
  // (request_job has no time field), so the honest move is to point at what DOES work.
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    toast('Dragging onto a day isn\'t wired — set a recurring time on the Registry tab, or fire it now with + New one-off');
  });

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="newOneOff"]')) {
      if (!busConfigured()) {
        // Opening the form here would let Eddie fill it in and watch it fail. Say it first.
        toast('Not connected — add your acc-bus token in Settings (⚙) first');
        return;
      }
      openDispatchModal('Custom');
      return;
    }
    const dismiss = e.target.closest('[data-action="ooDismiss"]');
    if (dismiss) {
      removeOneOff(dismiss.dataset.lid);
      setState({ oneOffsRev: Date.now() });
      return;
    }
    if (e.target.closest('[data-action="ooClear"]')) {
      clearFinishedOneOffs();
      setState({ oneOffsRev: Date.now() });
      return;
    }
    const retry = e.target.closest('[data-action="ooRetry"]');
    if (retry) {
      const row = listOneOffs().find((r) => r.lid === retry.dataset.lid);
      if (!row) return;
      // Re-send as a fresh row so the failed attempt stays on the record.
      dispatchOneOff({
        job: row.title, agent: row.agent, taskType: row.taskType,
        details: row.goal, runMode: row.runMode, model: row.model,
      }, `Resent: ${row.title}`);
    }
  });
}
