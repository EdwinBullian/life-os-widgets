// Proxy config + transport. Storage access is ALWAYS wrapped in try/catch (the Notion embed can
// throw "Access is denied" on localStorage). JSONP for cross-origin reads; resolvable POST for writes.

import { busConfigured, busActionFor, submitLegacyAction } from './busclient.js';

const LS_KEY = 'agentos_proxy_url'; // exact predecessor key — a previously-saved URL carries over.
const DEFAULT_PROXY = null;

// in-memory mirror so the widget runs even when storage throws. `undefined` = "not yet read".
let mem;
let cbSeq = 0;

export function getProxyUrl() {
  if (mem !== undefined) return mem;
  try {
    const v = localStorage.getItem(LS_KEY);
    // Cache the successful read into the mirror so a LATER storage failure (Notion can start
    // throwing "Access is denied" mid-session) can't silently lose a URL we already read.
    mem = v == null ? DEFAULT_PROXY : v;
    return mem;
  } catch {
    return DEFAULT_PROXY;
  }
}

export function setProxyUrl(url) {
  mem = url; // always update in-memory, even if persistence fails
  try {
    if (url == null) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, url);
  } catch {
    // storage denied — in-memory mirror keeps the widget usable this session.
  }
  return mem;
}

// ── Manual Claude Max % override ──────────────────────────────────────────────
// Anthropic exposes no API for "% of Max plan used this cycle", so Eddie types it in by hand. It
// persists in localStorage (in-memory fallback) and OVERRIDES spend.json's max.pctUsed everywhere
// it's shown (topbar pill, Overview fuel donut, Cost KPI). null = "use spend.json".
const MAX_PCT_KEY = 'agentos_max_pct';
let maxPctMem;

export function getMaxPct() {
  if (maxPctMem !== undefined) return maxPctMem;
  try {
    const v = localStorage.getItem(MAX_PCT_KEY);
    maxPctMem = v == null || v === '' ? null : Number(v);
    if (maxPctMem != null && !Number.isFinite(maxPctMem)) maxPctMem = null;
    return maxPctMem;
  } catch {
    return null;
  }
}

export function setMaxPct(pct) {
  const n = pct == null || pct === '' ? null : Number(pct);
  maxPctMem = n != null && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  try {
    if (maxPctMem == null) localStorage.removeItem(MAX_PCT_KEY);
    else localStorage.setItem(MAX_PCT_KEY, String(maxPctMem));
  } catch { /* storage denied — in-memory mirror holds for the session */ }
  return maxPctMem;
}

// ── Local agent-pause overrides ───────────────────────────────────────────────
// Optimistic UI that survives reloads even when the proxy/backend can't be reached. The render
// layer merges this over status.settings.pausedAgents, so a click flips immediately and sticks.
const PAUSED_KEY = 'agentos_paused_agents';
let pausedMem;

export function getPausedAgents() {
  if (pausedMem !== undefined) return pausedMem;
  try {
    const v = localStorage.getItem(PAUSED_KEY);
    pausedMem = v ? JSON.parse(v) : [];
  } catch { pausedMem = []; }
  if (!Array.isArray(pausedMem)) pausedMem = [];
  return pausedMem;
}

export function setAgentPaused(key, paused) {
  const cur = new Set(getPausedAgents());
  if (paused) cur.add(key); else cur.delete(key);
  pausedMem = [...cur];
  try { localStorage.setItem(PAUSED_KEY, JSON.stringify(pausedMem)); } catch { /* storage denied */ }
  return pausedMem;
}

// JSONP GET ?action=status&callback=… → resolves parsed status. Times out (~8s) and rejects,
// ALWAYS cleaning up the injected <script> and the global callback (no leaks across polls).
export function fetchStatus({ timeoutMs = 8000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const name = `__agentos_cb_${++cbSeq}`;
    let script;
    let timer;
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try { delete window[name]; } catch { window[name] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    function onAbort() {
      cleanup();
      reject(new Error('aborted'));
    }
    if (signal && signal.aborted) { reject(new Error('aborted')); return; }
    window[name] = (data) => { cleanup(); resolve(data); };
    if (signal) signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);

    const base = getProxyUrl() || '';
    script = document.createElement('script');
    script.src = `${base}?action=status&callback=${name}`;
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    document.head.appendChild(script);
  });
}

