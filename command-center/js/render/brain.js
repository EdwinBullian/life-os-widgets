// Brain tab: force-directed graph of the knowledge base (Agent/knowledge_base/ -> kb.db),
// read from data/kb_graph.json (written by `python cli.py graph-export`, read-only against kb.db).
// Subjects render as glowing clustered "lobes"; documents are dim resting neurons that flash
// briefly and stochastically — like real neural noise, not a looping decoration — with firing
// rate/brightness driven up in whichever subject a currently-RUNNING agent (state.status.perAgent)
// maps to. Uses D3 (CDN, loaded in index.html) — the one tab that isn't pure DOM-string
// templating, because a force simulation + a firing scheduler need persistent object identity
// across renders, not a from-scratch template each tick.
//
// Rebuild discipline: the 60s poller calls render() -> renderBrain(state, panel) on every tick.
// Rebuilding the SVG/simulation on every tick would restart the physics and reset zoom/pan/focus,
// so this module only (re)builds the graph when the panel is fresh or a NEW kb_graph.json
// reference lands (loadKbGraph() replaces state.kbGraph). The live-agent overlay (which lobes are
// "firing hot") DOES update on every tick — that's cheap and is the whole point of the effect —
// via updateActivity(), independent of the structural rebuild.

import { esc, safe } from '../util.js';
import { EMPTY_KB_GRAPH } from '../data.js';

const SUBJECT_VAR = {
  finance: '--tag-finance', health: '--tag-health', research: '--tag-research',
  marketing: '--tag-marketing', business: '--tag-business', career: '--tag-career',
  trading: '--tag-trading', school: '--tag-school', memory: '--tag-memory',
  knowledge: '--tag-knowledge',
};
const RUBRIC_NS = new Set(['tier', 'consensus', 'indep', 'grade', 'beats']);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const colorFor = (subject) => `var(${SUBJECT_VAR[(subject || '').toLowerCase()] || '--tag-other'})`;
const nodeR = (chunks) => clamp(3 + Math.sqrt(Number(chunks) || 0) * 1.6, 3, 14);
const topicalTags = (tags) => (tags || []).filter((t) => !(t.includes('/') && RUBRIC_NS.has(t.split('/', 1)[0])));

// Firing cadence: ambient (idle) vs. hot (an agent is actually running against that subject).
const AMBIENT_MIN_MS = 350, AMBIENT_MAX_MS = 900;
const HOT_MIN_MS = 70, HOT_MAX_MS = 180;
const HOP_MS = 260; // time a pulse takes to race across one edge — tune together with travelPulse's duration

// Module-level build state — one graph build lives across renders/ticks until the data changes.
let _built = null;
let _tooltipEl = null;

function tooltip() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'brain-tooltip';
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}
function showTooltip(evt, node) {
  const tt = tooltip();
  const tags = topicalTags(node.tags).slice(0, 6).map((t) => `<span class="tt-tag">${esc(t)}</span>`).join('');
  tt.innerHTML = `<div class="tt-title">${esc(node.title)}${node.contested ? ' <span class="tt-contested">CONTESTED</span>' : ''}</div>`
    + `<div class="tt-meta">${esc(node.subject)} / ${esc(node.doc_type)} · ${esc(node.chunks)} chunk${node.chunks === 1 ? '' : 's'}</div>`
    + (tags ? `<div class="tt-tags">${tags}</div>` : '');
  tt.classList.add('show');
  moveTooltip(evt);
}
function moveTooltip(evt) {
  if (!_tooltipEl) return;
  const pad = 14;
  const w = _tooltipEl.offsetWidth || 200;
  const x = clamp(evt.clientX + pad, 4, window.innerWidth - w - 4);
  _tooltipEl.style.left = `${x}px`;
  _tooltipEl.style.top = `${evt.clientY + pad}px`;
}
function hideTooltip() { if (_tooltipEl) _tooltipEl.classList.remove('show'); }

