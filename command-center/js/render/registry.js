// Registry tab: read-only table of every scheduled task pulled from data/registry.json.
// Columns: Name, Agent, Tier, Enabled, Trigger, Model, Tok/wk, Notes.
// Filter bar (All / open / open-first / max / private / infra) narrows rows.
// Sort: click any column header to toggle asc/desc.
// Never throws on missing/empty registry — shows empty-state instead.
// All dynamic values escaped via esc(). No DOM libs, no build step.

import { esc, safe } from '../util.js';
import { getState } from '../state.js';
import { postAction, getTaskOverrides, setTaskOverride } from '../proxy.js';
import { toast } from './agents.js';

// POST a registry action; never throws into the handler. Toasts success or a graceful offline note.
function postSafe(action, params) {
  try {
    postAction(action, params)
      .then(() => toast('Saved'))
      .catch(() => toast('Saved on this device — proxy offline'));
  } catch { toast('Saved on this device'); }
}

// Model options offered in the per-row dropdown. The task's current model is appended if unlisted
// so an exotic value (e.g. "Max now / local later") is never silently dropped.
const MODEL_OPTS = ['Auto', 'Opus', 'Sonnet', 'Haiku', 'gpt-oss-20b', 'Nemotron-3 Super', 'Devstral'];

// ── helpers ──────────────────────────────────────────────────────────────────

function isRegistry(r) {
  return r && typeof r === 'object' && Array.isArray(r.tasks);
}

// Merge per-task overrides over the registry rows. Server overrides (from the status feed, set on
// any device) apply first; the local optimistic override wins on top so this device's latest edit
// shows instantly even before the next status poll round-trips.
function applyOverrides(tasks) {
  const localOv = getTaskOverrides();
  const status = safe(getState().status, null);
  const serverOv = (status && status.taskOverrides && typeof status.taskOverrides === 'object')
    ? status.taskOverrides : {};
  return tasks.map((t) => {
    const s = serverOv[t.id];
    const l = localOv[t.id];
    return (s || l) ? { ...t, ...(s || {}), ...(l || {}) } : t;
  });
}

// Toggle switch for the Enabled column.
function enabledToggle(task) {
  const id = esc(task.id || '');
  const on = task.enabled ? ' checked' : '';
  return `<label class="reg-toggle" title="${task.enabled ? 'Enabled — click to pause' : 'Disabled — click to enable'}">`
    + `<input type="checkbox" data-action="regToggle" data-id="${id}"${on}><span class="reg-slider"></span></label>`;
}

// Always-editable schedule/frequency input (commits on blur/Enter via the change event).
function scheduleInput(task) {
  const id = esc(task.id || '');
  return `<input class="reg-sched-input" data-action="regSched" data-id="${id}" `
    + `value="${esc(task.trigger || '')}" placeholder="e.g. Mon 08:00" title="${esc(task.cron || '')}">`;
}

// Model dropdown.
function modelSelect(task) {
  const id = esc(task.id || '');
  const cur = task.model || 'Auto';
  const opts = MODEL_OPTS.includes(cur) ? MODEL_OPTS : [...MODEL_OPTS, cur];
  const html = opts.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('');
  return `<select class="reg-select" data-action="regModel" data-id="${id}">${html}</select>`;
}

function tierChip(tier) {
  const t = (tier || '').toLowerCase();
  const cls = t === 'max' ? 'max'
    : t === 'open' ? 'open'
    : t === 'open-first' ? 'open-first'
    : t === 'private' ? 'private'
    : 'infra';
  return `<span class="chip ${cls}">${esc(tier || '—')}</span>`;
}

function enabledDot(enabled) {
  return enabled
    ? '<span class="dot ok" title="Enabled"></span>'
    : '<span class="dot" style="background:var(--faint)" title="Disabled"></span>';
}

function fmtTokens(task) {
  const tok = Number(task.estTokensPerRun) || 0;
  const runs = Number(task.runsPerWeek) || 0;
  const wk = Math.round((tok * runs) / 1000);
  if (!tok) return '<span class="faint">—</span>';
  return `<span title="${esc(tok.toLocaleString())} tok/run × ${esc(runs)}/wk">${esc(wk)}k</span>`;
}

// ── sort state (module-level, survives re-renders) ───────────────────────────

let _sortCol = 'agent';
let _sortDir = 1; // 1 = asc, -1 = desc
// Default view is ACTIVE, not All: the registry carries infra plumbing and
// not-yet-built rows that Eddie should never have to read past. Those stay one
// click away under Infra / Planned rather than padding the default list.
let _filter = 'active';