// Real write actions. approve/schedule/reschedule are P2 stubs handled in the render layer and
// must never reach the proxy — postAction rejects them.
// Registry actions (settask*) are wired here and ready for the Apps Script backend. Each is also
// applied optimistically to a local override (see getTaskOverrides) so the UI works before the
// backend handler exists. Payloads (x-www-form-urlencoded):
//   settaskenabled   → { action, id, enabled:"true"|"false" }
//   settaskmodel     → { action, id, model:"gpt-oss-20b" }
//   settaskschedule  → { action, id, trigger:"Mon 08:00" }
const ALLOWED_ACTIONS = new Set([
  'dispatch', 'pause', 'runnow', 'cancel', 'setagentmodel', 'toggleagentpause',
  'settaskenabled', 'settaskmodel', 'settaskschedule',
  // ACC rewire: these route through the bus (busclient.busActionFor).
  'settasknotify', 'globalpause',
]);

// ── Local registry overrides ──────────────────────────────────────────────────
// Per-task patches (enabled / model / trigger) the user makes from the Registry tab. Persisted so
// the table reflects intended state immediately and across reloads, then merged over registry.json
// at render time. The matching POST keeps the backend in sync once its handlers are live.
const TASK_OVR_KEY = 'agentos_task_overrides';
let taskOvrMem;

export function getTaskOverrides() {
  if (taskOvrMem !== undefined) return taskOvrMem;
  try {
    const v = localStorage.getItem(TASK_OVR_KEY);
    taskOvrMem = v ? JSON.parse(v) : {};
  } catch { taskOvrMem = {}; }
  if (!taskOvrMem || typeof taskOvrMem !== 'object' || Array.isArray(taskOvrMem)) taskOvrMem = {};
  return taskOvrMem;
}

export function setTaskOverride(id, patch) {
  if (!id) return getTaskOverrides();
  const cur = { ...getTaskOverrides() };
  cur[id] = { ...(cur[id] || {}), ...patch };
  taskOvrMem = cur;
  try { localStorage.setItem(TASK_OVR_KEY, JSON.stringify(cur)); } catch { /* storage denied */ }
  return taskOvrMem;
}

// ── Phone Link Bridge snooze ───────────────────────────────────────────────────
// Local-only countdown for the Phone Bridge tab's snooze presets (1h / 4h / until tomorrow).
// Separate from the settaskenabled override above — this just remembers WHEN to auto-flip the
// task override back to enabled. Cleared once the snooze passes (see render/phonebridge.js).
const PB_SNOOZE_KEY = 'agentos_phonebridge_snooze_until';
let pbSnoozeMem;

export function getPhoneBridgeSnoozeUntil() {
  if (pbSnoozeMem !== undefined) return pbSnoozeMem;
  try {
    const v = localStorage.getItem(PB_SNOOZE_KEY);
    pbSnoozeMem = v ? Number(v) : null;
    if (pbSnoozeMem != null && !Number.isFinite(pbSnoozeMem)) pbSnoozeMem = null;
  } catch { pbSnoozeMem = null; }
  return pbSnoozeMem;
}

export function setPhoneBridgeSnoozeUntil(ts) {
  pbSnoozeMem = ts == null ? null : Number(ts);
  try {
    if (pbSnoozeMem == null) localStorage.removeItem(PB_SNOOZE_KEY);
    else localStorage.setItem(PB_SNOOZE_KEY, String(pbSnoozeMem));
  } catch { /* storage denied — in-memory mirror holds for the session */ }
  return pbSnoozeMem;
}

export function postAction(action, params = {}) {
  if (!ALLOWED_ACTIONS.has(action)) {
    return Promise.reject(new Error(`disallowed action: ${action}`));
  }
  // ACC rewire (P3.5): when the acc-bus token is configured, the GitHub-as-bus
  // path (doc 34 Ruling 1) is the canonical writer — it replaces the rejected
  // Apps Script proxy. Actions with no valid bus mapping fall through to the
  // legacy POST (or reject) so nothing silently no-ops.
  if (busConfigured()) {
    const mapped = busActionFor(action, params);
    if (!mapped.unsupported) return submitLegacyAction(action, params);
    // No bus mapping. Falling through to a legacy proxy that is almost never configured
    // used to surface "no proxy url configured" — which blames the wrong thing and hides
    // the real answer ("this control has no backend action"). Say the true reason.
    if (!getProxyUrl()) return Promise.reject(new Error(mapped.unsupported));
  }
  const url = getProxyUrl();
  if (!url) {
    // The bus is the canonical write path; an unset token is the overwhelmingly common
    // cause. Name the fix, not the symptom — this string is shown to Eddie verbatim.
    return Promise.reject(new Error(busConfigured()
      ? 'no proxy url configured'
      : 'not connected — add your acc-bus token in Settings (⚙)'));
  }
  const body = new URLSearchParams();
  body.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).then((res) => {
    if (!res.ok) throw new Error(`post failed: ${res.status}`);
    return res.json().catch(() => ({ ok: true }));
  });
}

export const ACTIONS = ALLOWED_ACTIONS; // exported for the render layer to validate against

export function _resetProxyForTests() {
  mem = undefined;
  cbSeq = 0;
}
