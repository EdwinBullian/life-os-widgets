// Cost tab: spend KPIs, by-model / by-agent bars, weekly-cap donut. Markup matches the approved
// mockup verbatim (grid/box/kpi/barrow/donut classes ported into css/styles.css). Read-only except
// the Edit-cap control, a Phase-2 stub (toast, no postAction). Degrades to a placeholder on
// null/malformed spend so the Cost tab and topbar never crash.

import { esc, safe, isStale } from '../util.js';
import { toast } from './agents.js';
import { getMaxPct } from '../proxy.js';

const SPEND_CADENCE_MS = 6 * 60 * 60 * 1000; // slow job, not the 60s poll
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;

// Empty-but-valid spend so a missing field never NaNs the donut (the old "gray circle" bug).
const EMPTY_SPEND = {
  updated: '', max: {}, openrouter: {}, byModel: [], byAgent: [], tokensOffloadedWeek: 0,
};

// Tokens → compact label: 2_400_000 → "2.4M", 1_240_000 → "1.24M", 12_000 → "12k", 0 → "0".
function tokfmt(n) {
  const t = Number(n) || 0;
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (t >= 1000) return `${Math.round(t / 1000)}k`;
  return String(Math.round(t));
}

// Per-model fill color, mirroring the mockup's choices. Prefer name match, fall back to tier.
function modelColor(r) {
  const name = String((r && r.name) || '').toLowerCase();
  if (name.includes('r1')) return 'var(--tag-research)';
  if (name.includes('v3.2') || name.includes('v3')) return 'var(--tag-finance)';
  if (name.includes('qwen')) return 'var(--tag-programming)';
  if (name.includes('claude') || name.includes('opus') || name.includes('sonnet') || name.includes('haiku')) return 'var(--running)';
  if (name.includes('free')) return 'var(--faint)';
  switch (String((r && r.tier) || '').toLowerCase()) {
    case 'premium': return 'var(--running)';
    case 'standard': return 'var(--tag-finance)';
    case 'budget': return 'var(--tag-programming)';
    case 'free': return 'var(--faint)';
    default: return 'var(--tag-research)';
  }
}

function kpi(big, lbl, deltaCls, deltaTxt) {
  return `<div class="box kpi"><div class="big">${esc(big)}</div>`
    + `<div class="lbl">${esc(lbl)}</div>`
    + `<div class="delta ${deltaCls}">${esc(deltaTxt)}</div></div>`;
}

// Relative bars: fill width = spend / max(spend in group) * 100. `colorFn(row)` → CSS color.
// `labelFn(row)` → the left-cell HTML (plain span for models, .tag t-<agent> for agents).
function bars(rows, labelFn, colorFn) {
  if (!Array.isArray(rows) || !rows.length) return '<div class="muted" style="font-size:12px">No data.</div>';
  const max = Math.max(...rows.map((r) => Number(r && r.spend) || 0), 0.0001);
  return rows.map((r) => {
    const pct = Math.round(((Number(r && r.spend) || 0) / max) * 100);
    return '<div class="barrow"><div class="top">'
      + `${labelFn(r)}<span class="mono">${esc(money(r && r.spend))}</span></div>`
      + `<div class="track"><div class="fill" style="width:${pct}%;background:${colorFn(r)}"></div></div></div>`;
  }).join('');
}

export function renderCost(state, panelArg) {
  const panel = panelArg || document.getElementById('cost');
  if (!panel) return;

  const raw = safe(state.spend, null);
  if (!raw || typeof raw !== 'object') {
    panel.innerHTML = '<div class="box"><div class="ptitle">Cost</div>'
      + '<div class="muted" style="font-size:12px">No spend data yet.</div></div>';
    wireCost(panel);
    return;
  }
  const spend = { ...EMPTY_SPEND, ...raw };
  const or = (spend.openrouter && typeof spend.openrouter === 'object') ? spend.openrouter : {};
  const max = (spend.max && typeof spend.max === 'object') ? spend.max : {};

  const cap = num(or.weekCap) && or.weekCap > 0 ? or.weekCap : 0;
  const week = num(or.weekSpend) ? or.weekSpend : 0;
  const capPct = cap > 0 ? Math.min(100, Math.round((week / cap) * 100)) : 0;

  const stale = isStale(spend.updated, SPEND_CADENCE_MS)
    ? ' <span class="stale" title="spend may be stale">stale</span>' : '';

  // ── KPI row ─────────────────────────────────────────────────────────────────
  const kpis = '<div class="grid cols-4">'
    + kpi(money(week), 'OpenRouter this week', 'muted', `cap ${money(cap)} · ${capPct}% used`)
    + kpi(num(or.projectedMonth) ? money(or.projectedMonth) : '—', 'Projected month', 'muted', 'OpenRouter spend est.')
    + kpi((getMaxPct() != null ? getMaxPct() : (num(max.pctUsed) ? max.pctUsed : null)) != null
      ? `${getMaxPct() != null ? getMaxPct() : max.pctUsed}%` : '—', 'Max plan used', 'muted',
      getMaxPct() != null ? 'you set this' : (max.resetAt ? 'resets soon' : 'rolling window'))
    + kpi(tokfmt(spend.tokensOffloadedWeek), 'Tokens offloaded / wk', 'up', '▲ kept off Max')
    + '</div>';

  // ── Donut: 0% renders as an all-card3 ring (intentional), never a NaN gradient. ──
  const donutBg = `conic-gradient(var(--tag-finance) 0% ${capPct}%, var(--card3) ${capPct}% 100%)`;
  const gauge = '<div class="gaugewrap" style="margin:6px 0 14px">'
    + `<div class="donut" style="--pct:${capPct};background:${donutBg}"><span class="val">${capPct}%</span></div>`
    + '<div><div style="font-weight:600">'
    + `${esc(money(week))} of ${esc(money(cap))}</div>`
    + '<div class="muted" style="font-size:12px">Autonomous jobs defer when the cap is hit.<br>'
    + 'Manual jobs (you) always run.</div></div></div>';

  // ── Bars ────────────────────────────────────────────────────────────────────
  const modelLabel = (r) => `<span>${esc((r && r.name) || '')}</span>`;
  const agentLabel = (r) => {
    const t = String((r && r.type) || '');
    return `<span class="tag t-${esc(t)}">${esc(t ? t[0].toUpperCase() + t.slice(1) : '')}</span>`;
  };
  const agentColor = (r) => `var(--tag-${esc(String((r && r.type) || 'research'))})`;

  const modelBars = bars(spend.byModel, modelLabel, modelColor);
  const agentBars = bars(spend.byAgent, agentLabel, agentColor);

  const cols = '<div class="grid cols-2 grow">'
    + '<div class="box">'
    + `<div class="ptitle">Spend by model (this week)${stale}</div>${modelBars}</div>`
    + '<div class="box">'
    + '<div class="ptitle">Weekly $ cap <button class="btn sm ghost" data-action="editCap">Edit cap</button></div>'
    + gauge
    + '<div class="ptitle" style="margin-top:6px">Spend by agent</div>'
    + `${agentBars}</div>`
    + '</div>';

  panel.innerHTML = kpis + cols;
  wireCost(panel);
}

function wireCost(panel) {
  if (panel.__costWired) return;
  panel.__costWired = true;
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="editCap"]')) toast('Edit cap');
  });
}
