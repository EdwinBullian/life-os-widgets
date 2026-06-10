// Overview tab: KPI row, quick-dispatch box, fuel gauges, and the read-only live activity feed.
// All values route through safe()/parseRunFeed so a null/malformed status or spend renders a
// placeholder, never throws. Quick dispatch is a real P1 write via the shared dispatchAction.

import { esc, safe, parseRunFeed, isStale } from '../util.js';
import { modelSelectHtml, dispatchAction, toast } from './agents.js';

// spend.json is produced by a slow job, not the 60s poll — flag stale past ~12h (2×6h cadence).
const SPEND_CADENCE_MS = 6 * 60 * 60 * 1000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// resetAt ISO → compact "3d 4h" / "5h" / "—". Past or unparseable → "now".
function countdown(resetAt) {
  if (!resetAt) return '—';
  const t = Date.parse(resetAt);
  if (Number.isNaN(t)) return '—';
  let mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'now';
  const d = Math.floor(mins / 1440); mins -= d * 1440;
  const h = Math.floor(mins / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function kpiCard(label, value) {
  return `<div class="kpi"><div class="kpi-val">${esc(value)}</div><div class="kpi-label">${esc(label)}</div></div>`;
}

function kpiRow(status) {
  const c = (status && typeof status.counts === 'object' && status.counts) || null;
  if (!c) return '<div class="kpi-row"><div class="empty-state">No data yet.</div></div>';
  return '<div class="kpi-row">'
    + kpiCard('Done today', num(c.doneToday) ? c.doneToday : '—')
    + kpiCard('Running now', num(c.running) ? c.running : '—')
    + kpiCard('Queued', num(c.queued) ? c.queued : '—')
    + kpiCard('Agents healthy', num(c.agentsHealthy) ? c.agentsHealthy : '—')
    + '</div>';
}

const AGENT_OPTS = ['Finance', 'Research', 'Health', 'Assistant'];
function quickDispatch() {
  return '<div class="quick-dispatch"><div class="sec-label">Quick dispatch</div>'
    + `<select id="ov-agent">${AGENT_OPTS.map((a) => `<option>${esc(a)}</option>`).join('')}</select>`
    + `<select id="ov-model">${modelSelectHtml('Auto')}</select>`
    + '<textarea id="ov-task" placeholder="Describe a one-shot job…"></textarea>'
    + '<button class="btn btn-primary" data-action="quickDispatch">Dispatch →</button></div>';
}

function gauges(spend) {
  if (!spend) return '<div class="gauges"><div class="empty-state">No spend data yet.</div></div>';
  const max = spend.max && typeof spend.max === 'object' ? spend.max : null;
  const or = spend.openrouter && typeof spend.openrouter === 'object' ? spend.openrouter : null;
  const stale = isStale(spend.updated, SPEND_CADENCE_MS)
    ? ' <span class="stale" title="data may be stale">stale</span>' : '';
  const pct = max && num(max.pctUsed) ? max.pctUsed : 0;
  const maxBox = max
    ? `<div class="gauge"><div class="gauge-donut" style="--pct:${esc(pct)}"></div>`
      + `<div class="gauge-label">Max plan <b>${esc(pct)}%</b>${stale}<br><span class="muted">resets ${esc(countdown(max.resetAt))}</span></div></div>`
    : '<div class="gauge"><div class="empty-state">No Max data.</div></div>';
  const week = or && num(or.weekSpend) ? or.weekSpend : 0;
  const cap = or && num(or.weekCap) ? or.weekCap : 0;
  const barPct = cap > 0 ? Math.min(100, Math.round((week / cap) * 100)) : 0;
  const orBox = or
    ? `<div class="gauge"><div class="gauge-bar"><span style="width:${esc(barPct)}%"></span></div>`
      + `<div class="gauge-label">OpenRouter <b>$${esc(week)}</b> / $${esc(cap)}</div></div>`
    : '<div class="gauge"><div class="empty-state">No OpenRouter data.</div></div>';
  return `<div class="gauges">${maxBox}${orBox}</div>`;
}

function feed(status) {
  const rows = parseRunFeed(status);
  if (!rows.length) return '<div class="activity"><div class="sec-label">Live activity</div><div class="empty-state">No recent activity.</div></div>';
  const items = rows.map((r) => '<div class="feed-row">'
    + `<span class="time">${esc(r.time)}</span>`
    + `<span class="agent-tag">${esc(r.agent)}</span>`
    + `<span class="msg">${esc(r.message)}</span>`
    + `<span class="dot st-${esc((r.status || '').toLowerCase())}" title="${esc(r.status)}"></span>`
    + '</div>').join('');
  return `<div class="activity"><div class="sec-label">Live activity</div>${items}</div>`;
}

export function renderOverview(state, panelArg) {
  const panel = panelArg || document.getElementById('overview');
  if (!panel) return;
  const status = safe(state.status, null);
  const spend = safe(state.spend, null);
  panel.innerHTML = kpiRow(status) + quickDispatch() + gauges(spend) + feed(status);
  wireOverview(panel);
}

function wireOverview(panel) {
  if (panel.__overviewWired) return;
  panel.__overviewWired = true;
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="quickDispatch"]');
    if (!btn) return;
    const agent = (panel.querySelector('#ov-agent') || {}).value || 'Assistant';
    const model = (panel.querySelector('#ov-model') || {}).value || 'Auto';
    const task = ((panel.querySelector('#ov-task') || {}).value || '').trim();
    if (!task) { toast('Enter a task to dispatch'); return; }
    // Carry a `job` label like every other dispatch path (preset/routine form) so the
    // queue has a title — first few words of the task, matching the form titleTpl style.
    const job = task.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 48) || 'Quick task';
    dispatchAction('dispatch', { job, agent, model, taskType: 'Quick Task', details: task, runMode: 'Downtime' }, `Dispatched: ${job} →`);
    const ta = panel.querySelector('#ov-task');
    if (ta) ta.value = '';
  });
}