// Obsidian-style hover: light up a node's real neighborhood (its edges + neighbor nodes),
// dim everything else so the actual connections are legible instead of drowned in the full graph.
function highlightNeighborhood(node) {
  if (!_built) return;
  const links = _built.linksByNode.get(node.id) || [];
  const connected = new Set([node.id]);
  links.forEach((l) => { connected.add(l.source.id); connected.add(l.target.id); });
  _built.svg.selectAll('.brain-node').style('opacity', (d) => (connected.has(d.id) ? null : 0.12));
  _built.svg.selectAll('.brain-edge').style('opacity', (d) => (
    d.source.id === node.id || d.target.id === node.id ? 0.9 : 0.03
  )).style('stroke-width', (d) => (
    d.source.id === node.id || d.target.id === node.id ? clamp(1 + d.weight * 0.25, 1, 3) : null
  ));
}
function clearHighlight() { applyFilters(); } // re-applies whatever focus/coverage state was active

function isRegistry(g) {
  return g && typeof g === 'object' && Array.isArray(g.nodes) && Array.isArray(g.edges);
}

// Flatten graph.coverage {subject: [{id,name,agent,trigger}]} into a deduped task list for the
// "agent coverage" dropdown (manual/declared — "which subjects COULD this job touch").
function flattenCoverage(coverage) {
  const tasks = new Map();
  for (const [subject, list] of Object.entries(coverage || {})) {
    for (const t of (Array.isArray(list) ? list : [])) {
      if (!t || !t.id) continue;
      if (!tasks.has(t.id)) tasks.set(t.id, { id: t.id, name: t.name || t.id, agent: t.agent, subjects: new Set() });
      tasks.get(t.id).subjects.add(subject);
    }
  }
  return [...tasks.values()];
}

function buildToolbar(panel, graph, subjects) {
  const bar = document.createElement('div');
  bar.className = 'brain-toolbar';
  const legend = subjects.map((s) => `<span class="tag" data-subject="${esc(s)}" style="color:${colorFor(s)}">${esc(s)}</span>`).join('');
  const covTasks = flattenCoverage(graph.coverage);
  const covOpts = covTasks.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  bar.innerHTML = `
    <span class="lab">Subjects</span>
    <span class="brain-legend" id="brain-legend">${legend}</span>
    <span class="lab">Coverage</span>
    <select id="brain-coverage-sel" style="width:auto;min-width:140px">
      <option value="">— none —</option>${covOpts}
    </select>
    <button class="btn ghost sm" id="brain-clear">Clear filter</button>
    <span class="brain-active-badge" id="brain-active-badge"></span>
    <span class="brain-stats" id="brain-stats"></span>`;
  panel.appendChild(bar);
  return bar;
}

function setStats(graph, subjects) {
  const el = document.getElementById('brain-stats');
  if (!el) return;
  const contested = graph.nodes.filter((n) => n.contested).length;
  el.textContent = `${graph.nodes.length} docs · ${graph.edges.length} synapses · ${subjects.length} subjects`
    + (contested ? ` · ${contested} contested` : '')
    + (graph.generated_at ? ` · exported ${new Date(graph.generated_at).toLocaleDateString()}` : '');
}

// ── Live-agent overlay ────────────────────────────────────────────────────────────────────────
// Reads state.status.perAgent (the same feed agents.js uses for the roster health dots) and marks
// which KB subjects a currently-RUNNING agent maps to (case-insensitive agent-key == subject,
// the same match graph_export.py uses server-side for the coverage field). Cheap; runs every poll
// tick without touching the simulation.
function computeActiveSubjects(state, subjects) {
  const status = safe(state.status, null);
  const perAgent = (status && status.perAgent) || {};
  const active = new Map(); // subject -> agentKey
  for (const [key, info] of Object.entries(perAgent)) {
    const h = String((info && info.health) || '').toLowerCase();
    if (h !== 'run' && h !== 'running') continue;
    const subj = subjects.find((s) => s.toLowerCase() === key.toLowerCase());
    if (subj) active.set(subj, key);
  }
  return active;
}

