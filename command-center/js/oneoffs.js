// One-off run ledger — the dashboard's memory of the jobs Eddie fires by hand.
//
// Why this file has to exist: the ACC is a static page. A one-off dispatch becomes a
// `request_job` file in the acc-bus repo, and the laptop's consumer DELETES that file the
// moment it picks it up (acc_bus.ack). There is therefore no server-side list the Schedule
// tray could read — by the time you look, the evidence is already gone. So the browser keeps
// its own ledger of what it submitted and reconciles each row against `replies/<id>.json`,
// which the consumer writes with {ok, reason}.
//
// Every state below is earned, never optimistic:
//   submitting → the PUT to the bus is still in flight
//   pending    → the bus took the file; the consumer hasn't replied yet (polls every ~2 min)
//   accepted   → consumer replied ok:true — the desk has the job
//   refused    → consumer replied ok:false — `reason` is its verbatim explanation
//   failed     → the write itself never landed (no token, offline, 4xx) — `reason` says why
//
// A failed row is kept and SHOWN. That is the point: the old code toasted a success message
// and dropped the job on the floor, which is how "I dispatched a Meta thesis and it was
// nowhere" happens. A job you fired is either visible with a real status or it never existed.

import { fetchReply, busConfigured } from './busclient.js';

const LS_KEY = 'agentos_oneoffs';
const MAX_ROWS = 40;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000; // finished rows fall off the tray after a week

// in-memory mirror so the tray still works when the Notion embed denies localStorage.
let mem;
let seq = 0;

export const TERMINAL = new Set(['accepted', 'refused', 'failed']);

function read() {
  if (mem !== undefined) return mem;
  try {
    const raw = localStorage.getItem(LS_KEY);
    mem = raw ? JSON.parse(raw) : [];
  } catch { mem = []; }
  if (!Array.isArray(mem)) mem = [];
  return mem;
}

function write(rows) {
  mem = rows;
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows)); } catch { /* storage denied — mirror holds */ }
  return mem;
}

function localId() {
  const rand = (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}${(seq += 1)}`;
  return `oo-${rand}`;
}

// Drop terminal rows older than a week; keep every non-terminal row regardless of age (a
// stuck "pending" is information, not clutter — it means the consumer never answered).
function prune(rows) {
  const cutoff = Date.now() - PRUNE_MS;
  const kept = rows.filter((r) => {
    if (!TERMINAL.has(r.state)) return true;
    const t = Date.parse(r.ts || '');
    return !Number.isFinite(t) || t >= cutoff;
  });
  return kept.slice(0, MAX_ROWS);
}

// Newest first — the tray reads top-down.
export function listOneOffs() {
  return prune(read()).slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
}

export function countActive() {
  return read().filter((r) => !TERMINAL.has(r.state)).length;
}

// Create a row in `submitting`. Returns the row (its `lid` is the handle for later patches).
export function recordOneOff({ title, agent, taskType, goal, runMode, model }) {
  const row = {
    lid: localId(),
    ts: new Date().toISOString(),
    title: String(title || 'One-off job'),
    agent: String(agent || ''),
    taskType: String(taskType || ''),
    goal: String(goal || ''),
    runMode: String(runMode || 'Downtime'),
    model: String(model || 'Auto'),
    state: 'submitting',
    reason: '',
    reqId: null,
  };
  write(prune([row, ...read()]));
  return row;
}

export function markOneOff(lid, patch) {
  const rows = read().map((r) => (r.lid === lid ? { ...r, ...patch } : r));
  write(prune(rows));
  return rows.find((r) => r.lid === lid) || null;
}

export function removeOneOff(lid) {
  write(prune(read().filter((r) => r.lid !== lid)));
  return mem;
}

export function clearFinishedOneOffs() {
  write(prune(read().filter((r) => !TERMINAL.has(r.state))));
  return mem;
}

// Ask the bus for a verdict on every row still waiting on one. Resolves to the number of rows
// that actually changed, so the caller can re-render ONLY on real news (a render loop that
// fires on every poll would fight the user's scroll position in the tray).
//
// A pending row with no reply yet is left pending — silence from the consumer is not a failure,
// it just hasn't polled. Rows are only marked accepted/refused when a reply really exists.
export function reconcileOneOffs() {
  const waiting = read().filter((r) => r.state === 'pending' && r.reqId);
  if (!waiting.length || !busConfigured()) return Promise.resolve(0);
  return Promise.all(waiting.map((r) => fetchReply(r.reqId)
    .then((reply) => {
      if (!reply || typeof reply !== 'object') return 0;
      const ok = reply.ok === true || reply.ok === 'true';
      markOneOff(r.lid, {
        state: ok ? 'accepted' : 'refused',
        reason: String(reply.reason || reply.detail || (ok ? '' : 'refused by the consumer')),
      });
      return 1;
    })
    .catch(() => 0)))
    .then((hits) => hits.reduce((a, b) => a + b, 0));
}

export function _resetOneOffsForTests() {
  mem = undefined;
  seq = 0;
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
