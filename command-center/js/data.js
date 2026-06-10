// Static JSON cache. Fetches ./data/*.json once, routes through safe(), and caches into the store.
// A missing/failed/malformed file must NEVER blank the topbar or crash a tab — fall back to empty.

import { safe } from './util.js';
import { setState } from './state.js';

// Frozen so the shared fallback singleton can't be mutated in place by a renderer (which would
// corrupt every later fallback that returns the same reference).
export const EMPTY_SPEND = Object.freeze({
  updated: null,
  max: Object.freeze({ pctUsed: 0, resetAt: '', estTokens: 0, capTokens: 0 }),
  openrouter: Object.freeze({ weekSpend: 0, weekCap: 0, projectedMonth: 0 }),
  byModel: Object.freeze([]),
  byAgent: Object.freeze([]),
  tokensOffloadedWeek: 0,
});

export const EMPTY_SCHEDULE = Object.freeze({
  updated: null,
  dailyBaseK: 0,
  week: Object.freeze([]),
  dailies: Object.freeze([]),
});

async function fetchJson(path, fallback) {
  try {
    // no-store: spend/schedule are edited out-of-band; don't let the 10-min Pages cache stale them.
    const res = await fetch(path, { cache: 'no-store' });
    if (!res || !res.ok) return fallback;
    const json = await res.json();
    return safe(json, fallback); // safe → fallback when null/wrong container kind
  } catch {
    return fallback; // network error or malformed JSON
  }
}

export async function loadSpend() {
  const spend = await fetchJson('./data/spend.json', EMPTY_SPEND);
  setState({ spend });
  return spend;
}

export async function loadSchedule() {
  const schedule = await fetchJson('./data/schedule.json', EMPTY_SCHEDULE);
  setState({ schedule });
  return schedule;
}

export async function loadStaticData() {
  return Promise.all([loadSpend(), loadSchedule()]);
}
