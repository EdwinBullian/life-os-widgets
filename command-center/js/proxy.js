// Proxy config + transport. Storage access is ALWAYS wrapped in try/catch (the Notion embed can
// throw "Access is denied" on localStorage). JSONP for cross-origin reads; resolvable POST for writes.

const LS_KEY = 'agentos_proxy_url'; // exact predecessor key — a previously-saved URL carries over.
const DEFAULT_PROXY = null;

// in-memory mirror so the widget runs even when storage throws. `undefined` = "not yet read".
let mem;
let cbSeq = 0;

export function getProxyUrl() {
  if (mem !== undefined) return mem;
  try {
    const v = localStorage.getItem(LS_KEY);
    // Cache the successful read into the mirror so a LATER storage failure (Notion can start
    // throwing "Access is denied" mid-session) can't silently lose a URL we already read.
    mem = v == null ? DEFAULT_PROXY : v;
    return mem;
  } catch {
    return DEFAULT_PROXY;
  }
}

export function setProxyUrl(url) {
  mem = url; // always update in-memory, even if persistence fails
  try {
    if (url == null) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, url);
  } catch {
    // storage denied — in-memory mirror keeps the widget usable this session.
  }
  return mem;
}

// ── Manual Claude Max % override ──────────────────────────────────────────────
// Anthropic exposes no API for "% of Max plan used this cycle", so Eddie types it in by hand. It
// persists in localStorage (in-memory fallback) and OVERRIDES spend.json's max.pctUsed everywhere
// it's shown (topbar pill, Overview fuel donut, Cost KPI). null = "use spend.json".
const MAX_PCT_KEY = 'agentos_max_pct';
let maxPctMem;

export function getMaxPct() {
  if (maxPctMem !== undefined) return maxPctMem;
  try {
    const v = localStorage.getItem(MAX_PCT_KEY);
    maxPctMem = v == null || v === '' ? null : Number(v);
    if (maxPctMem != null && !Number.isFinite(maxPctMem)) maxPctMem = null;
    return maxPctMem;
  } catch {
    return null;
  }
}

export function setMaxPct(pct) {
  const n = pct == null || pct === '' ? null : Number(pct);
  maxPctMem = n != null && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  try {
    if (maxPctMem == null) localStorage.removeItem(MAX_PCT_KEY);
    else localStorage.setItem(MAX_PCT_KEY, String(maxPctMem));
  } catch { /* storage denied — in-memory mirror holds for the session */ }
  return maxPctMem;
}

// JSONP GET ?action=status&callback=… → resolves parsed status. Times out (~8s) and rejects,
// ALWAYS cleaning up the injected <script> and the global callback (no leaks across polls).
export function fetchStatus({ timeoutMs = 8000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const name = `__agentos_cb_${++cbSeq}`;
    let script;
    let timer;
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      try { delete window[name]; } catch { window[name] = undefined; }
      if (script && script.parentNode) script.parentNode.removeChild(script);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    function onAbort() {
      cleanup();
      reject(new Error('aborted'));
    }
    if (signal && signal.aborted) { reject(new Error('aborted')); return; }
    window[name] = (data) => { cleanup(); resolve(data); };
    if (signal) signal.addEventListener('abort', onAbort);
    timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);

    const base = getProxyUrl() || '';
    script = document.createElement('script');
    script.src = `${base}?action=status&callback=${name}`;
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    document.head.appendChild(script);
  });
}

// The ONLY real write actions. approve/schedule/reschedule are P2 stubs handled in the render
// layer and must never reach the proxy — postAction rejects them.
const ALLOWED_ACTIONS = new Set([
  'dispatch', 'pause', 'runnow', 'cancel', 'setagentmodel', 'toggleagentpause',
]);

export function postAction(action, params = {}) {
  if (!ALLOWED_ACTIONS.has(action)) {
    return Promise.reject(new Error(`disallowed action: ${action}`));
  }
  const url = getProxyUrl();
  if (!url) return Promise.reject(new Error('no proxy url configured'));
  const body = new URLSearchParams();
  body.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).then((res) => {
    if (!res.ok) throw new Error(`post failed: ${res.status}`);
    return res.json().catch(() => ({ ok: true }));
  });
}

export const ACTIONS = ALLOWED_ACTIONS; // exported for the render layer to validate against

export function _resetProxyForTests() {
  mem = undefined;
  cbSeq = 0;
}
