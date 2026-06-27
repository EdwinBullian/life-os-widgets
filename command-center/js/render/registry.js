// Registry tab: read-only table of every scheduled task pulled from data/registry.json.
// Columns: Name, Agent, Tier, Enabled, Trigger, Model, Tok/wk, Notes.
// Filter bar (All / open / open-first / max / private / infra) narrows rows.
// Sort: click any column header to toggle asc/desc.
// Never throws on missing/empty registry — shows empty-state instead.
// All dynamic values escaped via esc(). No DOM libs, no build step.

import { esc, safe } from '../util.js';

// ── helpers ─────────────────────────────────────────────────────────────────────────────

function isRegistry(r) {
  return r && typeof r === 'object' && Array.isArray(r.tasks);
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

// ── sort state (module-level, survives re-renders) ───────────────────────────────────────────

let _sortCol = 'agent';
let _sortDir = 1; // 1 = asc, -1 = desc
let _filter = 'all';

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

// ── main renderer ─────────────────────────────────────────────────────────────────────────

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
    const rowClass = migratable ? ' class="reg-row-migrate"' : '';
    return `<tr${rowClass}>`
      + `<td><span class="ag-text-${agent} reg-name">${esc(t.name || t.id || '?')}</span></td>`
      + `<td><span class="ag-text-${agent}">${esc(t.agent || '—')}</span></td>`
      + `<td>${tierChip(t.currentTier)}</td>`
      + `<td style="text-align:center">${enabledDot(t.enabled)}</td>`
      + `<td class="reg-mono">${esc(t.trigger || '—')}</td>`
      + `<td class="reg-mono" style="color:var(--muted)">${esc(t.model || '—')}</td>`
      + `<td style="text-align:right">${fmtTokens(t)}</td>`
      + `<td class="reg-notes">${esc(t.notes || '—')}</td>`
      + `</tr>`;
  }).join('');

  return `<table class="reg-table"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
}

function getFilteredSorted(tasks) {
  let rows = tasks.filter((t) => {
    if (_filter === 'all') return true;
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

  const btns = [
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

  const tasks = reg.tasks;
  // Stash on the DOM element so filter/sort click handlers can re-render without global state.
  panel.__regTasks = tasks;
  panel.__regUpdated = reg.updated || null;
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
    + `<div class="reg-scroll">`
    + buildTable(filtered)
    + `</div>`
    + `</div>`;

  wireRegistry(panel, tasks);
}

function wireRegistry(panel, tasks) {
  // Guard: attach the delegated listener only once per panel element.
  if (panel.__regWired) return;
  panel.__regWired = true;

  panel.addEventListener('click', (e) => {
    // Filter button click
    const fb = e.target.closest('[data-filter]');
    if (fb) {
      _filter = fb.dataset.filter;
      // getState() is not imported here; re-read via the panel's latest innerHTML reference.
      // We store the full task list on the panel so filter/sort clicks don't need global state.
      renderRegistry({ registry: { tasks: panel.__regTasks || tasks, updated: panel.__regUpdated } }, panel);
      return;
    }
    // Column sort click
    const th = e.target.closest('[data-sort]');
    if (th) {
      const col = th.dataset.sort;
      if (_sortCol === col) {
        _sortDir *= -1;
      } else {
        _sortCol = col;
        _sortDir = 1;
      }
      renderRegistry({ registry: { tasks: panel.__regTasks || tasks, updated: panel.__regUpdated } }, panel);
    }
  });
}
