// Phone Bridge tab: on/off + snooze controls for the Phone Link (iMessage) daemon + its watchdog.
// The task row lives in data/registry.json (id "phone-link-bridge", agent "infra") — this tab just
// gives it a focused, single-purpose view instead of burying it in the Registry table.
//
// Real control: bridge_control_server.py (Agent/phone_link_bridge) runs a hidden loopback listener
// on 127.0.0.1:8766 that actually enables/disables the PhoneLinkBridgeDaemon + PhoneLinkBridgeWatchdog
// scheduled tasks. This tab calls it directly — that only succeeds when the dashboard happens to be
// open on the same Windows machine the bridge runs on. When it's unreachable (viewed from a phone or
// another device), every action still falls back to the optimistic override + settaskenabled POST,
// same contract as the Registry tab (see REGISTRY_ACTIONS.md) — nothing breaks either way.

import { esc, safe } from '../util.js';
import { getState } from '../state.js';
import { postAction, getTaskOverrides, setTaskOverride, getPhoneBridgeSnoozeUntil, setPhoneBridgeSnoozeUntil } from '../proxy.js';
import { toast } from './agents.js';

const TASK_ID = 'phone-link-bridge';
const LOCAL_URL = 'http://127.0.0.1:8766';
const LOCAL_CHECK_THROTTLE_MS = 4000;

const SNOOZE_PRESETS = [
  { label: '1h', mins: 60 },
  { label: '4h', mins: 240 },
  { label: 'Until tomorrow 8a', mins: null }, // computed specially — see msUntilTomorrow8am()
];

// Last-known read from bridge_control_server.py — null means "unreachable or not checked yet".
// Module-level (not component state) because it's a live device probe, not app data.
let _local = null;
let _localChecking = false;
let _lastLocalCheckAt = 0;
let _panelRef = null;

function postSafe(action, params) {
  try {
    postAction(action, params)
      .then(() => toast('Saved'))
      .catch(() => toast('Saved on this device — proxy offline'));
  } catch { toast('Saved on this device'); }
}

function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Best-effort call to the local control server. Resolves quietly on any failure (unreachable,
// blocked by the browser's private-network-access check, wrong machine, etc.) — callers never need
// to branch on success/failure themselves; they just get a fresher `_local` if it worked.
function tryLocalToggle(enabled) {
  if (_local) _local = { ..._local, enabled }; // optimistic — corrected by the response below
  return fetchWithTimeout(`${LOCAL_URL}/toggle`, 2500, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((json) => {
      _local = json;
      toast(enabled ? 'Bridge resumed on this machine' : 'Bridge paused on this machine');
    })
    .catch(() => { /* not reachable from here — optimistic-only, same as the Registry tab */ })
    .finally(() => { if (_panelRef) renderPhoneBridge(getState(), _panelRef); });
}

function maybeRefreshLocal(panel) {
  if (_localChecking || Date.now() - _lastLocalCheckAt < LOCAL_CHECK_THROTTLE_MS) return;
  _lastLocalCheckAt = Date.now();
  _localChecking = true;
  fetchWithTimeout(`${LOCAL_URL}/status`, 1200)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((json) => { _local = json; })
    .catch(() => { _local = null; })
    .finally(() => {
      _localChecking = false;
      renderPhoneBridge(getState(), panel);
    });
}

// ms from now until the next 8:00 AM local time (tomorrow if it's already past 8a today).
function msUntilTomorrow8am() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function fmtClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtChangedAt(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

function findTask(state) {
  const reg = safe(state.registry, null);
  const tasks = reg && Array.isArray(reg.tasks) ? reg.tasks : [];
  return tasks.find((t) => t && t.id === TASK_ID) || null;
}

// Merge the local override over the declared row (or a sane default if registry.json hasn't
// loaded yet) — same precedence as Registry's applyOverrides. When bridge_control_server.py is
// reachable, its response is ground truth and wins over both.
function effectiveTask(state) {
  const base = findTask(state) || { id: TASK_ID, name: 'Phone Link Bridge (iMessage)', enabled: true };
  const ov = getTaskOverrides()[TASK_ID];
  const merged = ov ? { ...base, ...ov } : base;
  if (_local) return { ...merged, enabled: !!_local.enabled, daemonState: _local.daemonState, watchdogState: _local.watchdogState };
  return merged;
}

// If a snooze window has passed, clear it and flip the override back to enabled. Called on every
// render so the tab self-corrects without needing a timer of its own.
function resolveExpiredSnooze() {
  const until = getPhoneBridgeSnoozeUntil();
  if (until == null || Date.now() < until) return false;
  setPhoneBridgeSnoozeUntil(null);
  setTaskOverride(TASK_ID, { enabled: true, changedAt: Date.now() });
  postSafe('settaskenabled', { id: TASK_ID, enabled: 'true' });
  tryLocalToggle(true);
  return true;
}

function setEnabled(enabled) {
  setTaskOverride(TASK_ID, { enabled, changedAt: Date.now() });
  if (enabled) setPhoneBridgeSnoozeUntil(null);
  postSafe('settaskenabled', { id: TASK_ID, enabled: String(enabled) });
  tryLocalToggle(enabled);
}

function snoozeFor(mins) {
  const ms = mins == null ? msUntilTomorrow8am() : mins * 60000;
  const until = Date.now() + ms;
  setPhoneBridgeSnoozeUntil(until);
  setTaskOverride(TASK_ID, { enabled: false, changedAt: Date.now() });
  postSafe('settaskenabled', { id: TASK_ID, enabled: 'false' });
  tryLocalToggle(false);
  return until;
}

export function renderPhoneBridge(state, panelArg) {
  const panel = panelArg || document.getElementById('phonebridge');
  if (!panel) return;
  _panelRef = panel;

  if (resolveExpiredSnooze()) {
    renderPhoneBridge(getState(), panel);
    return;
  }

  const task = effectiveTask(state);
  const enabled = !!task.enabled;
  const snoozeUntil = enabled ? null : getPhoneBridgeSnoozeUntil();
  const changedLabel = task.changedAt ? `Last changed ${fmtChangedAt(task.changedAt)}` : '';
  const live = !!_local;

  const snoozeChip = snoozeUntil
    ? `<span class="chip warn">resumes ${esc(fmtClock(snoozeUntil))}</span>`
    + `<button class="btn sm ghost" data-action="pbCancelSnooze">Cancel snooze</button>`
    : '';

  const snoozeBtns = SNOOZE_PRESETS.map((p, i) =>
    `<button class="btn sm ghost" data-action="pbSnooze" data-i="${i}">${esc(p.label)}</button>`).join('');

  const liveNote = live
    ? `<span class="chip open" title="bridge_control_server.py answered on this device — the toggle above takes real effect">● live control on this device</span>`
    : `<span class="chip" title="Not reachable from here — this device isn't running the bridge, or the browser blocked the local request">local control unreachable</span>`;

  panel.innerHTML = `<div class="box" style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px">
    <div class="ptitle">Phone Link Bridge <span class="chip ${enabled ? 'open' : ''}">${enabled ? 'Enabled' : 'Disabled'}</span></div>
    <div class="faint" style="font-size:12.5px;line-height:1.5;max-width:640px">
      iMessage bridge — text the assistant from your phone and get proactive pushes back. Backed by a
      Windows daemon plus a watchdog that checks every 5 minutes and relaunches Phone Link / the daemon
      if either died. <b>That relaunch is what pops the console or Phone Link window</b> during other
      activities — turn this off before gaming or anything that needs a clean screen.
    </div>

    <div class="pb-hero">
      <label class="pb-toggle" title="${enabled ? 'Enabled — click to pause' : 'Disabled — click to enable'}">
        <input type="checkbox" data-action="pbToggle"${enabled ? ' checked' : ''}>
        <span class="pb-slider"></span>
      </label>
      <div class="pb-hero-text">
        <div class="pb-hero-state ${enabled ? 'on' : 'off'}">${enabled ? 'Running' : 'Paused'}</div>
        <div class="faint" style="font-size:11.5px">${enabled
          ? 'Daemon + watchdog can run — expect the occasional popup.'
          : 'Daemon + watchdog are paused — no popups.'}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${liveNote}</div>

    <div>
      <div class="faint" style="font-size:11px;margin-bottom:7px">Quick snooze (auto re-enables when the timer's up)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${snoozeBtns}${snoozeChip}</div>
    </div>

    <div class="faint" style="font-size:11px">${esc(changedLabel)}</div>

    <div class="reg-hint faint" style="font-size:11px;line-height:1.5;max-width:640px">
      ${live
        ? 'Live control is reachable — the toggle and snooze above actually enable/disable the scheduled tasks on this machine, right now.'
        : 'Local control isn\'t reachable from here, so this toggle is optimistic-only: it updates instantly and persists on this device, and also '
          + `syncs to your Apps Script proxy when connected. Open the dashboard on the same Windows machine that runs the bridge to get real control, `
          + `or disable <span class="chip code">PhoneLinkBridgeDaemon</span> / <span class="chip code">PhoneLinkBridgeWatchdog</span> by hand there.`}
    </div>
  </div>`;

  wirePhoneBridge(panel);
  maybeRefreshLocal(panel);
}

function wirePhoneBridge(panel) {
  if (panel.__pbWired) return;
  panel.__pbWired = true;

  panel.addEventListener('change', (e) => {
    const tog = e.target.closest('[data-action="pbToggle"]');
    if (!tog) return;
    setEnabled(!!tog.checked);
    renderPhoneBridge(getState(), panel);
  });

  panel.addEventListener('click', (e) => {
    const sn = e.target.closest('[data-action="pbSnooze"]');
    if (sn) {
      const preset = SNOOZE_PRESETS[Number(sn.dataset.i)];
      if (preset) {
        const until = snoozeFor(preset.mins);
        toast(`Snoozed until ${fmtClock(until)}`);
        renderPhoneBridge(getState(), panel);
      }
      return;
    }
    const cancel = e.target.closest('[data-action="pbCancelSnooze"]');
    if (cancel) {
      setPhoneBridgeSnoozeUntil(null);
      renderPhoneBridge(getState(), panel);
    }
  });
}
