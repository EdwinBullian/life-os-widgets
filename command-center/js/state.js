// Central observable store — the single source of app state. One-way flow:
// event → action → setState(patch) → subscribers (render). No DOM access here.

const DEFAULT_STATE = {
  activeTab: 'overview',
  status: null,     // proxy fetchStatus result
  spend: null,      // data/spend.json
  schedule: null,   // data/schedule.json
  agents: [],       // roster (section 05)
  proxyUrl: null,
  polling: { inFlight: false, lastError: null },
  modal: null,
};

let state = { ...DEFAULT_STATE };
const subscribers = new Set();

export function getState() {
  return state;
}

// Shallow-merge patch into a NEW object so old snapshots are never mutated (cheap diffing),
// then notify each subscriber — isolated so one throwing subscriber can't break the rest.
export function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of subscribers) {
    try {
      fn(state);
    } catch (err) {
      // swallow: a broken subscriber must not stop the notify loop or corrupt state.
      // eslint-disable-next-line no-console
      console.error('subscriber error', err);
    }
  }
  return state;
}

export function subscribe(fn) {
  subscribers.add(fn);
  return function unsubscribe() {
    subscribers.delete(fn);
  };
}

// NOTE: the single render() dispatcher and the tab-renderer registry live in render/chrome.js
// (it owns chrome + active-tab rendering, which a bare store dispatch cannot). Sections 05/06
// register tab renderers via chrome.js's registerTabRenderer — there is intentionally no second
// registry here.

// ── test-only reset (not used by the app) ───────────────────────────────────────────────────
export function _resetState() {
  state = { ...DEFAULT_STATE, polling: { ...DEFAULT_STATE.polling } };
  subscribers.clear();
}
