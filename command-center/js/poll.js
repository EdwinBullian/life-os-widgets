// The single status poller. One interval at POLL_MS, one AbortController per in-flight request,
// an in-flight guard (no double-fire), clear-before-recreate (no stacked timers), and a debounced
// ~1.5s one-off re-poll after writes.

import { POLL_MS } from './util.js';
import { fetchStatus } from './proxy.js';
import { getState, setState } from './state.js';
import { loadKbGraph } from './data.js';

let timer = null;
let controller = null;
let repollTimer = null;
let kbGraphTimer = null;

const REPOLL_MS = 1500;
// kb_graph.json is 350KB+ and only changes when reindex.py's nightly job reruns graph_export —
// polling it on the 60s status cadence (POLL_MS) would be ~30x more network traffic than the
// data ever changes. loadKbGraph() also no-ops the state update when generated_at is unchanged,
// so most of these ticks cost one fetch and nothing else (no re-render, no D3 rebuild).
const KB_GRAPH_POLL_MS = 10 * 60 * 1000;

// One poll attempt. Skips entirely if a request is already in flight.
export function tick() {
  if (getState().polling.inFlight) return;
  // NOTE: setState shallow-merges `polling` wholesale — poll.js is its single owner, so always
  // write the full {inFlight, lastError} object; partial patches from elsewhere would clobber it.
  controller = new AbortController();
  setState({ polling: { inFlight: true, lastError: getState().polling.lastError } });
  fetchStatus({ signal: controller.signal })
    .then((status) => {
      controller = null;
      setState({ status, polling: { inFlight: false, lastError: null } });
    })
    .catch((err) => {
      // keep last-known status; surface the error for the topbar.
      controller = null;
      setState({ polling: { inFlight: false, lastError: String((err && err.message) || err) } });
    });
}

function clearTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function startPoller() {
  clearTimer(); // clear-before-recreate so startPoller() twice never stacks intervals
  timer = setInterval(tick, POLL_MS);
}

function clearKbGraphTimer() {
  if (kbGraphTimer) { clearInterval(kbGraphTimer); kbGraphTimer = null; }
}

// Separate, much slower poller for the Brain tab's kb_graph.json — see KB_GRAPH_POLL_MS.
// Independent of the status poller/in-flight guard above: a stalled status fetch must never
// block this, and vice versa.
export function startKbGraphPoller() {
  clearKbGraphTimer();
  kbGraphTimer = setInterval(() => { loadKbGraph().catch(() => {}); }, KB_GRAPH_POLL_MS);
}

export function stopPoller() {
  clearTimer();
  clearKbGraphTimer();
  if (controller) { controller.abort(); controller = null; }
  if (repollTimer) { clearTimeout(repollTimer); repollTimer = null; }
}

// Schedule exactly one fast re-poll. Debounced: repeated writes within the window don't stack.
export function repollSoon(ms = REPOLL_MS) {
  if (repollTimer) clearTimeout(repollTimer);
  repollTimer = setTimeout(() => { repollTimer = null; tick(); }, ms);
}

export function _resetPollerForTests() {
  clearTimer();
  clearKbGraphTimer();
  controller = null;
  if (repollTimer) { clearTimeout(repollTimer); repollTimer = null; }
}
