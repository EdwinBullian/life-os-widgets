// Settings modal — lets you set/clear the Apps Script proxy URL (the one thing the mockup's ⚙
// button never wired). Reuses the shared #overlay/#modal and the mockup's modal styling. Storage
// goes through proxy.js (localStorage key agentos_proxy_url, with the in-memory fallback when the
// Notion embed blocks storage). Saving triggers an immediate status fetch so the gateway pill flips.

import { getProxyUrl, setProxyUrl, fetchStatus, getMaxPct, setMaxPct } from '../proxy.js';
import { setBusToken, busConfigured, setGlobalPause, verifyBusToken, busTokenPersisted } from '../busclient.js';
import { getState, setState } from '../state.js';
import { esc } from '../util.js';
import { toast } from './agents.js';

// Pull one fresh status read after a proxy change so the UI reflects the new endpoint immediately.
function refreshStatus() {
  fetchStatus()
    .then((status) => setState({ status, polling: { inFlight: false, lastError: null } }))
    .catch((err) => setState({ polling: { inFlight: false, lastError: String((err && err.message) || err) } }));
}

export function openSettings() {
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) return;

  const cur = getProxyUrl() || '';
  const connected = !!getState().status && !getState().polling.lastError;

  modal.className = 'modal';
  modal.innerHTML = '<div class="modal-head"><div class="modal-icon"><span>⚙</span></div>'
    + '<div class="modal-title">Settings</div></div>'
    // The acc-bus token leads, because it is the ONLY live write path: without it every
    // button that dispatches, toggles, or pauses fails. The Apps Script proxy below it is
    // the dead predecessor, kept as a read-only fallback and labelled as legacy — leading
    // with it (as this modal used to) implies dispatch works once the URL is set. It doesn't.
    + '<div class="modal-sub">The <b>acc-bus token</b> is what lets this dashboard actually do things — '
    + 'dispatch one-off jobs, toggle registry rows, hit the kill switch. Without it every write '
    + 'button fails. It is a fine-grained GitHub PAT scoped to the acc-bus repo only.</div>'
    + `<div class="field"><label>acc-bus token <span class="hint">(fine-grained PAT, acc-bus repo only — the live write path)</span></label>`
    + `<input id="set-bustoken" type="password" placeholder="${busConfigured() ? '•••••••• (set — leave blank to keep)' : 'github_pat_…'}"></div>`
    + `<div class="field"><label>Claude Max plan % used <span class="hint">(you set this — Anthropic exposes no API for it)</span></label>`
    + `<input id="set-maxpct" type="number" min="0" max="100" step="1" placeholder="e.g. 24" value="${getMaxPct() != null ? esc(getMaxPct()) : ''}"></div>`
    + `<div class="field"><label>Apps Script proxy URL <span class="hint">(legacy read path — leave blank unless you still run it)</span></label>`
    + `<input id="set-proxy" type="text" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cur)}"></div>`
    + `<div class="note">Status: ${connected ? '<span style="color:var(--success)">● connected</span>' : '<span class="faint">● not connected yet</span>'}. `
    + `Bus write path: ${busConfigured() ? '<span style="color:var(--success)">● armed</span>' : '<span class="faint">● not armed</span>'}. `
    + 'Stored only in this browser — never committed or shared.</div>'
    + '<div class="modal-actions">'
    + '<button class="btn ghost" data-action="settingsPause">Pause all agents</button>'
    + '<button class="btn ghost" data-action="settingsResume">Resume</button>'
    + '<button class="btn ghost" data-action="settingsClear">Clear</button>'
    + '<button class="btn ghost" data-action="settingsCancel">Cancel</button>'
    + '<button class="btn" data-action="settingsSave">Save & connect</button></div>';
  overlay.classList.add('open');

  function close() {
    overlay.classList.remove('open');
    modal.innerHTML = '';
    overlay.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  }
  function onClick(e) {
    if (e.target === overlay) { close(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'settingsCancel') { close(); return; }
    if (action === 'settingsPause' || action === 'settingsResume') {
      // Global kill switch → a global_pause bus request. The consumer flips
      // registry.global_pause; run.py then exits early for every non-exempt job
      // (the Programming maintenance watchdog + the bridge stay alive). Resume
      // sends paused:false so the pause is never one-way from the dashboard.
      if (!busConfigured()) { toast('Set an acc-bus token first'); return; }
      const paused = action === 'settingsPause';
      setGlobalPause(paused)
        .then(() => toast(paused ? 'Kill switch sent — fleet pausing' : 'Resume sent — fleet un-pausing'))
        .catch((err) => toast(`Couldn't reach the bus — ${String((err && err.message) || err)}`));
      close();
      return;
    }
    if (action === 'settingsClear') {
      setProxyUrl(null);
      setBusToken(null);
      setState({ proxyUrl: null });
      close();
      toast('Proxy URL + bus token cleared');
      return;
    }
    if (action === 'settingsSave') {
      const input = modal.querySelector('#set-proxy');
      const v = input ? String(input.value || '').trim() : '';
      const pctEl = modal.querySelector('#set-maxpct');
      setMaxPct(pctEl ? pctEl.value : null); // empty → clears the override
      const tokEl = modal.querySelector('#set-bustoken');
      const tok = tokEl ? String(tokEl.value || '').trim() : '';
      // blank leaves the existing token untouched; `persisted` is false when the browser only
      // let it into the in-memory mirror (Notion embeds are cross-site iframes — storage there
      // is routinely partitioned or denied, which is how a pasted token "disappears").
      const persisted = tok ? setBusToken(tok) : busTokenPersisted();
      setProxyUrl(v || null);
      setState({ proxyUrl: v || null }); // any setState re-renders topbar + active tab
      close();
      // Don't claim "saved" and walk away — a stored-but-invalid token looks identical to a
      // working one until a button fails hours later. Check it now and say which it is.
      if (busConfigured()) {
        toast('Saved — checking the bus token…');
        verifyBusToken()
          .then((r) => {
            if (!r.ok) { toast(`Saved, but the bus token failed: ${r.reason}`); return; }
            // Works, but say so plainly if it won't survive a reload — otherwise it looks
            // armed today and mysteriously blank tomorrow.
            toast(persisted
              ? 'Saved — bus armed ✓ one-off dispatch is live'
              : 'Bus armed ✓ but THIS SESSION ONLY — the embed is blocking storage. Open the dashboard in its own tab and paste it there to make it stick.');
          })
          .catch(() => toast('Saved — could not verify the bus token'));
      } else {
        toast('Saved — no bus token, so write buttons stay offline');
      }
      if (v) refreshStatus();
    }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
}
