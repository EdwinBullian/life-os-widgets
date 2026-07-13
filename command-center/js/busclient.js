// ACC bus writer (P3.5 / doc 34 Ruling 1) — the dashboard's write path.
//
// The ACC is a static GitHub Pages site; it can't run a server. So a button
// press becomes one JSON file dropped into the private `acc-bus` repo via the
// GitHub Contents API. The always-on laptop's consumer (agent_framework/acc_bus.py)
// polls, VALIDATES against a schema + closed action whitelist, and executes.
//
// This file only WRITES requests + READS replies. It enforces nothing — the
// browser is untrusted input by design; every safety rule (action enum, privacy
// legality, registry field whitelist, kill-exempt list) lives in the Python
// consumer. A fine-grained PAT scoped to acc-bus only lives in localStorage,
// entered once per device (arm-time). It is never committed and, if leaked,
// exposes only the bus repo (which holds no data worth stealing).

const TOKEN_KEY = 'acc_bus_token';
const REPO_KEY = 'acc_bus_repo';
const DEFAULT_REPO = 'EdwinBullian/acc-bus';
const BRANCH = 'main';

let tokenMem;   // in-memory mirror (the Notion embed can throw on localStorage)
let repoMem;

// ── token + repo config (localStorage, storage-denial-safe) ──────────────────
export function getBusToken() {
  if (tokenMem !== undefined) return tokenMem;
  try { tokenMem = localStorage.getItem(TOKEN_KEY) || null; } catch { tokenMem = null; }
  return tokenMem;
}
export function setBusToken(tok) {
  tokenMem = tok || null;
  try {
    if (tokenMem == null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, tokenMem);
  } catch { /* storage denied — in-memory mirror holds for the session */ }
  return tokenMem;
}
export function getBusRepo() {
  if (repoMem !== undefined) return repoMem;
  try { repoMem = localStorage.getItem(REPO_KEY) || DEFAULT_REPO; } catch { repoMem = DEFAULT_REPO; }
  return repoMem;
}
export function busConfigured() { return !!getBusToken(); }

// ── legacy dashboard action -> closed bus action (the button-parity map) ─────
// Display model names -> the gateway aliases the consumer's is_known_model accepts.
// Anything Claude-Max routes to 'claude'; open lanes map to their gateway alias.
const MODEL_ALIAS = {
  Auto: 'claude', Opus: 'claude', Sonnet: 'claude', Haiku: 'claude',
  'DeepSeek V3.2': 'claude-deepseek-v3.2', 'DeepSeek R1': 'claude-deepseek-r1',
  'Qwen3 Coder': 'claude-qwen3-coder',
};
const CRON_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

// Returns {action, payload} for the bus, or {unsupported:reason} for a control
// that has NO valid bus action (a dead-end to delete or a future compound op).
export function busActionFor(legacyAction, params = {}) {
  switch (legacyAction) {
    case 'settaskenabled':
      return { action: 'toggle_enabled',
               payload: { id: params.id, enabled: params.enabled === true || params.enabled === 'true' } };
    case 'settasknotify':
    case 'notify':
      return { action: 'toggle_notify',
               payload: { id: params.id, notify: params.notify === true || params.notify === 'true' } };
    case 'settaskmodel':
    case 'setagentmodel': {
      const model = MODEL_ALIAS[params.model] || params.model;
      return { action: 'set_model_override', payload: { id: params.id, model } };
    }
    case 'settaskschedule': {
      // The consumer's set_cron needs a 5-field cron. The schedule tab still
      // emits a human trigger ("Mon 08:00") — pass it only if it's already a
      // cron; otherwise flag (see AUDIT: schedule tab must emit cron).
      const cron = String(params.cron || params.trigger || '');
      if (!CRON_RE.test(cron)) return { unsupported: 'schedule editor must emit a 5-field cron' };
      return { action: 'set_cron', payload: { id: params.id, cron } };
    }
    case 'dispatch': {
      // Real callers send {job, agent, taskType, details, ...} (agents.js /
      // overview.js) — build the goal from job + details, not a `goal` key.
      const goal = params.goal
        || [params.job, params.details].filter(Boolean).join(' — ')
        || params.brief || '';
      return { action: 'request_job', payload: { agent: params.agent, goal } };
    }
    case 'globalpause':
      return { action: 'global_pause', payload: { paused: !!params.paused } };
    // No valid bus action (audit: delete the dead-end stubs; runnow/cancel/
    // pause are future compound ops, not registry writes).
    case 'runnow': case 'cancel': case 'pause': case 'toggleagentpause':
    case 'approve': case 'reject': case 'schedule': case 'reschedule': case 'edit':
      return { unsupported: `${legacyAction} has no bus action (audit: delete or defer)` };
    default:
      return { unsupported: `unknown action ${legacyAction}` };
  }
}

// ── transport (GitHub Contents API) ──────────────────────────────────────────
function b64(str) {
  // base64 of a possibly-unicode JSON string, browser-safe.
  return btoa(unescape(encodeURIComponent(str)));
}
function newId() {
  const rand = (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 1e9).toString(36);
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${rand}`;
}

// Write one request file. Resolves to the request id; rejects on any failure so
// the caller can fall back / surface an offline note.
export function postBusRequest(action, payload) {
  const tok = getBusToken();
  if (!tok) return Promise.reject(new Error('acc-bus token not configured'));
  const id = newId();
  const body = { id, ts: new Date().toISOString(), actor: 'acc', action, payload: payload || {} };
  const url = `https://api.github.com/repos/${getBusRepo()}/contents/requests/${id}.json`;
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: `acc: ${action}`,
      content: b64(JSON.stringify(body, null, 2) + '\n'),
      branch: BRANCH,
    }),
  }).then((res) => {
    if (!res.ok) throw new Error(`bus write failed: ${res.status}`);
    return id;
  });
}

// Translate a legacy dashboard action and post it. Rejects with a descriptive
// error when the control has no valid bus action (button-parity contract).
export function submitLegacyAction(legacyAction, params) {
  const mapped = busActionFor(legacyAction, params);
  if (mapped.unsupported) return Promise.reject(new Error(mapped.unsupported));
  return postBusRequest(mapped.action, mapped.payload);
}

// Chat round-trip: write a chat request, return its id; the caller polls reply.
export function postChat(message) {
  return postBusRequest('chat', { message: String(message || '').slice(0, 1200) });
}

// Poll one reply file. Resolves to the parsed reply object, or null if not ready.
export function fetchReply(requestId) {
  const tok = getBusToken();
  if (!tok) return Promise.resolve(null);
  const safe = String(requestId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const url = `https://api.github.com/repos/${getBusRepo()}/contents/replies/${safe}.json?ref=${BRANCH}`;
  return fetch(url, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github.raw+json' },
  }).then((res) => (res.ok ? res.json() : null)).catch(() => null);
}

export function setGlobalPause(paused) {
  return postBusRequest('global_pause', { paused: !!paused });
}