function updateActivity(state) {
  if (!_built) return;
  const active = computeActiveSubjects(state, _built.subjects);
  _built.activeSubjects = new Set(active.keys());
  _built.lobeSel.classed('active', (s) => _built.activeSubjects.has(s));
  _built.ringSel.classed('active', (s) => _built.activeSubjects.has(s));
  const badge = document.getElementById('brain-active-badge');
  if (badge) {
    const parts = [...active.entries()].map(([s]) => s);
    badge.textContent = parts.length ? `● live: ${parts.join(', ')}` : '';
    badge.style.color = parts.length ? 'var(--accent-2)' : '';
  }
}

// ── Filtering (subject focus + declared-coverage dim) ───────────────────────────────────────────
function applyFilters() {
  if (!_built) return;
  const { svg, focusSubject, coverageTask } = _built;
  const coverSubjects = coverageTask ? new Set(coverageTask.subjects) : null;

  svg.selectAll('.brain-node').style('opacity', (d) => {
    if (focusSubject && d.subject !== focusSubject) return 0.06;
    if (coverSubjects && !coverSubjects.has(d.subject)) return 0.12;
    return null;
  });
  svg.selectAll('.brain-edge').style('opacity', (d) => {
    if (focusSubject && d.source.subject !== focusSubject && d.target.subject !== focusSubject) return 0.02;
    return null;
  });
  svg.selectAll('.brain-lobe, .brain-lobe-ring').style('display', (s) => (focusSubject && s !== focusSubject ? 'none' : null));

  document.querySelectorAll('#brain-legend .tag').forEach((el) => {
    el.classList.toggle('dim', focusSubject && el.dataset.subject !== focusSubject);
  });
}

function zoomToSubject(subject) {
  if (!_built) return;
  const { svg, nodes, width, height, zoomBehavior } = _built;
  const pts = nodes.filter((n) => n.subject === subject);
  if (!pts.length) return;
  const xs = pts.map((n) => n.x), ys = pts.map((n) => n.y);
  const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40;
  const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
  const scale = clamp(0.9 / Math.max((x1 - x0) / width, (y1 - y0) / height), 0.5, 4);
  const tx = width / 2 - scale * (x0 + x1) / 2;
  const ty = height / 2 - scale * (y0 + y1) / 2;
  svg.transition().duration(500).call(zoomBehavior.transform, window.d3.zoomIdentity.translate(tx, ty).scale(scale));
}
function resetZoom() {
  if (!_built) return;
  _built.svg.transition().duration(400).call(_built.zoomBehavior.transform, window.d3.zoomIdentity);
}

function toggleFocus(subject) {
  if (!_built) return;
  _built.focusSubject = _built.focusSubject === subject ? null : subject;
  applyFilters();
  if (_built.focusSubject) zoomToSubject(_built.focusSubject); else resetZoom();
}

function wireToolbar(panel) {
  const legend = panel.querySelector('#brain-legend');
  if (legend) {
    legend.addEventListener('click', (e) => {
      const el = e.target.closest('[data-subject]');
      if (el) toggleFocus(el.dataset.subject);
    });
  }
  const sel = panel.querySelector('#brain-coverage-sel');
  if (sel) {
    sel.addEventListener('change', () => {
      if (!_built) return;
      const covTasks = flattenCoverage(_built.graphRef.coverage);
      _built.coverageTask = covTasks.find((t) => t.id === sel.value) || null;
      applyFilters();
    });
  }
  const clearBtn = panel.querySelector('#brain-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!_built) return;
      _built.focusSubject = null;
      _built.coverageTask = null;
      if (sel) sel.value = '';
      applyFilters();
      resetZoom();
    });
  }
}

// ── Firing engine ────────────────────────────────────────────────────────────────────────────
// Real neurons don't glow steadily or pulse in lockstep — they sit near-dark at rest and spike
// briefly and irregularly, and an impulse that reaches a synapse keeps racing down the axon
// rather than stopping. racePulse() walks a real multi-hop path along actual edges (tag/ticker/
// wikilink/semantic — see graph_export.py); flashNode() is just the single-node spike underneath.
function flashNode(node) {
  const el = _built.nodeEls.get(node.id);
  if (!el) return;
  const d3g = window.d3;
  const g = d3g.select(el);
  const hot = _built.activeSubjects.has(node.subject);
  g.select('.n-halo').interrupt()
    .transition().duration(60).style('opacity', hot ? 0.7 : 0.42).attr('r', node.r * (hot ? 3.4 : 2.4))
    .transition().duration(480).style('opacity', 0.08).attr('r', node.r * 1.6);
  g.select('.n-core').interrupt()
    .transition().duration(50).style('opacity', 1)
    .transition().duration(380).style('opacity', 0.55);
}

