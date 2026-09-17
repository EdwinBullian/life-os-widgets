// Unique jobs on the Schedule board: the browser's record of each one-off Eddie creates, whether
// it sits unscheduled in the tray or is placed on a day.
//
// Unscheduled jobs are drafts and live only here — nothing runs until a job is dropped on a day.
// Placing, moving and unscheduling each send one bus request (oneoff_place / oneoff_move /
// oneoff_cancel). The desktop consumer turns those into the FC-18 one-off queue, which the
// oneoff-runner executes. The board shows where Eddie put a job straight away, but a refusal from
// the consumer puts it back where it was and shows the reason, so the board never claims a
// placement the desktop didn't accept.

import { postBusRequest, fetchReply, busConfigured } from './busclient.js';

const LS_KEY = 'agentos_board_oneoffs';
const DONE_PRUNE_MS = 14 * 24 * 60 * 60 * 1000;

let mem;
let seq = 0;

function read() {
  if (mem !== undefined) return mem;
  try { mem = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { mem = []; }
  if (!Array.isArray(mem)) mem = [];
  return mem;
}

function write(rows) {
  const cutoff = Date.now() - DONE_PRUNE_MS;
  // A placed job whose day is two weeks gone has run; keep the list from growing forever.
  mem = rows.filter((r) => !(r.day && Date.parse(`${r.day}T23:59:59`) < cutoff));
  try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch { /* storage denied — memory holds */ }
  return mem;
}

function lid() {
  const r = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${(seq += 1)}`;
  return `bj-${r}`;
}

export function listBoardJobs() { return read().slice(); }

export function getBoardJob(id) { return read().find((r) => r.lid === id) || null; }

function patch(id, p) {
  write(read().map((r) => (r.lid === id ? { ...r, ...p } : r)));
  return getBoardJob(id);
}

export function createDraft({ agent, jobType, jobLabel, tag, brief }) {
  const title = String(brief || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ') || jobLabel;
  const row = {
    lid: lid(), ts: new Date().toISOString(), agent, jobType, jobLabel, tag,
    brief: String(brief || ''), title, day: null, oid: null, state: 'draft', reason: '',
    op: null, reqId: null, prevDay: null,
  };
  write([...read(), row]);
  return row;
}

export function removeDraft(id) {
  const r = getBoardJob(id);
  if (r && !r.day && r.state !== 'sending') write(read().filter((x) => x.lid !== id));
}

function send(id, op, action, payload, optimistic) {
  const before = getBoardJob(id);
  if (!before) return Promise.resolve(null);
  patch(id, { ...optimistic, state: 'sending', op, prevDay: before.day, reason: '' });
  return postBusRequest(action, payload)
    .then((reqId) => patch(id, { reqId }))
    .catch((err) => revert(id, String((err && err.message) || err)));
}

function revert(id, reason) {
  const r = getBoardJob(id);
  if (!r) return null;
  if (r.op === 'place') return patch(id, { state: 'draft', day: null, reqId: null, op: null, reason });
  return patch(id, { state: 'placed', day: r.prevDay, reqId: null, op: null, reason });
}

// Returns '' when sent, or a reason the move can't be made right now.
export function placeJob(id, day) {
  const r = getBoardJob(id);
  if (!r) return 'job not found';
  if (!busConfigured()) return 'Not connected — add your acc-bus token in Settings (⚙)';
  if (r.state === 'sending') return 'Still sending the last change — give it a minute';
  if (r.day === day) return '';
  if (!r.day) {
    send(id, 'place', 'oneoff_place', { agent: r.agent, job_type: r.jobType, brief: r.brief, run_on: day }, { day });
    return '';
  }
  if (!r.oid) return 'Still waiting on the desktop to confirm this job';
  send(id, 'move', 'oneoff_move', { id: r.oid, run_on: day }, { day });
  return '';
}

export function unplaceJob(id) {
  const r = getBoardJob(id);
  if (!r || !r.day) return '';
  if (!busConfigured()) return 'Not connected — add your acc-bus token in Settings (⚙)';
  if (r.state === 'sending') return 'Still sending the last change — give it a minute';
  if (!r.oid) return 'Still waiting on the desktop to confirm this job';
  send(id, 'cancel', 'oneoff_cancel', { id: r.oid }, { day: null });
  return '';
}

// Poll replies for rows mid-change. Resolves to the number of rows that changed.
export function reconcileBoardJobs() {
  const waiting = read().filter((r) => r.state === 'sending' && r.reqId);
  if (!waiting.length || !busConfigured()) return Promise.resolve(0);
  return Promise.all(waiting.map((r) => fetchReply(r.reqId).then((reply) => {
    if (!reply || typeof reply !== 'object') return 0;
    const ok = reply.ok === true || reply.ok === 'true';
    if (!ok) { revert(r.lid, String(reply.reason || 'refused by the desktop')); return 1; }
    if (r.op === 'cancel') patch(r.lid, { state: 'draft', oid: null, day: null, reqId: null, op: null });
    else patch(r.lid, { state: 'placed', oid: reply.oneoff_id || r.oid, reqId: null, op: null });
    return 1;
  }).catch(() => 0))).then((n) => n.reduce((a, b) => a + b, 0));
}

export function _resetBoardJobsForTests() { mem = undefined; seq = 0; try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }
