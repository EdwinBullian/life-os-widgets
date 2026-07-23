// Agents tab: inline roster data (§4.3) + roster grid + per-agent modal + the shared
// dispatch form (§6.3.1, reused by Overview quick-dispatch). Pure string-templated DOM with
// strict esc() on every dynamic value; ALL interactivity flows through single delegated
// listeners (never inline onclick="…"), so dynamic text containing quotes can't break wiring.

import { getState, setState } from '../state.js';
import { esc, safe } from '../util.js';
import { postAction, getPausedAgents, setAgentPaused } from '../proxy.js';
import { repollSoon } from '../poll.js';

// ── Model menus (ported verbatim from the mockup) ─────────────────────────────
const CLAUDE_MODELS = ['Auto', 'Opus', 'Sonnet', 'Haiku'];
const OPEN_MODELS = ['gpt-oss-20b', 'Nemotron-3 Super', 'Devstral'];
export function modelSelectHtml(cur) {
  const opt = (m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`;
  return `<optgroup label="Claude · Max plan">${CLAUDE_MODELS.map(opt).join('')}</optgroup>`
    + `<optgroup label="Open · gateway (paid API)">${OPEN_MODELS.map(opt).join('')}</optgroup>`;
}

// first n words of a free-text field → a short job title. Empty → "Job".
function firstWords(s, n) {
  if (!s) return 'Job';
  const w = String(s).replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
  return w.length > 48 ? `${w.slice(0, 48)}…` : w;
}

// ── FORMS — dispatch field schemas keyed by taskType. ───────────────────────────────────────
export const FORMS = {
  'Financial Thesis': { agent: 'Finance', icon: '💰', sub: 'Full thesis + DCF + comps. Numbers get a review flag.', titleTpl: (v) => `Thesis — ${v.company || 'company'}`, fields: [{ k: 'company', label: 'Company or ticker', req: true, ph: 'e.g. Palantir / PLTR' }, { k: 'angle', label: 'Angle or focus', hint: 'optional', ph: 'e.g. AI defense moat' }, { k: 'notes', label: 'Anything else', hint: 'optional', type: 'textarea', ph: '' }] },
  DCF: { agent: 'Finance', icon: '🧮', sub: 'Standalone DCF valuation with a comps-informed terminal multiple.', titleTpl: (v) => `DCF — ${v.company || 'company'}`, fields: [{ k: 'company', label: 'Company or ticker', req: true, ph: 'e.g. Nvidia / NVDA' }, { k: 'assumptions', label: 'Key assumptions', hint: 'optional', type: 'textarea', ph: 'growth, margins, WACC if you have a view' }] },
  'Market Scan': { agent: 'Finance', icon: '📈', sub: 'Top moves, earnings, deals for a sector or theme.', titleTpl: (v) => `Market Scan — ${v.scope || ''}`, fields: [{ k: 'scope', label: 'Scope', req: true, ph: "e.g. AI infrastructure, or 'this week in tech'" }, { k: 'focus', label: 'Focus', hint: 'optional', ph: '' }, { k: 'notes', label: 'Notes', hint: 'optional', type: 'textarea', ph: '' }] },
  'Company Screen': { agent: 'Finance', icon: '🔎', sub: 'Fast first-pass — worth a full memo?', titleTpl: (v) => `Screen — ${v.company || 'company'}`, fields: [{ k: 'company', label: 'Company or ticker', req: true, ph: 'e.g. Cloudflare / NET' }, { k: 'focus', label: 'What you want to know', hint: 'optional', ph: '' }, { k: 'notes', label: 'Notes', hint: 'optional', type: 'textarea', ph: '' }] },
  'Light Research': { agent: 'Research', icon: '🔬', sub: 'Quick grounding → written report.', titleTpl: (v) => `Light Research — ${v.topic || ''}`, fields: [{ k: 'topic', label: 'Topic', req: true, ph: 'e.g. the GLP-1 drug market' }, { k: 'questions', label: 'Key questions / angle', hint: 'optional', type: 'textarea', ph: '' }, { k: 'length', label: 'Length / depth', hint: 'optional', ph: 'e.g. 1-page overview' }] },
  'Medium Research': { agent: 'Research', icon: '🔬', sub: 'Serious study → report + podcast.', titleTpl: (v) => `Medium Research — ${v.topic || ''}`, fields: [{ k: 'topic', label: 'Topic', req: true, ph: '' }, { k: 'questions', label: 'Key questions / angle', hint: 'optional', type: 'textarea', ph: '' }, { k: 'output', label: 'Output', type: 'select', opts: ['Report + Podcast', 'Report only', 'Report + Slides'] }] },
  'Heavy Max Research': { agent: 'Research', icon: '🧪', sub: 'Full multi-week deep dive — breadth + depth, runs in chunks.', titleTpl: (v) => `Heavy Max — ${v.topic || ''}`, fields: [{ k: 'topic', label: 'Topic', req: true, ph: '' }, { k: 'scope', label: 'Scope / angle', hint: 'optional', type: 'textarea', ph: '' }, { k: 'output', label: 'Output', type: 'select', opts: ['Everything', 'Report + Podcast', 'Report only'] }] },
  'Heavy Breadth Research': { agent: 'Research', icon: '🧪', sub: 'Wide market/business coverage of a space.', titleTpl: (v) => `Heavy Breadth — ${v.topic || ''}`, fields: [{ k: 'topic', label: 'Topic / space', req: true, ph: 'e.g. the AI infra ecosystem' }, { k: 'scope', label: 'What to cover', hint: 'optional', type: 'textarea', ph: '' }] },
  'Heavy Depth Research': { agent: 'Research', icon: '🧪', sub: 'Deep multi-notebook dive on one thing.', titleTpl: (v) => `Heavy Depth — ${v.topic || ''}`, fields: [{ k: 'topic', label: 'Topic', req: true, ph: '' }, { k: 'questions', label: 'Core questions', hint: 'optional', type: 'textarea', ph: '' }] },
  'Schedule Workouts': { agent: 'Health', icon: '📅', sub: 'Blocks training on Google Calendar (PST).', titleTpl: (v) => `Schedule Workouts — ${v.week || 'this week'}`, fields: [{ k: 'week', label: 'Which days / week', req: true, ph: 'e.g. this week, Mon/Wed/Fri' }, { k: 'constraints', label: 'Constraints', hint: 'optional', ph: '' }] },
  'Make Workout': { agent: 'Health', icon: '🏋️', sub: 'Generates one tailored workout.', titleTpl: (v) => `Workout — ${v.target || ''}`, fields: [{ k: 'target', label: 'Target', req: true, ph: 'e.g. push day / chest focus' }, { k: 'duration', label: 'Duration', hint: 'optional', ph: '' }, { k: 'equipment', label: 'Equipment', hint: 'optional', ph: '' }] },
  'Find Recipe': { agent: 'Health', icon: '🍳', sub: 'Finds a recipe & saves it to Notion Recipes.', titleTpl: (v) => `Recipe — ${v.dish || ''}`, fields: [{ k: 'dish', label: 'Dish or craving', req: true, ph: 'e.g. high-protein chicken bowl' }, { k: 'constraints', label: 'Constraints', hint: 'optional', ph: 'macros / ingredients on hand' }] },
  'Track Food': { agent: 'Health', icon: '🥗', sub: 'Logs foods to Cronometer.', titleTpl: () => 'Track Food', fields: [{ k: 'foods', label: 'Foods + amounts', req: true, type: 'textarea', ph: 'one per line' }, { k: 'meal', label: 'Meal', type: 'select', opts: ['Auto', 'Breakfast', 'Lunch', 'Dinner', 'Snack'] }] },
  'Daily Briefing': { agent: 'Assistant', icon: '🌅', sub: 'Builds your morning briefing from calendar + tasks + inboxes.', titleTpl: () => 'Daily Briefing', fields: [{ k: 'focus', label: 'Anything to emphasize', hint: 'optional', type: 'textarea', ph: 'e.g. recruiting deadlines, today only' }] },
  'Calendar Edit': { agent: 'Assistant', icon: '📆', sub: 'Adds / moves / removes events (PST).', titleTpl: (v) => `Calendar — ${firstWords(v.changes, 4)}`, fields: [{ k: 'changes', label: 'What to change', req: true, type: 'textarea', ph: 'e.g. add gym 6-7pm Tue & Thu, move dentist to Fri 3pm' }, { k: 'dates', label: 'Date(s)', hint: 'optional', ph: '' }] },
  'Quick Task': { agent: 'Assistant', icon: '✅', sub: 'Does the small thing, or files a task.', titleTpl: (v) => firstWords(v.task, 6), fields: [{ k: 'task', label: 'Task', req: true, type: 'textarea', ph: 'e.g. reorganize my Downloads by file type' }] },
  'Social Dashboard': { agent: 'Business', icon: '📊', sub: 'Generates the weekly Salil Group social analytics dashboard via Supermetrics.', titleTpl: (v) => `Social Dashboard${v.account ? ` — ${v.account}` : ''}`, fields: [{ k: 'account', label: 'Account / page', hint: 'optional', ph: 'e.g. Salil Riverside' }, { k: 'notes', label: 'Notes', hint: 'optional', type: 'textarea', ph: '' }] },
  'Analytics Brief': { agent: 'Business', icon: '📈', sub: 'Generates the weekly analytics brief with key insights and recommendations.', titleTpl: (v) => `Analytics Brief${v.account ? ` — ${v.account}` : ''}`, fields: [{ k: 'account', label: 'Account / page', hint: 'optional', ph: 'e.g. Salil Riverside' }, { k: 'period', label: 'Period', hint: 'optional', ph: 'e.g. last 7 days' }, { k: 'notes', label: 'Notes', hint: 'optional', type: 'textarea', ph: '' }] },
  'Content Draft': { agent: 'Marketing', icon: '✍️', sub: 'Drafts marketing content for any channel in your brand voice.', titleTpl: (v) => `Content — ${v.type || 'post'}`, fields: [{ k: 'type', label: 'Content type', req: true, ph: 'e.g. Instagram post, blog post, email' }, { k: 'topic', label: 'Topic or brief', req: true, type: 'textarea', ph: '' }, { k: 'tone', label: 'Tone', hint: 'optional', ph: 'e.g. professional, casual, playful' }] },
  'Campaign Plan': { agent: 'Marketing', icon: '📣', sub: 'Full campaign brief with objectives, channel strategy, and week-by-week content calendar.', titleTpl: (v) => `Campaign — ${v.goal || ''}`, fields: [{ k: 'goal', label: 'Campaign goal', req: true, ph: 'e.g. Q3 product launch, brand awareness' }, { k: 'audience', label: 'Target audience', hint: 'optional', ph: '' }, { k: 'channels', label: 'Channels', hint: 'optional', ph: 'e.g. Instagram, email, TikTok' }, { k: 'notes', label: 'Notes', hint: 'optional', type: 'textarea', ph: '' }] },
  'SEO Audit': { agent: 'Marketing', icon: '🔍', sub: 'Comprehensive SEO audit with keyword research, content gaps, and a prioritized action plan.', titleTpl: (v) => `SEO Audit — ${v.site || ''}`, fields: [{ k: 'site', label: 'Site or URL', req: true, ph: 'e.g. salilriverside.com' }, { k: 'focus', label: 'Focus area', hint: 'optional', ph: 'e.g. local SEO, content gaps, competitor keywords' }] },
  Custom: { agent: '', icon: '✨', sub: 'Free-form one-shot prompt.', titleTpl: (v) => firstWords(v.prompt, 6), fields: [{ k: 'agent', label: 'Agent', type: 'select', opts: ['Finance', 'Health', 'Research', 'Assistant', 'Business', 'Marketing'] }, { k: 'prompt', label: 'Prompt', req: true, type: 'textarea', ph: 'Describe exactly what you want done.' }] },
};

// ── SKILL_DESC — slash-command → one-line description (skill chip accordion). ──────────────────
export const SKILL_DESC = {
  '/screen': 'Fast first-pass screen on a company — worth a full memo?',
  '/memo': 'Full investment memo with thesis, risks, and valuation.',
  '/sector': 'Sector thesis: structure, players, and where value accrues.',
  '/teardown': 'Deal teardown — break down a transaction and its economics.',
  '/dcf': 'Discounted-cash-flow valuation with a comps-informed terminal multiple.',
  '/lbo': 'Leveraged-buyout model for a PE acquisition.',
  '/comps': 'Comparable-company analysis with trading multiples.',
  '/overview': 'Quick qualitative + quantitative overview of a name.',
  '/fundamental': 'Fundamental analysis of a company.',
  '/sentiment': 'Market sentiment read on a ticker or theme.',
  '/deep-dive': 'Full multi-angle deep dive on a single company.',
  '/workout': 'Generate one tailored workout.',
  '/body': 'Body-composition and progress check-in.',
  '/meal-prep': 'Build a meal-prep plan for the week.',
  '/diet': 'Diet analysis and nutrition guidance.',
  '/supplements': 'Supplement stack review and recommendations.',
  '/muscle': 'Hypertrophy-focused training guidance.',
  '/stretch': 'Mobility and stretching routine.',
  '/game': 'Game-day prep (basketball) — warmup and focus.',
  '/deload': 'Plan a deload / recovery week.',
  '/recovery': 'Recovery review from sleep, HRV, and load data.',
  '/light': 'Light research pass → written report.',
  '/medium': 'Medium research pass → report + podcast.',
  '/heavy': 'Heavy multi-session research project.',
  '/analyze': 'Analyze a source you provide (URL, file, or inbox item).',
  '/compare': 'Structured head-to-head comparison of two or more things.',
  '/find': 'Locate a specific piece of content to consume directly.',
  '/monitor': 'Set up a recurring research pulse on a topic.',
  '/check-in': 'Daily check-in on schedule, tasks, and priorities.',
  '/calendar': 'Add, move, or remove calendar events (PST).',
  '/recap': 'Recap of recent activity and what got done.',
  '/focus': 'Surface the few things to focus on today.',
  '/log': 'Log work, durations, and notes to memory.',
  '/brainstorm': 'Thinking-partner session to work through an idea.',
  '/search': 'Search across the assistant memory and workspace.',
  'mc-connect-sync': 'Sync Minecraft Connect state.',
  'cowork-sync': 'Sync Cowork session state.',
  Python: 'Python scripting and tooling.',
  JavaScript: 'JavaScript / web development.',
  PowerShell: 'PowerShell automation on Windows.',
  APIs: 'Integrate and call external APIs.',
  Plugins: 'Build and maintain Claude Code plugins.',
  Automation: 'Automate recurring workflows and jobs.',
  '/cover-letter': 'Draft a tailored cover letter in your voice.',
  '/cold-outreach': 'Write cold outreach for recruiting / networking.',
  '/business': 'Professional business writing.',
  '/linkedin': 'LinkedIn posts and profile copy in your voice.',
  '/personal-statement': 'Personal statement / application essay.',
  '/voice': 'Calibrate writing to your personal voice.',
  'Social Dashboard': 'Generate the weekly Salil Group social analytics dashboard.',
  'Analytics Brief': 'Generate the weekly analytics brief with key insights.',
  'Supermetrics': 'Pull marketing and analytics data via Supermetrics connectors.',
  '/brand-review': 'Review content against your brand voice and style guide.',
  '/campaign-plan': 'Full campaign brief with objectives, channel strategy, and content calendar.',
  '/competitive-brief': 'Competitive positioning and messaging comparison with content gaps.',
  '/content-creation': 'Draft marketing content across channels — blog, social, email, landing pages.',
  '/draft-content': 'Draft and refine copy for any channel or format.',
  '/email-sequence': 'Design multi-email drip sequences with timing and branching logic.',
  '/performance-report': 'Marketing performance report with trend analysis and recommendations.',
  '/seo-audit': 'SEO audit with keyword research, content gaps, and prioritized action plan.',
};

// ── Roster — eight agents. ─────────────────────────────────────────────────────────────────
export function buildRoster() {
  return [
    {
      key: 'finance', name: 'Finance Agent', type: 'Finance', icon: '💰',
      desc: 'Investment research and financial modeling. Runs a weekly thesis and market scan, and on demand builds memos, DCFs, comps, and screens.',
      skills: ['/screen', '/memo', '/sector', '/teardown', '/dcf', '/lbo', '/comps', '/overview', '/fundamental', '/sentiment', '/deep-dive'],
      routines: [{ t: 'Financial Thesis', tt: 'Financial Thesis' }, { t: 'DCF', tt: 'DCF' }, { t: 'Market Scan', tt: 'Market Scan' }, { t: 'Company Screen', tt: 'Company Screen' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [
        { label: "This week's market scan", taskType: 'Market Scan', details: 'Scope: this week in tech & markets — top moves, earnings, deals' },
        { label: 'AI & semis scan', taskType: 'Market Scan', details: 'Scope: AI & semiconductor sector this week' },
      ],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
    {
      key: 'research', name: 'Research Agent', type: 'Research', icon: '🔬',
      desc: 'Deep research on any topic through NotebookLM. Delivers reports, podcasts, and briefings at light, medium, or heavy depth, plus a weekly project.',
      skills: ['/light', '/medium', '/heavy', '/analyze', '/compare', '/find', '/monitor'],
      routines: [{ t: 'Light', tt: 'Light Research' }, { t: 'Medium', tt: 'Medium Research' }, { t: 'Heavy Max', tt: 'Heavy Max Research' }, { t: 'Heavy Breadth', tt: 'Heavy Breadth Research' }, { t: 'Heavy Depth', tt: 'Heavy Depth Research' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [
        { label: 'This week in AI', taskType: 'Light Research', details: 'Topic: notable AI developments this week' },
        { label: 'VC & startup pulse', taskType: 'Medium Research', details: 'Topic: this week in venture & startups' },
      ],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
    {
      key: 'health', name: 'Health Agent', type: 'Health', icon: '💪',
      desc: 'Fitness, nutrition, and recovery, pulling real data from Zepp and Cronometer. Plans training and meals, tracks food, and runs weekly check-ins.',
      skills: ['/workout', '/body', '/meal-prep', '/diet', '/supplements', '/muscle', '/stretch', '/game', '/deload', '/recovery'],
      routines: [{ t: 'Schedule Workouts', tt: 'Schedule Workouts' }, { t: 'Make Workout', tt: 'Make Workout' }, { t: 'Find Recipe', tt: 'Find Recipe' }, { t: 'Track Food', tt: 'Track Food' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [
        { label: "Schedule this week's workouts", taskType: 'Schedule Workouts', details: 'Which days / week: this week, per my training plan' },
        { label: 'Post-workout recipe', taskType: 'Find Recipe', details: 'Dish: high-protein post-workout meal, ~50g protein' },
      ],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
    {
      key: 'assistant', name: 'Assistant Agent', type: 'Assistant', icon: '🧠',
      desc: 'Your daily operator for scheduling, tasks, and calendar. Runs your briefings, recaps, and check-ins, and is the memory layer the other agents read from.',
      skills: ['/check-in', '/calendar', '/recap', '/focus', '/log', '/brainstorm', '/search', 'mc-connect-sync', 'cowork-sync'],
      routines: [{ t: 'Daily Briefing', tt: 'Daily Briefing' }, { t: 'Calendar Edit', tt: 'Calendar Edit' }, { t: 'Quick Task', tt: 'Quick Task' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [
        { label: 'What should I focus on today?', taskType: 'Quick Task', details: 'Look at my calendar + tasks and tell me the 3 things to focus on today' },
      ],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
    {
      key: 'programming', name: 'Programming Agent', type: 'Programming', icon: '💻',
      desc: 'Code, scripts, and automation in Python, JS, and PowerShell. On demand only; it maintains your phone bridge, trading bot, and plugins.',
      skills: ['Python', 'JavaScript', 'PowerShell', 'APIs', 'Plugins', 'Automation'],
      routines: [], presets: [], displayOnly: true, health: 'gray', ht: 'on demand',
    },
    {
      key: 'career', name: 'Career Agent', type: 'Career', icon: '🎓',
      desc: 'Professional writing in your voice: cover letters, cold outreach, LinkedIn, personal statements. Built for IB/VC recruiting and Mendoza.',
      skills: ['/cover-letter', '/cold-outreach', '/business', '/linkedin', '/personal-statement', '/voice'],
      routines: [], presets: [], displayOnly: true, health: 'gray', ht: 'on demand',
    },
    {
      key: 'business', name: 'Business Agent', type: 'Business', icon: '🏢',
      desc: 'Client work and reporting for The Salil Group. Runs weekly social dashboards and analytics briefs via Supermetrics; handles client-facing output and account management.',
      skills: ['Social Dashboard', 'Analytics Brief', 'Supermetrics', '/brand-review', '/campaign-plan'],
      routines: [{ t: 'Social Dashboard', tt: 'Social Dashboard' }, { t: 'Analytics Brief', tt: 'Analytics Brief' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [
        { label: 'Salil weekly social brief', taskType: 'Analytics Brief', details: 'Account: Salil Riverside\nPeriod: last 7 days' },
      ],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
    {
      key: 'marketing', name: 'Marketing Agent', type: 'Marketing', icon: '📣',
      desc: 'Content strategy, social media, and campaign analytics. Drafts posts and campaigns, reviews brand voice, and runs SEO audits. Pairs with the Business agent for client accounts.',
      skills: ['/content-creation', '/draft-content', '/campaign-plan', '/brand-review', '/email-sequence', '/seo-audit', '/competitive-brief', '/performance-report'],
      routines: [{ t: 'Content Draft', tt: 'Content Draft' }, { t: 'Campaign Plan', tt: 'Campaign Plan' }, { t: 'SEO Audit', tt: 'SEO Audit' }, { t: 'Custom', tt: 'Custom', custom: true }],
      presets: [],
      displayOnly: false, health: 'gray', ht: 'no runs yet',
    },
  ];
}

// ── health dot mapping (live perAgent[key].health string → dot class + label) ──────────────────
function healthDot(val) {
  switch (String(val || '').toLowerCase()) {
    case 'healthy': case 'green': case 'ok': return { cls: 'green', label: 'Healthy' };
    case 'warn': case 'amber': case 'stale': return { cls: 'amber', label: 'Needs attention' };
    case 'fail': case 'failed': case 'red': return { cls: 'red', label: 'Last run failed' };
    case 'run': case 'running': return { cls: 'run', label: 'Running' };
    default: return { cls: 'gray', label: 'No runs yet' };
  }
}

const roster = () => {
  const a = getState().agents;
  return Array.isArray(a) && a.length ? a : buildRoster();
};
const agentByKey = (key) => roster().find((a) => a.key === key) || null;

// ── toast + post-write re-poll (shared with Overview) ─────────────────────────────────────────
export function toast(msg) {
  const el = typeof document !== 'undefined' && document.getElementById('toast');
  if (el) el.textContent = msg;
}

// Fire a write action, toast, then schedule the fast re-poll. Never throws into the handler.
export function dispatchAction(action, params, label) {
  try {
    postAction(action, params)
      .then(() => { toast(label || 'Done'); })
      .catch((err) => { toast(`Couldn't reach proxy — ${String((err && err.message) || err)}`); });
  } catch (err) {
    toast(`Couldn't reach proxy — ${String((err && err.message) || err)}`);
  }
  try { repollSoon(); } catch { /* no poller under test — ignore */ }
}