function travelPulse(a, b, duration = HOP_MS) {
  const d3g = window.d3;
  const dot = _built.pulseLayer.append('circle')
    .attr('class', 'brain-pulse-dot')
    .attr('r', 2.4)
    .attr('cx', a.x).attr('cy', a.y)
    .style('fill', colorFor(a.subject))
    .style('opacity', 0.95);
  dot.transition().duration(duration).ease(d3g.easeLinear)
    .attr('cx', b.x).attr('cy', b.y)
    .transition().duration(120).style('opacity', 0)
    .on('end', function () { d3g.select(this).remove(); });
}

// Walk `hops` real edges from `node`, flashing each stop and racing a pulse along the way.
// Prefers not to immediately backtrack so the chain reads as travel, not a jitter in place.
function racePulse(node, hopsLeft, visited) {
  if (!_built) return;
  flashNode(node);
  if (hopsLeft <= 0) return;
  const links = _built.linksByNode.get(node.id);
  if (!links || !links.length) return;
  const neighborsOf = (l) => (l.source.id === node.id ? l.target : l.source);
  const fresh = links.map(neighborsOf).filter((n) => !visited.has(n.id));
  const pool = fresh.length ? fresh : links.map(neighborsOf);
  const next = pool[(Math.random() * pool.length) | 0];
  travelPulse(node, next);
  visited.add(next.id);
  setTimeout(() => racePulse(next, hopsLeft - 1, visited), HOP_MS);
}

function fireOnce() {
  if (!_built || !_built.nodes.length) return;
  const { nodes, activeSubjects, linksByNode } = _built;
  let pool = nodes;
  if (activeSubjects.size) {
    const hot = nodes.filter((n) => activeSubjects.has(n.subject));
    if (hot.length && Math.random() < 0.8) pool = hot;
  }
  // Bias toward connected nodes so "racing along a chain" is the common case; isolated docs
  // still flicker on their own sometimes — an honest reflection of the current data (see
  // graph_export.py's embed_coverage — most of the corpus has no edges yet).
  const connected = pool.filter((n) => (linksByNode.get(n.id) || []).length > 0);
  if (connected.length && Math.random() < 0.8) pool = connected;
  const n = pool[(Math.random() * pool.length) | 0];
  const hot = activeSubjects.has(n.subject);
  const hops = hot ? 3 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 3) | 0);
  racePulse(n, hops, new Set([n.id]));
}

function scheduleFiring() {
  if (!_built) return;
  const hot = _built.activeSubjects.size > 0;
  const [lo, hi] = hot ? [HOT_MIN_MS, HOT_MAX_MS] : [AMBIENT_MIN_MS, AMBIENT_MAX_MS];
  const delay = lo + Math.random() * (hi - lo);
  _built.fireTimer = setTimeout(() => {
    fireOnce();
    if (_built && _built.activeSubjects.size) fireOnce(); // hot subjects fire in overlapping bursts
    scheduleFiring();
  }, delay);
}

