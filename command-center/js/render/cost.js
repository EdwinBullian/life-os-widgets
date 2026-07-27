// Cost tab: spend KPIs, by-model / by-agent bars, weekly-cap donut. Markup matches the approved
// mockup verbatim (grid/box/kpi/barrow/donut classes ported into css/styles.css). Fully read-only
// as of 2026-07-26 — the "Edit cap" stub was deleted (button-parity audit: no bus action exists
// for it). Degrades to a placeholder on null/malformed spend so the Cost tab and topbar never crash.

import { esc, safe, isStale } from '../util.js';
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

// Per-model fill color — explicit hexes so model colors never shift when an agent theme color
// changes (e.g. finance going gold). Each model gets a stable, distinct color.
function modelColor(r) {
  const name = String((r && r.name) || '').toLowerCase();
  if (name.includes('opus')) return '#6aa3e0';   // blue
  if (name.includes('sonnet')) return '#7a9fd1'; // soft blue
  if (name.includes('haiku')) return '#9d83d6';  // purple
  if (name.includes('nemotron')) return '#c478c4'; // magenta — reasoning/finance
  if (name.includes('gpt-oss')) return '#5fb98a';  // green — workhorse
  if (name.includes('devstral')) return '#d4905c'; // orange — coder
  if (name.includes('scout')) return '#d6b85c';    // gold — vision
  if (name.includes('free')) return 'var(--faint)';
  return 'var(--tag-research)';
}

// ── Registry-derived cost (the consistent source) ─────────────────────────────
// Blended $/Mtok per model (rough in+out blend). Max-plan jobs are $0 marginal under the cap, but
// we surface a blended-equivalent cost so every agent/model shows a comparable bar.
const BLENDED_RATE = {
  opus: 7.5, sonnet: 3.0, haiku: 0.8, nemotron: 0.20, devstral: 0.80, scout: 0.15, 'gpt-oss': 0.055,
};
function rateFor(model) {
  const m = String(model || '').toLowerCase();
  for (const key of Object.keys(BLENDED_RATE)) if (m.includes(key)) return BLENDED_RATE[key];
  return 1.0;
}

// Aggregate enabled registry tasks into by-agent and by-model weekly cost. Returns null when
// there's no registry, so renderCost falls back to spend.json's arrays.
function computeRegistryCost(registry) {
  const tasks = (registry && Array.isArray(registry.tasks)) ? registry.tasks : [];
  if (!tasks.length) return null;
  const byAgent = {};
  const byModel = {};
  for (const t of tasks) {
    if (!t.enabled) continue;
    const wk = (Number(t.estTokensPerRun) || 0) * (Number(t.runsPerWeek) || 0);
    if (!wk) continue;
    const cost = (wk / 1e6) * rateFor(t.model);
    const agent = String(t.agent || 'infra').toLowerCase();
    if (agent !== 'infra') byAgent[agent] = (byAgent[agent] || 0) + cost;
    const model = t.model || '—';
    if (!byModel[model]) byModel[model] = { name: model, spend: 0, tier: t.currentTier || '' };
    byModel[model].spend += cost;
  }
  return {
    byAgent: Object.entries(byAgent).map(([type, spend]) => ({ type, spend })).sort((a, b) => b.spend - a.spend),
    byModel: Object.values(byModel).sort((a, b) => b.spend - a.spend),
  };
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
  const donutBg = `conic-gradient(var(--running) 0% ${capPct}%, var(--card3) ${capPct}% 100%)`;
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

  // Prefer registry-derived breakdowns (consistent, covers every agent); fall back to spend.json.
  const reg = computeRegistryCost(safe(state.registry, null));
  const modelRows = reg ? reg.byModel : spend.byModel;
  const agentRows = reg ? reg.byAgent : spend.byAgent;
  const regUpdated = state.registry && state.registry.updated
    ? ` <span class="faint" style="font-size:11px">· registry ${esc(state.registry.updated)}</span>` : '';

  const modelBars = bars(modelRows, modelLabel, modelColor);
  const agentBars = bars(agentRows, agentLabel, agentColor);

  const cols = '<div class="grid cols-2 grow">'
    + '<div class="box">'
    + `<div class="ptitle">Est. weekly cost by model${stale}${regUpdated}</div>${modelBars}</div>`
    + '<div class="box">'
    // "Edit cap" was a dead end — it toasted "Edit cap" and changed nothing. The cap is a plain
    // number in data/spend.json with no bus action behind it, so per the button-parity audit the
    // button is deleted rather than left faking an edit. Say where the number actually lives.
    + '<div class="ptitle">Weekly $ cap <span class="faint mono" title="Hand-maintained in the dashboard\'s data file">'
    + 'set in data/spend.json</span></div>'
    + gauge
    + '<div class="ptitle" style="margin-top:6px">Est. weekly cost by agent <span class="faint">blended model rates</span></div>'
    + `${agentBars}</div>`
    + '</div>';

  panel.innerHTML = kpis + cols;
  wireCost(panel);
}

// The Cost tab is read-only by design: every number on it is derived from spend.json /
// registry.json, and there is no bus action that writes any of them. It therefore has no
// click handlers — an empty wire function is kept so the render path stays uniform.
function wireCost() { /* no interactive controls on this tab */ }
