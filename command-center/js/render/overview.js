// Overview tab: KPI row, quick-dispatch box, fuel gauges, and the read-only live activity feed.
// Markup matches the approved mockup verbatim (classes ported into css/styles.css); every value
// routes through esc()/safe()/parseRunFeed so a null/malformed status or spend renders a graceful
// placeholder, never throws. Quick dispatch is a real write via the shared dispatchOneOff, so
// the job it fires also shows up (with a real status) in the Schedule tab's one-off tray.

import { esc, safe, parseRunFeed, isStale } from '../util.js';
import { modelSelectHtml, dispatchOneOff, toast } from './agents.js';
import { getMaxPct } from '../proxy.js';

// spend.json is produced by a slow job, not the 60s poll — flag stale past ~12h (2×6h cadence).
const SPEND_CADENCE_MS = 6 * 60 * 60 * 1000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// resetAt ISO → compact "3d 4h" / "5h" / "—". Past or unparseable → "now"/"—".
export function countdown(resetAt) {
  if (!resetAt) return '—';
  const t = Date.parse(resetAt);
  if (Number.isNaN(t)) return '—';
  let mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'now';
  const d = Math.floor(mins / 1440); mins -= d * 1440;
  const h = Math.floor(mins / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// ── KPI row (mockup: .grid.cols-4 of .box.kpi) ──────────────────────────────────
function kpiCard(value, label, opts = {}) {
  const style = opts.color ? ` style="color:var(--${opts.color})"` : '';
  const delta = opts.delta
    ? `<div class="delta ${esc(opts.deltaCls || 'muted')}">${esc(opts.delta)}</div>`
    : '<div class="delta muted">—</div>';
  return `<div class="box kpi"><div class="big"${style}>${esc(value)}</div>`
    + `<div class="lbl">${esc(label)}</div>${delta}</div>`;
}

// compact relative time for the recent-runs feed
function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Derive the KPI numbers. Prefer the live status feed; when it's absent (proxy disabled), fall
// back to registry + schedule so the row is informative instead of a blank "—".
function deriveCounts(status, schedule, registry) {
  const c = (status && typeof status.counts === 'object' && status.counts) || {};
  const live = !!(status && status.counts);
  const recent = (schedule && Array.isArray(schedule.recentRuns)) ? schedule.recentRuns : [];
  const todayStr = new Date().toDateString();
  const doneToday = num(c.doneToday) ? c.doneToday
    : recent.filter((r) => { const d = new Date(r.ranAt); return !Number.isNaN(d.getTime()) && d.toDateString() === todayStr; }).length;
  const tasks = (registry && Array.isArray(registry.tasks)) ? registry.tasks : [];
  const activeTasks = tasks.filter((t) => t.enabled && t.agent !== 'infra').length;
  return {
    live,
    doneToday,
    running: num(c.running) ? c.running : 0,
    scheduled: num(c.queued) ? c.queued : activeTasks,
    agents: num(c.agentsHealthy) ? c.agentsHealthy : 8,
  };
}

function kpiRow(status, schedule, registry) {
  const k = deriveCounts(status, schedule, registry);
  const src = k.live ? '' : ' · from registry';
  return '<div class="grid cols-4">'
    + kpiCard(k.doneToday, 'Jobs completed today')
    + kpiCard(k.running, 'Running now', { color: 'running' })
    + kpiCard(k.scheduled, 'Scheduled tasks', { color: 'queued', delta: `active${src}`, deltaCls: 'muted' })
    + kpiCard(k.agents, 'Agents')
    + '</div>';
}

// ── Quick dispatch + Fuel (mockup: .grid.cols-2) ────────────────────────────────
const AGENT_OPTS = ['Finance', 'Research', 'Health', 'Assistant', 'Programming', 'Career', 'Business', 'Marketing'];

function quickDispatch() {
  const agents = AGENT_OPTS.map((a) => `<option>${esc(a)}</option>`).join('');
  return '<div class="box">'
    + '<div class="ptitle">Quick dispatch <span class="faint mono">→ Notion queue</span></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
    + `<div><label class="fld">Agent</label><select id="ov-agent">${agents}</select></div>`
    + `<div><label class="fld">Model</label><select id="ov-model">${modelSelectHtml('Auto')}</select></div>`
    + '</div>'
    + '<label class="fld">Task</label>'
    + '<textarea id="ov-task" placeholder="e.g. Pull NVDA 10-Q highlights and update the thesis tracker…"></textarea>'
    + '<div style="display:flex;justify-content:flex-end;margin-top:11px">'
    + '<button class="btn" data-action="quickDispatch">Dispatch →</button></div>'
    + '</div>';
}

function fuelBox(spend) {
  if (!spend) {
    return '<div class="box"><div class="ptitle">Fuel <span class="faint">never get '
      + 'maxed-out blind again</span></div><div class="muted">No spend data yet.</div></div>';
  }
  const max = spend.max && typeof spend.max === 'object' ? spend.max : null;
  const or = spend.openrouter && typeof spend.openrouter === 'object' ? spend.openrouter : null;
  const stale = isStale(spend.updated, SPEND_CADENCE_MS)
    ? ' <span class="faint">stale</span>' : '';

  const ovrPct = getMaxPct(); // manual Max% override wins over spend.json
  const pct = ovrPct != null ? ovrPct : (max && num(max.pctUsed) ? max.pctUsed : 0);
  const est = max && num(max.estTokens) ? Math.round(max.estTokens / 1000) : null;
  const cap = max && num(max.capTokens) ? Math.round(max.capTokens / 1000) : null;
  const tokLine = (est !== null && cap !== null)
    ? `est. ~${esc(est)}k / ${esc(cap)}k tokens this cycle`
    : 'est. tokens unavailable';
  const reset = max ? countdown(max.resetAt) : '—';
  const donut = '<div class="gaugewrap" style="margin-bottom:10px">'
    + `<div class="donut" style="background:conic-gradient(var(--running) 0% ${esc(pct)}%, `
    + `var(--card3) ${esc(pct)}% 100%)"><span class="val">${esc(pct)}%</span></div>`
    + '<div><div style="font-weight:600">Claude Max plan</div>'
    + `<div class="muted" style="font-size:12px">~${esc(pct)}% of weekly capacity · `
    + `resets in <b style="color:var(--text)">${esc(reset)}</b>${stale}</div>`
    + `<div class="muted" style="font-size:12px">${tokLine}</div></div></div>`;

  const weekSpend = or && num(or.weekSpend) ? or.weekSpend : 0;
  const weekCap = or && num(or.weekCap) ? or.weekCap : 0;
  const barPct = weekCap > 0 ? Math.min(100, Math.round((weekSpend / weekCap) * 100)) : 0;
  const bar = '<div class="barrow"><div class="top"><span>OpenRouter spend (this week)</span>'
    + `<span class="mono">$${esc(weekSpend.toFixed(2))} / $${esc(weekCap.toFixed(2))}</span></div>`
    + `<div class="track"><div class="fill" style="width:${esc(barPct)}%;`
    + 'background:var(--success)"></div></div></div>';

  return '<div class="box"><div class="ptitle">Fuel <span class="faint">never get '
    + `maxed-out blind again</span></div>${donut}${bar}</div>`;
}

function midGrid(spend) {
  return `<div class="grid cols-2">${quickDispatch()}${fuelBox(spend)}</div>`;
}

// ── Live activity feed (mockup: .box.grow > .feed.grow > .row) ───────────────────
// status string → dot class: done/success→ok, running→run, fail→fail, else ok.
function dotClass(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'running' || s === 'run') return 'run';
  if (s === 'fail' || s === 'failed' || s === 'error') return 'fail';
  if (s === 'warn' || s === 'stale') return 'warn';
  return 'ok'; // done / success / unknown
}

function feed(status) {
  const rows = parseRunFeed(status);
  const head = '<div class="box grow"><div class="ptitle">Live activity '
    + '<span class="faint">streaming from activity_log.md</span></div>';
  if (!rows.length) {
    return `${head}<div class="feed grow"><div class="muted">No recent activity.</div></div></div>`;
  }
  // ISO timestamp → compact HH:MM (mockup shows "09:41"); non-ISO labels (e.g. "Tue") pass through.
  const fmtWhen = (t) => { const m = /T(\d{2}:\d{2})/.exec(String(t || '')); return m ? m[1] : String(t || ''); };
  const items = rows.map((r) => {
    const agentKey = String(r.agent || '').toLowerCase();
    const agentLabel = agentKey ? agentKey.charAt(0).toUpperCase() + agentKey.slice(1) : '—';
    return '<div class="row">'
      + `<div class="when mono">${esc(fmtWhen(r.time))}</div>`
      + `<div class="msg"><span class="tag t-${esc(agentKey)}">${esc(agentLabel)}</span> `
      + `&nbsp;${esc(r.message)}</div>`
      + `<span class="dot ${dotClass(r.status)}"></span>`
      + '</div>';
  }).join('');
  return `${head}<div class="feed grow">${items}</div></div>`;
}

// Recent completed runs — sourced from schedule.recentRuns, so it shows real history even when
// the live status feed (activity_log.md) is empty because the dispatch worker is disabled.
function recentRunsBox(schedule) {
  const runs = (schedule && Array.isArray(schedule.recentRuns)) ? schedule.recentRuns : [];
  const head = '<div class="box grow"><div class="ptitle">Recent runs '
    + '<span class="faint">last completed scheduled jobs</span></div>';
  if (!runs.length) {
    return `${head}<div class="feed grow"><div class="muted">No recent runs.</div></div></div>`;
  }
  const items = runs.slice(0, 12).map((r) => {
    const a = String(r.agent || '').toLowerCase();
    const label = a ? a.charAt(0).toUpperCase() + a.slice(1) : '—';
    const model = r.model ? `<span class="chip">${esc(r.model)}</span>` : '';
    return '<div class="row">'
      + `<div class="msg"><span class="tag t-${esc(a)}">${esc(label)}</span> &nbsp;${esc(r.name || r.taskId || '')}</div>`
      + model
      + `<span class="when faint" style="min-width:auto">${esc(relTime(r.ranAt))}</span>`
      + `<span class="dot ${dotClass(r.status)}"></span></div>`;
  }).join('');
  return `${head}<div class="feed grow">${items}</div></div>`;
}

// One-line "now" status pill. Agents run infrequently, so this is usually "Idle" — a thin strip,
// not a big feed. Shows a count when the live status feed reports running jobs.
function nowLine(status) {
  const running = (status && status.counts && Number(status.counts.running)) || 0;
  const cls = running > 0 ? 'run' : 'ok';
  const label = running > 0
    ? `${running} job${running === 1 ? '' : 's'} running now`
    : 'Idle — nothing running right now';
  return `<div class="now-line"><span class="dot ${cls}"></span><span>${esc(label)}</span></div>`;
}

// Next occurrence of a weekly (day,hour) slot, from `now`.
function nextOccurrence(day, hour, now) {
  const today = now.getDay();
  let d = ((day - today) + 7) % 7;
  if (d === 0 && now.getHours() >= hour) d = 7; // already passed today → next week
  const nx = new Date(now);
  nx.setDate(now.getDate() + d);
  nx.setHours(hour, 0, 0, 0);
  return nx;
}

// Human label: a live countdown within 24h ("in 3h 20m"), otherwise a day+time ("Sat 9pm").
function whenLabel(date, now) {
  const mins = Math.round((date - now) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60); const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  const ampm = date.getHours() >= 12 ? 'pm' : 'am';
  const t = `${date.getHours() % 12 || 12}${ampm}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const tom = new Date(now.getTime() + 86400000);
  if (date.toDateString() === tom.toDateString()) return `Tmrw ${t}`;
  return `${days[date.getDay()]} ${t}`;
}

function getUpcoming(schedule, n) {
  const week = (schedule && Array.isArray(schedule.week)) ? schedule.week : [];
  if (!week.length) return [];
  const now = new Date();
  return week
    .map((e) => { const next = nextOccurrence(Number(e.day), Number(e.hour) || 0, now); return { ...e, _next: next, _when: whenLabel(next, now) }; })
    .sort((a, b) => a._next - b._next)
    .slice(0, n);
}

// Up Next — the next scheduled runs with countdowns. Always populated from schedule.json.
function upNextBox(schedule) {
  const rows = getUpcoming(schedule, 7);
  const head = '<div class="box grow"><div class="ptitle">Up next '
    + '<span class="faint">next scheduled runs</span></div>';
  if (!rows.length) {
    return `${head}<div class="feed grow"><div class="muted">No scheduled runs.</div></div></div>`;
  }
  const items = rows.map((e) => {
    const a = String(e.agent || '').toLowerCase();
    const label = a ? a.charAt(0).toUpperCase() + a.slice(1) : '—';
    const model = e.model ? `<span class="chip">${esc(e.model)}</span>` : '';
    return '<div class="row">'
      + `<div class="msg"><span class="tag t-${esc(a)}">${esc(label)}</span> &nbsp;${esc(e.name || '')}</div>`
      + model
      + `<span class="when faint" style="min-width:auto">${esc(e._when)}</span></div>`;
  }).join('');
  return `${head}<div class="feed grow">${items}</div></div>`;
}

export function renderOverview(state, panelArg) {
  const panel = panelArg || document.getElementById('overview');
  if (!panel) return;
  const status = safe(state.status, null);
  const spend = safe(state.spend, null);
  const schedule = safe(state.schedule, null);
  const registry = safe(state.registry, null);
  // "Now" is a thin pill (agents run rarely); the space goes to Up Next + Recent runs side by side.
  panel.innerHTML = kpiRow(status, schedule, registry) + midGrid(spend)
    + nowLine(status)
    + `<div class="grid cols-2 grow">${upNextBox(schedule)}${recentRunsBox(schedule)}</div>`;
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
    dispatchOneOff({ job, agent, model, taskType: 'Quick Task', details: task, runMode: 'Downtime' }, `Sent: ${job} — tracking it in Schedule`);
    const ta = panel.querySelector('#ov-task');
    if (ta) ta.value = '';
  });
}