// ── Shared dispatch form (§6.3.1) ─────────────────────────────────────────────────────────────
export function dispatchForm(jobType, presetAgent) {
  const f = FORMS[jobType];
  if (!f) return '';
  const agent = f.agent || presetAgent || '';
  const fields = f.fields.map((fl) => {
    const lab = `<label>${esc(fl.label)}${fl.req ? ' <span class="req">*</span>' : ''}`
      + `${fl.hint ? ` <span class="hint">(${esc(fl.hint)})</span>` : ''}</label>`;
    let ctrl;
    if (fl.type === 'textarea') ctrl = `<textarea id="fld-${esc(fl.k)}" placeholder="${esc(fl.ph || '')}"></textarea>`;
    else if (fl.type === 'select') ctrl = `<select id="fld-${esc(fl.k)}">${fl.opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    else ctrl = `<input id="fld-${esc(fl.k)}" type="text" placeholder="${esc(fl.ph || '')}">`;
    return `<div class="field">${lab}${ctrl}</div>`;
  }).join('');
  const when = '<div class="field"><label>When to run</label><div class="when-row">'
    + '<div class="when-opt sel" data-w="Downtime" data-action="pickWhen">Downtime</div>'
    + '<div class="when-opt" data-w="Soonest" data-action="pickWhen">Soonest free</div>'
    + '<div class="when-opt" data-w="Now" data-action="pickWhen">Run now</div>'
    + '<div class="when-opt" data-w="Run After" data-action="pickWhen">Pick day…</div></div>'
    + '<input id="fld-runAfter" type="datetime-local" style="display:none;margin-top:8px"></div>';
  const model = `<div class="field"><label>Model <span class="hint">(this job)</span></label>`
    + `<select id="fld-model">${modelSelectHtml('Auto')}</select></div>`;
  return `<div class="modal-head"><div class="modal-icon">${esc(f.icon)}</div>`
    + `<div class="modal-title">${esc(jobType)}</div></div>`
    + `<div class="modal-sub">${esc(f.sub)}</div>`
    + `<form id="dispatchForm" data-tt="${esc(jobType)}" data-agent="${esc(agent)}" data-action-form>`
    + `${fields}${when}${model}`
    + '<div class="modal-actions"><button type="button" class="btn ghost" data-action="closeModal">Cancel</button>'
    + '<button type="submit" class="btn" data-action="submitDispatch">Dispatch →</button></div></form>';
}

// ── Roster grid card ────────────────────────────────────────────────────────────────────────────
function cardHtml(a, perAgent) {
  const live = perAgent && perAgent[a.key];
  const dot = healthDot((live && live.health) || a.health);
  const healthText = (live && live.health) ? dot.label : a.ht;
  const chips = a.skills.slice(0, 7).map((s) => `<span class="chip">${esc(s)}</span>`).join('')
    + (a.skills.length > 7 ? `<span class="chip">+${a.skills.length - 7}</span>` : '');
  // "what they did" footer line: live runs this week when available, else a static hint.
  const runs7 = live && Number.isFinite(Number(live.runs7)) ? Number(live.runs7) : null;
  const didText = a.displayOnly
    ? 'On-demand — open its project'
    : (runs7 != null ? `${runs7} run${runs7 === 1 ? '' : 's'} in the last 7d` : 'No runs logged yet');
  // Color identity moves to a LEFT accent (the art already carries a top bezel — a top
  // border here produced the "double line"). border-left can't collide with the bezel.
  return `<div class="acard ag-${esc(a.key)}${a.displayOnly ? ' display-only' : ''}" data-id="${esc(a.key)}" data-action="openAgent" role="button" tabindex="0">`
    + `<div class="card-img-wrap"><span class="emoji-fallback">${esc(a.icon)}</span>`
    + `<img class="card-img" src="agent-art/${esc(a.key)}.png" alt="" onerror="this.style.display='none'"></div>`
    + '<div class="card-body"><div class="card-header"><div>'
    + `<div class="agent-name">${esc(a.name)}</div>`
    + `<span class="agent-type type-${esc(a.key)}">${esc(a.type)}</span></div>`
    + `<span class="health"><span class="hdot h-${dot.cls}"></span>${esc(healthText)}</span></div>`
    + `<div class="card-desc">${esc(a.desc)}</div>`
    + `<div class="skillrow">${chips}</div>`
    + `<div class="card-foot"><span class="did">${esc(didText)}</span>`
    + `<span class="open-hint">${a.displayOnly ? 'on demand →' : 'tap to open →'}</span></div>`
    + '</div></div>';
}

// ── Agent modal ────────────────────────────────────────────────────────────────────────────────
function agentModalHtml(a, state) {
  const status = safe(state.status, null);
  const perAgent = (status && status.perAgent) || {};
  const settings = (status && status.settings) || {};
  const pa = perAgent[a.key] || { spark: [], runs7: 0, runs30: 0, recent: [] };
  const dot = healthDot(pa.health || a.health);
  const curModel = (settings.perAgentModel && settings.perAgentModel[a.key]) || 'Auto';
  // Merge the live backend state with the local optimistic override (latter wins for instant UI).
  const backendPaused = Array.isArray(settings.pausedAgents) && settings.pausedAgents.indexOf(a.key) > -1;
  const paused = backendPaused || getPausedAgents().indexOf(a.key) > -1;

  const controls = a.displayOnly ? '' : (
    '<div class="profile-ctl">'
    + `<span class="agent-state ${paused ? 'paused' : 'active'}"><span class="state-dot"></span>${paused ? 'Paused' : 'Active'}</span>`
    + `<span class="mini-field">Default model <select data-action="setModel" data-id="${esc(a.key)}">${modelSelectHtml(curModel)}</select></span>`
    + '<span class="spacer"></span>'
    + `<button class="agent-toggle${paused ? ' paused' : ''}" data-action="togglePause" data-id="${esc(a.key)}">`
    + `${paused ? '▶ Start agent' : '⏸ Pause agent'}</button></div>`
  );
  const routines = a.routines.length
    ? `<div class="sec"><div class="sec-label">Routines — dispatch a job</div><div class="btn-row">${
      a.routines.map((r) => `<button class="dispatch-btn${r.custom ? ' custom' : ''}" data-action="openRoutine" data-tt="${esc(r.tt)}" data-id="${esc(a.key)}">${esc(r.t)}</button>`).join('')
    }</div></div>`
    : '<div class="empty-state">On-demand agent — open its project to work with it.</div>';
  const presets = a.presets.length
    ? `<div class="sec"><div class="sec-label">One-tap presets</div><div class="btn-row">${
      a.presets.map((p, i) => `<button class="dispatch-btn" data-action="firePreset" data-id="${esc(a.key)}" data-i="${i}">${esc(p.label)}</button>`).join('')
    }</div></div>`
    : '';
  const spark = (pa.spark && pa.spark.length)
    ? `<div class="spark">${pa.spark.map((n) => `<div class="bar" style="height:${Math.min(32, 4 + (Number(n) || 0) * 7)}px;background:var(--tag-${esc(a.key)})"></div>`).join('')}</div>`
    : '<div class="muted" style="font-size:12px">No activity data yet.</div>';
  const recent = (pa.recent && pa.recent.length)
    ? `<div class="list">${pa.recent.map((r) => `<div class="lrow"><span class="st st-${esc((r.status || '').toLowerCase())}">${esc(r.status || '')}</span><span class="grow">${esc(r.title || 'run')}</span><span class="time">${esc(r.when || '')}</span></div>`).join('')}</div>`
    : '<div class="muted" style="font-size:12px">No runs logged yet.</div>';
  const skills = `<div class="skillacc">${a.skills.map((s) => `<div class="skl" data-skill="${esc(s)}"><div class="skl-h" data-action="toggleSkill" data-skill="${esc(s)}">${esc(s)}<span class="caret">▶</span></div><div class="skl-b">${esc(SKILL_DESC[s] || 'Skill.')}</div></div>`).join('')}</div>`;

  return `<div class="modal-head agent-head">`
    + `<div style="flex:1"><div class="modal-title">${esc(a.name)}</div>`
    + `<span class="agent-type type-${esc(a.key)}">${esc(a.type)}</span></div>`
    + `<span class="health"><span class="hdot h-${dot.cls}"></span>${esc(dot.label)}</span></div>`
    + `<div class="modal-sub">${esc(a.desc)}</div>`
    + controls + routines + presets
    + `<div class="sec"><div class="sec-label">Activity (recent)</div>${spark}`
    + `<div class="activity-line"><span><b>${esc(pa.runs7 || 0)}</b> last 7d</span><span><b>${esc(pa.runs30 || 0)}</b> last 30d</span></div></div>`
    + `<div class="sec"><div class="sec-label">Recent runs</div>${recent}</div>`
    + `<div class="sec"><div class="sec-label">Skills — tap to see what each does</div>${skills}</div>`
    + '<div class="modal-actions"><button class="btn ghost" data-action="closeModal">Close</button></div>';
}

function renderModal(state) {
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');
  if (!overlay || !modal) return;
  const m = state.modal;
  if (!m || (m.kind !== 'agent' && m.kind !== 'dispatch')) {
    overlay.classList.remove('open');
    modal.innerHTML = '';
    return;
  }
  if (m.kind === 'agent') {
    const a = agentByKey(m.payload && m.payload.key);
    modal.className = 'modal wide';
    modal.innerHTML = a ? agentModalHtml(a, state) : '';
  } else {
    modal.className = 'modal';
    modal.innerHTML = dispatchForm(m.payload.taskType, m.payload.agent);
  }
  overlay.classList.add('open');
  wireOverlay(overlay);
}

// ── renderAgents — roster grid (4-wide × 2-row for 8 agents) ─────────────────────────────────
export function renderAgents(state, panelArg) {
  const panel = panelArg || document.getElementById('agents');
  if (!panel) return;
  const status = safe(state.status, null);
  const perAgent = (status && status.perAgent) || {};
  panel.innerHTML = `<div class="agrid grow" style="align-content:start">${roster().map((a) => cardHtml(a, perAgent)).join('')}</div>`
    + '<div class="note" style="text-align:center">Click an agent for routines, presets, recent runs, and an expandable skill list. Finance → <b>Financial Thesis</b> → just type the company.</div>';
  wirePanel(panel);
  renderModal(state);
}

// ── Event delegation ──────────────────────────────────────────────────────────────────────────
function wirePanel(panel) {
  if (panel.__agentsWired) return;
  panel.__agentsWired = true;
  panel.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="openAgent"]');
    if (!el) return;
    setState({ modal: { kind: 'agent', payload: { key: el.dataset.id } } });
    renderModal(getState());
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action="openAgent"]');
    if (!el) return;
    e.preventDefault();
    setState({ modal: { kind: 'agent', payload: { key: el.dataset.id } } });
    renderModal(getState());
  });
}

function wireOverlay(overlay) {
  if (overlay.__agentsWired) return;
  overlay.__agentsWired = true;

  const close = () => { setState({ modal: null }); renderModal(getState()); };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'closeModal') { close(); return; }
    if (action === 'openRoutine') {
      const a = agentByKey(el.dataset.id);
      setState({ modal: { kind: 'dispatch', payload: { taskType: el.dataset.tt, agent: a ? a.type : '' } } });
      renderModal(getState());
      return;
    }
    if (action === 'firePreset') {
      const a = agentByKey(el.dataset.id);
      const p = a && a.presets[Number(el.dataset.i)];
      if (p) {
        dispatchAction('dispatch', { job: p.label, agent: a.type, taskType: p.taskType, details: p.details, runMode: 'Downtime' }, `⚡ ${p.label}`);
        close();
      }
      return;
    }
    if (action === 'togglePause') {
      const key = el.dataset.id;
      const willPause = getPausedAgents().indexOf(key) === -1; // toggle relative to current local state
      setAgentPaused(key, willPause); // optimistic + persisted
      dispatchAction('toggleagentpause', { agent: agentTypeOf(key), paused: willPause },
        willPause ? 'Agent paused' : 'Agent started');
      renderModal(getState()); // re-render so the label + status light flip immediately
      return;
    }
    if (action === 'toggleSkill') {
      const skl = el.closest('.skl');
      if (skl) skl.classList.toggle('open');
      return;
    }
    if (action === 'pickWhen') {
      el.parentNode.querySelectorAll('.when-opt').forEach((o) => o.classList.remove('sel'));
      el.classList.add('sel');
      const ra = overlay.querySelector('#fld-runAfter');
      if (ra) ra.style.display = el.dataset.w === 'Run After' ? 'block' : 'none';
    }
  });

  overlay.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-action="setModel"]');
    if (!sel) return;
    dispatchAction('setagentmodel', { agent: agentTypeOf(sel.dataset.id), model: sel.value }, `Model → ${sel.value}`);
  });

  overlay.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action-form]');
    if (!form) return;
    e.preventDefault();
    submitDispatch(form, close);
  });
}

function agentTypeOf(key) { const a = agentByKey(key); return a ? a.type : key; }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function submitDispatch(form, close) {
  const tt = form.dataset.tt;
  const f = FORMS[tt];
  if (!f) return;
  const v = {};
  let missing = false;
  for (const fl of f.fields) {
    const el = form.querySelector(`#fld-${cssEsc(fl.k)}`);
    const val = el ? String(el.value || '').trim() : '';
    v[fl.k] = val;
    if (fl.req && !val) missing = true;
  }
  if (missing) { toast('Fill in the required field'); return; }
  let agent = form.dataset.agent || v.agent || 'Assistant';
  if (tt === 'Custom' && v.agent) agent = v.agent;
  const whenEl = form.querySelector('.when-opt.sel');
  const runMode = (whenEl && whenEl.dataset.w) || 'Downtime';
  const modelEl = form.querySelector('#fld-model');
  const details = f.fields.filter((fl) => v[fl.k] && fl.k !== 'agent').map((fl) => `${fl.label}: ${v[fl.k]}`).join('\n');
  dispatchAction('dispatch', {
    job: f.titleTpl(v), agent, taskType: tt, details, runMode, model: (modelEl && modelEl.value) || 'Auto',
  }, `Dispatched: ${f.titleTpl(v)} →`);
  close();
}
