// Schedule tab: a seven-day board (Sun→Sat) plus the Unique jobs tray.
//
// Each job is one line coloured by agent — no times, models or token counts. Recurring jobs come
// from registry.json through boardweek.js. The daily set is hidden until toggled, and background
// work never appears. Unique jobs are one-offs: unscheduled ones wait in the tray, and dragging
// one onto a day schedules it for that day. A placed job can be dragged to another day, or back
// to the tray to unschedule it (boardjobs.js).

import { esc, safe } from '../util.js';
import { toast } from './agents.js';
import { setState } from '../state.js';
import { busConfigured } from '../busclient.js';
import { buildWeek, isoDay, AGENT_ORDER, byAgentThenName } from '../boardweek.js';
import { ONEOFF_CATALOG } from '../oneoffCatalog.js';
import {
  listBoardJobs, createDraft, removeDraft, placeJob, unplaceJob, reconcileBoardJobs,
} from '../boardjobs.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGEND = [['assistant', 'Assistant'], ['health', 'Health'], ['finance', 'Finance'], ['career', 'Career'],
  ['programming', 'Programming'], ['research', 'Research'], ['business', 'Business'], ['marketing', 'Marketing']];

let showDaily = false;
const rerender = () => setState({ oneOffsRev: Date.now() });

function lineHtml(j) {
  const cls = ['sb-job'];
  if (j.daily) cls.push('daily');
  if (j.oneoff) cls.push('oneoff');
  if (j.sending) cls.push('sending');
  if (j.error) cls.push('err');
  const drag = j.lid ? ` draggable="true" data-lid="${esc(j.lid)}"` : '';
  const tip = j.error || j.title || '';
  return `<div class="${cls.join(' ')}" style="--c:var(--tag-${esc(j.tag)})"${drag}${tip ? ` title="${esc(tip)}"` : ''}>`
    + '<span class="sb-bar"></span>'
    + `<span class="sb-name">${esc(j.name)}</span>`
    + (j.oneoff ? '<span class="sb-once">once</span>' : '')
    + '</div>';
}

function oneoffLine(r) {
  return {
    name: r.title, tag: r.tag, daily: false, oneoff: true, lid: r.lid,
    sending: r.state === 'sending', error: r.reason ? `${r.jobLabel} — ${r.reason}` : '',
    title: `${r.jobLabel}: ${r.brief}`,
  };
}

export function renderSchedule(state, panelArg) {
  const panel = panelArg || document.getElementById('schedule');
  if (!panel) return;
  const registry = safe(state.registry, null);
  const now = new Date();
  const { dates, days } = buildWeek(registry, now);
  const today = isoDay(now);
  const jobs = listBoardJobs();

  const cols = dates.map((d, i) => {
    const iso = isoDay(d);
    const placed = jobs.filter((r) => r.day === iso).map(oneoffLine);
    const lines = days[i].filter((j) => showDaily || !j.daily).concat(placed).sort(byAgentThenName);
    const past = iso < today;
    return `<div class="sb-col${iso === today ? ' today' : ''}${past ? ' past' : ''}" data-day="${iso}">`
      + `<div class="sb-hd"><b>${DAY_NAMES[i]}</b><span>${d.getDate()}</span></div>`
      + `<div class="sb-list">${lines.map(lineHtml).join('')}</div></div>`;
  }).join('');

  const drafts = jobs.filter((r) => !r.day);
  const tray = drafts.length
    ? drafts.map((r) => `<div class="sb-chip-wrap">${lineHtml(oneoffLine(r)).replace('<span class="sb-once">once</span>', '')}`
      + `<button class="sb-x" data-action="sbRemove" data-lid="${esc(r.lid)}" aria-label="Remove">×</button></div>`).join('')
    : '';

  panel.innerHTML = '<div class="box sb-box">'
    + '<div class="ptitle"><span>This week</span>'
    + `<span class="sb-legend">${LEGEND.map(([k, v]) => `<span><i style="background:var(--tag-${k})"></i>${v}</span>`).join('')}</span>`
    + '<span class="spacer"></span>'
    + `<button class="btn sm ghost${showDaily ? ' on' : ''}" data-action="sbDaily">${showDaily ? 'Hide daily jobs' : 'Show daily jobs'}</button></div>`
    + `<div class="sb-scroll"><div class="sb-board">${cols}</div></div></div>`
    + '<div class="box sb-tray" data-tray="1">'
    + '<div class="ptitle"><span>Unique jobs</span><span class="spacer"></span>'
    + '<button class="btn sm ghost" data-action="sbNew">+ New</button></div>'
    + `<div class="sb-tray-items">${tray}</div></div>`;

  wireSchedule(panel);
  pokeReconcile();
}

