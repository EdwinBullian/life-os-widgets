// Queue tab: 3-column kanban (Waiting approval / Approved / Scheduled), plus a 3-way filter
// toggle (Manual | Scheduled | All). "Manual" shows the existing Notion Agent Dispatch kanban;
// "Scheduled" shows upcoming routine runs from schedule.json sorted by next occurrence;
// "All" shows both in a combined scrollable list.
// NOTE: Scheduled and All views do NOT require state.status (which is null when the dispatch
// worker is disabled). Only Manual depends on status for the kanban data.

import { esc, normalizeQueue, safe } from '../util.js';
import { toast } from './agents.js';

const EMOJI = { finance: '💰', research: '🔬', health: '💪', assistant: '🧠', programming: '💻', career: '🎓', business: '🏢', marketing: '📣' };
const emojiFor = (key) => EMOJI[key] || '◆';

// ── Filter state (persists across re-renders within a session) ─────────────────────────────────
let queueFilter = 'scheduled'; // default to Scheduled so content is visible immediately
let _lastState = null;

// Column definitions
// Card action buttons. Approve / Reject / Schedule / Reschedule / Edit were deleted on
// 2026-07-26 per the button-parity audit's deletion list: acc_bus.py has no handler for any of
// them, so they could only ever toast and no-op. Run-now and Cancel survive as real concepts
// with no bus action yet — they say so plainly instead of faking success (see wireQueue).
const COLS = [
  {
    key: 'waiting', col: 'waiting', cls: 'w', countId: 'nW', bodyId: 'colWaiting',
    head: '⏳ Waiting approval', empty: 'Nothing waiting.',
    acts: () => '<span class="faint" style="font-size:10.5px">Approve in Notion</span>',
  },
  {
    key: 'approved', col: 'approved', cls: 'a', countId: 'nA', bodyId: 'colApproved',
    head: '✓ Approved', empty: 'Nothing approved yet.',
    acts: (id) => '<button class="btn sm go" data-action="runnow" data-id="' + id + '">▶ Now</button>',
  },
  {
    key: 'scheduled', col: 'scheduled', cls: 's', countId: 'nS', bodyId: 'colScheduled',
    head: '◷ Scheduled', empty: 'Nothing scheduled.',
    acts: (id) => '<button class="btn sm danger" data-action="cancel" data-id="' + id + '">Cancel</button>',
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

// Shared full-width row used by the Scheduled + All views. Color-coded by agent (left border +
// tag), with a clear SCHEDULED/MANUAL badge so the two sources never blur together.
function fullRow({ agent, kind, name, model, tier, when, tok, extra }) {
  const a = esc(String(agent || '').toLowerCase());
  const agentLabel = a ? a.charAt(0).toUpperCase() + a.slice(1) : '—';
  const badge = kind === 'manual'
    ? '<span class="src-badge manual">Manual</span>'
    : '<span class="src-badge scheduled">Scheduled</span>';
  const tokHtml = (tok != null && tok !== '') ? `<span class="qrow-tok faint">~${esc(tok)}k</span>` : '';
  const modelChip = model ? `<span class="chip ${esc(tier || '')}">${esc(model)}</span>` : '';
  return `<div class="qrow ag-${a}">`
    + badge
    + `<span class="qrow-when mono">${esc(when || '')}</span>`
    + `<span class="qrow-name">${esc(name || '')}</span>`
    + `<span class="tag t-${a}">${esc(agentLabel)}</span>`
    + modelChip
    + tokHtml
    + (extra || '')
    + '</div>';
}

function schedRowHtml(e) {
  return fullRow({
    agent: e.agent,
    kind: 'scheduled',
    name: e.name,
    model: e.model,
    tier: e.tier,
    when: fmtNext(e._next),
    tok: Math.round((Number(e.tok) || 0) / 1000),
  });
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
    ? manual.map((it) => fullRow({
        agent: it.agent,
        kind: 'manual',
        name: it.title,
        model: it.model,
        tier: it.tier,
        when: (it._src || '').toUpperCase(),
        extra: '',
      })).join('')
    : '<div style="padding:8px 4px;color:var(--faint);font-size:12px">No manual jobs queued.</div>';
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
    // These queue job-control buttons have NO backend action (busclient maps them all to
    // `unsupported`; acc_bus.py has no handler). Do NOT fake success — the old code toasted
    // "Marked Run Now" / "Cancelled" and marked the button pending while doing nothing.
    // Tell the truth instead (Eddie 2026-07-23; full wiring is a proposed backend build).
    if (action === 'runnow' || action === 'cancel') {
      toast('Not wired yet — manage this job in Notion for now');
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.closest('[data-action="notify"]')) toast('Not wired here — set notify on the Registry tab');
  });
}
