// Schedule tab: read-only weekly calendar (7 day-columns Sun→Sat) + per-day token counter.
// Drag-drop scheduling is a Phase-2 stub (drop → toast only, no setState/postAction). All
// dynamic text escaped via esc(); the one-off tray drop is the only interaction, delegated.

import { esc, hh, estCost, dayTotals, evtHeight, safe, isStale } from '../util.js';
import { toast } from './agents.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_SCHEDULE = { updated: '', dailyBaseK: 0, week: [], dailies: [] };
// schedule.json is regenerated ~daily; flag stale past 2×24h.
const SCHEDULE_CADENCE_MS = 24 * 60 * 60 * 1000;

function isSchedule(s) {
  return s && typeof s === 'object' && Array.isArray(s.week);
}

function eventHtml(e) {
  const agent = esc(e.agent || '');
  const tok = Number(e.tok) || 0;
  return `<div class="evt" style="border-left:3px solid var(--tag-${agent});height:${evtHeight(tok)}px">`
    + `<div class="evt-time">${esc(hh(Number(e.hour) || 0))}</div>`
    + `<div class="evt-name">${esc(e.name || '')}</div>`
    + `<div class="evt-foot"><span class="chip">${esc(e.model || '')}</span>`
    + `<span class="evt-cost">${esc(estCost({ tier: e.tier, tok }))}</span></div></div>`;
}

export function renderSchedule(state, panelArg) {
  const panel = panelArg || document.getElementById('schedule');
  if (!panel) return;
  const sched = safe(state.schedule, null);
  if (!isSchedule(sched) || !sched.week.length) {
    panel.innerHTML = '<div class="empty-state">No schedule data yet.</div>';
    wireSchedule(panel);
    return;
  }
  const totals = dayTotals(sched.week, sched.dailyBaseK); // [{day,k,heavy}] incl. daily base
  const dailies = Array.isArray(sched.dailies) ? sched.dailies : [];
  const dailyStrip = dailies.length
    ? `<div class="daily-strip">${dailies.map((d) => `<span class="chip">${esc(d)}</span>`).join('')}</div>`
    : '';
  const today = new Date().getDay();
  const stale = isStale(sched.updated, SCHEDULE_CADENCE_MS)
    ? '<span class="stale" title="schedule may be stale">stale</span>' : '';

  const cols = DAY_NAMES.map((name, day) => {
    const events = sched.week.filter((e) => Number(e.day) === day).map(eventHtml).join('');
    const tot = totals[day];
    return `<div class="calcol${day === today ? ' today' : ''}" data-day="${day}">`
      + `<div class="calcol-head">${esc(name)}</div>`
      + dailyStrip
      + `<div class="calcol-body">${events}</div>`
      + `<div class="calcol-total${tot.heavy ? ' heavy' : ''}">${esc(tot.k)}k</div></div>`;
  }).join('');

  panel.innerHTML = `<div class="sched-head">Week ${stale}</div>`
    + `<div class="cal">${cols}</div>`
    + '<div class="tray" data-action="trayDrop"><div class="sec-label">One-off jobs</div>'
    + '<div class="tray-hint">Drag a job onto a day (Phase 2)</div></div>';
  wireSchedule(panel);
}

function wireSchedule(panel) {
  if (panel.__schedWired) return;
  panel.__schedWired = true;
  // The only interaction: a drop on the tray/calendar is a Phase-2 stub — toast, no mutation.
  const stub = (e) => { e.preventDefault(); toast('Scheduling is Phase 2'); };
  panel.addEventListener('drop', stub);
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="trayDrop"]')) toast('Scheduling is Phase 2');
  });
}