let reconcileBusy = false;
function pokeReconcile() {
  if (reconcileBusy || !listBoardJobs().some((r) => r.state === 'sending')) return;
  reconcileBusy = true;
  reconcileBoardJobs()
    .then((n) => { if (n) rerender(); })
    .catch(() => {})
    .finally(() => { reconcileBusy = false; });
}

// ── New unique job form ───────────────────────────────────────────────────────
function agentOptions() {
  return Object.entries(ONEOFF_CATALOG)
    .sort((a, b) => AGENT_ORDER.indexOf(a[1].tag) - AGENT_ORDER.indexOf(b[1].tag))
    .map(([k, a]) => `<option value="${esc(k)}"${a.available ? '' : ' disabled'}>${esc(a.label)}${a.available ? '' : ' (off)'}</option>`)
    .join('');
}

function typeOptions(agent) {
  const a = ONEOFF_CATALOG[agent];
  return a ? Object.entries(a.job_types).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('') : '';
}

function openNewJob() {
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) return;
  const first = Object.keys(ONEOFF_CATALOG).find((k) => ONEOFF_CATALOG[k].available) || 'finance';
  modal.className = 'modal';
  modal.innerHTML = '<div class="modal-head"><div class="modal-title">New unique job</div></div>'
    + '<form id="sbNewForm">'
    + `<div class="field"><label>Agent</label><select id="sb-agent">${agentOptions()}</select></div>`
    + `<div class="field"><label>Job type</label><select id="sb-type">${typeOptions(first)}</select></div>`
    + '<div class="field"><label>Brief <span class="req">*</span></label><textarea id="sb-brief" placeholder="What should it do?"></textarea></div>'
    + '<div class="modal-actions"><button type="button" class="btn ghost" data-action="sbClose">Cancel</button>'
    + '<button type="submit" class="btn">Add</button></div></form>';
  modal.querySelector('#sb-agent').value = first;
  overlay.classList.add('open');
  wireModal(overlay, modal);
  modal.querySelector('#sb-brief').focus();
}

function closeModal(overlay, modal) {
  overlay.classList.remove('open');
  modal.innerHTML = '';
}

function wireModal(overlay, modal) {
  const form = modal.querySelector('#sbNewForm');
  modal.querySelector('#sb-agent').addEventListener('change', (e) => {
    modal.querySelector('#sb-type').innerHTML = typeOptions(e.target.value);
  });
  modal.querySelector('[data-action="sbClose"]').addEventListener('click', () => closeModal(overlay, modal));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const agent = modal.querySelector('#sb-agent').value;
    const jobType = modal.querySelector('#sb-type').value;
    const brief = modal.querySelector('#sb-brief').value.trim();
    const a = ONEOFF_CATALOG[agent];
    if (!a || !a.available) { toast('That agent isn\'t set up for one-off runs'); return; }
    if (!brief) { toast('Add a brief'); return; }
    createDraft({ agent, jobType, jobLabel: a.job_types[jobType] || jobType, tag: a.tag, brief });
    closeModal(overlay, modal);
    rerender();
  });
}

// ── Board interactions ────────────────────────────────────────────────────────
function wireSchedule(panel) {
  if (panel.__schedWired) return;
  panel.__schedWired = true;

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="sbDaily"]')) { showDaily = !showDaily; rerender(); return; }
    if (e.target.closest('[data-action="sbNew"]')) {
      if (!busConfigured()) toast('Not connected — add your acc-bus token in Settings (⚙) before placing jobs');
      openNewJob();
      return;
    }
    const rm = e.target.closest('[data-action="sbRemove"]');
    if (rm) { removeDraft(rm.dataset.lid); rerender(); }
  });

  panel.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.sb-job[data-lid]');
    if (!el) return;
    e.dataTransfer.setData('text/plain', el.dataset.lid);
    e.dataTransfer.effectAllowed = 'move';
  });

  const zoneOf = (e) => e.target.closest('.sb-col, [data-tray]');
  panel.addEventListener('dragover', (e) => {
    const z = zoneOf(e);
    if (!z || z.classList.contains('past')) return;
    e.preventDefault();
    z.classList.add('over');
  });
  panel.addEventListener('dragleave', (e) => {
    const z = zoneOf(e);
    if (z && !z.contains(e.relatedTarget)) z.classList.remove('over');
  });
  panel.addEventListener('drop', (e) => {
    const z = zoneOf(e);
    if (!z) return;
    e.preventDefault();
    z.classList.remove('over');
    if (z.classList.contains('past')) { toast('That day has already passed'); return; }
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const why = z.dataset.day ? placeJob(id, z.dataset.day) : unplaceJob(id);
    if (why) toast(why);
    rerender();
  });
}
