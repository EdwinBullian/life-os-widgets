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
// Returns true when the token was actually PERSISTED, false when it only made it into the
// in-memory mirror (i.e. it dies on the next reload).
//
// This return value matters more than it looks. In a Notion embed the dashboard is a
// cross-site iframe, so the browser may partition or outright deny localStorage — the write
// throws, this used to swallow it, and the token silently lived for exactly one session. The
// UI said "Settings saved" either way, so the token appeared to vanish on its own. It didn't:
// it was never written. Settings now reports which of the two happened.
export function setBusToken(tok) {
  tokenMem = tok || null;
  try {
    if (tokenMem == null) {
      localStorage.removeItem(TOKEN_KEY);
      return true;
    }
    localStorage.setItem(TOKEN_KEY, tokenMem);
    // Read back rather than trusting the write: partitioned/ephemeral storage can accept a
    // setItem and hand back nothing (or drop it at end of session).
    return localStorage.getItem(TOKEN_KEY) === tokenMem;
  } catch {
    return false; // storage denied — in-memory mirror holds for THIS SESSION ONLY
  }
}

// Did the stored token survive to disk? Used by Settings to warn on a session-only save.
export function busTokenPersisted() {
  try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
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
  'gpt-oss-20b': 'claude-or-general', 'Nemotron-3 Super': 'claude-or-reasoning',
  'Devstral': 'claude-or-coder',
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
      // Real callers send {job, agent, taskType, details, runMode, model} (agents.js /
      // overview.js) — build the goal from job + details, not a `goal` key.
      //
      // request_job's payload is only {agent, goal}, so runMode and model have nowhere
      // structural to go. They used to be dropped on the floor: the form let you pick
      // "Run now" and a model, and neither ever left the browser. Fold them into the goal
      // text instead — the desk reads the goal, so the intent at least ARRIVES. Only
      // non-default values are appended, to keep routine goals clean.
      const base = params.goal
        || [params.job, params.details].filter(Boolean).join(' — ')
        || params.brief || '';
      const notes = [];
      if (params.runMode && params.runMode !== 'Downtime') notes.push(`When: ${params.runMode}`);
      if (params.runAfter) notes.push(`Not before: ${params.runAfter}`);
      if (params.model && params.model !== 'Auto') notes.push(`Preferred model: ${params.model}`);
      const goal = notes.length ? `${base}\n\n[${notes.join(' · ')}]` : base;
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

// Read-only check that the stored token can actually see the bus repo. Resolves to
// {ok:true} or {ok:false, reason}. Costs one GET and no writes.
//
// This exists because "the token was never set / is wrong" is invisible until a button
// fails, and a failing button is easy to misread as a broken button. Settings calls this
// on save so the answer arrives when the token is entered, not hours later.
export function verifyBusToken(tok) {
  const token = tok || getBusToken();
  if (!token) return Promise.resolve({ ok: false, reason: 'no token set' });
  return fetch(`https://api.github.com/repos/${getBusRepo()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }).then((res) => {
    if (res.ok) return { ok: true, reason: '' };
    if (res.status === 401) return { ok: false, reason: 'token rejected (401) — expired or mistyped' };
    if (res.status === 403) return { ok: false, reason: 'token lacks access (403) — check its repo permissions' };
    if (res.status === 404) return { ok: false, reason: `can't see ${getBusRepo()} (404) — wrong repo, or the token isn't scoped to it` };
    return { ok: false, reason: `GitHub returned ${res.status}` };
  }).catch((err) => ({ ok: false, reason: `network error — ${String((err && err.message) || err)}` }));
}
