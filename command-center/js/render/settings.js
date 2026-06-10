// Settings modal — lets you set/clear the Apps Script proxy URL (the one thing the mockup's ⚙
// button never wired). Reuses the shared #overlay/#modal and the mockup's modal styling. Storage
// goes through proxy.js (localStorage key agentos_proxy_url, with the in-memory fallback when the
// Notion embed blocks storage). Saving triggers an immediate status fetch so the gateway pill flips.

import { getProxyUrl, setProxyUrl, fetchStatus } from '../proxy.js';
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
    + '<div class="modal-sub">Connect the widget to your Apps Script proxy for live agent status and '
    + 'one-tap dispatch. Same web app and URL as the predecessor <span class="chip code">agents.html</span> '
    + '— it carries over automatically on the same site, or paste it once below.</div>'
    + `<div class="field"><label>Apps Script proxy URL <span class="hint">(ends in /exec)</span></label>`
    + `<input id="set-proxy" type="text" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cur)}"></div>`
    + `<div class="note">Status: ${connected ? '<span style="color:var(--success)">● connected</span>' : '<span class="faint">● not connected yet</span>'}. `
    + 'The URL is stored only in this browser — never committed or shared.</div>'
    + '<div class="modal-actions">'
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
    if (action === 'settingsClear') {
      setProxyUrl(null);
      setState({ proxyUrl: null });
      close();
      toast('Proxy URL cleared');
      return;
    }
    if (action === 'settingsSave') {
      const input = modal.querySelector('#set-proxy');
      const v = input ? String(input.value || '').trim() : '';
      setProxyUrl(v || null);
      setState({ proxyUrl: v || null });
      close();
      toast(v ? 'Proxy URL saved — connecting…' : 'Proxy URL cleared');
      if (v) refreshStatus();
    }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
}
