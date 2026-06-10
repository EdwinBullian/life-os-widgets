// Persistent chrome (topbar pills + tab bar) and the single render() dispatcher.
// Rendering model: event → action → setState(patch) → subscribe(render). render() always draws
// chrome, then draws ONLY the active tab. DOM is built by string templating with strict esc() on
// every dynamic value (the project's no-build, no-DOM-lib convention — see section 04 plan).

import { getState, setState } from '../state.js';
import { esc, normalizeQueue, safe, isStale } from '../util.js';

const TABS = ['overview', 'chat', 'agents', 'schedule', 'queue', 'cost'];
const TAB_LABELS = {
  overview: 'Overview', chat: 'Chat', agents: 'Agents',
  schedule: 'Schedule', queue: 'Queue', cost: 'Cost',
};
const AGENT_COUNT = 6; // fixed inline roster (section 05)

// spend.json is produced by a slow job (not the 60s poll). isStale trips at 2×cadence, so a 6h
// cadence flags "stale" once the data is older than ~12h.
const SPEND_CADENCE_MS = 6 * 60 * 60 * 1000;

// Tab content renderers register here (sections 05/06). Unregistered tabs render nothing, not a throw.
const tabRenderers = new Map();
export function registerTabRenderer(tab, fn) { tabRenderers.set(tab, fn); }

const num = (v) => (typeof v === 'number' && Number.isFinite(v));

// ── Topbar ───────────────────────────────────────────────────────────────────
export function renderTopbar(state) {
  const pills = document.getElementById('pills');
  if (!pills) return;
  const spend = safe(state.spend, null); // null when missing/malformed (wrong container kind)
  const gatewayUp = state.status != null && !state.polling.lastError;

  const pct = spend && spend.max && num(spend.max.pctUsed) ? `${esc(spend.max.pctUsed)}%` : '—';
  const week = spend && spend.openrouter && num(spend.openrouter.weekSpend)
    ? `$${esc(spend.openrouter.weekSpend)}` : '—';
  const stale = spend ? isStale(spend.updated, SPEND_CADENCE_MS) : false;
  const staleMark = stale ? ' <span class="stale" title="data may be stale">stale</span>' : '';

  pills.innerHTML = `
    <span class="pill" id="pill-gateway">
      <span class="dot ${gatewayUp ? 'ok' : 'bad'}"></span><b>${gatewayUp ? 'Gateway up' : 'Gateway down'}</b>
    </span>
    <span class="pill" id="pill-max"><b>Max ${pct}</b>${staleMark}</span>
    <span class="pill" id="pill-or"><b>OR ${week}</b></span>`;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
export function renderTabs(state) {
  const bar = document.getElementById('tabs');
  if (!bar) return;
  const { waiting, approved, scheduled } = normalizeQueue(state.status);
  const counts = { agents: AGENT_COUNT, queue: waiting.length + approved.length + scheduled.length };
  bar.setAttribute('role', 'tablist');
  bar.innerHTML = TABS.map((t) => {
    const sel = state.activeTab === t;
    const count = counts[t] != null ? `<span class="count">${esc(counts[t])}</span>` : '';
    return `<button class="tab${sel ? ' active' : ''}" role="tab" data-tab="${t}"`
      + ` aria-selected="${sel}" tabindex="${sel ? 0 : -1}">${esc(TAB_LABELS[t])} ${count}</button>`;
  }).join('');
}

// ── Tab switching ────────────────────────────────────────────────────────────
export function setActiveTab(tab) {
  if (!TABS.includes(tab)) return;
  setState({ activeTab: tab });
}

// ── The single dispatcher ────────────────────────────────────────────────────
export function render(state) {
  renderTopbar(state);
  renderTabs(state);
  // Invariant (asserted by §07 smoke): exactly one .panel.active.
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === state.activeTab);
  });
  const fn = tabRenderers.get(state.activeTab);
  const panel = document.getElementById(state.activeTab);
  if (fn && panel) {
    try { fn(state, panel); } catch (err) {
      // a broken tab renderer must not take down the chrome.
      // eslint-disable-next-line no-console
      console.error('tab renderer error', err);
    }
  }
}

// ── Event wiring (one delegated listener each; called once at boot) ───────────
let wired = false;
export function initChrome() {
  if (wired) return;
  const bar = document.getElementById('tabs');
  if (!bar) return;
  wired = true;
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) setActiveTab(btn.dataset.tab);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.indexOf(getState().activeTab);
    const ni = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setActiveTab(TABS[ni]); // triggers re-render, which rebuilds the tab buttons
    // roving focus follows selection onto the freshly-rendered active button.
    const next = bar.querySelector(`[data-tab="${TABS[ni]}"]`);
    if (next) next.focus();
  });
}

export function _resetChromeForTests() {
  wired = false;
  tabRenderers.clear();
}
