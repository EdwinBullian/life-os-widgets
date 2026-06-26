// Queue tab: 3-column kanban (Waiting approval / Approved / Scheduled), plus a 3-way filter
// toggle (Manual | Scheduled | All). "Manual" shows the existing Notion Agent Dispatch kanban;
// "Scheduled" shows upcoming routine runs from schedule.json sorted by next occurrence;
// "All" shows both in a combined scrollable list.
// NOTE: Scheduled and All views do NOT require state.status (which is null when the dispatch
// worker is disabled). Only Manual depends on status for the kanban data.

import { esc, normalizeQueue, safe } from '../util.js';
import { toast, dispatchAction } from './agents.js';

const EMOJI = { finance: '💰', research: '🔬', health: '💪', assistant: '🧠', programming: '💻', career: '🎓', business: '🏢', marketing: '📣' };
const emojiFor = (key) => EMOJI[key] || '◆';

// ── Filter state (persists across re-renders within a session) ─────────────────────────────────
let queueFilter = 'scheduled'; // default to Scheduled so content is visible immediately
let _lastState = null;

// Column definitions
const COLS = [
  {
    key: 'waiting', col: 'waiting', cls: 'w', countId: 'nW', bodyId: 'colWaiting',
    head: '⏳ Waiting approval', empty: 'Nothing waiting.',
    acts: (id) => '<button class="btn sm ghost" data-action="edit" data-id="' + id + '">Edit</button>'
      + '<button class="btn sm go" data-action="approve" data-id="' + id + '">Approve</button>'
      + '<button class="btn sm danger" data-action="reject" data-id="' + id + '">Reject</button>',
  },
  {
    key: 'approved', col: 'approved', cls: 'a', countId: 'nA', bodyId: 'colApproved',
    head: '✓ Approved', empty: 'Nothing approved yet.',
    acts: (id) => '<button class="btn sm ghost" data-action="edit" data-id="' + id + '">Edit</button>'
      + '<button class="btn sm" data-action="schedule" data-id="' + id + '">Schedule →</button>'
      + '<button class="btn sm go" data-action="runnow" data-id="' + id + '">▶ Now</button>',
  },
  {
    key: 'scheduled', col: 'scheduled', cls: 's', countId: 'nS', bodyId: 'colScheduled',
    head: '◷ Scheduled', empty: 'Nothing scheduled.',
    acts: (id) => '<button class="btn sm ghost" data-action="edit" data-id="' + id + '">Edit</button>'
      + '<button class="btn sm ghost" data-action="reschedule" data-id="' + id + '">Reschedule</button>'
      + '<button class="btn sm danger" data-action="cancel" data-id="' + id + '">Cancel</button>',
  },
];

// ── Manual view helpers ────────────────────────────────────────────────────────────────────────
function qcard(item, col) {
  const id = esc(item.id || '');
  const agentKey = String(item.agent || '').toLowerCase();
  const agent = esc(agentKey);
  const agentLabel = esc(agentKey ? agentKey.charAt(0).toUpperCase() + agentKey.slice(1) : (item.agent || ''));
  const slot = item.slot
    ? '<div class="slotpill">◷ ' + esc(item.slot) + '</div>'
    : '';
  return '<div class="qcard" data-id="' + id + '"><div class="qtop">'
    + '<div class="qic"><span>' + esc(emojiFor(agentKey)) + '</span>'
    + '<img src="agent-art/' + agent + '.png" alt="" onerror="this.style.display=\'none\'"></div>'
    + '<div style="flex:1;min-width:0"><div class="qtitle">' + esc(item.title || '') + '</div>'
    + '<div class="qmeta"><span class="tag t-' + agent + '">' + agentLabel + '</span>'
    + '<span class="chip ' + esc(item.tier || '') + '">' + esc(item.model || '') + '</span>'
    + '<span class="src">' + esc(item.src || '') + '</span></div></div>'
    + '</div>'
    + '<div class="qprompt">' + esc(item.prompt || '') + '</div>' + slot
    + '<label class="qnotify"><input type="checkbox" data-action="notify"'
    + (item.notify ? ' checked' : '') + '> 🔔 Notify me on completion</label>'
    + '<div class="qacts">' + col.acts(id) + '</div></div>';
}

function colHtml(col, items) {
  const body = items.length
    ? items.map((it) => qcard(it, col)).join('')
    : '<div class="qempty">' + esc(col.empty) + '</div>';
  return '<div class="kcol" data-col="' + col.col + '">'
    + '<div class="kcol-h ' + col.cls + '">' + col.head
    + ' <span class="n" id="' + col.countId + '">' + items.length + '</span></div>'
    + '<div class="kbody" id="' + col.bodyId + '">' + body + '</div></div>';
}

