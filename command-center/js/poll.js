// The single status poller. One interval at POLL_MS, one AbortController per in-flight request,
// an in-flight guard (no double-fire), clear-before-recreate (no stacked timers), and a debounced
// ~1.5s one-off re-poll after writes.

import { POLL_MS } from './util.js';
import { fetchStatus } from './proxy.js';
import { getState, setState } from './state.js';

let timer = null;
let controller = null;
let repollTimer = null;

const REPOLL_MS = 1500;

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

export function stopPoller() {
  clearTimer();
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
  controller = null;
  if (repollTimer) { clearTimeout(repollTimer); repollTimer = null; }
}