// ── Structural build (runs once per fresh graph) ────────────────────────────────────────────────
function buildGraph(panel, graph) {
  const d3g = window.d3;
  if (_built && _built.fireTimer) clearTimeout(_built.fireTimer);
  panel.innerHTML = '';
  const subjects = [...new Set(graph.nodes.map((n) => n.subject))].sort();
  buildToolbar(panel, graph, subjects);

  const wrap = document.createElement('div');
  wrap.className = 'brain-wrap';
  panel.appendChild(wrap);
  const width = wrap.clientWidth || 900;
  const height = wrap.clientHeight || 520;

  const svgRoot = d3g.select(wrap).append('svg').attr('viewBox', [0, 0, width, height]);
  const defs = svgRoot.append('defs');
  defs.append('filter').attr('id', 'brain-blur-lobe').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
    .append('feGaussianBlur').attr('stdDeviation', 22);
  defs.append('filter').attr('id', 'brain-blur-node').attr('x', '-150%').attr('y', '-150%').attr('width', '400%').attr('height', '400%')
    .append('feGaussianBlur').attr('stdDeviation', 2.4);

  const viewport = svgRoot.append('g').attr('class', 'viewport');
  const lobeLayer = viewport.append('g').attr('class', 'lobes');
  const ringLayer = viewport.append('g').attr('class', 'rings');
  const edgeLayer = viewport.append('g').attr('class', 'edges');
  const pulseLayer = viewport.append('g').attr('class', 'pulses');
  const nodeLayer = viewport.append('g').attr('class', 'nodes');

  const zoomBehavior = d3g.zoom().scaleExtent([0.3, 5]).on('zoom', (ev) => viewport.attr('transform', ev.transform));
  svgRoot.call(zoomBehavior);

  const nodes = graph.nodes.map((n) => ({ ...n, r: nodeR(n.chunks) }));
  const idIndex = new Map(nodes.map((n) => [n.id, n]));
  const links = graph.edges
    .filter((e) => idIndex.has(e.source) && idIndex.has(e.target))
    .map((e) => ({ ...e }));

  // Cluster anchor per subject, arranged on a ring so lobes don't overlap by default.
  const cx = width / 2, cy = height / 2, ring = Math.min(width, height) * 0.32;
  const centers = {};
  subjects.forEach((s, i) => {
    const angle = (i / subjects.length) * 2 * Math.PI - Math.PI / 2;
    centers[s] = { x: cx + ring * Math.cos(angle), y: cy + ring * Math.sin(angle) };
  });

  const sim = d3g.forceSimulation(nodes)
    .force('charge', d3g.forceManyBody().strength(-24))
    .force('collide', d3g.forceCollide().radius((d) => d.r + 1.5))
    .force('link', d3g.forceLink(links).id((d) => d.id).distance(32).strength((l) => Math.min(0.5, l.weight * 0.06)))
    .force('x', d3g.forceX((d) => centers[d.subject].x).strength(0.09))
    .force('y', d3g.forceY((d) => centers[d.subject].y).strength(0.09));

  const lobeSel = lobeLayer.selectAll('circle').data(subjects).join('circle')
    .attr('class', 'brain-lobe')
    .attr('filter', 'url(#brain-blur-lobe)')
    .style('fill', (s) => colorFor(s));

  // No inline stroke here on purpose — the CSS .brain-lobe-ring.active rule sets the accent
  // color, and an inline style would win over that stylesheet rule regardless of specificity.
  const ringSel = ringLayer.selectAll('circle').data(subjects).join('circle')
    .attr('class', 'brain-lobe-ring');

  const edgeSel = edgeLayer.selectAll('line').data(links).join('line')
    .attr('class', (d) => `brain-edge ${d.type}`) // d.type is one of our own enum values (tag/ticker/wikilink/semantic), not user text
    .style('stroke-width', (d) => clamp(0.7 + d.weight * 0.25, 0.7, 2.6));

  const nodeSel = nodeLayer.selectAll('g').data(nodes).join('g')
    .attr('class', 'brain-node')
    .style('cursor', 'pointer')
    .call(d3g.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  // Two-layer "resting neuron": a soft dim halo (blurred) behind a small brighter core. Both start
  // dim — brightness/size only spike momentarily when fireOnce() flashes this node. Plus an
  // invisible, generously-sized hit-area circle: the visible circles get down to 3-4px radius,
  // far too small to reliably hover/click/drag on their own (this was the earlier bug — n-halo/
  // n-core have pointer-events:none in CSS specifically so THIS is what receives all interaction).
  nodeSel.append('circle').attr('class', 'n-hit')
    .attr('r', (d) => Math.max(d.r * 2.4, 9));
  nodeSel.append('circle').attr('class', 'n-halo')
    .attr('r', (d) => d.r * 1.6)
    .attr('filter', 'url(#brain-blur-node)')
    .style('fill', (d) => d.contested ? 'var(--warn)' : colorFor(d.subject))
    .style('opacity', 0.08);
  nodeSel.append('circle').attr('class', 'n-core')
    .attr('r', (d) => d.r * 0.5)
    .style('fill', (d) => d.contested ? 'var(--warn)' : colorFor(d.subject))
    .style('opacity', 0.55);

  nodeSel.on('mouseenter', (ev, d) => { showTooltip(ev, d); highlightNeighborhood(d); })
    .on('mousemove', (ev) => moveTooltip(ev))
    .on('mouseleave', () => { hideTooltip(); clearHighlight(); });

  lobeSel.style('cursor', 'pointer').on('click', (ev, s) => toggleFocus(s));

  const nodeEls = new Map();
  nodeSel.each(function (d) { nodeEls.set(d.id, this); });

  sim.on('tick', () => {
    edgeSel.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    lobeSel.attr('cx', (s) => {
      const m = nodes.filter((n) => n.subject === s);
      return m.reduce((a, n) => a + n.x, 0) / (m.length || 1);
    }).attr('cy', (s) => {
      const m = nodes.filter((n) => n.subject === s);
      return m.reduce((a, n) => a + n.y, 0) / (m.length || 1);
    }).attr('r', (s) => {
      const m = nodes.filter((n) => n.subject === s);
      if (!m.length) return 0;
      const mx = m.reduce((a, n) => a + n.x, 0) / m.length, my = m.reduce((a, n) => a + n.y, 0) / m.length;
      return Math.max(...m.map((n) => Math.hypot(n.x - mx, n.y - my) + n.r)) + 16;
    });
    ringSel.attr('cx', (s) => lobeSel.filter((d) => d === s).attr('cx'))
      .attr('cy', (s) => lobeSel.filter((d) => d === s).attr('cy'))
      .attr('r', (s) => Number(lobeSel.filter((d) => d === s).attr('r')) + 6);
  });

  // Build the real adjacency map AFTER d3.forceLink has resolved link.source/target from ids to
  // node object references (it does this on simulation construction, synchronously).
  const adjacency = new Map();
  links.forEach((l) => {
    if (!adjacency.has(l.source.id)) adjacency.set(l.source.id, []);
    if (!adjacency.has(l.target.id)) adjacency.set(l.target.id, []);
    adjacency.get(l.source.id).push(l);
    adjacency.get(l.target.id).push(l);
  });

  _built = {
    panel, graphRef: graph, svg: svgRoot, zoomBehavior, sim, subjects, nodes, links,
    lobeSel, ringSel, pulseLayer, nodeEls, linksByNode: adjacency,
    width, height, focusSubject: null, coverageTask: null, activeSubjects: new Set(), fireTimer: null,
  };
  wireToolbar(panel);
  setStats(graph, subjects);
  applyFilters();
  scheduleFiring();
}

export function renderBrain(state, panel) {
  const graph = safe(state.kbGraph, EMPTY_KB_GRAPH);
  if (typeof window === 'undefined' || !window.d3) {
    panel.innerHTML = '<div class="box"><div class="ptitle">BRAIN</div>'
      + '<div class="muted">D3 failed to load from CDN (offline?) — brain map unavailable.</div></div>';
    return;
  }
  if (!isRegistry(graph) || graph.nodes.length === 0) {
    panel.innerHTML = '<div class="box"><div class="ptitle">BRAIN</div>'
      + '<div class="muted">No knowledge-base graph yet. Run <span class="mono">python cli.py graph-export</span> '
      + 'in Agent/knowledge_base/ to generate data/kb_graph.json.</div></div>';
    if (_built && _built.fireTimer) clearTimeout(_built.fireTimer);
    _built = null;
    return;
  }
  if (_built && _built.panel === panel && _built.graphRef === graph) {
    updateActivity(state); // cheap live overlay refresh — never rebuilds the simulation
    return;
  }
  buildGraph(panel, graph);
  updateActivity(state);
}