// A row is "active" if it actually runs AND it is a desk job, not machine
// plumbing. Infra (gateway, bridge, reindex, mirrors) is real but invisible.
function isActive(task) {
  return Boolean(task.enabled) && (task.agent || '') !== 'infra';
}

function sortVal(task, col) {
  switch (col) {
    case 'name':    return (task.name || '').toLowerCase();
    case 'agent':   return (task.agent || '').toLowerCase();
    case 'tier':    return (task.currentTier || '').toLowerCase();
    case 'enabled': return task.enabled ? 0 : 1;
    case 'trigger': return (task.trigger || '').toLowerCase();
    case 'model':   return (task.model || '').toLowerCase();
    case 'tokwk': {
      const tok = Number(task.estTokensPerRun) || 0;
      const runs = Number(task.runsPerWeek) || 0;
      return tok * runs;
    }
    default: return '';
  }
}

function headerCell(col, label, activeCol) {
  const active = activeCol === col;
  const arrow = active ? (_sortDir === 1 ? ' ▲' : ' ▼') : '';
  return `<th class="reg-th${active ? ' active' : ''}" data-sort="${col}">${esc(label)}${arrow}</th>`;
}

// ── main renderer ─────────────────────────────────────────────────────────────

function buildTable(tasks) {
  if (!tasks.length) {
    return '<div class="empty-state">No tasks match this filter.</div>';
  }

  const cols = [
    { key: 'name',    label: 'Task' },
    { key: 'agent',   label: 'Agent' },
    { key: 'tier',    label: 'Current Tier' },
    { key: 'enabled', label: 'On' },
    { key: 'trigger', label: 'Schedule' },
    { key: 'model',   label: 'Model' },
    { key: 'tokwk',  label: 'Tok/wk' },
  ];

  const thead = `<tr>${cols.map((c) => headerCell(c.key, c.label, _sortCol)).join('')}<th class="reg-th">Notes</th></tr>`;

  const rows = tasks.map((t) => {
    const agent = (t.agent || 'infra').toLowerCase();
    const recTier = (t.recommendedTier || '').toLowerCase();
    const curTier = (t.currentTier || '').toLowerCase();
    // Highlight row if recommended ≠ current (migration opportunity)
    const migratable = recTier && recTier !== curTier && curTier !== 'n/a';
    const cls = `ag-${agent}${migratable ? ' reg-row-migrate' : ''}${t.enabled ? '' : ' reg-row-off'}`;
    return `<tr class="${cls}">`
      + `<td><span class="ag-text-${agent} reg-name">${esc(t.name || t.id || '?')}</span></td>`
      + `<td><span class="ag-text-${agent}">${esc(t.agent || '—')}</span></td>`
      + `<td>${tierChip(t.currentTier)}</td>`
      + `<td style="text-align:center">${enabledToggle(t)}</td>`
      + `<td>${scheduleInput(t)}</td>`
      + `<td>${modelSelect(t)}</td>`
      + `<td style="text-align:right">${fmtTokens(t)}</td>`
      + `<td class="reg-notes">${esc(t.notes || '—')}</td>`
      + `</tr>`;
  }).join('');

  return `<table class="reg-table"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
}

function getFilteredSorted(tasks) {
  let rows = tasks.filter((t) => {
    if (_filter === 'all') return true;
    if (_filter === 'active') return isActive(t);
    if (_filter === 'planned') return !t.enabled;
    if (_filter === 'infra') return (t.agent || '') === 'infra';
    return (t.currentTier || '').toLowerCase() === _filter;
  });
  rows = [...rows].sort((a, b) => {
    const av = sortVal(a, _sortCol);
    const bv = sortVal(b, _sortCol);
    if (av < bv) return -1 * _sortDir;
    if (av > bv) return  1 * _sortDir;
    return 0;
  });
  return rows;
}

function buildFilterBar(tasks) {
  // Count per tier for badge numbers
  const counts = { all: tasks.length };
  for (const t of tasks) {
    const k = (t.currentTier || 'max').toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  counts.infra = tasks.filter((t) => t.agent === 'infra').length;
  counts.active = tasks.filter(isActive).length;
  counts.planned = tasks.filter((t) => !t.enabled).length;

  const btns = [
    { key: 'active',     label: 'Active' },
    { key: 'planned',    label: 'Planned / off' },
    { key: 'all',        label: 'All' },
    { key: 'open',       label: 'Open' },
    { key: 'open-first', label: 'Open-first' },
    { key: 'max',        label: 'Max' },
    { key: 'private',    label: 'Private' },
    { key: 'infra',      label: 'Infra' },
  ].map(({ key, label }) => {
    const cnt = counts[key] || 0;
    const active = _filter === key ? ' active' : '';
    return `<button class="btn sm ghost reg-filter${active}" data-filter="${key}">`
      + `${esc(label)} <span class="count">${cnt}</span></button>`;
  }).join('');

  return `<div class="reg-filterbar">${btns}</div>`;
}

export function renderRegistry(state, panelArg) {
  const panel = panelArg || document.getElementById('registry');
  if (!panel) return;

  const reg = safe(state.registry, null);
  if (!isRegistry(reg)) {
    panel.innerHTML = '<div class="empty-state">Registry data not loaded yet.<br>'
      + '<span class="faint">Waiting for data/registry.json …</span></div>';
    wireRegistry(panel, []);
    return;
  }

  const rawTasks = reg.tasks;
  // Stash the RAW tasks so filter/sort/control re-renders re-apply overrides from a clean base.
  panel.__regTasks = rawTasks;
  panel.__regUpdated = reg.updated || null;
  const tasks = applyOverrides(rawTasks); // merge local on/off, model, schedule edits
  const filtered = getFilteredSorted(tasks);
  const updated = reg.updated ? `<span class="faint" style="font-size:11px">updated ${esc(reg.updated)}</span>` : '';

  // Compute weekly Max-plan tokens saved if open recommendations were live
  const migrateable = tasks.filter((t) => {
    const rec = (t.recommendedTier || '').toLowerCase();
    const cur = (t.currentTier || '').toLowerCase();
    return rec === 'open' && cur === 'max';
  });
  const savedK = migrateable.reduce((s, t) => {
    return s + Math.round(((Number(t.estTokensPerRun) || 0) * (Number(t.runsPerWeek) || 0)) / 1000);
  }, 0);
  const savingsHint = savedK > 0
    ? `<span class="chip open" style="font-size:11px">≈${esc(savedK)}k tok/wk reclaimed if open tasks migrate</span>`
    : '';

  panel.innerHTML = `<div class="box" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:10px">`
    + `<div class="ptitle">Task Registry ${updated} ${savingsHint}</div>`
    + buildFilterBar(tasks)
    + '<div class="reg-hint faint">Toggle a task on/off, edit its schedule, or change its model right here. '
    + 'Changes apply instantly and persist on this device; they also sync to your proxy when connected.</div>'
    + `<div class="reg-scroll">`
    + buildTable(filtered)
    + `</div>`
    + `</div>`;

  wireRegistry(panel, tasks);
}

