// Queue tab: kanban (Waiting / Approved / Scheduled) derived from normalizeQueue(status).
// The proxy queue is FLAT — only `status==="Queued"` is actionable, so Approved/Scheduled stay
// empty (with a Phase-2 note) unless the proxy exposes those states. Only runnow/cancel are real
// writes; Approve/Schedule/Reschedule/Edit/notify are stubs that toast and never call postAction.

import { esc, normalizeQueue, safe } from '../util.js';
import { toast, dispatchAction } from './agents.js';

const COLS = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'scheduled', label: 'Scheduled' },
];

// Action buttons render only for the Waiting lane (the only lane the proxy actually acts on).
// runnow/cancel are real writes; Approve/Schedule/Edit are P2 stubs (toast-only, no postAction).
function actionsHtml(id) {
  return '<div class="qcard-actions">'
    + `<button class="btn btn-sm" data-action="runnow" data-id="${id}">Run now</button>`
    + `<button class="btn btn-sm" data-action="approve" data-id="${id}">Approve</button>`
    + `<button class="btn btn-sm" data-action="schedule" data-id="${id}">Schedule</button>`
    + `<button class="btn btn-sm btn-ghost" data-action="edit" data-id="${id}">Edit</button>`
    + `<button class="btn btn-sm btn-ghost" data-action="cancel" data-id="${id}">Cancel</button>`
    + '</div>';
}

function cardHtml(item, colKey) {
  const id = esc(item.id || '');
  const slot = item.slot ? `<span class="slot-pill">${esc(item.slot)}</span>` : '';
  return `<div class="qcard" data-id="${id}">`
    + `<div class="qcard-head"><span class="agent-tag type-${esc(item.agent || '')}">${esc(item.agent || '')}</span>`
    + `<span class="chip">${esc(item.model || '')}</span>${slot}</div>`
    + `<div class="qcard-title">${esc(item.title || '')}</div>`
    + `<div class="qcard-src">${esc(item.src || '')}</div>`
    + `<div class="qcard-prompt">${esc(item.prompt || '')}</div>`
    + '<label class="notify-row"><input type="checkbox" data-action="notify"'
    + `${item.notify ? ' checked' : ''}> notify</label>`
    + (colKey === 'waiting' ? actionsHtml(id) : '')
    + '</div>';
}

function colHtml(col, items) {
  const note = (col.key !== 'waiting' && items.length === 0)
    ? '<div class="empty-state">Phase 2 — proxy has no such state yet.</div>'
    : (items.length === 0 ? '<div class="empty-state">Empty.</div>' : items.map((it) => cardHtml(it, col.key)).join(''));
  // dynamic rebalance: fullest lane grows, empty lanes shrink.
  const grow = items.length === 0 ? 1 : items.length + 1;
  return `<div class="kcol" data-col="${col.key}" style="flex-grow:${grow}">`
    + `<div class="kcol-head">${esc(col.label)} <span class="count">${items.length}</span></div>`
    + `<div class="kcol-body">${note}</div></div>`;
}

export function renderQueue(state, panelArg) {
  const panel = panelArg || document.getElementById('queue');
  if (!panel) return;
  const status = safe(state.status, null);
  if (!status) {
    panel.innerHTML = '<div class="empty-state">No data yet.</div>';
    wireQueue(panel);
    return;
  }
  const cols = normalizeQueue(status); // {waiting, approved, scheduled}
  panel.innerHTML = `<div class="kanban">${COLS.map((c) => colHtml(c, cols[c.key] || [])).join('')}</div>`;
  wireQueue(panel);
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
    } else if (action === 'cancel') {
      dispatchAction('cancel', { id }, 'Cancelled');
      markPending(el);
    } else if (action === 'approve' || action === 'schedule' || action === 'reschedule' || action === 'edit') {
      toast('Phase 2'); // P2 stubs — no proxy action exists; must NOT call postAction
    }
  });
  // notify checkbox is visual-only (Phase 2) — never persists.
  panel.addEventListener('change', (e) => {
    if (e.target.closest('[data-action="notify"]')) toast('Notify rules are Phase 2');
  });
}

// Mark the affected card pending until the next status poll reconciles it.
function markPending(el) {
  const card = el.closest('.qcard');
  if (card) card.classList.add('pending');
}
