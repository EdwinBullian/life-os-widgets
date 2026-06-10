// Cost tab: spend KPIs, by-model / by-agent bars, weekly-cap donut. Read-only except the
// Edit-cap control, which is a Phase-2 stub (toast, no postAction). Degrades to a placeholder
// on null/malformed spend so the Cost tab and topbar never crash.

import { esc, safe, isStale } from '../util.js';
import { toast } from './agents.js';

const SPEND_CADENCE_MS = 6 * 60 * 60 * 1000; // slow job, not the 60s poll
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;

function kpi(label, val) {
  return `<div class="kpi"><div class="kpi-val">${esc(val)}</div><div class="kpi-label">${esc(label)}</div></div>`;
}

// labelKey: which field labels the row (name|type). colorKey: which field drives the fill color
// class — byModel colors by `tier`, byAgent by agent `type`.
function bars(rows, labelKey, colorKey) {
  if (!Array.isArray(rows) || !rows.length) return '<div class="empty-state">No data.</div>';
  const max = Math.max(...rows.map((r) => Number(r.spend) || 0), 0.0001);
  return rows.map((r) => {
    const label = esc(r[labelKey] || '');
    const pct = Math.round(((Number(r.spend) || 0) / max) * 100);
    return `<div class="barrow"><span class="bar-label">${label}</span>`
      + `<span class="track"><span class="fill type-${esc(r[colorKey] || '')}" style="width:${pct}%"></span></span>`
      + `<span class="bar-val">${esc(money(r.spend))}</span></div>`;
  }).join('');
}

export function renderCost(state, panelArg) {
  const panel = panelArg || document.getElementById('cost');
  if (!panel) return;
  const spend = safe(state.spend, null);
  if (!spend || typeof spend !== 'object') {
    panel.innerHTML = '<div class="empty-state">No spend data yet.</div>';
    wireCost(panel);
    return;
  }
  const or = (spend.openrouter && typeof spend.openrouter === 'object') ? spend.openrouter : {};
  const max = (spend.max && typeof spend.max === 'object') ? spend.max : {};
  const stale = isStale(spend.updated, SPEND_CADENCE_MS)
    ? '<span class="stale" title="spend may be stale">stale</span>' : '';

  const kpis = '<div class="kpi-row">'
    + kpi('This week', num(or.weekSpend) ? money(or.weekSpend) : '—')
    + kpi('Projected month', num(or.projectedMonth) ? money(or.projectedMonth) : '—')
    + kpi('Max % used', num(max.pctUsed) ? `${max.pctUsed}%` : '—')
    + kpi('Tokens offloaded', num(spend.tokensOffloadedWeek) ? `${Math.round(spend.tokensOffloadedWeek / 1000)}k` : '—')
    + '</div>';

  const cap = num(or.weekCap) && or.weekCap > 0 ? or.weekCap : 0;
  const week = num(or.weekSpend) ? or.weekSpend : 0;
  const capPct = cap > 0 ? Math.min(100, Math.round((week / cap) * 100)) : 0;
  const donut = `<div class="donut" style="--pct:${capPct}"><div class="donut-label">${capPct}%<br>`
    + `<span class="muted">${esc(money(week))} / ${esc(money(cap))}</span></div></div>`
    + `<button class="btn btn-sm btn-ghost" data-action="editCap">Edit cap</button>`;

  panel.innerHTML = `<div class="cost-head">Spend ${stale}</div>${kpis}`
    + `<div class="cost-grid">`
    + `<div class="cost-sec"><div class="sec-label">Weekly cap</div>${donut}</div>`
    + `<div class="cost-sec"><div class="sec-label">By model</div>${bars(spend.byModel, 'name', 'tier')}</div>`
    + `<div class="cost-sec"><div class="sec-label">By agent</div>${bars(spend.byAgent, 'type', 'type')}</div>`
    + '</div>';
  wireCost(panel);
}

function wireCost(panel) {
  if (panel.__costWired) return;
  panel.__costWired = true;
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="editCap"]')) toast('Editing the cap is Phase 2');
  });
}