// ── Scheduled view helpers ────────────────────────────────────────────────────────────────────
function nextOccurrence(dayOfWeek, hour) {
  const now = new Date();
  const today = now.getDay();
  let d = ((dayOfWeek - today) + 7) % 7;
  if (d === 0 && now.getHours() >= hour) d = 7;
  const next = new Date(now);
  next.setDate(now.getDate() + d);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function fmtNext(date) {
  const now = new Date();
  const h = date.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  const time = `${h % 12 || 12}${ampm}`;
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const tom = new Date(now.getTime() + 86400000);
  if (date.toDateString() === tom.toDateString()) return `Tmrw ${time}`;
  return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]} ${time}`;
}

function getScheduledRows(schedule) {
  if (!schedule || !Array.isArray(schedule.week) || !schedule.week.length) return [];
  return schedule.week
    .map((e) => ({ ...e, _next: nextOccurrence(Number(e.day), Number(e.hour || 0)) }))
    .sort((a, b) => a._next - b._next);
}

function schedRowHtml(e) {
  const agent = esc(e.agent || '');
  return `<div class="sched-row">`
    + `<span class="sched-when faint">${esc(fmtNext(e._next))}</span>`
    + `<span class="sched-bar ag-${agent}"></span>`
    + `<span class="sched-name">${esc(e.name || '')}</span>`
    + `<span class="chip ${esc(e.tier || '')}">${esc(e.model || '')}</span>`
    + `<span class="sched-tok faint">~${Math.round((Number(e.tok) || 0) / 1000)}k</span>`
    + `</div>`;
}

// ── Filter bar ────────────────────────────────────────────────────────────────────────────────
function filterBarHtml() {
  const t = (f, label) =>
    `<button class="q-ftab${queueFilter === f ? ' active' : ''}" data-qf="${f}">${label}</button>`;
  return `<div class="q-filter">${t('manual','Manual')}${t('scheduled','Scheduled')}${t('all','All')}</div>`;
}

// ── View renderers ────────────────────────────────────────────────────────────────────────────
function renderManualView(cols) {
  return '<div class="kanban grow">'
    + COLS.map((c) => colHtml(c, cols[c.key] || [])).join('')
    + '</div>';
}

function renderScheduledView(schedule) {
  const rows = getScheduledRows(schedule);
  return '<div class="sched-list grow">'
    + (rows.length
        ? rows.map(schedRowHtml).join('')
        : '<div class="qempty">No schedule data loaded yet.</div>')
    + '</div>';
}

function renderAllView(cols, schedule) {
  const rows = getScheduledRows(schedule);
  const manual = [
    ...(cols.waiting  || []).map((it) => ({ ...it, _src: 'waiting'  })),
    ...(cols.approved || []).map((it) => ({ ...it, _src: 'approved' })),
    ...(cols.scheduled|| []).map((it) => ({ ...it, _src: 'scheduled'})),
  ];
  const schedSection = rows.length
    ? rows.map(schedRowHtml).join('')
    : '<div style="padding:5px 4px;color:var(--faint);font-size:12px">No scheduled runs.</div>';
  const manSection = manual.length
    ? manual.map((it) => {
        const k = esc(String(it.agent || '').toLowerCase());
        return `<div class="sched-row">`
          + `<span class="sched-when" style="color:var(--queued);font-size:10px;text-transform:uppercase;letter-spacing:.4px">Manual</span>`
          + `<span class="sched-bar ag-${k}"></span>`
          + `<span class="sched-name">${esc(it.title || '')}</span>`
          + `<span class="chip ${esc(it.tier || '')}">${esc(it.model || '')}</span>`
          + `<span class="faint" style="font-size:10px">${esc(it._src || '')}</span>`
          + `</div>`;
      }).join('')
    : '<div style="padding:5px 4px;color:var(--faint);font-size:12px">No manual jobs queued.</div>';
  return '<div class="sched-list grow">'
    + '<div class="q-section-head">Upcoming routine runs</div>'
    + schedSection
    + '<div class="q-section-head" style="margin-top:12px">Manual dispatch queue</div>'
    + manSection
    + '</div>';
}

// ── renderQueue ────────────────────────────────────────────────────────────────────────────────
export function renderQueue(state, panelArg) {
  const panel = panelArg || document.getElementById('queue');
  if (!panel) return;
  _lastState = state;

  // Scheduled view: never needs status — render directly from schedule data.
  if (queueFilter === 'scheduled') {
    panel.innerHTML = filterBarHtml() + renderScheduledView(state.schedule);
    wireQueue(panel);
    return;
  }

  // All view: show schedule regardless; include manual cols if status available.
  if (queueFilter === 'all') {
    const status = safe(state.status, null);
    const cols = status ? normalizeQueue(status) : { waiting: [], approved: [], scheduled: [] };
    panel.innerHTML = filterBarHtml() + renderAllView(cols, state.schedule);
    wireQueue(panel);
    return;
  }

  // Manual view: depends on status.
  const status = safe(state.status, null);
  if (!status) {
    panel.innerHTML = filterBarHtml()
      + '<div class="qempty" style="margin-top:20px">No manual jobs queued.<br><span style="font-size:11px">Switch to Scheduled to see upcoming routine runs.</span></div>';
    wireQueue(panel);
    return;
  }
  const cols = normalizeQueue(status);
  panel.innerHTML = filterBarHtml() + renderManualView(cols);
  rebalance(panel, cols);
  wireQueue(panel);
}

// Dynamic column balancing — only applies to the kanban (manual) view.
function rebalance(panel, cols) {
  if (queueFilter !== 'manual') return;
  for (const c of COLS) {
    const el = panel.querySelector('[data-col="' + c.col + '"');
    if (!el) continue;
    const count = (cols[c.key] || []).length;
    el.style.flexGrow = count === 0 ? 0.4 : Math.max(2.5, count);
  }
}

function wireQueue(panel) {
  if (panel.__queueWired) return;
  panel.__queueWired = true;
  panel.addEventListener('click', (e) => {
    const ftab = e.target.closest('[data-qf]');
    if (ftab) {
      queueFilter = ftab.dataset.qf;
      if (_lastState) renderQueue(_lastState, panel);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (action === 'runnow') {
      dispatchAction('runnow', { id }, 'Marked Run Now');
      markPending(el);
    } else if (action === 'cancel' || action === 'reject') {
      dispatchAction('cancel', { id }, 'Cancelled');
      markPending(el);
    } else if (action === 'approve' || action === 'schedule' || action === 'reschedule' || action === 'edit') {
      toast('Phase 2');
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.closest('[data-action="notify"]')) toast('Phase 2');
  });
}

function markPending(el) {
  const card = el.closest('.qcard');
  if (card) card.classList.add('pending');
}
