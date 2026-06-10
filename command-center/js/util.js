// Pure, DOM-free helpers + single-source constants for the AI Command Center widget.
// No DOM / fetch / localStorage access anywhere in this module — every renderer (sections 04–06)
// depends on the stable, normalized shapes these helpers produce.

// ── Single-source-of-truth constants (do not duplicate these literals downstream) ────────────
export const HEAVY_DAY_K = 220; // a day's total (in thousands of tokens) >= this flags "heavy"
export const POLL_MS = 60000;   // status poll cadence (used by poll.js, section 03)

// why: ≈$3 per million tokens is a reasonable blended OpenRouter rate for cost estimates.
const OPEN_RATE_PER_TOKEN = 3 / 1_000_000;

// why: event blocks must stay legible (min) yet never overflow the fixed --app-h panel (max).
const EVT_MIN_PX = 18;
const EVT_MAX_PX = 120;
const EVT_PX_PER_TOKEN = 1 / 2000; // 2k tokens ≈ 1px of height

// how stale a per-agent LAST RUN may be before its health drops to amber.
// why 8: most agents run weekly, so a >8-day gap means a scheduled run was actually missed.
// NOTE: this is distinct from isStale() below, which measures DATA-FILE freshness (2×poll cadence),
// not run recency. Two different staleness notions on purpose — don't unify them.
const STALE_RUN_DAYS = 8;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ── esc ──────────────────────────────────────────────────────────────────────
// Escapes & < > " ' — the single quote is load-bearing: render strings interpolate into both
// innerHTML and single-quoted attribute contexts. null/undefined → "". Non-strings coerced.
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── hh ───────────────────────────────────────────────────────────────────────
// hour-of-day (0..23) → compact 12h label: 0→"12a", 9→"9a", 12→"12p", 18→"6p", 23→"11p".
export function hh(hour) {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? 'a' : 'p'}`;
}

// ── estCost ──────────────────────────────────────────────────────────────────
// {tier, tok} → "Max plan" | "free" | "≈$X.XX" (open-router tier, computed from tok).
export function estCost(job) {
  const tier = job && job.tier;
  if (tier === 'max') return 'Max plan';
  if (tier === 'free') return 'free';
  const tok = (job && Number(job.tok)) || 0;
  return `≈$${(tok * OPEN_RATE_PER_TOKEN).toFixed(2)}`;
}

// ── healthOf ─────────────────────────────────────────────────────────────────
// (type, lastRun, running) → {cls, label}. `lastRun` is the most-recent run record
// ({status, when}) or null. Precedence: running → run; no runs → gray; failed → red;
// stale success → amber; else green.
// NOTE (as-built): the section spec sketched the 2nd arg as `key`; it is the last-run record,
// since cls/label are derived from last-run state, which a bare key string cannot provide.
export function healthOf(type, lastRun, running) {
  if (running) return { cls: 'run', label: 'Running' };
  if (!lastRun) return { cls: 'gray', label: 'No runs yet' };
  if (lastRun.status === 'fail') return { cls: 'red', label: 'Last run failed' };
  const when = Date.parse(lastRun.when);
  const stale = Number.isNaN(when) || Date.now() - when > STALE_RUN_DAYS * 86400000;
  if (stale) return { cls: 'amber', label: 'Stale' };
  return { cls: 'green', label: 'Healthy' };
}

// ── dayTotals ────────────────────────────────────────────────────────────────
// (week[{day,tok}], dailyBaseK) → 7 rows [{day, k, heavy}]. Each day = base + sum(tok)/1000 (K).
// heavy when k >= HEAVY_DAY_K. Empty/missing week → every day equals just the base.
export function dayTotals(week, dailyBaseK) {
  const base = Number(dailyBaseK) || 0;
  const rows = DAY_NAMES.map((_, day) => ({ day, k: base, heavy: false }));
  if (Array.isArray(week)) {
    for (const e of week) {
      const d = e && Number(e.day);
      if (!Number.isInteger(d) || d < 0 || d > 6) continue;
      rows[d].k += (Number(e.tok) || 0) / 1000;
    }
  }
  for (const r of rows) {
    r.k = Math.round(r.k);
    r.heavy = r.k >= HEAVY_DAY_K;
  }
  return rows;
}

// ── evtHeight ────────────────────────────────────────────────────────────────
// token count → block pixel height, monotonic non-decreasing, clamped to [EVT_MIN_PX, EVT_MAX_PX].
export function evtHeight(tok) {
  const t = Number(tok) || 0;
  return Math.round(clamp(EVT_MIN_PX + t * EVT_PX_PER_TOKEN, EVT_MIN_PX, EVT_MAX_PX));
}

// ── parseRunFeed ─────────────────────────────────────────────────────────────
// proxy status.runFeed → activity rows [{time, agent, message, status}]. Missing/non-array → [].
export function parseRunFeed(status) {
  const feed = status && status.runFeed;
  if (!Array.isArray(feed)) return [];
  return feed.map((r) => ({
    time: (r && r.when) || '',
    agent: (r && r.agent) || '',
    message: (r && r.title) || '',
    status: (r && r.status) || '',
  }));
}

// ── normalizeQueue ───────────────────────────────────────────────────────────
// flat status.queue → {waiting, approved, scheduled}. status==="Queued" → waiting.
// approved/scheduled stay empty until the proxy exposes those states (Phase 2). Never throws.
export function normalizeQueue(status) {
  const out = { waiting: [], approved: [], scheduled: [] };
  const q = status && status.queue;
  if (!Array.isArray(q)) return out;
  for (const item of q) {
    if (item && item.status === 'Queued') out.waiting.push(item);
  }
  return out;
}

// ── nextRun ──────────────────────────────────────────────────────────────────
// (schedule, agentKey) → next fire-time label for that agent ("Mon 6a"), cyclic from now.
// Agent with no jobs (or missing schedule) → null.
export function nextRun(schedule, agentKey) {
  const week = schedule && schedule.week;
  if (!Array.isArray(week)) return null;
  const jobs = week.filter((e) => e && e.agent === agentKey && Number.isInteger(e.day));
  if (!jobs.length) return null;
  const now = new Date();
  const nowMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  // minutes-from-now until each job fires, wrapping to next week if already passed.
  const soonest = jobs
    .map((e) => {
      const fire = e.day * 1440 + (Number(e.hour) || 0) * 60;
      const delta = (fire - nowMin + 10080) % 10080;
      return { e, delta };
    })
    .sort((a, b) => a.delta - b.delta)[0].e;
  return `${DAY_NAMES[soonest.day]} ${hh(Number(soonest.hour) || 0)}`;
}

// ── safe ─────────────────────────────────────────────────────────────────────
// returns json when it matches fallback's container kind (array vs object), else fallback.
// Never throws — the graceful-empty primitive every renderer calls.
export function safe(json, fallback) {
  try {
    if (json === null || json === undefined) return fallback;
    if (Array.isArray(fallback) !== Array.isArray(json)) return fallback;
    if (typeof json !== typeof fallback) return fallback;
    return json;
  } catch {
    return fallback;
  }
}

// ── isStale ──────────────────────────────────────────────────────────────────
// true when now - updated > 2× cadenceMs. Missing/unparseable updated → stale (true).
export function isStale(updatedISO, cadenceMs) {
  if (!updatedISO) return true;
  const t = Date.parse(updatedISO);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > 2 * (Number(cadenceMs) || 0);
}