function wireRegistry(panel, tasks) {
  // Guard: attach the delegated listeners only once per panel element.
  if (panel.__regWired) return;
  panel.__regWired = true;

  // Re-render from the RAW task list on the panel (overrides re-merge inside renderRegistry).
  const reRender = () => renderRegistry(
    { registry: { tasks: panel.__regTasks || tasks, updated: panel.__regUpdated } }, panel,
  );

  panel.addEventListener('click', (e) => {
    const fb = e.target.closest('[data-filter]');
    if (fb) { _filter = fb.dataset.filter; reRender(); return; }
    const th = e.target.closest('[data-sort]');
    if (th) {
      const col = th.dataset.sort;
      if (_sortCol === col) _sortDir *= -1; else { _sortCol = col; _sortDir = 1; }
      reRender();
    }
  });

  // Controls (commit on change → blur/Enter for inputs, immediate for toggle/select).
  panel.addEventListener('change', (e) => {
    const tog = e.target.closest('[data-action="regToggle"]');
    if (tog) {
      const id = tog.dataset.id;
      const enabled = !!tog.checked;
      setTaskOverride(id, { enabled });
      postSafe('settaskenabled', { id, enabled: String(enabled) });
      reRender();
      return;
    }
    const mdl = e.target.closest('[data-action="regModel"]');
    if (mdl) {
      const id = mdl.dataset.id;
      const model = mdl.value;
      setTaskOverride(id, { model });
      postSafe('settaskmodel', { id, model });
      reRender();
      return;
    }
    const sch = e.target.closest('[data-action="regSched"]');
    if (sch) {
      const id = sch.dataset.id;
      const trigger = String(sch.value || '').trim();
      setTaskOverride(id, { trigger });
      postSafe('settaskschedule', { id, trigger });
      reRender();
    }
  });
}
