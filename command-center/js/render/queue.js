// Queue tab: 3-column kanban (Waiting approval / Approved / Scheduled), markup ported verbatim
// from the approved mockup and bound to live state via normalizeQueue(status). The proxy queue is
// FLAT — only status==="Queued" lands in Waiting, so Approved/Scheduled stay empty (placeholder)
// until the proxy exposes those states (Phase 2). Only runnow/cancel are real writes; Approve,
// Schedule, Reschedule, Edit, and the notify checkbox are Phase-2 stubs (toast only, no postAction).

import { esc, normalizeQueue, safe } from '../util.js';
import { toast, dispatchAction } from './agents.js';


const EMOJI = { finance: '💰', research: '🔬', health: '💪', assistant: '🧠', programming: '💻', career: '🎓' };
const emojiFor = (key) => EMOJI[key] || '◆';

// Column definitions: data-col drives delegation + tests; cls is the .kcol-h modifier; head is the
// label markup; empty is the faint placeholder; acts(id) is the per-card action row for that lane.
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

// qcard — every dynamic value through esc(); buttons carry data-id so quote-laden prompts/titles
// can never break wiring (no inline handlers anywhere).
function qcard(item, col) {
  const id = esc(item.id || '');
  // Icon/art/tag-color key off the AGENT type (e.g. "finance"), not the job key (e.g. "fin-thesis").
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

export function renderQueue(state, panelArg) {
  const panel = panelArg || document.getElementById('queue');
  if (!panel) return;
  const status = safe(state.status, null);
  if (!status) {
    panel.innerHTML = '<div class="qempty">No data yet.</div>';
    wireQueue(panel);
    return;
  }
  const cols = normalizeQueue(status); // {waiting, approved, scheduled} — never throws
  panel.innerHTML = '<div class="kanban grow">'
    + COLS.map((c) => colHtml(c, cols[c.key] || [])).join('')
    + '</div>';
  rebalance(panel, cols);
  wireQueue(panel);
}

// Dynamic column balancing (verbatim from mockup): empty lanes shrink to 0.4, populated lanes grow
// proportional to their item count (min 2.5). Keeps Waiting prominent when Approved/Scheduled empty.
function rebalance(panel, cols) {
  for (const c of COLS) {
    const el = panel.querySelector('[data-col="' + c.col + '"]');
    if (!el) continue;
    const count = (cols[c.key] || []).length;
    el.style.flexGrow = count === 0 ? 0.4 : Math.max(2.5, count);
  }
}

function wireQueue(panel) {
  if (panel.__queueWired) return;
  panel.__queueWired = true;
  panel.addEventListener('click', (e) => {
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
      toast('Phase 2'); // P2 stubs — no proxy action exists; must NOT call postAction
    }
  });
  // notify checkbox is visual-only (Phase 2) — never persists.
  panel.addEventListener('change', (e) => {
    if (e.target.closest('[data-action="notify"]')) toast('Phase 2');
  });
}

// Mark the affected card pending until the next status poll reconciles it.
function markPending(el) {
  const card = el.closest('.qcard');
  if (card) card.classList.add('pending');
}
