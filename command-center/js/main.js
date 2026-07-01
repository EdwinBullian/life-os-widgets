// Entry point loaded by index.html's <script type="module">.
// Builds initial state, mounts, kicks off data loads, and starts the 60s poller.

import { getState, setState, subscribe } from './state.js';
import { getProxyUrl, fetchStatus } from './proxy.js';
import { loadStaticData } from './data.js';
import { startPoller, startKbGraphPoller } from './poll.js';
import { render, initChrome, registerTabRenderer } from './render/chrome.js';
import { renderOverview } from './render/overview.js';
import { renderAgents, buildRoster } from './render/agents.js';
import { renderSchedule } from './render/schedule.js';
import { renderQueue } from './render/queue.js';
import { renderCost } from './render/cost.js';
import { renderChat } from './render/chat.js';
import { renderRegistry } from './render/registry.js';
import { renderPhoneBridge } from './render/phonebridge.js';
import { renderBrain } from './render/brain.js';

export function buildInitialState() {
  return {
    activeTab: 'overview',
    status: null,
    spend: null,
    schedule: null,
    registry: null,
    kbGraph: null,
    agents: buildRoster(), // inline roster (section 05) — static, seeded at boot
    proxyUrl: getProxyUrl(),
    polling: { inFlight: false, lastError: null },
    modal: null,
  };
}

export function boot() {
  setState(buildInitialState());
  registerTabRenderer('overview', renderOverview); // §05 tab renderers
  registerTabRenderer('agents', renderAgents);
  registerTabRenderer('schedule', renderSchedule); // §06 tab renderers
  registerTabRenderer('queue', renderQueue);
  registerTabRenderer('cost', renderCost);
  registerTabRenderer('chat', renderChat);
  registerTabRenderer('registry', renderRegistry);
  registerTabRenderer('phonebridge', renderPhoneBridge);
  registerTabRenderer('brain', renderBrain);
  subscribe(render);   // every setState re-renders chrome + active tab
  initChrome();        // delegated tab click + arrow-key listeners
  render(getState());  // first paint

  // Static JSON (graceful-empty fallbacks) — refreshed off the status-poll cadence.
  loadStaticData();

  // One initial status read; keep last-known on failure, surface the error.
  fetchStatus()
    .then((status) => setState({ status, polling: { inFlight: false, lastError: null } }))
    .catch((err) => setState({ polling: { inFlight: false, lastError: String((err && err.message) || err) } }));

  startPoller(); // §03 owns the in-flight guard / teardown / re-poll
  startKbGraphPoller(); // separate slow (10min) poller — kb_graph.json is 350KB+ and rarely changes
}

// Auto-boot only in the real shell (the #tabs container exists). Importing under test does nothing.
if (typeof document !== 'undefined' && document.getElementById('tabs')) {
  boot();
}
